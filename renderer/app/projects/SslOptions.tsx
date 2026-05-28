import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, Lock, X } from 'lucide-react'
import type { DbConfig } from '@shared/types'
import { api } from '@/lib/api'
import { Input } from '@/components/ui/Input'

interface Props {
  cfg: DbConfig
  onChange: (c: DbConfig) => void
  defaultOpen?: boolean
}

export function SslOptions({ cfg, onChange, defaultOpen }: Props) {
  const sslActive = Boolean(
    cfg.ssl || cfg.sslCaPath || cfg.sslCertPath || cfg.sslKeyPath
  )
  const [open, setOpen] = useState(defaultOpen ?? sslActive)

  const pick = async (
    field: 'sslCaPath' | 'sslCertPath' | 'sslKeyPath',
    title: string
  ) => {
    const path = await api.connection.pickCertFile(title)
    if (path) onChange({ ...cfg, [field]: path, ssl: true })
  }

  return (
    <div className="rounded-lg border border-line/40 bg-bg-subtle/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wider text-text-muted hover:text-text"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Lock className="size-3" />
          SSL / TLS
          {sslActive && (
            <span className="text-[10px] text-success/80 normal-case tracking-normal ml-1">
              · enabled
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={Boolean(cfg.ssl)}
              onChange={(e) => onChange({ ...cfg, ssl: e.target.checked })}
              className="size-3.5 accent-accent"
            />
            <span>Use SSL</span>
          </label>
          <CertPathField
            label="CA certificate"
            value={cfg.sslCaPath ?? ''}
            placeholder="/path/to/ca.pem"
            onCommit={(v) => onChange({ ...cfg, sslCaPath: v || undefined })}
            onPick={() => pick('sslCaPath', 'Select CA certificate')}
          />
          <CertPathField
            label="Client certificate"
            value={cfg.sslCertPath ?? ''}
            placeholder="/path/to/client-cert.pem"
            onCommit={(v) => onChange({ ...cfg, sslCertPath: v || undefined })}
            onPick={() => pick('sslCertPath', 'Select client certificate')}
          />
          <CertPathField
            label="Client key"
            value={cfg.sslKeyPath ?? ''}
            placeholder="/path/to/client-key.pem"
            onCommit={(v) => onChange({ ...cfg, sslKeyPath: v || undefined })}
            onPick={() => pick('sslKeyPath', 'Select client key')}
          />
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={cfg.sslRejectUnauthorized !== false}
              onChange={(e) =>
                onChange({ ...cfg, sslRejectUnauthorized: e.target.checked })
              }
              className="size-3.5 accent-accent"
            />
            <span>Verify server certificate</span>
          </label>
        </div>
      )}
    </div>
  )
}

function CertPathField({
  label,
  value,
  placeholder,
  onCommit,
  onPick
}: {
  label: string
  value: string
  placeholder: string
  onCommit: (v: string) => void
  onPick: () => void
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])

  const clear = () => {
    setLocal('')
    onCommit('')
  }

  return (
    <div>
      <div className="text-[10.5px] text-text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Input
            value={local}
            placeholder={placeholder}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={() => {
              if (local !== value) onCommit(local)
            }}
            className={local ? 'pr-8' : undefined}
          />
          {local && (
            <button
              type="button"
              onClick={clear}
              title="Clear"
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onPick}
          title="Browse..."
          className="shrink-0 h-9 px-2.5 rounded-lg border border-line/70 bg-bg-subtle text-text-muted hover:text-text hover:border-accent/40"
        >
          <FolderOpen className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
