import { ipcMain } from 'electron'
import { historyRepo } from '../storage/history.repo'

export function registerHistoryIpc(): void {
  ipcMain.handle('history:list', (_e, projectId?: string, limit?: number) =>
    historyRepo.list(projectId, limit ?? 100)
  )
  ipcMain.handle('history:get', (_e, runId: string) => ({
    run: historyRepo.getRun(runId),
    tables: historyRepo.listTableRuns(runId)
  }))
  ipcMain.handle('history:clear', (_e, projectId?: string) => historyRepo.clear(projectId))
  ipcMain.handle('history:logs', (_e, runId: string) => historyRepo.listLogs(runId))
}
