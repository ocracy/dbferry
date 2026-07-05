import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, Search, Loader2, AlertTriangle, Hash, X, Zap, Play, Sparkles, Trash2, KeyRound, ChevronDown } from 'lucide-react'
import type { Project, TableConfig, SyncMode } from '@shared/types'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useSync } from '@/stores/sync'
import { cn } from '@/lib/cn'
import { toast } from 'sonner'

interface Props {
  project: Project
  onTablesChanged: () => void
  disabled: boolean
}

interface TableDiff {
  added: string[]
  removed: string[]
  pkChanged: { name: string; from: string; to: string }[]
}

type ModeFilter = 'all' | 'disabled' | 'incremental' | 'full' | 'new'

export function TablesGrid({ project, onTablesChanged, disabled }: Props) {
  const [loading, setLoading] = useState(false)
  const [countingAll, setCountingAll] = useState(false)
  const [countingOne, setCountingOne] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [rowCounts, setRowCounts] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ table: TableConfig; x: number; y: number } | null>(null)
  const [diff, setDiff] = useState<TableDiff | null>(null)
  const [diffOpen, setDiffOpen] = useState(true)
  const [newTables, setNewTables] = useState<Set<string>>(new Set())
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')
  const active = useSync((s) => s.active)
  const tables = project.tables

  const fetchTables = async () => {
    setLoading(true)
    try {
      const meta = await api.connection.listTablesMeta(project.id, 'source')
      const list = meta.map((m) => m.name)
      // Snapshot of what dbferry knew before this refresh — used to compute the diff.
      const prevNames = new Set(tables.map((t) => t.name))
      const added: string[] = []
      const pkChanged: TableDiff['pkChanged'] = []
      const merged: TableConfig[] = meta.map((m) => {
        const existing = tables.find((t) => t.name === m.name)
        if (!existing) {
          added.push(m.name)
          return { name: m.name, mode: 'disabled', pkColumn: m.pkColumn ?? 'id' }
        }
        if (existing.pkColumn === 'id' && m.pkColumn && m.pkColumn !== 'id') {
          pkChanged.push({ name: m.name, from: existing.pkColumn, to: m.pkColumn })
          return { ...existing, pkColumn: m.pkColumn }
        }
        return existing
      })
      const removedTables = tables.filter((t) => !list.includes(t.name))
      const removed = removedTables.map((t) => t.name)
      // Keep still-configured removed tables visible; drop the ones that were disabled anyway.
      const final = [...merged, ...removedTables.filter((r) => r.mode !== 'disabled')]
      await api.projects.replaceTables(project.id, final)

      const nextDiff: TableDiff = { added, removed, pkChanged }
      const hasChanges = added.length > 0 || removed.length > 0 || pkChanged.length > 0
      setDiff(hasChanges ? nextDiff : null)
      setDiffOpen(true)
      setNewTables(new Set(added))
      if (hasChanges) {
        const bits: string[] = []
        if (added.length) bits.push(`${added.length} new`)
        if (removed.length) bits.push(`${removed.length} removed`)
        toast.success(`Schema changed · ${bits.join(' · ')}`)
      } else if (prevNames.size > 0) {
        toast.success('No table changes since last refresh')
      }

      const noPk = meta.filter((m) => !m.pkColumn).map((m) => m.name)
      if (noPk.length) {
        toast.warning(
          `${noPk.length} table(s) have no primary key. Use "full" or skip incremental: ${noPk.slice(0, 5).join(', ')}${noPk.length > 5 ? '…' : ''}`
        )
      }
      onTablesChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const countAll = async () => {
    if (!tables.length) return
    setCountingAll(true)
    try {
      const names = tables.map((t) => t.name)
      const result = await api.connection.countRows(project.id, 'source', names)
      setRowCounts((prev) => ({ ...prev, ...result }))
      const total = Object.values(result).filter((n) => n >= 0).reduce((s, n) => s + n, 0)
      toast.success(`${names.length} tables · ${total.toLocaleString()} total rows`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCountingAll(false)
    }
  }

  const countOne = async (name: string) => {
    setCountingOne(name)
    try {
      const result = await api.connection.countRows(project.id, 'source', [name])
      setRowCounts((prev) => ({ ...prev, ...result }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCountingOne(null)
    }
  }

  const setMode = async (table: TableConfig, mode: SyncMode) => {
    if (disabled) return
    await api.projects.upsertTable(project.id, { ...table, mode })
    onTablesChanged()
  }

  const toggleAddColumn = async (table: TableConfig) => {
    if (disabled) return
    await api.projects.upsertTable(project.id, { ...table, addColumn: !table.addColumn })
    onTablesChanged()
  }

  const toggleDropColumn = async (table: TableConfig) => {
    if (disabled) return
    await api.projects.upsertTable(project.id, { ...table, dropColumn: !table.dropColumn })
    onTablesChanged()
  }

  const filtered = useMemo(() => {
    let list = tables
    if (modeFilter === 'new') list = list.filter((t) => newTables.has(t.name))
    else if (modeFilter !== 'all') list = list.filter((t) => t.mode === modeFilter)
    if (filter) {
      const q = filter.toLowerCase()
      list = list.filter((t) => t.name.toLowerCase().includes(q))
    }
    return list
  }, [tables, filter, modeFilter, newTables])

  // Bulk action targets selected rows; if none selected, falls back to all visible
  const targetNames = () =>
    selected.size > 0
      ? new Set(filtered.filter((t) => selected.has(t.name)).map((t) => t.name))
      : new Set(filtered.map((t) => t.name))

  const bulkSetMode = async (mode: SyncMode) => {
    if (disabled) return
    const targetSet = targetNames()
    const next = tables.map((t) => (targetSet.has(t.name) ? { ...t, mode } : t))
    await api.projects.replaceTables(project.id, next)
    onTablesChanged()
  }

  const bulkSetFlag = async (flag: 'addColumn' | 'dropColumn', value: boolean) => {
    if (disabled) return
    const targetSet = targetNames()
    const next = tables.map((t) => (targetSet.has(t.name) ? { ...t, [flag]: value } : t))
    await api.projects.replaceTables(project.id, next)
    onTablesChanged()
  }

  const toggleRow = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) return new Set()
      const next = new Set(prev)
      for (const t of filtered) next.add(t.name)
      return next
    })
  }

  const syncSelected = async (mode: 'incremental' | 'full') => {
    if (disabled) return
    const names = Array.from(selected)
    if (names.length === 0) return
    try {
      await api.sync.startTables(
        project.id,
        names.map((n) => ({ name: n, mode }))
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const syncOne = async (name: string, mode: 'incremental' | 'full') => {
    if (disabled) return
    try {
      await api.sync.startTables(project.id, [{ name, mode }])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const counts = useMemo(() => {
    let full = 0,
      incremental = 0,
      d = 0
    for (const t of tables) {
      if (t.mode === 'full') full++
      else if (t.mode === 'incremental') incremental++
      else d++
    }
    return { full, incremental, disabled: d }
  }, [tables])

  const filterActive = filter.trim().length > 0
  const filteredAllSame = (mode: SyncMode) =>
    filtered.length > 0 && filtered.every((t) => t.mode === mode)
  const filteredAllFlag = (flag: 'addColumn' | 'dropColumn') =>
    filtered.length > 0 && filtered.every((t) => !!t[flag])
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((t) => selected.has(t.name))
  const someVisibleSelected =
    !allVisibleSelected && filtered.some((t) => selected.has(t.name))
  const selectionScope = selected.size > 0 ? 'selection' : 'visible'

  return (
    <div className="glass rounded-xl flex flex-col h-full min-h-0">
      <div className="px-5 py-3.5 flex items-center justify-between border-b border-line/40 shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm mr-1">Tables</h3>
          <FilterChip
            label="all"
            count={tables.length}
            tone="neutral"
            active={modeFilter === 'all'}
            onClick={() => setModeFilter('all')}
          />
          <FilterChip
            label="incremental"
            count={counts.incremental}
            tone="accent"
            active={modeFilter === 'incremental'}
            onClick={() => setModeFilter((f) => (f === 'incremental' ? 'all' : 'incremental'))}
          />
          <FilterChip
            label="full"
            count={counts.full}
            tone="warn"
            active={modeFilter === 'full'}
            onClick={() => setModeFilter((f) => (f === 'full' ? 'all' : 'full'))}
          />
          <FilterChip
            label="disabled"
            count={counts.disabled}
            tone="neutral"
            active={modeFilter === 'disabled'}
            onClick={() => setModeFilter((f) => (f === 'disabled' ? 'all' : 'disabled'))}
          />
          {newTables.size > 0 && (
            <FilterChip
              label="new"
              count={newTables.size}
              tone="success"
              active={modeFilter === 'new'}
              icon={<Sparkles className="size-3" />}
              onClick={() => setModeFilter((f) => (f === 'new' ? 'all' : 'new'))}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={countAll} disabled={countingAll || !tables.length}>
            {countingAll ? <Loader2 className="size-3.5 animate-spin" /> : <Hash className="size-3.5" />}
            Count all rows
          </Button>
          <Button variant="outline" size="sm" onClick={fetchTables} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {tables.length === 0 ? 'Load tables' : 'Refresh'}
          </Button>
        </div>
      </div>

      {diff && (
        <DiffBanner
          diff={diff}
          open={diffOpen}
          onToggle={() => setDiffOpen((o) => !o)}
          onClose={() => setDiff(null)}
          onConfigureNew={() => {
            setModeFilter('new')
            setDiffOpen(false)
          }}
        />
      )}

      {tables.length > 0 && (
        <div className="px-5 py-2.5 flex items-center gap-3 border-b border-line/40 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              className="h-8 pl-8 pr-8"
              placeholder="Filter tables…"
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
          <span className="text-[11px] text-text-muted">
            {filtered.length !== tables.length
              ? `${filtered.length}/${tables.length}`
              : `${tables.length} total`}
          </span>
          {modeFilter !== 'all' && (
            <button
              onClick={() => setModeFilter('all')}
              className="text-[11px] text-accent hover:underline"
            >
              show all
            </button>
          )}
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px]">
              <span className="text-accent font-medium">{selected.size} selected</span>
              <span className="text-text-muted/40">·</span>
              <button
                onClick={() => syncSelected('incremental')}
                disabled={disabled}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
              >
                <Play className="size-3" />
                Sync Incremental
              </button>
              <button
                onClick={() => syncSelected('full')}
                disabled={disabled}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-warn/40 text-warn hover:bg-warn/10 transition-colors"
              >
                <Play className="size-3" />
                Sync Full
              </button>
              <span className="text-text-muted/40">·</span>
              <button
                onClick={() => setSelected(new Set())}
                className="text-text-muted hover:text-text"
              >
                clear
              </button>
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          tableName={contextMenu.table.name}
          onSyncIncremental={() => {
            syncOne(contextMenu.table.name, 'incremental')
            setContextMenu(null)
          }}
          onSyncFull={() => {
            syncOne(contextMenu.table.name, 'full')
            setContextMenu(null)
          }}
          onCount={() => {
            countOne(contextMenu.table.name)
            setContextMenu(null)
          }}
          syncDisabled={disabled}
        />
      )}

      {tables.length === 0 ? (
        <div className="p-12 text-center">
          <div className="text-text-muted text-sm mb-4">
            Connect to the source database and load its tables to start configuring sync.
          </div>
          <Button variant="primary" onClick={fetchTables} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Load tables from source
          </Button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-panel/95 backdrop-blur z-10 border-b border-line/40">
              <tr className="text-[10px] uppercase tracking-wider text-text-muted/70 border-b border-line/30">
                <th className="pl-5 pr-2 py-1.5 text-center" rowSpan={2}>
                  <SelectAllBox
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    onClick={toggleAllVisible}
                    title={
                      allVisibleSelected
                        ? 'Deselect all'
                        : `Select all ${filterActive ? 'filtered' : 'tables'}`
                    }
                  />
                </th>
                <th className="px-3 py-1.5 text-left font-medium" rowSpan={2}>Table</th>
                <th className="px-3 py-1.5 text-right font-medium" rowSpan={2}>Rows</th>
                <th className="px-3 py-1.5 text-center font-semibold text-accent/80" colSpan={3}>Data</th>
                <th className="px-3 py-1.5 text-center font-semibold text-warn/80" colSpan={2}>Structure</th>
                <th className="px-5 py-1.5 text-right font-medium w-24" rowSpan={2}>Status</th>
              </tr>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-text-muted">
                <BulkHeaderCell
                  label="Disabled"
                  scope={selectionScope}
                  onClick={() => bulkSetMode('disabled')}
                  active={filteredAllSame('disabled')}
                  tone="neutral"
                  disabled={disabled}
                />
                <BulkHeaderCell
                  label="Incremental"
                  scope={selectionScope}
                  onClick={() => bulkSetMode('incremental')}
                  active={filteredAllSame('incremental')}
                  tone="accent"
                  disabled={disabled}
                />
                <BulkHeaderCell
                  label="Full"
                  scope={selectionScope}
                  onClick={() => bulkSetMode('full')}
                  active={filteredAllSame('full')}
                  tone="warn"
                  disabled={disabled}
                />
                <BulkFlagHeader
                  label="Add col"
                  scope={selectionScope}
                  active={filteredAllFlag('addColumn')}
                  onClick={() => bulkSetFlag('addColumn', !filteredAllFlag('addColumn'))}
                  disabled={disabled}
                />
                <BulkFlagHeader
                  label="Drop col"
                  scope={selectionScope}
                  active={filteredAllFlag('dropColumn')}
                  onClick={() => bulkSetFlag('dropColumn', !filteredAllFlag('dropColumn'))}
                  disabled={disabled}
                />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <TableRow
                  key={t.name}
                  table={t}
                  selected={selected.has(t.name)}
                  onToggleSelected={() => toggleRow(t.name)}
                  rowCount={rowCounts[t.name]}
                  counting={countingOne === t.name}
                  onCountRow={() => countOne(t.name)}
                  setMode={(m) => setMode(t, m)}
                  toggleAddColumn={() => toggleAddColumn(t)}
                  toggleDropColumn={() => toggleDropColumn(t)}
                  runStatus={active?.tables[t.name]}
                  flag={
                    newTables.has(t.name)
                      ? 'new'
                      : diff?.removed.includes(t.name)
                        ? 'removed'
                        : undefined
                  }
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ table: t, x: e.clientX, y: e.clientY })
                  }}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-text-muted text-sm">
                    {filter
                      ? `No tables match "${filter}"`
                      : modeFilter === 'new'
                        ? 'No new tables from the last refresh'
                        : `No ${modeFilter} tables`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  count,
  tone,
  active,
  icon,
  onClick
}: {
  label: string
  count: number
  tone: 'accent' | 'warn' | 'neutral' | 'success'
  active: boolean
  icon?: React.ReactNode
  onClick: () => void
}) {
  const activeColor =
    tone === 'accent'
      ? 'bg-accent/20 text-accent border-accent/50'
      : tone === 'warn'
        ? 'bg-warn/20 text-warn border-warn/50'
        : tone === 'success'
          ? 'bg-success/20 text-success border-success/50'
          : 'bg-text/10 text-text border-text-muted/50'
  return (
    <button
      onClick={onClick}
      title={`Filter: ${label}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider transition-colors',
        active
          ? activeColor
          : 'bg-bg-panel text-text-muted border-line/60 hover:border-text-muted/60'
      )}
    >
      {icon}
      {count} {label}
    </button>
  )
}

function DiffBanner({
  diff,
  open,
  onToggle,
  onClose,
  onConfigureNew
}: {
  diff: TableDiff
  open: boolean
  onToggle: () => void
  onClose: () => void
  onConfigureNew: () => void
}) {
  const { added, removed, pkChanged } = diff
  return (
    <div className="mx-4 mt-3 rounded-lg border border-line/50 bg-bg-panel/40 shrink-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={onToggle} className="text-text-muted hover:text-text">
          <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />
        </button>
        <span className="text-xs font-semibold">Schema changes since last refresh</span>
        <div className="flex items-center gap-1.5">
          {added.length > 0 && (
            <Badge tone="success">
              <Sparkles className="size-2.5" /> {added.length} new
            </Badge>
          )}
          {removed.length > 0 && (
            <Badge tone="danger">
              <Trash2 className="size-2.5" /> {removed.length} removed
            </Badge>
          )}
          {pkChanged.length > 0 && (
            <Badge tone="warn">
              <KeyRound className="size-2.5" /> {pkChanged.length} pk
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {added.length > 0 && (
            <button
              onClick={onConfigureNew}
              className="text-[11px] text-accent hover:underline"
            >
              Configure new
            </button>
          )}
          <button onClick={onClose} title="Dismiss" className="text-text-muted hover:text-text">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3 pt-0 space-y-2 text-[11.5px]">
          {added.length > 0 && (
            <DiffRow
              icon={<Sparkles className="size-3 text-success" />}
              label="New on source (default disabled — enable to sync)"
              names={added}
              tone="success"
            />
          )}
          {removed.length > 0 && (
            <DiffRow
              icon={<Trash2 className="size-3 text-danger" />}
              label="Gone from source (won't sync anymore)"
              names={removed}
              tone="danger"
            />
          )}
          {pkChanged.length > 0 && (
            <DiffRow
              icon={<KeyRound className="size-3 text-warn" />}
              label="Primary key detected"
              names={pkChanged.map((p) => `${p.name} (${p.from}→${p.to})`)}
              tone="warn"
            />
          )}
        </div>
      )}
    </div>
  )
}

function DiffRow({
  icon,
  label,
  names,
  tone
}: {
  icon: React.ReactNode
  label: string
  names: string[]
  tone: 'success' | 'danger' | 'warn'
}) {
  const color =
    tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-warn'
  return (
    <div className="flex gap-2">
      <span className="shrink-0 flex items-center gap-1 pt-0.5">
        {icon}
        <span className={cn('font-medium', color)}>{names.length}</span>
      </span>
      <div className="min-w-0">
        <div className="text-text-muted text-[10.5px] uppercase tracking-wide mb-0.5">{label}</div>
        <div className="flex flex-wrap gap-1">
          {names.map((n) => (
            <span
              key={n}
              className="font-mono text-[11px] rounded bg-bg-panel/80 border border-line/50 px-1.5 py-px"
            >
              {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function BulkHeaderCell({
  label,
  onClick,
  active,
  tone,
  disabled,
  scope
}: {
  label: string
  onClick: () => void
  active: boolean
  tone: 'accent' | 'warn' | 'neutral'
  disabled: boolean
  scope: 'selection' | 'visible'
}) {
  const color =
    tone === 'accent'
      ? active
        ? 'text-accent'
        : 'text-text-muted hover:text-accent'
      : tone === 'warn'
        ? active
          ? 'text-warn'
          : 'text-text-muted hover:text-warn'
        : active
          ? 'text-text'
          : 'text-text-muted hover:text-text'
  return (
    <th className="px-3 py-2 font-medium text-center">
      <button
        onClick={onClick}
        disabled={disabled}
        title={`Set ${scope === 'selection' ? 'selected' : 'visible'} to ${label.toLowerCase()}`}
        className={cn('uppercase tracking-wider text-[10.5px] transition-colors', color, disabled && 'opacity-50')}
      >
        {label}
      </button>
    </th>
  )
}

function BulkFlagHeader({
  label,
  onClick,
  active,
  disabled,
  scope
}: {
  label: string
  onClick: () => void
  active: boolean
  disabled: boolean
  scope: 'selection' | 'visible'
}) {
  return (
    <th className="px-3 py-2 font-medium text-center">
      <button
        onClick={onClick}
        disabled={disabled}
        title={`Toggle ${label.toLowerCase()} for ${scope === 'selection' ? 'selected' : 'visible'}`}
        className={cn(
          'uppercase tracking-wider text-[10.5px] transition-colors',
          active ? 'text-warn' : 'text-text-muted hover:text-warn',
          disabled && 'opacity-50'
        )}
      >
        {label}
      </button>
    </th>
  )
}

function TableRow({
  table,
  selected,
  onToggleSelected,
  rowCount,
  counting,
  onCountRow,
  setMode,
  toggleAddColumn,
  toggleDropColumn,
  runStatus,
  flag,
  onContextMenu
}: {
  table: TableConfig
  selected: boolean
  onToggleSelected: () => void
  rowCount: number | undefined
  counting: boolean
  onCountRow: () => void
  setMode: (m: SyncMode) => void
  toggleAddColumn: () => void
  toggleDropColumn: () => void
  runStatus?: { status: string; rowsCopied: number; rowsPerSec: number; total?: number; error?: string }
  flag?: 'new' | 'removed'
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <tr
      className={cn(
        'border-b border-line/20 hover:bg-bg-panel/50 group',
        selected && 'bg-accent/5',
        flag === 'new' && 'bg-success/5',
        flag === 'removed' && 'bg-danger/5'
      )}
    >
      <td className="pl-5 pr-2 py-2 text-center">
        <SelectBox checked={selected} onClick={onToggleSelected} />
      </td>
      <td
        onContextMenu={onContextMenu}
        className="px-3 py-2 font-mono text-[12.5px] cursor-context-menu"
      >
        <span className="inline-flex items-center gap-1.5 max-w-[280px]">
          <span className="truncate">{table.name}</span>
          {flag === 'new' && (
            <span
              title="New table since last refresh"
              className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] uppercase tracking-wide bg-success/15 text-success"
            >
              <Sparkles className="size-2.5" />
              new
            </span>
          )}
          {flag === 'removed' && (
            <span
              title="Gone from source — will no longer sync"
              className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] uppercase tracking-wide bg-danger/15 text-danger"
            >
              <Trash2 className="size-2.5" />
              removed
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-[12px]">
        <div className="inline-flex items-center gap-1.5">
          <span className={rowCount === -1 ? 'text-danger' : 'text-text-muted'}>
            {rowCount === undefined ? '—' : rowCount === -1 ? 'err' : rowCount.toLocaleString()}
          </span>
          <button
            onClick={onCountRow}
            disabled={counting}
            title="Count this table"
            className="opacity-0 group-hover:opacity-100 hover:text-accent text-text-muted transition-opacity"
          >
            {counting ? <Loader2 className="size-3 animate-spin" /> : <Hash className="size-3" />}
          </button>
        </div>
      </td>
      <RadioCell checked={table.mode === 'disabled'} onClick={() => setMode('disabled')} tone="neutral" />
      <RadioCell checked={table.mode === 'incremental'} onClick={() => setMode('incremental')} tone="accent" />
      <RadioCell checked={table.mode === 'full'} onClick={() => setMode('full')} tone="warn" />
      <CheckboxCell checked={!!table.addColumn} onClick={toggleAddColumn} />
      <CheckboxCell checked={!!table.dropColumn} onClick={toggleDropColumn} />
      <td className="px-5 py-2 text-right">
        {runStatus ? <RunStatusCell s={runStatus} /> : <span className="text-text-muted/50 text-xs">—</span>}
      </td>
    </tr>
  )
}

function RadioCell({
  checked,
  onClick,
  tone
}: {
  checked: boolean
  onClick: () => void
  tone: 'accent' | 'warn' | 'neutral'
}) {
  const ring =
    tone === 'accent'
      ? 'ring-accent border-accent bg-accent'
      : tone === 'warn'
        ? 'ring-warn border-warn bg-warn'
        : 'ring-text-muted border-text-muted bg-text-muted'
  return (
    <td className="px-3 py-2 text-center">
      <button
        onClick={onClick}
        aria-checked={checked}
        role="radio"
        className={cn(
          'mx-auto block size-5 rounded-full border-2 transition-all',
          checked
            ? `${ring} shadow-[0_0_0_3px_hsl(var(--tw-ring-color)/0.18)]`
            : 'border-line/60 hover:border-text-muted/80'
        )}
      >
        {checked && <span className="block size-1.5 mx-auto rounded-full bg-white" />}
      </button>
    </td>
  )
}

function ContextMenu({
  x,
  y,
  onClose,
  tableName,
  onSyncIncremental,
  onSyncFull,
  onCount,
  syncDisabled
}: {
  x: number
  y: number
  onClose: () => void
  tableName: string
  onSyncIncremental: () => void
  onSyncFull: () => void
  onCount: () => void
  syncDisabled: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Defer attach to avoid catching the contextmenu's own mousedown
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onClick)
    }, 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp position to viewport
  const adjX = Math.min(Math.max(0, x), window.innerWidth - 220)
  const adjY = Math.min(Math.max(0, y), window.innerHeight - 180)

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left: adjX, top: adjY }}
      className="z-[100] w-52 glass rounded-lg border border-line/50 shadow-2xl py-1 text-sm"
    >
      <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-text-muted/70 truncate font-mono">
        {tableName}
      </div>
      <div className="h-px bg-line/30 my-1" />
      <MenuItem
        icon={<Play className="size-3.5 text-accent" />}
        label="Sync Incremental Now"
        onClick={onSyncIncremental}
        disabled={syncDisabled}
      />
      <MenuItem
        icon={<Play className="size-3.5 text-warn" />}
        label="Sync Full Now"
        onClick={onSyncFull}
        disabled={syncDisabled}
      />
      <div className="h-px bg-line/30 my-1" />
      <MenuItem
        icon={<Hash className="size-3.5" />}
        label="Show table count"
        onClick={onCount}
      />
    </div>,
    document.body
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-panel/70 transition-colors text-[12.5px]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  )
}

function SelectBox({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-checked={checked}
      role="checkbox"
      className={cn(
        'block size-4 rounded border-2 transition-all grid place-items-center',
        checked ? 'border-accent bg-accent' : 'border-line/60 hover:border-accent/60'
      )}
    >
      {checked && (
        <svg viewBox="0 0 20 20" className="size-2.5 text-white">
          <path fill="currentColor" d="M7.629 14.571 4.343 11.286 5.757 9.872 7.629 11.743 14.243 5.129 15.657 6.543z" />
        </svg>
      )}
    </button>
  )
}

function SelectAllBox({
  checked,
  indeterminate,
  onClick,
  title
}: {
  checked: boolean
  indeterminate: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      aria-checked={checked}
      role="checkbox"
      title={title}
      className={cn(
        'mx-auto block size-4 rounded border-2 transition-all grid place-items-center',
        checked || indeterminate
          ? 'border-accent bg-accent'
          : 'border-line/60 hover:border-accent/60'
      )}
    >
      {checked ? (
        <svg viewBox="0 0 20 20" className="size-2.5 text-white">
          <path fill="currentColor" d="M7.629 14.571 4.343 11.286 5.757 9.872 7.629 11.743 14.243 5.129 15.657 6.543z" />
        </svg>
      ) : indeterminate ? (
        <span className="block w-2 h-0.5 bg-white" />
      ) : null}
    </button>
  )
}

function CheckboxCell({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <td className="px-3 py-2 text-center">
      <button
        onClick={onClick}
        aria-checked={checked}
        role="checkbox"
        className={cn(
          'mx-auto block size-5 rounded-md border-2 transition-all grid place-items-center',
          checked
            ? 'border-warn bg-warn'
            : 'border-line/60 hover:border-warn/60'
        )}
      >
        {checked && (
          <svg viewBox="0 0 20 20" className="size-3 text-white">
            <path fill="currentColor" d="M7.629 14.571 4.343 11.286 5.757 9.872 7.629 11.743 14.243 5.129 15.657 6.543z" />
          </svg>
        )}
      </button>
    </td>
  )
}

function RunStatusCell({ s }: { s: { status: string; rowsCopied: number; rowsPerSec: number; total?: number; error?: string } }) {
  if (s.status === 'running') {
    const pct = s.total && s.total > 0 ? Math.min(100, Math.round((s.rowsCopied / s.total) * 100)) : null
    const tooltip =
      pct != null
        ? `${s.rowsCopied.toLocaleString()} / ${s.total!.toLocaleString()} rows · ${Math.round(s.rowsPerSec)}/s`
        : `${s.rowsCopied.toLocaleString()} rows · ${Math.round(s.rowsPerSec)}/s`
    return (
      <span title={tooltip} className="inline-flex items-center gap-1 text-accent text-xs font-mono tabular-nums">
        <Loader2 className="size-3 animate-spin" />
        {pct != null ? `${pct}%` : '…'}
      </span>
    )
  }
  if (s.status === 'success') {
    return (
      <span title={`${s.rowsCopied.toLocaleString()} rows`} className="text-success text-xs font-mono tabular-nums">
        {s.rowsCopied.toLocaleString()}
      </span>
    )
  }
  if (s.status === 'failed') {
    return (
      <span title={s.error || 'failed'} className="inline-flex items-center text-danger text-xs">
        <AlertTriangle className="size-3.5" />
      </span>
    )
  }
  if (s.status === 'cancelled')
    return <span title="cancelled" className="text-text-muted text-xs">·</span>
  return <span title={s.status} className="text-text-muted text-xs">·</span>
}
