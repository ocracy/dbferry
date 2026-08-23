import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Columns3,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  TableProperties,
  X
} from 'lucide-react'
import type { ColumnFixAction, Project, SchemaDiffResult } from '@shared/types'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { toast } from 'sonner'

interface Props {
  project: Project
  /** tables to compare — empty means every table in the project */
  tables: string[]
  onClose: () => void
  onApplied: () => void
  /** hands the missing tables over to the create-table flow */
  onCreateTables?: (tables: string[]) => void
}

type Tab = 'drop' | 'create' | 'alter'

/** One line of one tab. `values` is set for enum widenings. */
interface Row {
  key: string
  tab: Tab
  table: string
  column: string
  /** the type being removed / created, or the change being made */
  detail: string
  applicable: boolean
  reason?: string
  values?: string[]
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'drop', label: 'Drop' },
  { id: 'create', label: 'Create' },
  { id: 'alter', label: 'Alter' }
]

export function SchemaDiffDialog({ project, tables, onClose, onApplied, onCreateTables }: Props) {
  const [result, setResult] = useState<SchemaDiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<Tab>('drop')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.schema.diff(project.id, tables)
      setResult(r)
      // Nothing is pre-selected — only what the user ticks is applied.
      setPicked(new Set())
      // Open on a tab that actually has something in it.
      const has = (kinds: string[]) =>
        r.tables.some((t) => t.diffs.some((d) => kinds.includes(d.kind)))
      setTab(
        has(['extra-in-target'])
          ? 'drop'
          : has(['missing-in-target'])
            ? 'create'
            : has(['enum-values', 'type-mismatch'])
              ? 'alter'
              : 'drop'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applying) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, applying])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const t of result?.tables ?? []) {
      for (const d of t.diffs) {
        const key = `${t.table} ${d.column} ${d.kind}`
        if (d.kind === 'missing-in-target') {
          out.push({
            key,
            tab: 'create',
            table: t.table,
            column: d.column,
            detail: d.sourceType ?? '—',
            applicable: d.fixable,
            reason: d.reason
          })
        } else if (d.kind === 'extra-in-target') {
          out.push({
            key,
            tab: 'drop',
            table: t.table,
            column: d.column,
            detail: d.targetType ?? '—',
            applicable: d.fixable,
            reason: d.reason
          })
        } else if (d.kind === 'enum-values') {
          const missing = d.missingValues ?? []
          out.push({
            key,
            tab: 'alter',
            table: t.table,
            column: d.column,
            detail:
              missing.length > 0
                ? `add ${missing.map((v) => `'${v}'`).join(', ')}`
                : `target has extra ${(d.extraValues ?? []).map((v) => `'${v}'`).join(', ')}`,
            applicable: d.fixable,
            reason: d.reason,
            values: missing
          })
        } else {
          out.push({
            key,
            tab: 'alter',
            table: t.table,
            column: d.column,
            detail: `${d.targetType ?? '—'} → ${d.sourceType ?? '—'}`,
            applicable: false,
            reason: d.reason
          })
        }
      }
    }
    return out.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column))
  }, [result])

  const missingTables = useMemo(
    () => result?.tables.filter((t) => t.missingTable).map((t) => t.table) ?? [],
    [result]
  )
  const goneFromSource = useMemo(
    () => result?.tables.filter((t) => t.missingOnSource).map((t) => t.table) ?? [],
    [result]
  )
  const erroredTables = useMemo(
    () => result?.tables.filter((t) => t.error).map((t) => `${t.table}: ${t.error}`) ?? [],
    [result]
  )

  const countFor = (id: Tab) => rows.filter((r) => r.tab === id).length

  const q = filter.trim().toLowerCase()
  const visible = rows.filter(
    (r) =>
      r.tab === tab &&
      (!q || r.table.toLowerCase().includes(q) || r.column.toLowerCase().includes(q))
  )
  const selectable = visible.filter((r) => r.applicable)
  const allSelected = selectable.length > 0 && selectable.every((r) => picked.has(r.key))

  const actions = useMemo<ColumnFixAction[]>(
    () =>
      rows
        .filter((r) => r.applicable && picked.has(r.key))
        .map((r) => ({
          table: r.table,
          column: r.column,
          action:
            r.tab === 'create'
              ? ('add' as const)
              : r.tab === 'drop'
                ? ('drop' as const)
                : ('add-enum-values' as const),
          values: r.values
        })),
    [rows, picked]
  )
  const dropPicked = actions.filter((a) => a.action === 'drop').length

  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const toggleAll = () =>
    setPicked((prev) => {
      const next = new Set(prev)
      for (const r of selectable) {
        if (allSelected) next.delete(r.key)
        else next.add(r.key)
      }
      return next
    })

  const apply = async () => {
    if (actions.length === 0) return
    setApplying(true)
    try {
      const results = await api.schema.applyFixes(project.id, actions)
      const failed = results.filter((r) => !r.ok)
      if (failed.length === 0) {
        toast.success(`${results.length} change(s) applied to target`)
      } else {
        toast.error(
          `${failed.length}/${results.length} failed · ${failed[0].table}.${failed[0].column}: ${failed[0].error}`
        )
      }
      onApplied()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  const nothingAtAll =
    !!result &&
    rows.length === 0 &&
    missingTables.length === 0 &&
    goneFromSource.length === 0 &&
    erroredTables.length === 0

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/60 backdrop-blur-sm">
      <div className="glass rounded-2xl w-[820px] max-w-[95vw] h-[76vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3 border-b border-line/40 shrink-0">
          <Columns3 className="size-4 text-accent shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-tight">Column differences</h3>
            <p className="text-[11px] text-text-muted truncate">
              <span className="font-mono">{project.source.database}</span>
              <ArrowRight className="inline size-3 mx-1 -mt-px" />
              <span className="font-mono">{project.target.database}</span>
              {result && <span className="ml-2">· {result.scannedTables} table(s)</span>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={load} disabled={loading || applying}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Re-check
            </Button>
            <button
              onClick={onClose}
              disabled={applying}
              className="text-text-muted hover:text-text disabled:opacity-40"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {!loading && !error && !nothingAtAll && (
          <div className="px-6 pt-3 flex items-center gap-1.5 shrink-0">
            {TABS.map((t) => (
              <TabButton
                key={t.id}
                label={t.label}
                count={countFor(t.id)}
                tone={t.id}
                active={tab === t.id}
                onClick={() => setTab(t.id)}
              />
            ))}
            <div className="relative ml-auto w-48">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                className="h-8 pl-8 pr-7"
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden mt-3">
          {loading ? (
            <div className="h-full grid place-items-center gap-3 text-text-muted text-sm">
              <Loader2 className="size-5 animate-spin text-accent" />
              Comparing columns…
            </div>
          ) : error ? (
            <div className="h-full px-8 grid place-items-center gap-2 text-center">
              <AlertTriangle className="size-5 text-danger" />
              <p className="text-sm text-danger">{error}</p>
              <p className="text-[11px] text-text-muted">
                Both source and target passwords must be saved before comparing.
              </p>
            </div>
          ) : nothingAtAll ? (
            <div className="h-full grid place-items-center gap-2 text-center">
              <CheckCircle2 className="size-6 text-success" />
              <p className="text-sm font-medium">Columns are in sync</p>
              <p className="text-[11px] text-text-muted">
                No differences across {result?.scannedTables} table(s).
              </p>
            </div>
          ) : (
            <>
              {/* Table-level facts belong to the tab they explain. */}
              {tab === 'create' && missingTables.length > 0 && (
                <Notice
                  title={`${missingTables.length} table(s) do not exist on the target`}
                  items={missingTables}
                  action={
                    onCreateTables && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-danger/40 text-danger hover:bg-danger/10"
                        onClick={() => onCreateTables(missingTables)}
                      >
                        <TableProperties className="size-3.5" />
                        Create in target
                      </Button>
                    )
                  }
                />
              )}
              {tab === 'drop' && goneFromSource.length > 0 && (
                <Notice
                  title={`${goneFromSource.length} table(s) no longer exist on the source`}
                  detail="Their columns are not listed here — drop the tables yourself if you want them gone."
                  items={goneFromSource}
                />
              )}
              {erroredTables.length > 0 && (
                <Notice
                  title={`${erroredTables.length} table(s) could not be read`}
                  items={erroredTables}
                />
              )}

              {selectable.length > 0 && (
                <label className="flex items-center gap-3 px-6 py-2 border-y border-line/30 cursor-pointer select-none">
                  <Check checked={allSelected} tone={tab} onClick={toggleAll} />
                  <span className="text-[11.5px] text-text-muted">
                    Select all {selectable.length}
                  </span>
                </label>
              )}

              {visible.length === 0 ? (
                <div className="py-16 text-center text-text-muted text-sm">
                  {filter ? 'Nothing matches this filter' : emptyLabel(tab)}
                </div>
              ) : (
                <ul>
                  {visible.map((r) => (
                    <Line
                      key={r.key}
                      row={r}
                      checked={picked.has(r.key)}
                      onToggle={() => toggle(r.key)}
                      disabled={applying}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 flex items-center gap-3 border-t border-line/40 shrink-0">
          <div className="text-[11.5px] min-w-0 truncate">
            {actions.length === 0 ? (
              <span className="text-text-muted">Nothing selected</span>
            ) : (
              <>
                <span className="text-text">{actions.length} selected</span>
                {dropPicked > 0 && (
                  <span className="text-danger"> · {dropPicked} will be deleted with its data</span>
                )}
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Button variant="ghost" onClick={onClose} disabled={applying}>
              Close
            </Button>
            <Button
              variant={dropPicked > 0 ? 'danger' : 'primary'}
              onClick={apply}
              disabled={actions.length === 0 || applying || loading}
            >
              {applying && <Loader2 className="size-4 animate-spin" />}
              {applying ? 'Applying…' : `Apply${actions.length ? ` ${actions.length}` : ''}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function emptyLabel(tab: Tab): string {
  if (tab === 'drop') return 'No columns to drop — the target has nothing extra'
  if (tab === 'create') return 'No columns to create — the target has everything the source has'
  return 'No type or enum changes'
}

function Line({
  row,
  checked,
  onToggle,
  disabled
}: {
  row: Row
  checked: boolean
  onToggle: () => void
  disabled: boolean
}) {
  return (
    <li
      onClick={() => row.applicable && !disabled && onToggle()}
      className={cn(
        'flex items-center gap-3 px-6 py-2 border-b border-line/20',
        row.applicable ? 'cursor-pointer hover:bg-bg-panel/50' : 'opacity-60',
        checked && (row.tab === 'drop' ? 'bg-danger/[0.07]' : row.tab === 'create' ? 'bg-success/[0.07]' : 'bg-accent/[0.07]')
      )}
    >
      <span className="w-4 shrink-0 grid place-items-center">
        {row.applicable ? (
          <Check checked={checked} tone={row.tab} onClick={onToggle} />
        ) : (
          <Lock className="size-3.5 text-text-muted/60" />
        )}
      </span>
      <span className="font-mono text-[12.5px] truncate min-w-0 flex-1">
        <span className="text-text-muted">{row.table}.</span>
        {row.column}
      </span>
      <span className="font-mono text-[11px] text-text-muted truncate max-w-[280px] shrink-0">
        {row.detail}
      </span>
      {!row.applicable && row.reason && (
        <span className="text-[11px] text-warn truncate max-w-[220px] shrink-0" title={row.reason}>
          {row.reason}
        </span>
      )}
    </li>
  )
}

function TabButton({
  label,
  count,
  tone,
  active,
  onClick
}: {
  label: string
  count: number
  tone: Tab
  active: boolean
  onClick: () => void
}) {
  const activeColor =
    tone === 'drop'
      ? 'bg-danger/15 text-danger'
      : tone === 'create'
        ? 'bg-success/15 text-success'
        : 'bg-accent/15 text-accent'
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-[12.5px] font-medium transition-colors',
        active ? activeColor : 'text-text-muted hover:text-text'
      )}
    >
      {label}
      <span className={cn('tabular-nums rounded px-1 text-[10.5px]', active ? 'bg-black/20' : 'bg-bg-panel')}>
        {count}
      </span>
    </button>
  )
}

function Notice({
  title,
  detail,
  items,
  action
}: {
  title: string
  detail?: string
  items: string[]
  action?: React.ReactNode
}) {
  return (
    <div className="mx-6 mb-3 rounded-lg border border-line/50 bg-bg-panel/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-warn">
        <AlertTriangle className="size-3.5 shrink-0" />
        {title}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {detail && <p className="mt-0.5 text-[11px] text-text-muted">{detail}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {items.map((n) => (
          <span
            key={n}
            className="font-mono text-[11px] rounded bg-bg-panel/80 border border-line/50 px-1.5 py-px"
          >
            {n}
          </span>
        ))}
      </div>
    </div>
  )
}

function Check({
  checked,
  tone,
  onClick
}: {
  checked: boolean
  tone: Tab
  onClick: () => void
}) {
  const on =
    tone === 'drop'
      ? 'border-danger bg-danger'
      : tone === 'create'
        ? 'border-success bg-success'
        : 'border-accent bg-accent'
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-checked={checked}
      role="checkbox"
      className={cn(
        'block size-4 rounded border-2 transition-all grid place-items-center',
        checked ? on : 'border-line/60 hover:border-text-muted/80'
      )}
    >
      {checked && (
        <svg viewBox="0 0 20 20" className="size-2.5 text-white">
          <path
            fill="currentColor"
            d="M7.629 14.571 4.343 11.286 5.757 9.872 7.629 11.743 14.243 5.129 15.657 6.543z"
          />
        </svg>
      )}
    </button>
  )
}
