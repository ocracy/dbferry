import { Client } from 'pg'
import Cursor from 'pg-cursor'
import { from as copyFrom } from 'pg-copy-streams'
import type { ColumnInfo, TableMeta } from '@shared/types'
import type {
  BulkWriteOpts,
  ConnectionInfo,
  DbAdapter,
  StreamRowsOpts
} from './types'
import { buildPostgresSsl } from './ssl'
import { sanitizeDbConfig } from './sanitize'

function pgEscapeCopyValue(v: unknown): string {
  if (v === null || v === undefined) return '\\N'
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '+00')
  if (typeof v === 'boolean') return v ? 't' : 'f'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (Buffer.isBuffer(v)) return '\\\\x' + v.toString('hex')
  if (typeof v === 'object') {
    const json = JSON.stringify(v)
    return pgEscapeCopyText(json)
  }
  return pgEscapeCopyText(String(v))
}

function buildPgFullType(row: {
  data_type: string
  udt_name: string
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
}): string {
  const dt = row.data_type
  if (dt === 'character varying' || dt === 'varchar') {
    return row.character_maximum_length ? `varchar(${row.character_maximum_length})` : 'varchar'
  }
  if (dt === 'character' || dt === 'char') {
    return row.character_maximum_length ? `char(${row.character_maximum_length})` : 'char'
  }
  if (dt === 'numeric' || dt === 'decimal') {
    if (row.numeric_precision != null && row.numeric_scale != null)
      return `numeric(${row.numeric_precision},${row.numeric_scale})`
    return 'numeric'
  }
  if (dt === 'ARRAY') return `${row.udt_name.replace(/^_/, '')}[]`
  if (dt === 'USER-DEFINED') return row.udt_name
  return dt
}

/** Renders a label as a PostgreSQL string literal. */
export function pgLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function pgEscapeCopyText(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch === 0x5c) out += '\\\\'
    else if (ch === 0x09) out += '\\t'
    else if (ch === 0x0a) out += '\\n'
    else if (ch === 0x0d) out += '\\r'
    else out += s[i]
  }
  return out
}

export class PostgresAdapter implements DbAdapter {
  private client!: Client
  private inTx = false
  constructor(private info: ConnectionInfo) {}

  identifier(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"'
  }

  async connect(): Promise<void> {
    const { password } = this.info
    const config = sanitizeDbConfig(this.info.config)
    this.client = new Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password,
      database: config.database,
      ssl: buildPostgresSsl(config)
    })
    await this.client.connect()
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.end()
      } catch {}
    }
  }

  destroy(): void {
    try {
      const stream = (this.client as unknown as { connection?: { stream?: { destroy?: () => void } } })
        .connection?.stream
      stream?.destroy?.()
    } catch {}
  }

  async ping(): Promise<{ serverVersion: string }> {
    const r = await this.client.query<{ version: string }>('SELECT version() AS version')
    return { serverVersion: r.rows[0]?.version ?? 'unknown' }
  }

  async listTables(): Promise<string[]> {
    const r = await this.client.query<{ name: string }>(
      `SELECT table_name AS name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`
    )
    return r.rows.map((row) => row.name)
  }

  async listTablesMeta(): Promise<TableMeta[]> {
    const r = await this.client.query<{ name: string; pk: string | null }>(
      `SELECT t.table_name AS name, kcu.column_name AS pk
         FROM information_schema.tables t
         LEFT JOIN information_schema.table_constraints tc
           ON tc.table_schema = t.table_schema
          AND tc.table_name = t.table_name
          AND tc.constraint_type = 'PRIMARY KEY'
         LEFT JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_schema = tc.constraint_schema
          AND kcu.constraint_name = tc.constraint_name
          AND kcu.ordinal_position = 1
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name`
    )
    return r.rows.map((row) => ({ name: row.name, pkColumn: row.pk ?? null }))
  }

  async execute(sql: string): Promise<void> {
    await this.client.query(sql)
  }

  async addColumn(table: string, col: ColumnInfo): Promise<void> {
    const typeSql = col.fullType || col.dataType
    await this.client.query(
      `ALTER TABLE ${this.identifier(table)} ADD COLUMN ${this.identifier(col.name)} ${typeSql}`
    )
  }

  async dropColumn(table: string, columnName: string): Promise<void> {
    await this.client.query(
      `ALTER TABLE ${this.identifier(table)} DROP COLUMN ${this.identifier(columnName)}`
    )
  }

  /**
   * PostgreSQL keeps the labels on the type, not the column, so the values are
   * appended to the enum type itself. ADD VALUE cannot run inside a transaction
   * block, which is why schema fixes are applied outside one.
   */
  async addEnumValues(
    table: string,
    column: string,
    opts: { newValues: string[] }
  ): Promise<void> {
    const cols = await this.getColumns(table)
    const col = cols.find((c) => c.name.toLowerCase() === column.toLowerCase())
    if (!col?.enumTypeName) {
      throw new Error(`Column "${column}" is not backed by an enum type on the target`)
    }
    for (const value of opts.newValues) {
      await this.client.query(
        `ALTER TYPE ${this.identifier(col.enumTypeName)} ADD VALUE IF NOT EXISTS ${pgLiteral(value)}`
      )
    }
  }

  async countRows(table: string): Promise<number> {
    const r = await this.client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM ${this.identifier(table)}`
    )
    return Number(r.rows[0]?.c ?? 0)
  }

  async countRowsAfterPk(
    table: string,
    pkColumn: string,
    pkGreaterThan: string | number | bigint
  ): Promise<number> {
    const r = await this.client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM ${this.identifier(table)} WHERE ${this.identifier(pkColumn)} > $1`,
      [pkGreaterThan]
    )
    return Number(r.rows[0]?.c ?? 0)
  }

  async getColumns(table: string): Promise<ColumnInfo[]> {
    const r = await this.client.query<{
      name: string
      data_type: string
      udt_name: string
      character_maximum_length: number | null
      numeric_precision: number | null
      numeric_scale: number | null
      is_nullable: string
      is_pk: boolean
    }>(
      `SELECT c.column_name AS name,
              c.data_type AS data_type,
              c.udt_name AS udt_name,
              c.character_maximum_length,
              c.numeric_precision,
              c.numeric_scale,
              c.is_nullable AS is_nullable,
              EXISTS (
                SELECT 1 FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                 WHERE tc.constraint_type = 'PRIMARY KEY'
                   AND tc.table_schema = c.table_schema
                   AND tc.table_name = c.table_name
                   AND kcu.column_name = c.column_name
              ) AS is_pk
         FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = $1
        ORDER BY c.ordinal_position`,
      [table]
    )
    // Enum labels do not live in information_schema — a column only points at its
    // type, so adding a value to the type is invisible without this lookup.
    const enumTypes = r.rows.some((row) => row.data_type === 'USER-DEFINED' || row.data_type === 'ARRAY')
      ? await this.enumLabels(r.rows.map((row) => row.udt_name.replace(/^_/, '')))
      : new Map<string, string[]>()

    return r.rows.map((row) => {
      const typeName = row.udt_name.replace(/^_/, '')
      const labels = enumTypes.get(typeName)
      return {
        name: row.name,
        dataType: row.data_type,
        fullType: buildPgFullType(row),
        nullable: row.is_nullable === 'YES',
        isPrimaryKey: row.is_pk === true,
        enumValues: labels,
        enumTypeName: labels ? typeName : undefined
      }
    })
  }

  /** Labels of the given enum types, keyed by type name, in declaration order. */
  private async enumLabels(typeNames: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>()
    if (typeNames.length === 0) return out
    const r = await this.client.query<{ typname: string; enumlabel: string }>(
      `SELECT t.typname, e.enumlabel
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = ANY($1::text[])
        ORDER BY t.typname, e.enumsortorder`,
      [Array.from(new Set(typeNames))]
    )
    for (const row of r.rows) {
      const list = out.get(row.typname)
      if (list) list.push(row.enumlabel)
      else out.set(row.typname, [row.enumlabel])
    }
    return out
  }

  async getMaxPk(table: string, pkColumn: string): Promise<string | number | bigint | null> {
    const r = await this.client.query<{ m: unknown }>(
      `SELECT MAX(${this.identifier(pkColumn)}) AS m FROM ${this.identifier(table)}`
    )
    const v = r.rows[0]?.m
    return v == null ? null : (v as number | string)
  }

  async *streamRows(table: string, opts: StreamRowsOpts): AsyncIterable<unknown[][]> {
    const cols = opts.columns.map((c) => this.identifier(c)).join(', ')
    const where =
      opts.pkColumn && opts.pkGreaterThan != null
        ? ` WHERE ${this.identifier(opts.pkColumn)} > $1`
        : ''
    const order = opts.pkColumn ? ` ORDER BY ${this.identifier(opts.pkColumn)} ASC` : ''
    const sql = `SELECT ${cols} FROM ${this.identifier(table)}${where}${order}`
    const params = where ? [opts.pkGreaterThan as never] : []
    const cursor = this.client.query(new Cursor(sql, params, { rowMode: 'array' }))

    try {
      while (true) {
        if (opts.cancelSignal?.aborted) throw new Error('cancelled')
        const rows: unknown[][] = await new Promise((resolve, reject) => {
          cursor.read(opts.batchSize, (err: Error | null, rows: unknown[]) =>
            err ? reject(err) : resolve(rows as unknown[][])
          )
        })
        if (rows.length === 0) break
        yield rows
      }
    } finally {
      await new Promise<void>((resolve) => cursor.close(() => resolve()))
    }
  }

  async truncate(table: string): Promise<void> {
    await this.client.query(`TRUNCATE TABLE ${this.identifier(table)} RESTART IDENTITY CASCADE`)
  }

  async bulkWrite(
    table: string,
    rowsBatches: AsyncIterable<unknown[][]>,
    opts: BulkWriteOpts
  ): Promise<number> {
    const colList = opts.columns.map((c) => this.identifier(c.name)).join(', ')
    const sql = `COPY ${this.identifier(table)} (${colList}) FROM STDIN WITH (FORMAT text)`
    const stream = this.client.query(copyFrom(sql))

    let total = 0
    let firstError: Error | null = null

    const finishedPromise = new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve())
      stream.on('error', (err) => {
        firstError = err
        reject(err)
      })
    })

    const writeLine = (line: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const ok = stream.write(line, (err) => {
          if (err) reject(err)
        })
        if (ok) resolve()
        else stream.once('drain', () => resolve())
      })

    try {
      for await (const batch of rowsBatches) {
        if (opts.cancelSignal?.aborted) {
          stream.destroy(new Error('cancelled'))
          throw new Error('cancelled')
        }
        for (const row of batch) {
          const line = row.map(pgEscapeCopyValue).join('\t') + '\n'
          await writeLine(line)
        }
        total += batch.length
        opts.onProgress?.(batch.length)
      }
      stream.end()
      await finishedPromise
    } catch (err) {
      if (!firstError) firstError = err as Error
      try {
        stream.destroy(firstError)
      } catch {}
      throw firstError
    }
    return total
  }

  async setConstraintsDisabled(disabled: boolean): Promise<void> {
    await this.client.query(
      disabled
        ? `SET session_replication_role = 'replica'`
        : `SET session_replication_role = 'origin'`
    )
  }

  async beginTransaction(): Promise<void> {
    if (this.inTx) return
    await this.client.query('BEGIN')
    this.inTx = true
  }
  async commit(): Promise<void> {
    if (!this.inTx) return
    await this.client.query('COMMIT')
    this.inTx = false
  }
  async rollback(): Promise<void> {
    if (!this.inTx) return
    await this.client.query('ROLLBACK')
    this.inTx = false
  }
}
