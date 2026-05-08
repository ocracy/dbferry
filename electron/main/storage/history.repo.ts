import { nanoid } from 'nanoid'
import type { SyncRun, SyncTableRun, SyncStatus, RunTrigger } from '@shared/types'
import { getDb } from './sqlite'

const MAX_RUNS = 500

interface RunRow {
  id: string
  project_id: string
  started_at: number
  finished_at: number | null
  status: string
  trigger: string
  full_count: number
  incremental_count: number
  disabled_count: number
  total_rows: number
  error_summary: string | null
}

interface TableRunRow {
  run_id: string
  table_name: string
  mode: string
  rows_copied: number
  duration_ms: number
  status: string
  error: string | null
}

function rowToRun(r: RunRow): SyncRun {
  return {
    id: r.id,
    projectId: r.project_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status as SyncStatus,
    trigger: r.trigger as RunTrigger,
    fullCount: r.full_count,
    incrementalCount: r.incremental_count,
    disabledCount: r.disabled_count,
    totalRows: r.total_rows ?? 0,
    errorSummary: r.error_summary
  }
}

function rowToTableRun(r: TableRunRow): SyncTableRun {
  return {
    runId: r.run_id,
    tableName: r.table_name,
    mode: r.mode as SyncTableRun['mode'],
    rowsCopied: r.rows_copied,
    durationMs: r.duration_ms,
    status: r.status as SyncTableRun['status'],
    error: r.error
  }
}

export const historyRepo = {
  startRun(projectId: string, trigger: RunTrigger, counts: { full: number; incremental: number; disabled: number }): string {
    const db = getDb()
    const id = nanoid(14)
    db.prepare(
      `INSERT INTO sync_runs (id, project_id, started_at, status, trigger, full_count, incremental_count, disabled_count)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`
    ).run(id, projectId, Date.now(), trigger, counts.full, counts.incremental, counts.disabled)
    return id
  },

  finishRun(runId: string, status: SyncStatus, errorSummary: string | null): void {
    const db = getDb()
    const sumRow = db
      .prepare<[string], { total: number | null }>(
        'SELECT COALESCE(SUM(rows_copied), 0) AS total FROM sync_table_runs WHERE run_id = ?'
      )
      .get(runId)
    const total = sumRow?.total ?? 0
    db.prepare(
      `UPDATE sync_runs SET finished_at = ?, status = ?, error_summary = ?, total_rows = ? WHERE id = ?`
    ).run(Date.now(), status, errorSummary, total, runId)
    historyRepo.prune()
  },

  upsertTableRun(tr: SyncTableRun): void {
    const db = getDb()
    db.prepare(
      `INSERT INTO sync_table_runs (run_id, table_name, mode, rows_copied, duration_ms, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, table_name) DO UPDATE SET
         mode = excluded.mode,
         rows_copied = excluded.rows_copied,
         duration_ms = excluded.duration_ms,
         status = excluded.status,
         error = excluded.error`
    ).run(tr.runId, tr.tableName, tr.mode, tr.rowsCopied, tr.durationMs, tr.status, tr.error)
  },

  list(projectId?: string, limit = 100): SyncRun[] {
    const db = getDb()
    const rows = projectId
      ? db
          .prepare<[string, number], RunRow>(
            'SELECT * FROM sync_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?'
          )
          .all(projectId, limit)
      : db
          .prepare<[number], RunRow>('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?')
          .all(limit)
    return rows.map(rowToRun)
  },

  getRun(runId: string): SyncRun | null {
    const db = getDb()
    const row = db
      .prepare<[string], RunRow>('SELECT * FROM sync_runs WHERE id = ?')
      .get(runId)
    return row ? rowToRun(row) : null
  },

  listTableRuns(runId: string): SyncTableRun[] {
    const db = getDb()
    const rows = db
      .prepare<[string], TableRunRow>(
        'SELECT * FROM sync_table_runs WHERE run_id = ? ORDER BY table_name'
      )
      .all(runId)
    return rows.map(rowToTableRun)
  },

  prune(): void {
    const db = getDb()
    db.exec(`
      DELETE FROM sync_runs WHERE id NOT IN (
        SELECT id FROM sync_runs ORDER BY started_at DESC LIMIT ${MAX_RUNS}
      );
    `)
  },

  clear(projectId?: string): number {
    const db = getDb()
    const stmt = projectId
      ? db.prepare("DELETE FROM sync_runs WHERE project_id = ? AND status != 'running'")
      : db.prepare("DELETE FROM sync_runs WHERE status != 'running'")
    const r = projectId ? stmt.run(projectId) : stmt.run()
    return r.changes
  }
}
