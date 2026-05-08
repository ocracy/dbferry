import { ipcMain, BrowserWindow } from 'electron'
import { cancelProject, isProjectRunning, runSync } from '../sync-engine/engine'
import { projectsRepo } from '../storage/projects.repo'
import { setGlobalEmit } from '../scheduler/cron'

export function registerSyncIpc(getMainWindow: () => BrowserWindow | null): void {
  const emit = (e: unknown) => {
    const w = getMainWindow()
    if (w && !w.isDestroyed()) w.webContents.send('sync:event', e)
  }
  setGlobalEmit(emit as never)

  ipcMain.handle('sync:start', async (_e, projectId: string) => {
    const project = projectsRepo.get(projectId)
    if (!project) throw new Error('Project not found')
    return runSync({ project, trigger: 'manual', emit: emit as never })
  })

  ipcMain.handle('sync:cancel', (_e, projectId: string) => cancelProject(projectId))

  ipcMain.handle('sync:isRunning', (_e, projectId: string) => isProjectRunning(projectId))
}
