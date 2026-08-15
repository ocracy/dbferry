import { ipcMain } from 'electron'
import type { ColumnFixAction, ColumnFixResult, SchemaDiffResult } from '@shared/types'
import { applyColumnFixes, diffSchema } from '../sync-engine/schema-diff'
import { secrets } from '../secrets/keytar'
import { projectsRepo } from '../storage/projects.repo'

async function loadContext(projectId: string) {
  const project = projectsRepo.get(projectId)
  if (!project) throw new Error('Project not found')
  const [srcPwd, tgtPwd] = await Promise.all([
    secrets.getPassword(projectId, 'source'),
    secrets.getPassword(projectId, 'target')
  ])
  if (srcPwd === null) throw new Error('Source password not set')
  if (tgtPwd === null) throw new Error('Target password not set')
  return { project, srcPwd, tgtPwd }
}

export function registerSchemaIpc(): void {
  ipcMain.handle(
    'schema:diff',
    async (_e, payload: { projectId: string; tables?: string[] }): Promise<SchemaDiffResult> => {
      const { project, srcPwd, tgtPwd } = await loadContext(payload.projectId)
      const names =
        payload.tables && payload.tables.length > 0
          ? payload.tables
          : project.tables.map((t) => t.name)
      return diffSchema(project, srcPwd, tgtPwd, names)
    }
  )

  ipcMain.handle(
    'schema:applyFixes',
    async (
      _e,
      payload: { projectId: string; actions: ColumnFixAction[] }
    ): Promise<ColumnFixResult[]> => {
      const { project, srcPwd, tgtPwd } = await loadContext(payload.projectId)
      return applyColumnFixes(project, srcPwd, tgtPwd, payload.actions ?? [])
    }
  )
}
