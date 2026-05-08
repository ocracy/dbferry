import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, Loader2, AlertTriangle, Info } from 'lucide-react'
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
  const [sourceTables, setSourceTables] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const active = useSync((s) => s.active)
  const tables = project.tables

  const fetchTables = async () => {
    setLoading(true)
    try {
      const meta = await api.connection.listTablesMeta(project.id, 'source')
      const list = meta.map((m) => m.name)
      setSourceTables(list)
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
          `${noPk.length} table(s) have no primary key — incremental mode will fail. Use "full" or set PK manually: ${noPk.slice(0, 5).join(', ')}${noPk.length > 5 ? '…' : ''}`
        )
      }
      onTablesChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const setMode = async (table: TableConfig, mode: SyncMode) => {
    if (disabled) return
    await api.projects.upsertTable(project.id, { ...table, mode })
    onTablesChanged()
  }

  const setPk = async (table: TableConfig, pk: string) => {
    if (disabled) return
    await api.projects.upsertTable(project.id, { ...table, pkColumn: pk || 'id' })
    onTablesChanged()
  }

  const setAllMode = async (mode: SyncMode) => {
    if (disabled) return
    const next = tables.map((t) => ({ ...t, mode }))
    await api.projects.replaceTables(project.id, next)
    onTablesChanged()
  }

  const filtered = useMemo(() => {
    if (!filter) return tables
    return tables.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
  }, [tables, filter])

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

  return (
    <div className="glass rounded-xl">
      <div className="px-5 py-4 flex items-center justify-between border-b border-line/40">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">Tables</h3>
          <Badge tone="accent">{counts.incremental} incremental</Badge>
          <Badge tone="warn">{counts.full} full</Badge>
          <Badge tone="neutral">{counts.disabled} disabled</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              className="h-8 pl-8 w-48"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchTables} disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {tables.length === 0 ? 'Load tables' : 'Refresh'}
          </Button>
        </div>
      </div>

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
        <div className="overflow-auto max-h-[520px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-panel/95 backdrop-blur z-10 border-b border-line/40">
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-text-muted">
                <th className="px-5 py-2.5 font-medium">Table</th>
                <th className="px-3 py-2.5 font-medium text-center">
                  <button onClick={() => setAllMode('disabled')} className="hover:text-text">
                    Disabled
                  </button>
                </th>
                <th className="px-3 py-2.5 font-medium text-center">
                  <button onClick={() => setAllMode('incremental')} className="hover:text-accent">
                    Incremental
                  </button>
                </th>
                <th className="px-3 py-2.5 font-medium text-center">
                  <button onClick={() => setAllMode('full')} className="hover:text-warn">
                    Full
                  </button>
                </th>
                <th className="px-3 py-2.5 font-medium">PK</th>
                <th className="px-5 py-2.5 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <TableRow
                  key={t.name}
                  table={t}
                  setMode={(m) => setMode(t, m)}
                  setPk={(pk) => setPk(t, pk)}
                  runStatus={active?.tables[t.name]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TableRow({
  table,
  setMode,
  setPk,
  runStatus
}: {
  table: TableConfig
  setMode: (m: SyncMode) => void
  setPk: (pk: string) => void
  runStatus?: { status: string; rowsCopied: number; rowsPerSec: number; error?: string }
}) {
  return (
    <tr className="border-b border-line/20 hover:bg-bg-panel/50">
      <td className="px-5 py-2 font-mono text-[12.5px] truncate max-w-[280px]">{table.name}</td>
      <RadioCell checked={table.mode === 'disabled'} onClick={() => setMode('disabled')} tone="neutral" />
      <RadioCell checked={table.mode === 'incremental'} onClick={() => setMode('incremental')} tone="accent" />
      <RadioCell checked={table.mode === 'full'} onClick={() => setMode('full')} tone="warn" />
      <td className="px-3 py-1.5">
        <input
          className="h-7 w-20 rounded-md border border-line/50 bg-bg-subtle px-2 text-xs font-mono focus:outline-none focus:border-accent/60"
          defaultValue={table.pkColumn}
          onBlur={(e) => {
            if (e.target.value !== table.pkColumn) setPk(e.target.value)
          }}
        />
      </td>
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

function RunStatusCell({ s }: { s: { status: string; rowsCopied: number; rowsPerSec: number; error?: string } }) {
  if (s.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-accent text-xs">
        <Loader2 className="size-3 animate-spin" />
        {s.rowsCopied.toLocaleString()} rows · {Math.round(s.rowsPerSec)}/s
      </span>
    )
  }
  if (s.status === 'success') {
    return <Badge tone="success">{s.rowsCopied.toLocaleString()}</Badge>
  }
  if (s.status === 'failed') {
    return (
      <span title={s.error} className="inline-flex items-center gap-1 text-danger text-xs">
        <AlertTriangle className="size-3" />
        failed
      </span>
    )
  }
  if (s.status === 'cancelled') return <Badge tone="neutral">cancelled</Badge>
  return <Badge tone="neutral">{s.status}</Badge>
}
