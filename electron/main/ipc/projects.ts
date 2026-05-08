import { ipcMain, dialog, shell } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import type { DbConfig, JsonProjectExport, Project, TableConfig } from '@shared/types'
import { projectsRepo } from '../storage/projects.repo'
import { secrets } from '../secrets/keytar'
import { syncProjectSchedule, unschedule } from '../scheduler/cron'

export function registerProjectIpc(): void {
  ipcMain.handle('projects:list', () => projectsRepo.list())

  ipcMain.handle('projects:get', (_e, id: string) => projectsRepo.get(id))

  ipcMain.handle(
    'projects:create',
    (_e, input: { name: string; source: DbConfig; target: DbConfig }) => {
      const p = projectsRepo.create({
        name: input.name,
        source: input.source,
        target: input.target,
        tables: [],
        scheduleEnabled: false,
        scheduleCron: null,
        tableConcurrency: 3
      })
      return p
    }
  )

  ipcMain.handle('projects:update', (_e, id: string, patch: Partial<Project>) => {
    const updated = projectsRepo.update(id, patch)
    if (updated) syncProjectSchedule(updated)
    return updated
  })

  ipcMain.handle('projects:delete', async (_e, id: string) => {
    unschedule(id)
    await secrets.deleteAll(id)
    projectsRepo.delete(id)
    return true
  })

  ipcMain.handle(
    'projects:replaceTables',
    (_e, id: string, tables: TableConfig[]) => {
      projectsRepo.replaceTables(id, tables)
      return projectsRepo.get(id)
    }
  )

  ipcMain.handle(
    'projects:upsertTable',
    (_e, id: string, table: TableConfig) => {
      projectsRepo.upsertTable(id, table)
      return projectsRepo.get(id)
    }
  )

  ipcMain.handle('projects:hasPasswords', async (_e, id: string) => secrets.hasBoth(id))

  ipcMain.handle('projects:passwordStatus', async (_e, id: string) => secrets.status(id))

  ipcMain.handle(
    'projects:setPassword',
    async (_e, id: string, side: 'source' | 'target', password: string) => {
      await secrets.setPassword(id, side, password)
      return true
    }
  )

  ipcMain.handle('projects:exportJson', async (_e, id: string) => {
    const p = projectsRepo.get(id)
    if (!p) throw new Error('Project not found')
    const exported: JsonProjectExport = {
      version: 1,
      name: p.name,
      source: p.source,
      target: p.target,
      tables: p.tables,
      schedule: { enabled: p.scheduleEnabled, cron: p.scheduleCron },
      tableConcurrency: p.tableConcurrency
    }
    const result = await dialog.showSaveDialog({
      title: 'Export project',
      defaultPath: `${p.name.replace(/[^\w\-]+/g, '_')}.dbferry.json`,
      filters: [{ name: 'dbferry project', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, JSON.stringify(exported, null, 2), 'utf8')
    return result.filePath
  })

  ipcMain.handle(
    'projects:importJson',
    async (_e, payload: { content?: string; path?: string }) => {
      let content = payload.content
      if (!content && payload.path) content = await readFile(payload.path, 'utf8')
      if (!content) throw new Error('Empty import payload')
      const parsed = JSON.parse(content) as JsonProjectExport
      if (!parsed || parsed.version !== 1 || !parsed.source || !parsed.target) {
        throw new Error('Invalid dbferry project JSON')
      }
      const existing = projectsRepo.list().map((p) => p.name)
      let name = parsed.name || 'Imported project'
      let n = 2
      while (existing.includes(name)) {
        name = `${parsed.name} (${n++})`
      }
      const p = projectsRepo.create({
        name,
        source: parsed.source,
        target: parsed.target,
        tables: parsed.tables ?? [],
        scheduleEnabled: parsed.schedule?.enabled ?? false,
        scheduleCron: parsed.schedule?.cron ?? null,
        tableConcurrency: parsed.tableConcurrency ?? 3
      })
      syncProjectSchedule(p)
      return p
    }
  )

  ipcMain.handle('projects:revealInFinder', (_e, path: string) => {
    shell.showItemInFolder(path)
    return true
  })
}
