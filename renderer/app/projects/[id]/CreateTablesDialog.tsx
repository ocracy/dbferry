import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  TableProperties,
  X
} from 'lucide-react'
import type { CreateTablePlan, Project } from '@shared/types'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { toast } from 'sonner'

interface Props {
  project: Project
  /** tables that exist on the source but not on the target */
  tables: string[]
  onClose: () => void
  onCreated: () => void
}

/**
 * Creating a table is a schema write on the user's database, so the DDL is shown
 * before it runs: pick the tables, read the statement, then create.
 */
export function CreateTablesDialog({ project, tables, onClose, onCreated }: Props) {
  const [plans, setPlans] = useState<CreateTablePlan[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = await api.schema.planCreateTables(project.id, tables)
      setPlans(p)
      // Everything creatable starts selected — the user opened this to create them.
      setPicked(new Set(p.filter((x) => x.sql && !x.exists).map((x) => x.table)))
      if (p.length === 1 && p[0].sql) setExpanded(p[0].table)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [project.id, tables])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, creating])

  const creatable = useMemo(() => plans?.filter((p) => p.sql && !p.exists) ?? [], [plans])
  const blocked = useMemo(() => plans?.filter((p) => !p.sql || p.exists) ?? [], [plans])
  const warningCount = useMemo(
    () => creatable.filter((p) => picked.has(p.table)).reduce((s, p) => s + p.warnings.length, 0),
    [creatable, picked]
  )

  const toggle = (table: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(table)) next.delete(table)
      else next.add(table)
      return next
    })

  const create = async () => {
    const names = creatable.filter((p) => picked.has(p.table)).map((p) => p.table)
    if (names.length === 0) return
    setCreating(true)
    try {
      const results = await api.schema.createTables(project.id, names)
      const failed = results.filter((r) => !r.ok)
      if (failed.length === 0) {
        toast.success(`${results.length} table(s) created on target`)
        onCreated()
        onClose()
        return
      }
      toast.error(`${failed.length}/${results.length} failed · ${failed[0].table}: ${failed[0].error}`)
      onCreated()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const selectedCount = creatable.filter((p) => picked.has(p.table)).length

  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-bg/60 backdrop-blur-sm">
      <div className="glass rounded-2xl w-[760px] max-w-[95vw] max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3 border-b border-line/40 shrink-0">
          <TableProperties className="size-4 text-accent shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-tight">Create tables in target</h3>
            <p className="text-[11px] text-text-muted truncate">
              from <span className="font-mono">{project.source.database}</span>
              <ArrowRight className="inline size-3 mx-1 -mt-px" />
              <span className="font-mono">{project.target.database}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="ml-auto text-text-muted hover:text-text disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="py-16 grid place-items-center gap-3 text-text-muted text-sm">
              <Loader2 className="size-5 animate-spin text-accent" />
              Reading source schema…
            </div>
          ) : error ? (
            <div className="py-14 px-8 grid place-items-center gap-2 text-center">
              <AlertTriangle className="size-5 text-danger" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              <p className="px-1 pb-1 text-[11.5px] text-text-muted">
                Columns, nullability and the primary key are copied. Indexes, defaults, foreign keys
                and auto-increment are not.
              </p>

              {creatable.map((p) => (
                <div key={p.table} className="rounded-lg border border-line/50 overflow-hidden">
                  <div
                    onClick={() => !creating && toggle(p.table)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-bg-panel/40',
                      picked.has(p.table) && 'bg-success/[0.07]'
                    )}
                  >
                    <span
                      role="checkbox"
                      aria-checked={picked.has(p.table)}
                      className={cn(
                        'block size-4 rounded border-2 transition-all grid place-items-center shrink-0',
                        picked.has(p.table) ? 'border-success bg-success' : 'border-line/60'
                      )}
                    >
                      {picked.has(p.table) && <Check className="size-2.5 text-white" strokeWidth={4} />}
                    </span>
                    <span className="font-mono text-[12.5px] truncate min-w-0 flex-1">{p.table}</span>
                    <span className="text-[11px] text-text-muted shrink-0">
                      {p.columnCount} column(s)
                      {p.pkColumn ? ` · pk ${p.pkColumn}` : ' · no pk'}
                    </span>
                    {p.warnings.length > 0 && (
                      <span
                        title={`${p.warnings.length} note(s)`}
                        className="text-[11px] text-warn shrink-0 inline-flex items-center gap-1"
                      >
                        <AlertTriangle className="size-3" />
                        {p.warnings.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpanded((cur) => (cur === p.table ? null : p.table))
                      }}
                      className="text-text-muted hover:text-text shrink-0 inline-flex items-center gap-1 text-[11px]"
                    >
                      SQL
                      <ChevronDown
                        className={cn(
                          'size-3.5 transition-transform',
                          expanded !== p.table && '-rotate-90'
                        )}
                      />
                    </button>
                  </div>
                  {expanded === p.table && (
                    <div className="border-t border-line/30">
                      {p.warnings.length > 0 && (
                        <ul className="px-3 py-2 space-y-0.5 border-b border-line/30">
                          {p.warnings.map((w) => (
                            <li key={w} className="text-[11px] text-warn flex gap-1.5">
                              <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                              <span>{w}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <pre className="px-3 py-2.5 text-[11px] font-mono leading-relaxed overflow-x-auto bg-black/30 text-text-muted">
                        {p.sql}
                      </pre>
                    </div>
                  )}
                </div>
              ))}

              {blocked.length > 0 && (
                <div className="rounded-lg border border-line/50 bg-bg-panel/30 px-3 py-2.5">
                  <div className="text-[11.5px] font-medium text-text-muted mb-1">
                    {blocked.length} table(s) skipped
                  </div>
                  <ul className="space-y-0.5">
                    {blocked.map((p) => (
                      <li key={p.table} className="text-[11px] text-text-muted">
                        <span className="font-mono text-text">{p.table}</span>
                        {' — '}
                        {p.exists ? 'already exists on target' : p.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {creatable.length === 0 && blocked.length === 0 && (
                <p className="py-10 text-center text-sm text-text-muted">Nothing to create</p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 flex items-center gap-3 border-t border-line/40 shrink-0">
          <div className="text-[11.5px] text-text-muted min-w-0 truncate">
            {selectedCount === 0
              ? 'Nothing selected'
              : `${selectedCount} table(s) will be created${warningCount > 0 ? ` · ${warningCount} note(s)` : ''}`}
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Button variant="ghost" onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={create}
              disabled={selectedCount === 0 || creating || loading}
            >
              {creating && <Loader2 className="size-4 animate-spin" />}
              {creating ? 'Creating…' : `Create ${selectedCount || ''}`.trim()}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
