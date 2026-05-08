function parseField(field: string, min: number, max: number): Set<number> | null {
  if (field === '*') return null
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.*)\/(\d+)$/)
    const step = stepMatch ? Number(stepMatch[2]) : 1
    const range = stepMatch ? stepMatch[1] || '*' : part
    let lo = min
    let hi = max
    if (range !== '*') {
      const dash = range.split('-')
      if (dash.length === 2) {
        lo = Number(dash[0])
        hi = Number(dash[1])
      } else {
        lo = Number(range)
        hi = lo
      }
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) return new Set()
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

export function nextRunAt(cron: string, from: Date = new Date()): Date | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minF, hourF, domF, monF, dowF] = parts
  const mins = parseField(minF, 0, 59)
  const hours = parseField(hourF, 0, 23)
  const doms = parseField(domF, 1, 31)
  const mons = parseField(monF, 1, 12)
  const dows = parseField(dowF, 0, 6)

  const d = new Date(from.getTime() + 60_000)
  d.setSeconds(0, 0)
  const limit = 366 * 24 * 60
  for (let i = 0; i < limit; i++) {
    if (
      (mins === null || mins.has(d.getMinutes())) &&
      (hours === null || hours.has(d.getHours())) &&
      (doms === null || doms.has(d.getDate())) &&
      (mons === null || mons.has(d.getMonth() + 1)) &&
      (dows === null || dows.has(d.getDay()))
    ) {
      return new Date(d)
    }
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const s = Math.floor(ms / 1000)
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export type ScheduleMode = 'minutes' | 'hours' | 'daily' | 'custom'

export function parseSchedule(cron: string | null): {
  mode: ScheduleMode
  every?: number
  hour?: number
  minute?: number
} {
  if (!cron) return { mode: 'minutes', every: 10 }
  const m1 = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/)
  if (m1) return { mode: 'minutes', every: Number(m1[1]) }
  const m2 = cron.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/)
  if (m2) return { mode: 'hours', every: Number(m2[1]) }
  const m3 = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/)
  if (m3) return { mode: 'daily', minute: Number(m3[1]), hour: Number(m3[2]) }
  return { mode: 'custom' }
}

export function buildCron(mode: ScheduleMode, opts: { every?: number; hour?: number; minute?: number; custom?: string }): string {
  if (mode === 'minutes') {
    const n = Math.max(1, Math.min(59, opts.every ?? 10))
    return n === 1 ? '* * * * *' : `*/${n} * * * *`
  }
  if (mode === 'hours') {
    const n = Math.max(1, Math.min(23, opts.every ?? 1))
    return n === 1 ? '0 * * * *' : `0 */${n} * * *`
  }
  if (mode === 'daily') {
    const h = Math.max(0, Math.min(23, opts.hour ?? 9))
    const m = Math.max(0, Math.min(59, opts.minute ?? 0))
    return `${m} ${h} * * *`
  }
  return opts.custom?.trim() || '* * * * *'
}
