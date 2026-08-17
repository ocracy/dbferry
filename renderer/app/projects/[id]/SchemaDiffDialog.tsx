import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Columns3,
  Lock,
  Loader2,
  ListPlus,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Table2,
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

/** One actionable line: a column that will be created on, removed from, or widened on the target. */
interface ChangeRow {
  key: string
  table: string
  column: string
  action: 'add' | 'drop' | 'enum'
  /** the type that will be created (add) or removed (drop), or the labels to add (enum) */
  type: string
  applicable: boolean
  reason?: string
  /** enum labels that will be added to the target */
  values?: string[]
}

/** A column that exists on both sides with a different type — reported, never applied. */
interface TypeRow {
  key: string
  table: string
  column: string
  sourceType: string
  targetType: string
}

type Tab = 'changes' | 'types'

export function SchemaDiffDialog({ project, tables, onClose, onApplied, onCreateTables }: Props) {
  const [result, setResult] = useState<SchemaDiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<Tab>('changes')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.schema.diff(project.id, tables)
      setResult(r)
      // Nothing is pre-selected — only what the user ticks is applied.
      setPicked(new Set())
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

  const { changeRows, typeRows } = useMemo(() => {
    const changes: ChangeRow[] = []
    const types: TypeRow[] = []
    for (const t of result?.tables ?? []) {
      for (const d of t.diffs) {
        if (d.kind === 'enum-values') {
          const missing = d.missingValues ?? []
          if (missing.length > 0) {
            changes.push({
              key: `${t.table} ${d.column}`,
              table: t.table,
              column: d.column,
              action: 'enum',
              type: missing.map((v) => `'${v}'`).join(', '),
              applicable: d.fixable,
              reason: d.reason,
              values: missing
            })
          } else {
            // Only the target has extra labels — nothing to apply, just report it.
            types.push({
              key: `${t.table} ${d.column}`,
              table: t.table,
              column: d.column,
              sourceType: `enum without ${(d.extraValues ?? []).map((v) => `'${v}'`).join(', ')}`,
              targetType: `enum with ${(d.extraValues ?? []).map((v) => `'${v}'`).join(', ')}`
            })
          }
        } else if (d.kind === 'type-mismatch') {
          types.push({
            key: `${t.table} ${d.column}`,
            table: t.table,
            column: d.column,
            sourceType: d.sourceType ?? '—',
            targetType: d.targetType ?? '—'
          })
        } else {
          const add = d.kind === 'missing-in-target'
          changes.push({
            key: `${t.table} ${d.column}`,
            table: t.table,
            column: d.column,
            action: add ? 'add' : 'drop',
            // Show the type that is actually involved: what gets created, or what gets removed.
            type: (add ? d.sourceType : d.targetType) ?? '—',
            applicable: d.fixable,
            reason: d.reason
          })
        }
      }
    }
    return { changeRows: changes, typeRows: types }
  }, [result])

  const missingTables = useMemo(
    () => result?.tables.filter((t) => t.missingTable).map((t) => t.table) ?? [],
    [result]
  )
  const erroredTables = useMemo(
    () => result?.tables.filter((t) => t.error).map((t) => `${t.table}: ${t.error}`) ?? [],
    [result]
  )

  const addTotal = changeRows.filter((r) => r.action === 'add').length
  const dropTotal = changeRows.filter((r) => r.action === 'drop').length
  const enumTotal = changeRows.filter((r) => r.action === 'enum').length

  const q = filter.trim().toLowerCase()
  const match = (table: string, column: string) =>
    !q || table.toLowerCase().includes(q) || column.toLowerCase().includes(q)

  /** Rows of the active tab, grouped by table, so the table name is printed once. */
  const groups = useMemo(() => {
    const rows: Array<ChangeRow | TypeRow> =
      tab === 'changes'
        ? changeRows.filter((r) => match(r.table, r.column))
        : typeRows.filter((r) => match(r.table, r.column))
    const byTable = new Map<string, Array<ChangeRow | TypeRow>>()
    for (const r of rows) {
      const list = byTable.get(r.table)
      if (list) list.push(r)
      else byTable.set(r.table, [r])
    }
    return Array.from(byTable, ([table, items]) => ({ table, items })).sort((a, b) =>
      a.table.localeCompare(b.table)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, changeRows, typeRows, q])

  const actions = useMemo<ColumnFixAction[]>(
    () =>
      changeRows
        .filter((r) => r.applicable && picked.has(r.key))
        .map((r) => ({
          table: r.table,
          column: r.column,
          action:
            r.action === 'enum' ? ('add-enum-values' as const) : (r.action as 'add' | 'drop'),
          values: r.values
        })),
    [changeRows, picked]
  )
  const addPicked = actions.filter((a) => a.action === 'add').length
  const dropPicked = actions.filter((a) => a.action === 'drop').length
  const enumPicked = actions.filter((a) => a.action === 'add-enum-values').length

  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const toggleTable = (table: string) =>
    setPicked((prev) => {
      const rows = changeRows.filter((r) => r.table === table && r.applicable)
      const allOn = rows.length > 0 && rows.every((r) => picked.has(r.key))
      const next = new Set(prev)
      for (const r of rows) {
        if (allOn) next.delete(r.key)
        else next.add(r.key)
      }
      return next
    })

  const selectAll = (only: 'add' | 'drop' | 'enum' | 'none') =>
    setPicked(() => {
      if (only === 'none') return new Set()
      return new Set(changeRows.filter((r) => r.applicable && r.action === only).map((r) => r.key))
    })

  const apply = async () => {
    if (actions.length === 0) return
    setApplying(true)
    try {
      const results = await api.schema.applyFixes(project.id, actions)
      const failed = results.filter((r) => !r.ok)
      if (failed.length === 0) {
        toast.success(`${results.length} column change(s) applied to target`)
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
    changeRows.length === 0 &&
    typeRows.length === 0 &&
    missingTables.length === 0 &&
    erroredTables.length === 0

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/60 backdrop-blur-sm">
      <div className="glass rounded-2xl w-[860px] max-w-[95vw] h-[78vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3 border-b border-line/40 shrink-0">
          <Columns3 className="size-4 text-accent shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-tight">Column differences</h3>
            <p className="text-[11px] text-text-muted truncate">
              <span className="font-mono">{project.source.database}</span>
              <ArrowRight className="inline size-3 mx-1 -mt-px" />
              <span className="font-mono">{project.target.database}</span>
              {result && <span className="ml-2">· {result.scannedTables} table(s) scanned</span>}
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
          <>
            {/* One-glance summary of what this dialog is offering to do. */}
            <div className="px-6 py-3 flex items-baseline gap-x-4 gap-y-1 flex-wrap border-b border-line/40 shrink-0">
              <span className="text-[13px]">
                <span className="text-success font-semibold tabular-nums">{addTotal}</span>
                <span className="text-text-muted"> column(s) to add</span>
              </span>
              <span className="text-[13px]">
                <span className="text-danger font-semibold tabular-nums">{dropTotal}</span>
                <span className="text-text-muted"> to drop</span>
              </span>
              {enumTotal > 0 && (
                <span className="text-[13px]">
                  <span className="text-accent font-semibold tabular-nums">{enumTotal}</span>
                  <span className="text-text-muted"> enum(s) missing labels</span>
                </span>
              )}
              {typeRows.length > 0 && (
                <span className="text-[13px]">
                  <span className="text-warn font-semibold tabular-nums">{typeRows.length}</span>
                  <span className="text-text-muted"> type difference(s)</span>
                </span>
              )}
              <span className="text-[11px] text-text-muted ml-auto">
                across{' '}
                {new Set([...changeRows, ...typeRows].map((r) => r.table)).size} table(s)
              </span>
            </div>

            <div className="px-6 py-2.5 flex items-center gap-2 border-b border-line/40 shrink-0">
              <Tab
                label="Changes to apply"
                count={changeRows.length}
                active={tab === 'changes'}
                onClick={() => setTab('changes')}
              />
              {typeRows.length > 0 && (
                <Tab
                  label="Type differences"
                  count={typeRows.length}
                  active={tab === 'types'}
                  onClick={() => setTab('types')}
                />
              )}
              <div className="relative ml-auto w-52">
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

            {tab === 'changes' && changeRows.length > 0 && (
              <div className="px-6 py-2 flex items-center gap-3 text-[11px] border-b border-line/40 shrink-0">
                <span className="text-text-muted">Quick select</span>
                <button
                  onClick={() => selectAll('add')}
                  disabled={applying || addTotal === 0}
                  className="text-success hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  all {addTotal} additions
                </button>
                <button
                  onClick={() => selectAll('drop')}
                  disabled={applying || dropTotal === 0}
                  className="text-danger hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  all {dropTotal} drops
                </button>
                {enumTotal > 0 && (
                  <button
                    onClick={() => selectAll('enum')}
                    disabled={applying}
                    className="text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    all {enumTotal} enum updates
                  </button>
                )}
                {picked.size > 0 && (
                  <button
                    onClick={() => selectAll('none')}
                    disabled={applying}
                    className="text-text-muted hover:text-text ml-1"
                  >
                    clear
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
              {tab === 'changes' && (missingTables.length > 0 || erroredTables.length > 0) && (
                <div className="px-6 pt-3 space-y-2">
                  {missingTables.length > 0 && (
                    <Notice
                      tone="danger"
                      title={`${missingTables.length} table(s) do not exist on the target`}
                      detail="They cannot sync until they exist. Review the CREATE TABLE and create them."
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
                            Create {missingTables.length} in target
                          </Button>
                        )
                      }
                    />
                  )}
                  {erroredTables.length > 0 && (
                    <Notice
                      tone="warn"
                      title={`${erroredTables.length} table(s) could not be read`}
                      items={erroredTables}
                    />
                  )}
                </div>
              )}

              {groups.length === 0 ? (
                <div className="py-16 text-center text-text-muted text-sm">
                  {tab === 'changes'
                    ? filter
                      ? 'No changes match this filter'
                      : 'No columns to add or drop'
                    : 'No type differences match this filter'}
                </div>
              ) : (
                <div className="pb-3">
                  {groups.map((g) => {
                    const applicable = changeRows.filter((r) => r.table === g.table && r.applicable)
                    const allOn = applicable.length > 0 && applicable.every((r) => picked.has(r.key))
                    return (
                      <div key={g.table}>
                        <div className="sticky top-0 z-10 flex items-center gap-2 px-6 py-2 bg-bg-panel/95 backdrop-blur border-y border-line/40">
                          <Table2 className="size-3.5 text-text-muted shrink-0" />
                          <span className="font-mono text-[12.5px] truncate">{g.table}</span>
                          <span className="text-[11px] text-text-muted shrink-0">
                            {g.items.length} {tab === 'changes' ? 'change(s)' : 'difference(s)'}
                          </span>
                          {tab === 'changes' && applicable.length > 0 && (
                            <button
                              onClick={() => toggleTable(g.table)}
                              disabled={applying}
                              className="ml-auto text-[11px] text-accent hover:underline shrink-0"
                            >
                              {allOn ? 'deselect table' : 'select table'}
                            </button>
                          )}
                        </div>
                        <ul>
                          {g.items.map((r) =>
                            tab === 'changes' ? (
                              <ChangeLine
                                key={r.key}
                                row={r as ChangeRow}
                                checked={picked.has(r.key)}
                                onToggle={() => toggle(r.key)}
                                disabled={applying}
                              />
                            ) : (
                              <TypeLine key={r.key} row={r as TypeRow} />
                            )
                          )}
                        </ul>
                      </div>
                    )
                  })}
                </div>
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
                {addPicked > 0 && (
                  <span className="text-success">
                    {addPicked} column{addPicked > 1 ? 's' : ''} will be added
                  </span>
                )}
                {addPicked > 0 && (dropPicked > 0 || enumPicked > 0) && (
                  <span className="text-text-muted"> · </span>
                )}
                {enumPicked > 0 && (
                  <span className="text-accent">
                    {enumPicked} enum{enumPicked > 1 ? 's' : ''} will get the missing label(s)
                  </span>
                )}
                {enumPicked > 0 && dropPicked > 0 && <span className="text-text-muted"> · </span>}
                {dropPicked > 0 && (
                  <span className="text-danger">
                    {dropPicked} column{dropPicked > 1 ? 's' : ''} will be deleted with its data
                  </span>
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
              {applying
                ? 'Applying…'
                : actions.length === 0
                  ? 'Apply on target'
                  : `Apply ${actions.length} on target`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChangeLine({
  row,
  checked,
  onToggle,
  disabled
}: {
  row: ChangeRow
  checked: boolean
  onToggle: () => void
  disabled: boolean
}) {
  const isAdd = row.action === 'add'
  const isDrop = row.action === 'drop'
  const tone = isAdd ? 'success' : isDrop ? 'danger' : 'accent'
  return (
    <li
      onClick={() => row.applicable && !disabled && onToggle()}
      className={cn(
        'flex items-center gap-3 pl-6 pr-6 py-2 border-b border-line/20',
        row.applicable ? 'cursor-pointer hover:bg-bg-panel/50' : 'opacity-60',
        checked &&
          (isDrop ? 'bg-danger/[0.07]' : isAdd ? 'bg-success/[0.07]' : 'bg-accent/[0.07]')
      )}
    >
      <span className="w-4 shrink-0 grid place-items-center">
        {row.applicable ? (
          <Check checked={checked} tone={tone} onClick={onToggle} />
        ) : (
          <Lock className="size-3.5 text-text-muted/60" />
        )}
      </span>

      {/* Action first — it is the thing to understand at a glance. */}
      <span
        className={cn(
          'shrink-0 w-[76px] inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider',
          isAdd
            ? 'bg-success/15 text-success border-success/30'
            : isDrop
              ? 'bg-danger/15 text-danger border-danger/30'
              : 'bg-accent/15 text-accent border-accent/30'
        )}
      >
        {isAdd ? <Plus className="size-2.5" /> : isDrop ? <Minus className="size-2.5" /> : <ListPlus className="size-2.5" />}
        {isAdd ? 'add' : isDrop ? 'drop' : 'enum'}
      </span>

      <span className="font-mono text-[12.5px] truncate min-w-0 flex-1">{row.column}</span>

      <span
        className={cn(
          'font-mono text-[11px] truncate max-w-[240px] shrink-0',
          row.action === 'enum' ? 'text-accent' : 'text-text-muted'
        )}
        title={row.action === 'enum' ? `Labels to add: ${row.type}` : row.type}
      >
        {row.action === 'enum' ? `+ ${row.type}` : row.type}
      </span>

      {/* Only rows that cannot be applied need a sentence — the pill says the rest. */}
      {!row.applicable && (
        <span className="text-[11px] text-warn shrink-0 max-w-[260px] truncate" title={row.reason}>
          {row.reason}
        </span>
      )}
    </li>
  )
}

function TypeLine({ row }: { row: TypeRow }) {
  return (
    <li className="flex items-center gap-3 pl-6 pr-6 py-2 border-b border-line/20">
      <span className="font-mono text-[12.5px] truncate min-w-0 flex-1">{row.column}</span>
      <span className="font-mono text-[11px] shrink-0 inline-flex items-center gap-2">
        <span className="text-text-muted">target</span>
        <span className="text-warn">{row.targetType}</span>
        <ArrowRight className="size-3 text-text-muted/60" />
        <span className="text-text-muted">source</span>
        <span className="text-text">{row.sourceType}</span>
      </span>
      <span className="text-[11px] text-text-muted shrink-0 w-[150px] text-right">
        change it manually
      </span>
    </li>
  )
}

function Tab({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12px] font-medium transition-colors',
        active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text'
      )}
    >
      {label}
      <span
        className={cn(
          'tabular-nums rounded px-1 text-[10.5px]',
          active ? 'bg-accent/20' : 'bg-bg-panel'
        )}
      >
        {count}
      </span>
    </button>
  )
}

function Notice({
  tone,
  title,
  detail,
  items,
  action
}: {
  tone: 'danger' | 'warn'
  title: string
  detail?: string
  items: string[]
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-line/50 bg-bg-panel/40 px-3 py-2.5">
      <div
        className={cn(
          'flex items-center gap-1.5 text-[11.5px] font-medium',
          tone === 'danger' ? 'text-danger' : 'text-warn'
        )}
      >
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
  tone: 'success' | 'danger' | 'accent'
  onClick: () => void
}) {
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
        checked
          ? tone === 'danger'
            ? 'border-danger bg-danger'
            : tone === 'accent'
              ? 'border-accent bg-accent'
              : 'border-success bg-success'
          : 'border-line/60 hover:border-text-muted/80'
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
