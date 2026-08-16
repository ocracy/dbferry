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
  sslCaPath?: string
  sslCertPath?: string
  sslKeyPath?: string
  sslRejectUnauthorized?: boolean
}

export interface TableConfig {
  name: string
  mode: SyncMode
  pkColumn: string
  addColumn?: boolean
  dropColumn?: boolean
}

export interface RunLog {
  ts: number
  level: 'info' | 'warn' | 'error'
  message: string
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
  | { type: 'table-total'; runId: string; tableName: string; total: number }
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
  fullType?: string
  nullable: boolean
  isPrimaryKey: boolean
}

export interface TableMeta {
  name: string
  pkColumn: string | null
}

/** A single column-level difference between the source and the target table. */
export type ColumnDiffKind = 'missing-in-target' | 'extra-in-target' | 'type-mismatch'

export interface ColumnDiff {
  column: string
  kind: ColumnDiffKind
  sourceType: string | null
  targetType: string | null
  /** true when dbferry can generate the DDL to fix this difference */
  fixable: boolean
  /** why it is not fixable (shown in the UI) */
  reason?: string
}

export interface TableColumnDiff {
  table: string
  /** target table does not exist at all — dbferry does not generate CREATE TABLE */
  missingTable: boolean
  error?: string
  diffs: ColumnDiff[]
}

export interface SchemaDiffResult {
  sourceType: DbType
  targetType: DbType
  sameDriver: boolean
  scannedTables: number
  checkedAt: number
  /** only tables that have differences or an error */
  tables: TableColumnDiff[]
}

export interface ColumnFixAction {
  table: string
  column: string
  action: 'add' | 'drop'
}

export interface ColumnFixResult extends ColumnFixAction {
  ok: boolean
  error?: string
}

/** The CREATE TABLE dbferry would run on the target, shown for approval before it runs. */
export interface CreateTablePlan {
  table: string
  sql: string | null
  /** type translations and other things worth knowing before approving */
  warnings: string[]
  columnCount: number
  pkColumn: string | null
  /** already present on the target — nothing to do */
  exists: boolean
  error?: string
}

export interface CreateTableResult {
  table: string
  ok: boolean
  error?: string
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  releaseUrl: string | null
  releaseName: string | null
  publishedAt: string | null
  error?: string
}

export interface UpdateLogEvent {
  level: 'info' | 'warn' | 'error'
  message: string
  ts: number
}

export interface UpdateProgressEvent {
  received: number
  total: number | null
  percent: number | null
}

export interface UpdateDownloadResult {
  ok: boolean
  filePath: string | null
  assetName: string | null
  /** 'self-update' replaces the app bundle and relaunches; 'installer' opens the dmg/AppImage */
  mode?: 'self-update' | 'installer'
  /** true when the app is about to quit to finish the update */
  quitting?: boolean
  error?: string
}
