import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, XCircle, Plug, Loader2, Eye, EyeOff } from 'lucide-react'
import type { ConnectionTestResult, DbConfig, Project } from '@shared/types'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { toast } from 'sonner'
import { SslOptions } from '../SslOptions'

interface Props {
  title: string
  side: 'source' | 'target'
  project: Project
  status: ConnectionTestResult | null
  setStatus: (s: ConnectionTestResult | null) => void
  onChange: (cfg: DbConfig) => void
  hasPassword: boolean
  onPasswordSaved: () => void
}

export function ConnectionPanel({
  title,
  side,
  project,
  status,
  setStatus,
  onChange,
  hasPassword,
  onPasswordSaved
}: Props) {
  const cfg = side === 'source' ? project.source : project.target
  const [draft, setDraft] = useState<DbConfig>(cfg)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const lastSavedRef = useRef('')

  useEffect(() => {
    setDraft(cfg)
  }, [
    cfg.type,
    cfg.host,
    cfg.port,
    cfg.user,
    cfg.database,
    cfg.ssl,
    cfg.sslCaPath,
    cfg.sslCertPath,
    cfg.sslKeyPath,
    cfg.sslRejectUnauthorized
  ])

  const test = async () => {
    setTesting(true)
    try {
      let pwd = password
      if (pwd) {
        await api.projects.setPassword(project.id, side, pwd)
        lastSavedRef.current = pwd
        onPasswordSaved()
      }
      const r = await api.connection.testStored(project.id, side)
      setStatus(r)
    } finally {
      setTesting(false)
    }
  }

  const savePassword = async () => {
    if (!password || password === lastSavedRef.current) return
    await api.projects.setPassword(project.id, side, password)
    lastSavedRef.current = password
    onPasswordSaved()
    toast.success(`${title} password saved`)
  }

  const commit = (next: DbConfig) => {
    setDraft(next)
    onChange(next)
  }

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <span className="text-text-muted text-[11px] uppercase tracking-wider">{title}</span>
          {hasPassword && (
            <span className="text-[10px] text-success/80 normal-case font-normal tracking-normal">
              · password saved
            </span>
          )}
        </h3>
        <Button variant="primary" size="sm" onClick={test} disabled={testing}>
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
          Test Connection
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-2.5">
        <div className="col-span-4">
          <FieldLabel>Driver</FieldLabel>
          <Select
            value={draft.type}
            onChange={(e) => {
              const type = e.target.value as 'mysql' | 'postgres'
              commit({ ...draft, type, port: type === 'mysql' ? 3306 : 5432 })
            }}
          >
            <option value="mysql">MySQL</option>
            <option value="postgres">PostgreSQL</option>
          </Select>
        </div>
        <div className="col-span-6">
          <FieldLabel>Host</FieldLabel>
          <Input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} onBlur={() => commit(draft)} />
        </div>
        <div className="col-span-2">
          <FieldLabel>Port</FieldLabel>
          <Input
            type="number"
            value={draft.port}
            onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) || 0 })}
            onBlur={() => commit(draft)}
          />
        </div>
        <div className="col-span-6">
          <FieldLabel>User</FieldLabel>
          <Input value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} onBlur={() => commit(draft)} />
        </div>
        <div className="col-span-6">
          <FieldLabel>Database</FieldLabel>
          <Input
            value={draft.database}
            onChange={(e) => setDraft({ ...draft, database: e.target.value })}
            onBlur={() => commit(draft)}
          />
        </div>
        <div className="col-span-12">
          <FieldLabel>Password</FieldLabel>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={savePassword}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  ;(e.target as HTMLInputElement).blur()
                  test()
                }
              }}
              placeholder={hasPassword ? '•••••••• (saved — type to replace)' : 'Enter database password'}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <SslOptions cfg={draft} onChange={commit} />
      </div>

      {status && (
        <div
          className={`mt-3 flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
            status.ok ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger'
          }`}
        >
          {status.ok ? <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" /> : <XCircle className="size-3.5 mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <div className="font-medium">
              {status.ok
                ? `Connected${status.tableCount != null ? ` · ${status.tableCount} tables` : ''}`
                : 'Failed'}
            </div>
            <div className="text-[11px] opacity-80 break-all">
              {status.serverVersion ?? status.message}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] text-text-muted uppercase tracking-wider mb-1 block">{children}</span>
}
