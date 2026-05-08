import { useEffect, useMemo, useState } from 'react'
import { Calendar, Clock, Power } from 'lucide-react'
import type { Project } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { buildCron, formatCountdown, nextRunAt, parseSchedule, type ScheduleMode } from '@/lib/cron'
import cronstrue from 'cronstrue'

export function ScheduleSelector({
  project,
  onChanged
}: {
  project: Project
  onChanged: (patch: Partial<Project>) => void
}) {
  const initial = useMemo(() => parseSchedule(project.scheduleCron), [project.scheduleCron])
  const [mode, setMode] = useState<ScheduleMode>(initial.mode)
  const [every, setEvery] = useState<number>(initial.every ?? (initial.mode === 'hours' ? 1 : 10))
  const [hour, setHour] = useState<number>(initial.hour ?? 9)
  const [minute, setMinute] = useState<number>(initial.minute ?? 0)
  const [custom, setCustom] = useState<string>(
    initial.mode === 'custom' && project.scheduleCron ? project.scheduleCron : ''
  )
  const enabled = project.scheduleEnabled

  const cron = useMemo(
    () => buildCron(mode, { every, hour, minute, custom }),
    [mode, every, hour, minute, custom]
  )

  useEffect(() => {
    setMode(initial.mode)
    if (initial.every != null) setEvery(initial.every)
    if (initial.hour != null) setHour(initial.hour)
    if (initial.minute != null) setMinute(initial.minute)
  }, [project.scheduleCron])

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [enabled])

  const next = useMemo(() => {
    if (!enabled || !project.scheduleCron) return null
    return nextRunAt(project.scheduleCron, new Date(now))
  }, [enabled, project.scheduleCron, now])

  const humanized = useMemo(() => {
    try {
      return cronstrue.toString(cron, { use24HourTimeFormat: true })
    } catch {
      return ''
    }
  }, [cron])

  const apply = (patch?: { mode?: ScheduleMode; every?: number; hour?: number; minute?: number; custom?: string; enabled?: boolean }) => {
    const nextMode = patch?.mode ?? mode
    const nextEvery = patch?.every ?? every
    const nextHour = patch?.hour ?? hour
    const nextMinute = patch?.minute ?? minute
    const nextCustom = patch?.custom ?? custom
    const nextEnabled = patch?.enabled ?? enabled
    const nextCron = buildCron(nextMode, {
      every: nextEvery,
      hour: nextHour,
      minute: nextMinute,
      custom: nextCustom
    })
    onChanged({ scheduleCron: nextCron, scheduleEnabled: nextEnabled })
  }

  const toggle = () => apply({ enabled: !enabled })

  const minuteOptions = [1, 2, 5, 10, 15, 20, 30, 45]
  const hourOptions = [1, 2, 3, 4, 6, 8, 12, 24]

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Calendar className="size-4 text-accent" />
          Schedule
        </h3>
        <button
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-accent' : 'bg-bg-panel border border-line/60'
          }`}
        >
          <span
            className={`inline-block size-5 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {enabled && next && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 flex items-center gap-3">
          <Clock className="size-4 text-accent shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-text-muted uppercase tracking-wider">Next run</div>
            <div className="font-mono text-sm">
              <span className="text-accent">{formatCountdown(next.getTime() - now)}</span>
              <span className="text-text-muted ml-2">
                · {next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-1.5 mb-4">
        {(['minutes', 'hours', 'daily', 'custom'] as ScheduleMode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m)
              apply({ mode: m })
            }}
            className={`px-3 py-1.5 text-[12px] rounded-lg border transition-colors ${
              mode === m
                ? 'bg-accent/15 border-accent/40 text-accent'
                : 'border-line/40 text-text-muted hover:text-text hover:border-line'
            }`}
          >
            {m === 'minutes' ? 'Minutes' : m === 'hours' ? 'Hours' : m === 'daily' ? 'Daily' : 'Custom'}
          </button>
        ))}
      </div>

      {mode === 'minutes' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Every</span>
          <Select
            className="w-24"
            value={every}
            onChange={(e) => {
              const v = Number(e.target.value)
              setEvery(v)
              apply({ every: v })
            }}
          >
            {minuteOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <span className="text-sm text-text-muted">minute{every === 1 ? '' : 's'}</span>
        </div>
      )}

      {mode === 'hours' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Every</span>
          <Select
            className="w-24"
            value={every}
            onChange={(e) => {
              const v = Number(e.target.value)
              setEvery(v)
              apply({ every: v })
            }}
          >
            {hourOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <span className="text-sm text-text-muted">hour{every === 1 ? '' : 's'}</span>
        </div>
      )}

      {mode === 'daily' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">At</span>
          <Select
            className="w-20"
            value={hour}
            onChange={(e) => {
              const v = Number(e.target.value)
              setHour(v)
              apply({ hour: v })
            }}
          >
            {Array.from({ length: 24 }, (_, i) => i).map((n) => (
              <option key={n} value={n}>
                {String(n).padStart(2, '0')}
              </option>
            ))}
          </Select>
          <span className="text-text-muted">:</span>
          <Select
            className="w-20"
            value={minute}
            onChange={(e) => {
              const v = Number(e.target.value)
              setMinute(v)
              apply({ minute: v })
            }}
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((n) => (
              <option key={n} value={n}>
                {String(n).padStart(2, '0')}
              </option>
            ))}
          </Select>
        </div>
      )}

      {mode === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            className="font-mono"
            placeholder="*/15 * * * *"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button
            variant="subtle"
            size="md"
            onClick={() => custom.trim() && apply({ custom: custom.trim() })}
          >
            Apply
          </Button>
        </div>
      )}

      {humanized && (
        <p className="text-[11px] text-text-muted mt-3 italic">{humanized}</p>
      )}
    </div>
  )
}
