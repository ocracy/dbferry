import type {
  ColumnDiff,
  ColumnFixAction,
  ColumnFixResult,
  ColumnInfo,
  CreateTablePlan,
  CreateTableResult,
  Project,
  SchemaDiffResult,
  TableColumnDiff
} from '@shared/types'
import type { DbAdapter } from './adapters/types'
import { MysqlAdapter } from './adapters/mysql'
import { PostgresAdapter } from './adapters/postgres'
import { intersectColumns } from './type-mapper'
import { buildCreateTable } from './ddl'

function adapterFor(type: Project['source']['type'], config: Project['source'], password: string): DbAdapter {
  if (type === 'mysql') return new MysqlAdapter({ config, password })
  return new PostgresAdapter({ config, password })
}

function typeLabel(col: ColumnInfo): string {
  return (col.fullType || col.dataType).toLowerCase()
}

/**
 * Same-driver type comparison. Cross-driver types are intentionally never compared —
 * `varchar(255)` vs `character varying(255)` would flag every single column.
 */
function typesDiffer(src: ColumnInfo, tgt: ColumnInfo): boolean {
  return typeLabel(src).replace(/\s+/g, '') !== typeLabel(tgt).replace(/\s+/g, '')
}

async function withConnections<T>(
  project: Project,
  srcPwd: string,
  tgtPwd: string,
  fn: (src: DbAdapter, tgt: DbAdapter) => Promise<T>
): Promise<T> {
  const src = adapterFor(project.source.type, project.source, srcPwd)
  const tgt = adapterFor(project.target.type, project.target, tgtPwd)
  await src.connect()
  try {
    await tgt.connect()
  } catch (err) {
    await src.close().catch(() => {})
    throw err
  }
  try {
    return await fn(src, tgt)
  } finally {
    await src.close().catch(() => {})
    await tgt.close().catch(() => {})
  }
}

/**
 * Compares the column layout of each requested table between source and target.
 * Only tables that actually differ (or failed to read) end up in the result.
 */
export async function diffSchema(
  project: Project,
  srcPwd: string,
  tgtPwd: string,
  tableNames: string[]
): Promise<SchemaDiffResult> {
  const sameDriver = project.source.type === project.target.type

  const tables = await withConnections(project, srcPwd, tgtPwd, async (src, tgt) => {
    const targetTables = new Set((await tgt.listTables()).map((t) => t.toLowerCase()))
    const out: TableColumnDiff[] = []

    for (const table of tableNames) {
      if (!targetTables.has(table.toLowerCase())) {
        out.push({ table, missingTable: true, diffs: [] })
        continue
      }
      try {
        const [srcCols, tgtCols] = await Promise.all([src.getColumns(table), tgt.getColumns(table)])
        const { matched, missingInTarget, missingInSource } = intersectColumns(srcCols, tgtCols)
        const diffs: ColumnDiff[] = []

        for (const name of missingInTarget) {
          const col = srcCols.find((c) => c.name === name)!
          diffs.push({
            column: name,
            kind: 'missing-in-target',
            sourceType: typeLabel(col),
            targetType: null,
            fixable: sameDriver,
            reason: sameDriver ? undefined : 'Cross-driver type translation is not supported'
          })
        }
        for (const name of missingInSource) {
          const col = tgtCols.find((c) => c.name === name)!
          diffs.push({
            column: name,
            kind: 'extra-in-target',
            sourceType: null,
            targetType: typeLabel(col),
            // Dropping needs no type translation, so it works across drivers too.
            fixable: !col.isPrimaryKey,
            reason: col.isPrimaryKey ? 'Primary key column — drop it manually' : undefined
          })
        }
        for (const m of matched) {
          // Enum labels are comparable across drivers even when the type names are
          // not, and a value added on the source is the case worth catching here.
          const srcVals = m.src.enumValues
          const tgtVals = m.tgt.enumValues
          if (srcVals?.length && tgtVals?.length) {
            const tgtSet = new Set(tgtVals)
            const srcSet = new Set(srcVals)
            const missingValues = srcVals.filter((v) => !tgtSet.has(v))
            const extraValues = tgtVals.filter((v) => !srcSet.has(v))
            if (missingValues.length || extraValues.length) {
              diffs.push({
                column: m.src.name,
                kind: 'enum-values',
                sourceType: typeLabel(m.src),
                targetType: typeLabel(m.tgt),
                missingValues,
                extraValues,
                // Adding labels is safe; removing one would invalidate existing rows.
                fixable: missingValues.length > 0,
                reason:
                  missingValues.length === 0
                    ? 'Only the target has extra labels — they are never removed automatically'
                    : undefined
              })
            }
            // The enum entry already describes this column — a raw type mismatch on
            // the same column would only repeat the label list.
            continue
          }
          if (sameDriver && typesDiffer(m.src, m.tgt)) {
            diffs.push({
              column: m.src.name,
              kind: 'type-mismatch',
              sourceType: typeLabel(m.src),
              targetType: typeLabel(m.tgt),
              fixable: false,
              reason: 'Type changes are not applied automatically — ALTER can lose data'
            })
          }
        }

        if (diffs.length) out.push({ table, missingTable: false, diffs })
      } catch (err) {
        out.push({
          table,
          missingTable: false,
          diffs: [],
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return out
  })

  return {
    sourceType: project.source.type,
    targetType: project.target.type,
    sameDriver,
    scannedTables: tableNames.length,
    checkedAt: Date.now(),
    tables
  }
}

/**
 * Builds the CREATE TABLE statement for each requested table without running it,
 * so the user can read the DDL before approving it.
 */
export async function planCreateTables(
  project: Project,
  srcPwd: string,
  tgtPwd: string,
  tableNames: string[]
): Promise<CreateTablePlan[]> {
  if (tableNames.length === 0) return []

  return withConnections(project, srcPwd, tgtPwd, async (src, tgt) => {
    const existing = new Set((await tgt.listTables()).map((t) => t.toLowerCase()))
    const plans: CreateTablePlan[] = []

    for (const table of tableNames) {
      const base: CreateTablePlan = {
        table,
        sql: null,
        warnings: [],
        columnCount: 0,
        pkColumn: null,
        exists: existing.has(table.toLowerCase())
      }
      if (base.exists) {
        plans.push(base)
        continue
      }
      try {
        const cols = await src.getColumns(table)
        const { sql, prelude, warnings } = buildCreateTable(
          table,
          cols,
          project.source.type,
          project.target.type,
          (n) => tgt.identifier(n)
        )
        plans.push({
          ...base,
          // Show the enum types the table depends on together with the table itself.
          sql: [...prelude, sql].join(';\n\n'),
          warnings,
          columnCount: cols.length,
          pkColumn: cols.find((c) => c.isPrimaryKey)?.name ?? null
        })
      } catch (err) {
        plans.push({ ...base, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return plans
  })
}

/** Runs the approved CREATE TABLE statements on the target. One failure does not stop the rest. */
export async function createTables(
  project: Project,
  srcPwd: string,
  tgtPwd: string,
  tableNames: string[]
): Promise<CreateTableResult[]> {
  if (tableNames.length === 0) return []

  return withConnections(project, srcPwd, tgtPwd, async (src, tgt) => {
    const existing = new Set((await tgt.listTables()).map((t) => t.toLowerCase()))
    const results: CreateTableResult[] = []

    for (const table of tableNames) {
      try {
        if (existing.has(table.toLowerCase())) {
          throw new Error('Table already exists on the target')
        }
        const cols = await src.getColumns(table)
        const { sql, prelude } = buildCreateTable(
          table,
          cols,
          project.source.type,
          project.target.type,
          (n) => tgt.identifier(n)
        )
        // Enum types first — the table definition references them.
        for (const stmt of prelude) await tgt.execute(stmt)
        await tgt.execute(sql)
        results.push({ table, ok: true })
      } catch (err) {
        results.push({ table, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return results
  })
}

/**
 * Applies user-confirmed column fixes on the TARGET database only.
 * Each action is independent — one failure does not stop the rest.
 */
export async function applyColumnFixes(
  project: Project,
  srcPwd: string,
  tgtPwd: string,
  actions: ColumnFixAction[]
): Promise<ColumnFixResult[]> {
  if (actions.length === 0) return []

  return withConnections(project, srcPwd, tgtPwd, async (src, tgt) => {
    const results: ColumnFixResult[] = []
    const srcColsCache = new Map<string, ColumnInfo[]>()

    for (const action of actions) {
      try {
        if (action.action === 'add-enum-values') {
          const values = action.values ?? []
          if (values.length === 0) throw new Error('No labels to add')
          const tgtCol = (await tgt.getColumns(action.table)).find(
            (x) => x.name.toLowerCase() === action.column.toLowerCase()
          )
          if (!tgtCol) throw new Error('Column no longer exists on target')
          const existing = tgtCol.enumValues ?? []
          if (existing.length === 0) throw new Error('Target column is not an enum')
          // Keep the target's current order and append what is missing, so existing
          // rows keep meaning the same thing.
          const fullValues = [...existing, ...values.filter((v) => !existing.includes(v))]
          // The target's own base type decides how it is redeclared (PG has no SET).
          const base = tgtCol.dataType.toLowerCase() === 'set' ? 'set' : 'enum'
          await tgt.addEnumValues(action.table, action.column, {
            newValues: values,
            fullValues,
            nullable: tgtCol.nullable,
            base
          })
        } else if (action.action === 'add') {
          if (project.source.type !== project.target.type) {
            throw new Error('Cross-driver ADD COLUMN is not supported')
          }
          let cols = srcColsCache.get(action.table)
          if (!cols) {
            cols = await src.getColumns(action.table)
            srcColsCache.set(action.table, cols)
          }
          const col = cols.find((c) => c.name.toLowerCase() === action.column.toLowerCase())
          if (!col) throw new Error(`Column no longer exists on source`)
          await tgt.addColumn(action.table, col)
        } else {
          await tgt.dropColumn(action.table, action.column)
        }
        results.push({ ...action, ok: true })
      } catch (err) {
        results.push({
          ...action,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return results
  })
}
