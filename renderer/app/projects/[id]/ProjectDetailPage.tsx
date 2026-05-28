import { useEffect, useState } from 'react'
import { ArrowLeft, Play, Square, Download, Settings, Trash2, X } from 'lucide-react'
import type { ConnectionTestResult, Project } from '@shared/types'
import { api } from '@/lib/api'
import { useRoute } from '@/stores/route'
import { useSync } from '@/stores/sync'
import { Button } from '@/components/ui/Button'
import { ConnectionPanel } from './ConnectionPanel'
import { TablesGrid } from './TablesGrid'
import { ScheduleSelector } from './ScheduleSelector'
import { toast } from 'sonner'

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const { go } = useRoute()
  const [project, setProject] = useState<Project | null>(null)
  const [pwStatus, setPwStatus] = useState<{ source: boolean; target: boolean }>({ source: false, target: false })
  const [srcStatus, setSrcStatus] = useState<ConnectionTestResult | null>(null)
  const [tgtStatus, setTgtStatus] = useState<ConnectionTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const hasPasswords = pwStatus.source && pwStatus.target
  const active = useSync((s) => s.active)
  const isRunning = active?.projectId === projectId && active.status === 'running'

  const refresh = async () => {
    const [p, ps] = await Promise.all([
      api.projects.get(projectId),
      api.projects.passwordStatus(projectId)
    ])
    setProject(p)
    setPwStatus(ps)
  }

  useEffect(() => {
    refresh()
  }, [projectId])

  if (!project) {
    return (
      <div className="px-8 pt-12">
        <Button variant="ghost" size="sm" onClick={() => go({ name: 'projects' })}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <div className="text-text-muted mt-8">Loading project…</div>
      </div>
    )
  }

  const startSync = async () => {
    if (!hasPasswords) {
      toast.error('Set source and target passwords first')
      setSettingsOpen(true)
      return
    }
    const enabled = project.tables.filter((t) => t.mode !== 'disabled')
    if (enabled.length === 0) {
      toast.error('Choose at least one table to sync')
      return
    }
    try {
      setBusy(true)
      await api.sync.start(project.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const cancelSync = async () => {
    await api.sync.cancel(project.id)
    toast('Stopping sync…')
  }

  const exportJson = async () => {
    const path = await api.projects.exportJson(project.id)
    if (path) toast.success('Exported', { description: path })
  }

  const onDelete = async () => {
    if (!confirm(`Delete project "${project.name}"? Saved passwords will also be removed.`)) return
    await api.projects.delete(project.id)
    toast.success('Project deleted')
    go({ name: 'projects' })
  }

  return (
    <>
      <div className="h-full flex flex-col px-8 pt-12 pb-6 max-w-7xl mx-auto w-full min-h-0">
        <div className="flex items-center justify-between mb-5 shrink-0">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" onClick={() => setSettingsOpen(true)} title="Settings">
              <Settings className="size-4" />
            </Button>
            <Button variant="subtle" size="md" onClick={exportJson}>
              <Download className="size-4" />
              Export
            </Button>
            {isRunning ? (
              <Button variant="danger" size="md" onClick={cancelSync}>
                <Square className="size-4" />
                Stop
              </Button>
            ) : (
              <Button variant="primary" size="md" onClick={startSync} disabled={busy}>
                <Play className="size-4" />
                Sync now
              </Button>
            )}
          </div>
        </div>

        <div className="mb-4 shrink-0">
          <ScheduleSelector
            project={project}
            onChanged={(patch) =>
              api.projects.update(project.id, patch).then((p) => p && setProject(p))
            }
          />
        </div>

        <div className="flex-1 min-h-0 pb-24">
          <TablesGrid project={project} onTablesChanged={refresh} disabled={isRunning} />
        </div>
      </div>

      {settingsOpen && (
        <SettingsDrawer
          project={project}
          srcStatus={srcStatus}
          tgtStatus={tgtStatus}
          setSrcStatus={setSrcStatus}
          setTgtStatus={setTgtStatus}
          pwStatus={pwStatus}
          onClose={() => setSettingsOpen(false)}
          onChange={(patch) =>
            api.projects.update(project.id, patch).then((p) => p && setProject(p))
          }
          onPasswordSaved={refresh}
          onDelete={onDelete}
        />
      )}
    </>
  )
}

function SettingsDrawer({
  project,
  srcStatus,
  tgtStatus,
  setSrcStatus,
  setTgtStatus,
  pwStatus,
  onClose,
  onChange,
  onPasswordSaved,
  onDelete
}: {
  project: Project
  srcStatus: ConnectionTestResult | null
  tgtStatus: ConnectionTestResult | null
  setSrcStatus: (s: ConnectionTestResult | null) => void
  setTgtStatus: (s: ConnectionTestResult | null) => void
  pwStatus: { source: boolean; target: boolean }
  onClose: () => void
  onChange: (patch: Partial<Project>) => void
  onPasswordSaved: () => void
  onDelete: () => void
}) {
  const [concurrency, setConcurrency] = useState(project.tableConcurrency)

  return (
    <div
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="fixed inset-0 z-50 flex"
    >
      <div className="flex-1 bg-bg/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-[640px] max-w-[95vw] h-full bg-bg border-l border-line/40 overflow-y-auto">
        <div className="px-6 py-4 flex items-center justify-between border-b border-line/40 sticky top-0 bg-bg/95 backdrop-blur-md z-10">
          <h3 className="font-semibold flex items-center gap-2">
            <Settings className="size-4" />
            Settings · {project.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-8 grid place-items-center rounded-md text-text-muted hover:text-text hover:bg-bg-panel/60 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <ConnectionPanel
            title="Source"
            side="source"
            project={project}
            status={srcStatus}
            setStatus={setSrcStatus}
            onChange={(cfg) => onChange({ source: cfg })}
            hasPassword={pwStatus.source}
            onPasswordSaved={onPasswordSaved}
          />
          <ConnectionPanel
            title="Target"
            side="target"
            project={project}
            status={tgtStatus}
            setStatus={setTgtStatus}
            onChange={(cfg) => onChange({ target: cfg })}
            hasPassword={pwStatus.target}
            onPasswordSaved={onPasswordSaved}
          />

          <div className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">Table concurrency</h3>
              <span className="font-mono text-sm text-accent">{concurrency}</span>
            </div>
            <input
              type="range"
              min={1}
              max={8}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              onMouseUp={() => onChange({ tableConcurrency: concurrency })}
              onTouchEnd={() => onChange({ tableConcurrency: concurrency })}
              className="w-full accent-accent"
            />
            <p className="text-xs text-text-muted mt-2">
              How many tables to sync in parallel. Higher = faster but more DB load.
            </p>
          </div>

          <div className="rounded-xl border border-danger/30 bg-danger/5 p-5">
            <h3 className="font-semibold text-sm mb-2 text-danger">Danger zone</h3>
            <p className="text-xs text-text-muted mb-3">
              Deletes the project and removes its passwords from the OS keychain. Sync history is also cleared.
            </p>
            <Button variant="danger" size="sm" onClick={onDelete}>
              <Trash2 className="size-3.5" />
              Delete project
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
