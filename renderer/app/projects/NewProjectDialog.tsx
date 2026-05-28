import { useState } from 'react'
import { X, Plug, Loader2, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react'
import type { ConnectionTestResult, DbConfig } from '@shared/types'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { toast } from 'sonner'
import { SslOptions } from './SslOptions'

const defaultMysql: DbConfig = { type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: '' }
const defaultPg: DbConfig = { type: 'postgres', host: '127.0.0.1', port: 5432, user: 'postgres', database: '' }

interface Props {
  onCancel: () => void
  onCreate: (input: {
    name: string
    source: DbConfig
    target: DbConfig
    sourcePassword: string
    targetPassword: string
  }) => void
}

export function NewProjectDialog({ onCancel, onCreate }: Props) {
  const [name, setName] = useState('My sync project')
  const [source, setSource] = useState<DbConfig>(defaultMysql)
  const [target, setTarget] = useState<DbConfig>(defaultPg)
  const [sourcePassword, setSourcePassword] = useState('')
  const [targetPassword, setTargetPassword] = useState('')
  const [sourceStatus, setSourceStatus] = useState<ConnectionTestResult | null>(null)
  const [targetStatus, setTargetStatus] = useState<ConnectionTestResult | null>(null)
  const [sourceDbs, setSourceDbs] = useState<string[]>([])
  const [targetDbs, setTargetDbs] = useState<string[]>([])

  const canSubmit =
    name.trim().length > 0 &&
    source.database.trim().length > 0 &&
    target.database.trim().length > 0

  const submit = () => {
    if (!canSubmit) {
      if (!source.database.trim() || !target.database.trim()) {
        toast.error('Select a database for both source and target')
      }
      return
    }
    onCreate({
      name: name.trim(),
      source,
      target,
      sourcePassword,
      targetPassword
    })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/60 backdrop-blur-sm">
      <div className="glass rounded-2xl w-[760px] max-w-[95vw] shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-4 flex items-center justify-between border-b border-line/40 sticky top-0 bg-bg/80 backdrop-blur-md z-10">
          <h3 className="font-semibold">New project</h3>
          <button onClick={onCancel} className="text-text-muted hover:text-text">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <Field label="Project name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Prod → Staging" />
          </Field>
          <div className="grid grid-cols-2 gap-5">
            <ConnectionSection
              title="Source"
              cfg={source}
              onChange={setSource}
              password={sourcePassword}
              onPasswordChange={setSourcePassword}
              status={sourceStatus}
              onStatusChange={setSourceStatus}
              databases={sourceDbs}
              onDatabasesChange={setSourceDbs}
            />
            <ConnectionSection
              title="Target"
              cfg={target}
              onChange={setTarget}
              password={targetPassword}
              onPasswordChange={setTargetPassword}
              status={targetStatus}
              onStatusChange={setTargetStatus}
              databases={targetDbs}
              onDatabasesChange={setTargetDbs}
            />
          </div>
        </div>
        <div className="px-6 py-4 flex justify-end gap-2 border-t border-line/40 sticky bottom-0 bg-bg/80 backdrop-blur-md">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            Create project
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </span>
      {children}
    </label>
  )
}

function ConnectionSection({
  title,
  cfg,
  onChange,
  password,
  onPasswordChange,
  status,
  onStatusChange,
  databases,
  onDatabasesChange
}: {
  title: string
  cfg: DbConfig
  onChange: (c: DbConfig) => void
  password: string
  onPasswordChange: (p: string) => void
  status: ConnectionTestResult | null
  onStatusChange: (s: ConnectionTestResult | null) => void
  databases: string[]
  onDatabasesChange: (dbs: string[]) => void
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)

  const test = async () => {
    setTesting(true)
    try {
      const dbs = await api.connection.listDatabases(cfg, password)
      onDatabasesChange(dbs)
      const r = await api.connection.test(cfg, password)
      onStatusChange(r)
      if (r.ok && !cfg.database && dbs.length > 0) {
        onChange({ ...cfg, database: dbs[0] })
      }
    } catch (err) {
      onStatusChange({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line/40 p-4 bg-bg-subtle/40">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{title}</div>
        <Button variant="primary" size="sm" onClick={test} disabled={testing}>
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
          Test Connection
        </Button>
      </div>
      <Field label="Driver">
        <Select
          value={cfg.type}
          onChange={(e) => {
            const type = e.target.value as 'mysql' | 'postgres'
            onChange({ ...cfg, type, port: type === 'mysql' ? 3306 : 5432, database: '' })
            onDatabasesChange([])
            onStatusChange(null)
          }}
        >
          <option value="mysql">MySQL</option>
          <option value="postgres">PostgreSQL</option>
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <Field label="Host">
            <Input value={cfg.host} onChange={(e) => onChange({ ...cfg, host: e.target.value })} />
          </Field>
        </div>
        <Field label="Port">
          <Input
            type="number"
            value={cfg.port}
            onChange={(e) => onChange({ ...cfg, port: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
      <Field label="User">
        <Input value={cfg.user} onChange={(e) => onChange({ ...cfg, user: e.target.value })} />
      </Field>
      <Field label="Password">
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') test()
            }}
            placeholder="Database password"
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
      </Field>
      <Field label="Database" required>
        {databases.length > 0 ? (
          <Select
            value={cfg.database}
            onChange={(e) => onChange({ ...cfg, database: e.target.value })}
          >
            <option value="">— select a database —</option>
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={cfg.database}
            onChange={(e) => onChange({ ...cfg, database: e.target.value })}
            placeholder="Test connection to list databases"
          />
        )}
      </Field>

      <SslOptions cfg={cfg} onChange={onChange} />

      {status && (
        <div
          className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
            status.ok ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger'
          }`}
        >
          {status.ok ? <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" /> : <XCircle className="size-3.5 mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <div className="font-medium">
              {status.ok
                ? `Connected${databases.length > 0 ? ` · ${databases.length} databases` : ''}`
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
