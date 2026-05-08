import mysql from 'mysql2/promise'
import type { ColumnInfo, TableMeta } from '@shared/types'
import type {
  BulkWriteOpts,
  ConnectionInfo,
  DbAdapter,
  StreamRowsOpts
} from './types'

const WRITE_CHUNK = 1000

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
      ssl: config.ssl ? {} : undefined,
      multipleStatements: false,
      dateStrings: true,
      timezone: 'Z',
      supportBigNumbers: true,
      bigNumberStrings: true
    })
  }

  async close(): Promise<void> {
    if (this.conn) await this.conn.end()
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

  async getColumns(table: string): Promise<ColumnInfo[]> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_KEY AS keyType
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [this.info.config.database, table]
    )
    return rows.map((r) => ({
      name: String(r.name),
      dataType: String(r.dataType),
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
    for await (const batch of rowsBatches) {
      if (opts.cancelSignal?.aborted) throw new Error('cancelled')
      for (let i = 0; i < batch.length; i += WRITE_CHUNK) {
        const chunk = batch.slice(i, i + WRITE_CHUNK)
        const placeholders = chunk
          .map(() => `(${opts.columns.map(() => '?').join(',')})`)
          .join(',')
        const flat: unknown[] = []
        for (const row of chunk) for (const v of row) flat.push(v)
        const sql = `INSERT IGNORE INTO ${this.identifier(table)} (${colNames}) VALUES ${placeholders}`
        await this.conn.query(sql, flat)
        total += chunk.length
        opts.onProgress?.(chunk.length)
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
