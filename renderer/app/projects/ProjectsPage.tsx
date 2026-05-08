import { useEffect, useState } from 'react'
import { Plus, Database, Calendar, Trash2, ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import type { DbConfig, Project } from '@shared/types'
import { api } from '@/lib/api'
import { useRoute } from '@/stores/route'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatRelative } from '@/lib/format'
import { NewProjectDialog } from './NewProjectDialog'
import { toast } from 'sonner'

export function ProjectsPage() {
  const { go } = useRoute()
  const [projects, setProjects] = useState<Project[]>([])
  const [showNew, setShowNew] = useState(false)

  const refresh = () => api.projects.list().then(setProjects).catch(() => setProjects([]))

  useEffect(() => {
    refresh()
  }, [])

  const onCreate = async (input: {
    name: string
    source: DbConfig
    target: DbConfig
    sourcePassword: string
    targetPassword: string
  }) => {
    const p = await api.projects.create({ name: input.name, source: input.source, target: input.target })
    await api.projects.setPassword(p.id, 'source', input.sourcePassword)
    await api.projects.setPassword(p.id, 'target', input.targetPassword)
    setShowNew(false)
    toast.success(`Project "${p.name}" created`)
    go({ name: 'project', id: p.id })
  }

  const onDelete = async (id: string) => {
    if (!confirm('Delete this project? Saved passwords will also be removed.')) return
    await api.projects.delete(id)
    refresh()
    toast.success('Project deleted')
  }

  return (
    <div className="px-8 pt-12 pb-24 max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-text-muted text-sm mt-1">
            Each project pairs a source and a target database with its own table sync rules.
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={() => setShowNew(true)}>
          <Plus className="size-4" />
          New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState onCreate={() => setShowNew(true)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.25 }}
            >
              <Card
                className="group cursor-pointer hover:border-accent/40 transition-colors"
                onClick={() => go({ name: 'project', id: p.id })}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3.5">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold tracking-tight truncate text-[15px]">{p.name}</h3>
                      <p className="text-[11px] text-text-muted mt-0.5">
                        Updated {formatRelative(p.updatedAt)}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-text-muted mb-3">
                    <DbChip cfg={p.source} />
                    <span className="text-text-muted/40">→</span>
                    <DbChip cfg={p.target} />
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge tone="accent">{p.tables.filter((t) => t.mode !== 'disabled').length} active</Badge>
                    <Badge tone="neutral">{p.tables.length} tables</Badge>
                    {p.scheduleEnabled && p.scheduleCron ? (
                      <Badge tone="success">
                        <Calendar className="size-3" />
                        scheduled
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(p.id)
                      }}
                      className="text-text-muted hover:text-danger transition-colors p-1.5"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {showNew && (
        <NewProjectDialog
          onCancel={() => setShowNew(false)}
          onCreate={onCreate}
        />
      )}
    </div>
  )
}

function DbChip({ cfg }: { cfg: DbConfig }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-bg-panel/60 border border-line/40 font-mono text-[11px]">
      <Database className="size-3" />
      <span className={cfg.type === 'mysql' ? 'text-orange-400' : 'text-blue-400'}>{cfg.type}</span>
      <span className="text-text-muted">·</span>
      <span className="truncate max-w-[120px]">{cfg.database || cfg.host}</span>
    </span>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="p-12 text-center">
      <div className="mx-auto size-14 rounded-2xl bg-gradient-to-br from-accent/30 to-accent/10 grid place-items-center mb-4">
        <Database className="size-7 text-accent" />
      </div>
      <h3 className="font-semibold mb-1.5">No projects yet</h3>
      <p className="text-text-muted text-sm mb-5 max-w-md mx-auto">
        Create a project to pair a source and target database, then choose which tables sync and how.
      </p>
      <Button variant="primary" onClick={onCreate}>
        <Plus className="size-4" />
        Create your first project
      </Button>
    </Card>
  )
}
