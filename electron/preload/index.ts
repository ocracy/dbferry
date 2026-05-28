import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ConnectionTestResult,
  DbConfig,
  JsonProjectExport,
  Project,
  RunLog,
  SyncProgressEvent,
  SyncRun,
  SyncTableRun,
  TableConfig,
  TableMeta
} from '@shared/types'

const api = {
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
    get: (id: string): Promise<Project | null> => ipcRenderer.invoke('projects:get', id),
    create: (input: { name: string; source: DbConfig; target: DbConfig }): Promise<Project> =>
      ipcRenderer.invoke('projects:create', input),
    update: (id: string, patch: Partial<Project>): Promise<Project | null> =>
      ipcRenderer.invoke('projects:update', id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:delete', id),
    replaceTables: (id: string, tables: TableConfig[]): Promise<Project | null> =>
      ipcRenderer.invoke('projects:replaceTables', id, tables),
    upsertTable: (id: string, table: TableConfig): Promise<Project | null> =>
      ipcRenderer.invoke('projects:upsertTable', id, table),
    hasPasswords: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('projects:hasPasswords', id),
    passwordStatus: (id: string): Promise<{ source: boolean; target: boolean }> =>
      ipcRenderer.invoke('projects:passwordStatus', id),
    setPassword: (id: string, side: 'source' | 'target', password: string): Promise<boolean> =>
      ipcRenderer.invoke('projects:setPassword', id, side, password),
    exportJson: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('projects:exportJson', id),
    importJson: (payload: { content?: string; path?: string }): Promise<Project> =>
      ipcRenderer.invoke('projects:importJson', payload),
    revealInFinder: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('projects:revealInFinder', path)
  },
  connection: {
    test: (config: DbConfig, password: string): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('connection:test', { config, password }),
    listDatabases: (config: DbConfig, password: string): Promise<string[]> =>
      ipcRenderer.invoke('connection:listDatabases', { config, password }),
    testStored: (projectId: string, side: 'source' | 'target'): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke('connection:testStored', { projectId, side }),
    listTables: (projectId: string, side: 'source' | 'target'): Promise<string[]> =>
      ipcRenderer.invoke('connection:listTables', { projectId, side }),
    listTablesMeta: (projectId: string, side: 'source' | 'target'): Promise<TableMeta[]> =>
      ipcRenderer.invoke('connection:listTablesMeta', { projectId, side }),
    countRows: (
      projectId: string,
      side: 'source' | 'target',
      tables: string[]
    ): Promise<Record<string, number>> =>
      ipcRenderer.invoke('connection:countRows', { projectId, side, tables }),
    getMaxPk: (
      projectId: string,
      side: 'source' | 'target',
      table: string,
      pkColumn: string
    ): Promise<string | null> =>
      ipcRenderer.invoke('connection:getMaxPk', { projectId, side, table, pkColumn }),
    pickCertFile: (title?: string): Promise<string | null> =>
      ipcRenderer.invoke('connection:pickCertFile', { title })
  },
  sync: {
    start: (projectId: string): Promise<{ runId: string }> =>
      ipcRenderer.invoke('sync:start', projectId),
    startTables: (
      projectId: string,
      tables: Array<{ name: string; mode: 'incremental' | 'full' }>
    ): Promise<{ runId: string }> =>
      ipcRenderer.invoke('sync:startTables', { projectId, tables }),
    cancel: (projectId: string): Promise<boolean> => ipcRenderer.invoke('sync:cancel', projectId),
    isRunning: (projectId: string): Promise<boolean> =>
      ipcRenderer.invoke('sync:isRunning', projectId),
    onEvent: (cb: (e: SyncProgressEvent) => void) => {
      const listener = (_: unknown, e: SyncProgressEvent) => cb(e)
      ipcRenderer.on('sync:event', listener)
      return () => ipcRenderer.removeListener('sync:event', listener)
    }
  },
  history: {
    list: (projectId?: string, limit?: number): Promise<SyncRun[]> =>
      ipcRenderer.invoke('history:list', projectId, limit),
    get: (runId: string): Promise<{ run: SyncRun | null; tables: SyncTableRun[] }> =>
      ipcRenderer.invoke('history:get', runId),
    clear: (projectId?: string): Promise<number> =>
      ipcRenderer.invoke('history:clear', projectId),
    logs: (runId: string): Promise<RunLog[]> => ipcRenderer.invoke('history:logs', runId)
  },
  files: {
    pathFor: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  update: {
    check: (): Promise<{
      currentVersion: string
      latestVersion: string | null
      hasUpdate: boolean
      releaseUrl: string | null
      releaseName: string | null
      publishedAt: string | null
      error?: string
    }> => ipcRenderer.invoke('update:check'),
    open: (url: string): Promise<boolean> => ipcRenderer.invoke('update:open', url)
  }
}

export type DbferryApi = typeof api

contextBridge.exposeInMainWorld('api', api)
