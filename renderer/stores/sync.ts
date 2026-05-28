import { create } from 'zustand'
import type { SyncProgressEvent, SyncStatus } from '@shared/types'

interface TableState {
  name: string
  mode: string
  rowsCopied: number
  rowsPerSec: number
  total?: number
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'skipped'
  error?: string
}

export interface ActiveRun {
  runId: string
  projectId: string
  totalTables: number
  finishedTables: number
  currentTableIndex: number
  currentTableName: string | null
  runningTables: string[]
  tables: Record<string, TableState>
  startedAt: number
  finishedAt: number | null
  status: SyncStatus
  log: Array<{ ts: number; level: 'info' | 'warn' | 'error'; message: string }>
}

interface SyncStoreState {
  active: ActiveRun | null
  liveLogs: Array<{ ts: number; level: 'info' | 'warn' | 'error'; message: string; runId: string }>
  applyEvent: (e: SyncProgressEvent) => void
  reset: () => void
  clearLogs: () => void
}

export const useSync = create<SyncStoreState>((set) => ({
  active: null,
  liveLogs: [],
  reset: () => set({ active: null }),
  clearLogs: () => set({ liveLogs: [] }),
  applyEvent: (e) =>
    set((state) => {
      let active = state.active
      if (e.type === 'run-started') {
        active = {
          runId: e.runId,
          projectId: e.projectId,
          totalTables: e.totalTables,
          finishedTables: 0,
          currentTableIndex: 0,
          currentTableName: null,
          runningTables: [],
          tables: {},
          startedAt: Date.now(),
          finishedAt: null,
          status: 'running',
          log: []
        }
        return { active }
      }
      if (!active || e.runId !== active.runId) return state
      if (e.type === 'table-started') {
        active = {
          ...active,
          currentTableIndex: e.index,
          currentTableName: e.tableName,
          runningTables: [...active.runningTables, e.tableName],
          tables: {
            ...active.tables,
            [e.tableName]: {
              name: e.tableName,
              mode: e.mode,
              rowsCopied: 0,
              rowsPerSec: 0,
              status: 'running'
            }
          }
        }
        return { active }
      }
      if (e.type === 'table-total') {
        const t = active.tables[e.tableName]
        if (!t) return state
        active = {
          ...active,
          tables: {
            ...active.tables,
            [e.tableName]: { ...t, total: e.total }
          }
        }
        return { active }
      }
      if (e.type === 'table-progress') {
        const t = active.tables[e.tableName]
        if (!t) return state
        active = {
          ...active,
          currentTableName: e.tableName,
          tables: {
            ...active.tables,
            [e.tableName]: { ...t, rowsCopied: e.rowsCopied, rowsPerSec: e.rowsPerSec }
          }
        }
        return { active }
      }
      if (e.type === 'table-finished') {
        const t = active.tables[e.tableName]
        const stillRunning = active.runningTables.filter((n) => n !== e.tableName)
        active = {
          ...active,
          finishedTables: active.finishedTables + 1,
          runningTables: stillRunning,
          currentTableName:
            active.currentTableName === e.tableName
              ? stillRunning[stillRunning.length - 1] ?? null
              : active.currentTableName,
          tables: {
            ...active.tables,
            [e.tableName]: {
              ...(t ?? { name: e.tableName, mode: '', rowsCopied: 0, rowsPerSec: 0, status: 'pending' }),
              rowsCopied: e.rowsCopied,
              status: e.status,
              error: e.error
            }
          }
        }
        return { active }
      }
      if (e.type === 'run-finished') {
        active = { ...active, status: e.status, currentTableName: null, finishedAt: Date.now() }
        return { active }
      }
      if (e.type === 'log') {
        active = { ...active, log: [...active.log, { ts: Date.now(), level: e.level, message: e.message }].slice(-200) }
        const newLog = { ts: Date.now(), level: e.level, message: e.message, runId: e.runId }
        return { active, liveLogs: [...state.liveLogs, newLog].slice(-2000) }
      }
      return state
    })
}))
