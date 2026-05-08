import pLimit from 'p-limit'
import type {
  ColumnInfo,
  Project,
  RunTrigger,
  SyncMode,
  SyncProgressEvent,
  SyncStatus
} from '@shared/types'
import { secrets } from '../secrets/keytar'
import { historyRepo } from '../storage/history.repo'
import { MysqlAdapter } from './adapters/mysql'
import { PostgresAdapter } from './adapters/postgres'
import type { DbAdapter } from './adapters/types'
import { coerceValue, intersectColumns } from './type-mapper'

export type ProgressListener = (e: SyncProgressEvent) => void

interface RunHandle {
  abort: AbortController
  finished: Promise<void>
  runId: string
}

const runningProjects = new Map<string, RunHandle>()

function adapterFor(type: 'mysql' | 'postgres', info: { config: Project['source']; password: string }): DbAdapter {
  if (type === 'mysql') return new MysqlAdapter({ config: info.config, password: info.password })
  return new PostgresAdapter({ config: info.config, password: info.password })
}

function syncableTables(project: Project): { full: number; incremental: number; disabled: number } {
  let full = 0,
    incremental = 0,
    disabled = 0
  for (const t of project.tables) {
    if (t.mode === 'full') full++
    else if (t.mode === 'incremental') incremental++
    else disabled++
  }
  return { full, incremental, disabled }
}

export function isProjectRunning(projectId: string): boolean {
  return runningProjects.has(projectId)
}

export function cancelProject(projectId: string): boolean {
  const h = runningProjects.get(projectId)
  if (!h) return false
  h.abort.abort()
  return true
}

export interface RunSyncInput {
  project: Project
  trigger: RunTrigger
  emit: ProgressListener
}

export async function runSync({ project, trigger, emit }: RunSyncInput): Promise<{ runId: string }> {
  if (runningProjects.has(project.id)) {
    throw new Error('Project sync already running')
  }
  const counts = syncableTables(project)
  const runId = historyRepo.startRun(project.id, trigger, counts)
  const abort = new AbortController()
  const tablesToSync = project.tables.filter((t) => t.mode !== 'disabled')

  emit({
    type: 'run-started',
    runId,
    projectId: project.id,
    totalTables: tablesToSync.length
  })

  const startedAt = Date.now()

  const finished = (async () => {
    let runStatus: SyncStatus = 'success'
    let errorSummary: string | null = null

    try {
      const [srcPwd, tgtPwd] = await Promise.all([
        secrets.getPassword(project.id, 'source'),
        secrets.getPassword(project.id, 'target')
      ])
      if (srcPwd === null || tgtPwd === null) {
        throw new Error('Missing passwords. Open the project and set source/target passwords.')
      }

      const limit = pLimit(Math.max(1, project.tableConcurrency || 3))
      const total = tablesToSync.length
      let index = 0
      let failures = 0

      const tasks = tablesToSync.map((tableCfg) =>
        limit(async () => {
          if (abort.signal.aborted) {
            historyRepo.upsertTableRun({
              runId,
              tableName: tableCfg.name,
              mode: tableCfg.mode,
              rowsCopied: 0,
              durationMs: 0,
              status: 'cancelled',
              error: null
            })
            return
          }
          const myIndex = ++index
          emit({
            type: 'table-started',
            runId,
            tableName: tableCfg.name,
            mode: tableCfg.mode,
            index: myIndex,
            total
          })
          const tableStart = Date.now()
          try {
            const rows = await syncTable({
              project,
              srcPwd,
              tgtPwd,
              tableName: tableCfg.name,
              mode: tableCfg.mode,
              pkColumn: tableCfg.pkColumn || 'id',
              cancelSignal: abort.signal,
              onRows: (delta, rps) => {
                emit({
                  type: 'table-progress',
                  runId,
                  tableName: tableCfg.name,
                  rowsCopied: delta,
                  rowsPerSec: rps
                })
              },
              log: (level, message) => emit({ type: 'log', runId, level, message })
            })
            const dur = Date.now() - tableStart
            historyRepo.upsertTableRun({
              runId,
              tableName: tableCfg.name,
              mode: tableCfg.mode,
              rowsCopied: rows,
              durationMs: dur,
              status: 'success',
              error: null
            })
            emit({
              type: 'table-finished',
              runId,
              tableName: tableCfg.name,
              rowsCopied: rows,
              durationMs: dur,
              status: 'success'
            })
          } catch (err) {
            failures++
            const msg = err instanceof Error ? err.message : String(err)
            const dur = Date.now() - tableStart
            const isCancel = abort.signal.aborted || msg === 'cancelled'
            historyRepo.upsertTableRun({
              runId,
              tableName: tableCfg.name,
              mode: tableCfg.mode,
              rowsCopied: 0,
              durationMs: dur,
              status: isCancel ? 'cancelled' : 'failed',
              error: isCancel ? null : msg
            })
            emit({
              type: 'table-finished',
              runId,
              tableName: tableCfg.name,
              rowsCopied: 0,
              durationMs: dur,
              status: isCancel ? 'cancelled' : 'failed',
              error: isCancel ? undefined : msg
            })
          }
        })
      )

      await Promise.all(tasks)

      if (abort.signal.aborted) runStatus = 'cancelled'
      else if (failures > 0 && failures === tablesToSync.length) runStatus = 'failed'
      else if (failures > 0) runStatus = 'partial'
      else runStatus = 'success'
    } catch (err) {
      runStatus = 'failed'
      errorSummary = err instanceof Error ? err.message : String(err)
      emit({ type: 'log', runId, level: 'error', message: errorSummary })
    } finally {
      historyRepo.finishRun(runId, runStatus, errorSummary)
      const dur = Date.now() - startedAt
      emit({ type: 'run-finished', runId, status: runStatus, durationMs: dur })
      runningProjects.delete(project.id)
    }
  })()

  runningProjects.set(project.id, { abort, finished, runId })
  return { runId }
}

interface SyncTableInput {
  project: Project
  srcPwd: string
  tgtPwd: string
  tableName: string
  mode: SyncMode
  pkColumn: string
  cancelSignal: AbortSignal
  onRows: (delta: number, rowsPerSec: number) => void
  log: (level: 'info' | 'warn' | 'error', message: string) => void
}

const BATCH_SIZE = 5000

async function syncTable(input: SyncTableInput): Promise<number> {
  const { project, srcPwd, tgtPwd, tableName, mode, pkColumn, cancelSignal, onRows, log } = input
  const src = adapterFor(project.source.type, { config: project.source, password: srcPwd })
  const tgt = adapterFor(project.target.type, { config: project.target, password: tgtPwd })

  await src.connect()
  try {
    await tgt.connect()
  } catch (err) {
    await src.close()
    throw err
  }

  let txOpen = false
  try {
    const [srcCols, tgtCols] = await Promise.all([src.getColumns(tableName), tgt.getColumns(tableName)])
    if (tgtCols.length === 0) {
      throw new Error(`Target table "${tableName}" not found or has no columns.`)
    }
    const { matched, missingInTarget, missingInSource } = intersectColumns(srcCols, tgtCols)
    if (matched.length === 0) {
      throw new Error(`No matching columns between source and target for "${tableName}".`)
    }
    if (missingInTarget.length) {
      log('warn', `[${tableName}] columns missing in target (skipped): ${missingInTarget.join(', ')}`)
    }
    if (missingInSource.length) {
      log('warn', `[${tableName}] columns missing in source (will be DEFAULT/NULL): ${missingInSource.join(', ')}`)
    }

    let pkGreaterThan: string | number | bigint | null = null
    if (mode === 'incremental') {
      const pkCol = matched.find((m) => m.src.name === pkColumn) ?? matched.find((m) => m.src.isPrimaryKey)
      if (!pkCol) throw new Error(`Incremental sync requires PK column "${pkColumn}" present in both source and target.`)
      pkGreaterThan = await tgt.getMaxPk(tableName, pkCol.tgt.name)
      log('info', `[${tableName}] incremental: target max(${pkColumn})=${pkGreaterThan ?? 'null'}`)
    }

    await tgt.setConstraintsDisabled(true)
    await tgt.beginTransaction()
    txOpen = true

    if (mode === 'full') {
      await tgt.truncate(tableName)
    }

    const srcColNames = matched.map((m) => m.src.name)
    const tgtCoercedCols: ColumnInfo[] = matched.map((m) => m.tgt)

    const rawIter = src.streamRows(tableName, {
      columns: srcColNames,
      pkColumn: mode === 'incremental' ? pkColumn : undefined,
      pkGreaterThan,
      batchSize: BATCH_SIZE,
      cancelSignal
    })

    const coercedIter = (async function* () {
      for await (const batch of rawIter) {
        if (cancelSignal.aborted) throw new Error('cancelled')
        const out: unknown[][] = []
        for (const row of batch) {
          const newRow = new Array(matched.length)
          for (let i = 0; i < matched.length; i++) {
            newRow[i] = coerceValue(
              row[i],
              project.source.type,
              project.target.type,
              matched[i].src,
              matched[i].tgt
            )
          }
          out.push(newRow)
        }
        yield out
      }
    })()

    const start = Date.now()
    let lastReported = start
    let lastTotal = 0
    let runningTotal = 0

    const total = await tgt.bulkWrite(tableName, coercedIter, {
      columns: tgtCoercedCols,
      cancelSignal,
      onProgress: (delta) => {
        runningTotal += delta
        const now = Date.now()
        if (now - lastReported > 250) {
          const rps = ((runningTotal - lastTotal) * 1000) / Math.max(1, now - lastReported)
          lastReported = now
          lastTotal = runningTotal
          onRows(runningTotal, rps)
        }
      }
    })
    onRows(runningTotal, 0)

    await tgt.commit()
    txOpen = false
    return total
  } catch (err) {
    if (txOpen) {
      try {
        await tgt.rollback()
      } catch {}
    }
    throw err
  } finally {
    try {
      await tgt.setConstraintsDisabled(false)
    } catch {}
    await src.close().catch(() => {})
    await tgt.close().catch(() => {})
  }
}
