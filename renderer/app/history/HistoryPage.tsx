import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Square, Loader2, ChevronRight, Trash2 } from 'lucide-react'
import type { Project, SyncRun, SyncTableRun } from '@shared/types'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format'
import { toast } from 'sonner'

export function HistoryPage() {
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [projects, setProjects] = useState<Map<string, Project>>(new Map())
  const [open, setOpen] = useState<string | null>(null)
  const [tables, setTables] = useState<SyncTableRun[]>([])

  const refresh = () => {
    Promise.all([api.history.list(undefined, 100), api.projects.list()]).then(([h, ps]) => {
      setRuns(h)
      setProjects(new Map(ps.map((p) => [p.id, p])))
    })
  }

  useEffect(() => {
    refresh()
  }, [])

  const onClear = async () => {
    if (!confirm('Delete all sync history? This cannot be undone.')) return
    const removed = await api.history.clear()
    setOpen(null)
    setTables([])
    refresh()
    toast.success(`Cleared ${removed} run(s)`)
  }

  const onToggle = async (runId: string) => {
    if (open === runId) {
      setOpen(null)
      return
    }
    const detail = await api.history.get(runId)
    setTables(detail.tables)
    setOpen(runId)
  }

  return (
    <div className="px-8 pt-12 pb-24 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">History</h1>
          <p className="text-text-muted text-sm">Last 500 sync runs across all projects.</p>
        </div>
        {runs.length > 0 && (
          <Button variant="outline" size="sm" onClick={onClear}>
            <Trash2 className="size-3.5" />
            Clear all
          </Button>
        )}
      </div>

      {runs.length === 0 ? (
        <Card className="p-12 text-center text-text-muted">No sync runs yet.</Card>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <Card key={r.id} className="overflow-hidden">
              <button
                onClick={() => onToggle(r.id)}
                className="w-full px-5 py-3.5 flex items-center gap-4 hover:bg-bg-panel/50 transition-colors text-left"
              >
                <StatusIcon status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm truncate">
                      {projects.get(r.projectId)?.name ?? '(deleted project)'}
                    </span>
                    <Badge tone={r.trigger === 'manual' ? 'neutral' : 'accent'}>{r.trigger}</Badge>
                  </div>
                  <div className="text-[11px] text-text-muted font-mono">
                    {formatDateTime(r.startedAt)} · {formatRelative(r.startedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone="success">{r.totalRows.toLocaleString()} rows</Badge>
                  <Badge tone="warn">{r.fullCount} full</Badge>
                  <Badge tone="accent">{r.incrementalCount} incremental</Badge>
                  <Badge tone="neutral">{r.disabledCount} disabled</Badge>
                  {r.finishedAt && (
                    <span className="text-[11px] text-text-muted font-mono ml-2">
                      {formatDuration(r.finishedAt - r.startedAt)}
                    </span>
                  )}
                  <ChevronRight
                    className={`size-4 text-text-muted transition-transform ${open === r.id ? 'rotate-90' : ''}`}
                  />
                </div>
              </button>
              {open === r.id && (
                <div className="border-t border-line/40 p-5 bg-bg-subtle/40">
                  {r.errorSummary && (
                    <div className="mb-3 text-xs text-danger">{r.errorSummary}</div>
                  )}
                  <table className="w-full text-sm">
                    <thead className="text-[10.5px] text-text-muted uppercase tracking-wider text-left">
                      <tr>
                        <th className="py-1 font-medium">Table</th>
                        <th className="py-1 font-medium">Mode</th>
                        <th className="py-1 font-medium text-right">Rows</th>
                        <th className="py-1 font-medium text-right">Duration</th>
                        <th className="py-1 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tables.map((t) => (
                        <tr key={t.tableName} className="border-t border-line/20">
                          <td className="py-1.5 font-mono text-[12.5px]">{t.tableName}</td>
                          <td className="py-1.5">{t.mode}</td>
                          <td className="py-1.5 text-right font-mono">{t.rowsCopied.toLocaleString()}</td>
                          <td className="py-1.5 text-right font-mono">{formatDuration(t.durationMs)}</td>
                          <td className="py-1.5 text-right">
                            <Badge
                              tone={
                                t.status === 'success'
                                  ? 'success'
                                  : t.status === 'failed'
                                    ? 'danger'
                                    : t.status === 'cancelled'
                                      ? 'warn'
                                      : 'neutral'
                              }
                            >
                              {t.status}
                            </Badge>
                            {t.error && (
                              <div className="text-[10.5px] text-danger mt-0.5">{t.error}</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: SyncRun['status'] }) {
  const cls = 'size-4'
  if (status === 'running') return <Loader2 className={`${cls} text-accent animate-spin`} />
  if (status === 'success') return <CheckCircle2 className={`${cls} text-success`} />
  if (status === 'failed') return <AlertTriangle className={`${cls} text-danger`} />
  if (status === 'cancelled') return <Square className={`${cls} text-text-muted`} />
  return <AlertTriangle className={`${cls} text-warn`} />
}
