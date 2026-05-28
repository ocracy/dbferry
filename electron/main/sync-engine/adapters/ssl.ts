import { readFileSync } from 'node:fs'
import type { DbConfig } from '@shared/types'

export interface ResolvedSslOptions {
  ca?: Buffer
  cert?: Buffer
  key?: Buffer
  rejectUnauthorized: boolean
}

function readIfPresent(path: string | undefined, label: string): Buffer | undefined {
  if (!path) return undefined
  try {
    return readFileSync(path)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to read SSL ${label} at "${path}": ${msg}`)
  }
}

export function hasSslConfig(cfg: DbConfig): boolean {
  return Boolean(cfg.ssl)
}

export function resolveSslOptions(cfg: DbConfig): ResolvedSslOptions | null {
  if (!hasSslConfig(cfg)) return null
  return {
    ca: readIfPresent(cfg.sslCaPath, 'CA'),
    cert: readIfPresent(cfg.sslCertPath, 'client certificate'),
    key: readIfPresent(cfg.sslKeyPath, 'client key'),
    rejectUnauthorized: cfg.sslRejectUnauthorized !== false
  }
}

export function buildMysqlSsl(cfg: DbConfig): Record<string, unknown> | undefined {
  const opts = resolveSslOptions(cfg)
  if (!opts) return undefined
  const out: Record<string, unknown> = { rejectUnauthorized: opts.rejectUnauthorized }
  if (opts.ca) out.ca = opts.ca
  if (opts.cert) out.cert = opts.cert
  if (opts.key) out.key = opts.key
  return out
}

export function buildPostgresSsl(cfg: DbConfig): Record<string, unknown> | undefined {
  const opts = resolveSslOptions(cfg)
  if (!opts) return undefined
  const out: Record<string, unknown> = { rejectUnauthorized: opts.rejectUnauthorized }
  if (opts.ca) out.ca = opts.ca
  if (opts.cert) out.cert = opts.cert
  if (opts.key) out.key = opts.key
  return out
}
