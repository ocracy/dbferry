import mysql from 'mysql2/promise'
import type { ColumnInfo, TableMeta } from '@shared/types'
import type {
  BulkWriteOpts,
  ConnectionInfo,
  DbAdapter,
  StreamRowsOpts
} from './types'
import { buildMysqlSsl } from './ssl'

const WRITE_CHUNK = 500
// Stay well under MySQL server's default max_allowed_packet (which can be as
// low as 4 MiB on shared hosts). 4 MiB target keeps us safe across most setups.
const MAX_PACKET_BYTES = 4 * 1024 * 1024

function estimateRowBytes(row: unknown[]): number {
  let n = 4 // overhead per row
  for (const v of row) {
    if (v == null) n += 4
    else if (typeof v === 'string') n += v.length + 4
    else if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') n += 16
    else if (Buffer.isBuffer(v)) n += v.length + 4
    else n += String(v).length + 4
  }
  return n
}

export class MysqlAdapter implements DbAdapter {
  private conn!: mysql.Connection
  constructor(private info: ConnectionInfo) {}

  identifier(name: string): string {
    return '`' + name.replace(/`/g, '``') + '`'
  }

  async connect(): Promise<void> {
    const { config, password } = this.info
    this.conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password,
      database: config.database,
      ssl: buildMysqlSsl(config),
      multipleStatements: false,
      dateStrings: true,
      timezone: 'Z',
      supportBigNumbers: true,
      bigNumberStrings: true,
      // Allow large packets (bulk INSERTs of rows with big JSON/BLOB).
      // Cast to any: mysql2 supports this option but its type defs lag.
      ...({ maxAllowedPacket: 256 * 1024 * 1024 } as Record<string, unknown>)
    })
  }

  async close(): Promise<void> {
    if (this.conn) {
      try {
        await this.conn.end()
      } catch {}
    }
  }

  destroy(): void {
    try {
      if (this.conn) (this.conn as unknown as { destroy?: () => void }).destroy?.()
    } catch {}
  }

  async ping(): Promise<{ serverVersion: string }> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>('SELECT VERSION() AS v')
    return { serverVersion: String(rows[0]?.v ?? 'unknown') }
  }

  async listTables(): Promise<string[]> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS name
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      [this.info.config.database]
    )
    return rows.map((r) => String(r.name))
  }

  async listTablesMeta(): Promise<TableMeta[]> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(
      `SELECT t.TABLE_NAME AS name, k.COLUMN_NAME AS pk
         FROM information_schema.TABLES t
         LEFT JOIN information_schema.KEY_COLUMN_USAGE k
           ON k.TABLE_SCHEMA = t.TABLE_SCHEMA
          AND k.TABLE_NAME = t.TABLE_NAME
          AND k.CONSTRAINT_NAME = 'PRIMARY'
          AND k.ORDINAL_POSITION = 1
        WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_NAME`,
      [this.info.config.database]
    )
    return rows.map((r) => ({
      name: String(r.name),
      pkColumn: r.pk ? String(r.pk) : null
    }))
  }

  async addColumn(table: string, col: ColumnInfo): Promise<void> {
    // Always use fullType (e.g. `varchar(255)`) — DATA_TYPE alone is invalid for VARCHAR/etc.
    // Always allow NULL on added columns to avoid backfill failures on existing rows.
    const typeSql = col.fullType || col.dataType
    await this.conn.query(
      `ALTER TABLE ${this.identifier(table)} ADD COLUMN ${this.identifier(col.name)} ${typeSql} NULL`
    )
  }

  async dropColumn(table: string, columnName: string): Promise<void> {
    await this.conn.query(
      `ALTER TABLE ${this.identifier(table)} DROP COLUMN ${this.identifier(columnName)}`
    )
  }

  async countRows(table: string): Promise<number> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${this.identifier(table)}`
    )
    return Number(rows[0]?.c ?? 0)
  }

  async countRowsAfterPk(
    table: string,
    pkColumn: string,
    pkGreaterThan: string | number | bigint
  ): Promise<number> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${this.identifier(table)} WHERE ${this.identifier(pkColumn)} > ?`,
      [pkGreaterThan]
    )
    return Number(rows[0]?.c ?? 0)
  }

  async getColumns(table: string): Promise<ColumnInfo[]> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS fullType, IS_NULLABLE AS nullable, COLUMN_KEY AS keyType
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [this.info.config.database, table]
    )
    return rows.map((r) => ({
      name: String(r.name),
      dataType: String(r.dataType),
      fullType: r.fullType ? String(r.fullType) : undefined,
      nullable: r.nullable === 'YES',
      isPrimaryKey: r.keyType === 'PRI'
    }))
  }

  async getMaxPk(table: string, pkColumn: string): Promise<string | number | bigint | null> {
    const sql = `SELECT MAX(${this.identifier(pkColumn)}) AS m FROM ${this.identifier(table)}`
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(sql)
    const v = rows[0]?.m
    return v == null ? null : (v as number | string)
  }

  async *streamRows(table: string, opts: StreamRowsOpts): AsyncIterable<unknown[][]> {
    const cols = opts.columns.map((c) => this.identifier(c)).join(', ')
    const where =
      opts.pkColumn && opts.pkGreaterThan != null
        ? ` WHERE ${this.identifier(opts.pkColumn)} > ?`
        : ''
    const order = opts.pkColumn ? ` ORDER BY ${this.identifier(opts.pkColumn)} ASC` : ''
    const sql = `SELECT ${cols} FROM ${this.identifier(table)}${where}${order}`
    const params = where ? [opts.pkGreaterThan as never] : []

    const stream = (this.conn as unknown as {
      connection: {
        query: (opts: { sql: string; values: unknown[]; rowsAsArray: boolean }) => {
          stream: (opts: { highWaterMark: number }) => AsyncIterable<unknown[]> & { destroy?: () => void }
        }
      }
    }).connection
      .query({ sql, values: params, rowsAsArray: true })
      .stream({ highWaterMark: 50 })

    let buf: unknown[][] = []
    for await (const row of stream as AsyncIterable<unknown[]>) {
      if (opts.cancelSignal?.aborted) {
        ;(stream as { destroy?: () => void }).destroy?.()
        throw new Error('cancelled')
      }
      buf.push(row)
      if (buf.length >= opts.batchSize) {
        yield buf
        buf = []
      }
    }
    if (buf.length) yield buf
  }

  async truncate(table: string): Promise<void> {
    await this.conn.query(`TRUNCATE TABLE ${this.identifier(table)}`)
  }

  async bulkWrite(
    table: string,
    rowsBatches: AsyncIterable<unknown[][]>,
    opts: BulkWriteOpts
  ): Promise<number> {
    const colNames = opts.columns.map((c) => this.identifier(c.name)).join(', ')
    let total = 0

    const flush = async (chunk: unknown[][]) => {
      if (chunk.length === 0) return
      const placeholders = chunk
        .map(() => `(${opts.columns.map(() => '?').join(',')})`)
        .join(',')
      const flat: unknown[] = []
      for (const row of chunk) for (const v of row) flat.push(v)
      const sql = `INSERT IGNORE INTO ${this.identifier(table)} (${colNames}) VALUES ${placeholders}`
      try {
        await this.conn.query(sql, flat)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Retry one row at a time when bulk fails — surfaces the offending row
        // and survives transient packet/size issues.
        if (chunk.length > 1) {
          for (const row of chunk) {
            await this.conn.query(
              `INSERT IGNORE INTO ${this.identifier(table)} (${colNames}) VALUES (${opts.columns.map(() => '?').join(',')})`,
              row
            )
          }
          return
        }
        throw new Error(`${msg} (chunk size=${chunk.length})`)
      }
    }

    for await (const batch of rowsBatches) {
      if (opts.cancelSignal?.aborted) throw new Error('cancelled')
      let pending: unknown[][] = []
      let pendingBytes = 0
      for (const row of batch) {
        const rowBytes = estimateRowBytes(row)
        if (
          pending.length > 0 &&
          (pending.length >= WRITE_CHUNK || pendingBytes + rowBytes > MAX_PACKET_BYTES)
        ) {
          await flush(pending)
          total += pending.length
          opts.onProgress?.(pending.length)
          pending = []
          pendingBytes = 0
        }
        pending.push(row)
        pendingBytes += rowBytes
      }
      if (pending.length > 0) {
        await flush(pending)
        total += pending.length
        opts.onProgress?.(pending.length)
      }
    }
    return total
  }

  async setConstraintsDisabled(disabled: boolean): Promise<void> {
    if (disabled) {
      await this.conn.query('SET FOREIGN_KEY_CHECKS=0')
      await this.conn.query('SET UNIQUE_CHECKS=0')
    } else {
      await this.conn.query('SET FOREIGN_KEY_CHECKS=1')
      await this.conn.query('SET UNIQUE_CHECKS=1')
    }
  }

  async beginTransaction(): Promise<void> {
    await this.conn.beginTransaction()
  }
  async commit(): Promise<void> {
    await this.conn.commit()
  }
  async rollback(): Promise<void> {
    await this.conn.rollback()
  }
}
