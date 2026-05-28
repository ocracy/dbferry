import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, Search, Loader2, AlertTriangle, Hash, X, Zap, Play } from 'lucide-react'
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

export function TablesGrid({ project, onTablesChanged, disabled }: Props) {
  const [loading, setLoading] = useState(false)
  const [countingAll, setCountingAll] = useState(false)
  const [countingOne, setCountingOne] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [rowCounts, setRowCounts] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ table: TableConfig; x: number; y: number } | null>(null)
  const active = useSync((s) => s.active)
  const tables = project.tables

  const fetchTables = async () => {
    setLoading(true)
    try {
      const meta = await api.connection.listTablesMeta(project.id, 'source')
      const list = meta.map((m) => m.name)
      const merged: TableConfig[] = meta.map((m) => {
        const existing = tables.find((t) => t.name === m.name)
        if (!existing) {
          return { name: m.name, mode: 'disabled', pkColumn: m.pkColumn ?? 'id' }
        }
        if (existing.pkColumn === 'id' && m.pkColumn && m.pkColumn !== 'id') {
          return { ...existing, pkColumn: m.pkColumn }
        }
        return existing
      })
      const removed = tables.filter((t) => !list.includes(t.name))
      const final = [...merged, ...removed.filter((r) => r.mode !== 'disabled')]
      await api.projects.replaceTables(project.id, final)
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
    if (!filter) return tables
    const q = filter.toLowerCase()
    return tables.filter((t) => t.name.toLowerCase().includes(q))
  }, [tables, filter])

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
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">Tables</h3>
          <Badge tone="accent">{counts.incremental} incremental</Badge>
          <Badge tone="warn">{counts.full} full</Badge>
          <Badge tone="neutral">{counts.disabled} disabled</Badge>
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
            {filterActive ? `${filtered.length}/${tables.length}` : `${tables.length} total`}
          </span>
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
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ table: t, x: e.clientX, y: e.clientY })
                  }}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-text-muted text-sm">
                    No tables match "{filter}"
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
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <tr className={cn('border-b border-line/20 hover:bg-bg-panel/50 group', selected && 'bg-accent/5')}>
      <td className="pl-5 pr-2 py-2 text-center">
        <SelectBox checked={selected} onClick={onToggleSelected} />
      </td>
      <td
        onContextMenu={onContextMenu}
        className="px-3 py-2 font-mono text-[12.5px] truncate max-w-[280px] cursor-context-menu"
      >
        {table.name}
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
