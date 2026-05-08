export type DbType = 'mysql' | 'postgres'
export type SyncMode = 'disabled' | 'incremental' | 'full'
export type SyncStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled'
export type RunTrigger = 'manual' | 'scheduled'

export interface DbConfig {
  type: DbType
  host: string
  port: number
  user: string
  database: string
  ssl?: boolean
}

export interface TableConfig {
  name: string
  mode: SyncMode
  pkColumn: string
}

export interface Project {
  id: string
  name: string
  source: DbConfig
  target: DbConfig
  tables: TableConfig[]
  scheduleEnabled: boolean
  scheduleCron: string | null
  tableConcurrency: number
  createdAt: number
  updatedAt: number
}

export interface JsonProjectExport {
  version: 1
  name: string
  source: DbConfig
  target: DbConfig
  tables: TableConfig[]
  schedule: { enabled: boolean; cron: string | null }
  tableConcurrency: number
}

export interface SyncTableRun {
  runId: string
  tableName: string
  mode: SyncMode
  rowsCopied: number
  durationMs: number
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'cancelled'
  error: string | null
}

export interface SyncRun {
  id: string
  projectId: string
  startedAt: number
  finishedAt: number | null
  status: SyncStatus
  trigger: RunTrigger
  fullCount: number
  incrementalCount: number
  disabledCount: number
  totalRows: number
  errorSummary: string | null
}

export type SyncProgressEvent =
  | { type: 'run-started'; runId: string; projectId: string; totalTables: number }
  | { type: 'table-started'; runId: string; tableName: string; mode: SyncMode; index: number; total: number }
  | { type: 'table-progress'; runId: string; tableName: string; rowsCopied: number; rowsPerSec: number }
  | { type: 'table-finished'; runId: string; tableName: string; rowsCopied: number; durationMs: number; status: SyncTableRun['status']; error?: string }
  | { type: 'run-finished'; runId: string; status: SyncStatus; durationMs: number }
  | { type: 'log'; runId: string; level: 'info' | 'warn' | 'error'; message: string }

export interface ConnectionTestResult {
  ok: boolean
  message: string
  serverVersion?: string
  tableCount?: number
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  isPrimaryKey: boolean
}

export interface TableMeta {
  name: string
  pkColumn: string | null
}
