import type {
  ColumnDiff,
  ColumnFixAction,
  ColumnFixResult,
  ColumnInfo,
  Project,
  SchemaDiffResult,
  TableColumnDiff
} from '@shared/types'
import type { DbAdapter } from './adapters/types'
import { MysqlAdapter } from './adapters/mysql'
import { PostgresAdapter } from './adapters/postgres'
import { intersectColumns } from './type-mapper'

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
        if (sameDriver) {
          for (const m of matched) {
            if (!typesDiffer(m.src, m.tgt)) continue
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
        if (action.action === 'add') {
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
