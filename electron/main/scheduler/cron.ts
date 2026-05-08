import nodeCron, { type ScheduledTask } from 'node-cron'
import type { Project, SyncProgressEvent } from '@shared/types'
import { projectsRepo } from '../storage/projects.repo'
import { isProjectRunning, runSync } from '../sync-engine/engine'

const tasks = new Map<string, ScheduledTask>()
type Emit = (e: SyncProgressEvent) => void
let globalEmit: Emit = () => {}

export function setGlobalEmit(emit: Emit): void {
  globalEmit = emit
}

export function loadAllSchedules(): void {
  for (const p of projectsRepo.list()) {
    syncProjectSchedule(p)
  }
}

export function syncProjectSchedule(project: Project): void {
  unschedule(project.id)
  if (!project.scheduleEnabled || !project.scheduleCron) return
  if (!nodeCron.validate(project.scheduleCron)) return
  const t = nodeCron.schedule(
    project.scheduleCron,
    async () => {
      if (isProjectRunning(project.id)) return
      const fresh = projectsRepo.get(project.id)
      if (!fresh) return
      try {
        await runSync({ project: fresh, trigger: 'scheduled', emit: globalEmit }).then((h) => h)
      } catch {
        // swallow; engine logs to history
      }
    },
    { scheduled: true }
  )
  tasks.set(project.id, t)
}

export function unschedule(projectId: string): void {
  const t = tasks.get(projectId)
  if (t) {
    t.stop()
    tasks.delete(projectId)
  }
}

export function unscheduleAll(): void {
  for (const t of tasks.values()) t.stop()
  tasks.clear()
}
