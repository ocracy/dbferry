import type { DbConfig } from '@shared/types'

const URL_PREFIX = /^(jdbc:)?(mysql|postgres(ql)?|https?):\/\//i

export function sanitizeDbConfig<T extends DbConfig>(cfg: T): T {
  const out = { ...cfg }

  let host = (cfg.host ?? '').trim()
  // Strip surrounding quotes if user pasted "1.2.3.4"
  if ((host.startsWith('"') && host.endsWith('"')) || (host.startsWith("'") && host.endsWith("'"))) {
    host = host.slice(1, -1).trim()
  }
  // Strip protocol prefixes (mysql://, postgres://, http://, jdbc:mysql://, …)
  host = host.replace(URL_PREFIX, '')
  // Strip credentials prefix (user:pass@host)
  const atIdx = host.lastIndexOf('@')
  if (atIdx !== -1) host = host.slice(atIdx + 1)
  // Strip trailing path / query / fragment
  host = host.replace(/[/?#].*$/, '')

  let port = cfg.port
  // Extract port if host is "1.2.3.4:3307" or "[::1]:5432"
  const ipv6Match = host.match(/^\[([^\]]+)\]:(\d+)$/)
  if (ipv6Match) {
    host = ipv6Match[1]
    const p = Number(ipv6Match[2])
    if (Number.isFinite(p) && p > 0) port = p
  } else {
    const m = host.match(/^([^:\s]+):(\d+)$/)
    if (m) {
      host = m[1]
      const p = Number(m[2])
      if (Number.isFinite(p) && p > 0) port = p
    }
  }

  out.host = host
  out.port = port
  if (cfg.user != null) out.user = String(cfg.user).trim()
  if (cfg.database != null) out.database = String(cfg.database).trim()
  return out
}
