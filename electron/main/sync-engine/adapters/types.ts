import type { ColumnInfo, DbConfig, TableMeta } from '@shared/types'

export interface ConnectionInfo {
  config: DbConfig
  password: string
}

export interface BulkWriteOpts {
  columns: ColumnInfo[]
  onProgress?: (rowsCopiedDelta: number) => void
  cancelSignal?: AbortSignal
}

export interface StreamRowsOpts {
  columns: string[]
  pkColumn?: string
  pkGreaterThan?: string | number | bigint | null
  batchSize: number
  cancelSignal?: AbortSignal
}

export interface DbAdapter {
  connect(): Promise<void>
  close(): Promise<void>
  destroy(): void
  ping(): Promise<{ serverVersion: string }>
  listTables(): Promise<string[]>
  listTablesMeta(): Promise<TableMeta[]>
  countRows(table: string): Promise<number>
  countRowsAfterPk(table: string, pkColumn: string, pkGreaterThan: string | number | bigint): Promise<number>
  /** Runs a DDL statement built by `sync-engine/ddl.ts`. Never used for user input. */
  execute(sql: string): Promise<void>
  addColumn(table: string, col: ColumnInfo): Promise<void>
  dropColumn(table: string, columnName: string): Promise<void>
  getColumns(table: string): Promise<ColumnInfo[]>
  getMaxPk(table: string, pkColumn: string): Promise<string | number | bigint | null>
  streamRows(table: string, opts: StreamRowsOpts): AsyncIterable<unknown[][]>
  truncate(table: string): Promise<void>
  bulkWrite(table: string, rowsBatches: AsyncIterable<unknown[][]>, opts: BulkWriteOpts): Promise<number>
  setConstraintsDisabled(disabled: boolean): Promise<void>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  identifier(name: string): string
}
