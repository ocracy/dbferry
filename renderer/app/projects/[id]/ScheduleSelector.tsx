import { useEffect, useMemo, useState } from 'react'
import { Calendar, Clock } from 'lucide-react'
import type { Project } from '@shared/types'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { buildCron, formatCountdown, nextRunAt, parseSchedule, type ScheduleMode } from '@/lib/cron'

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
    <div className="glass rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 shrink-0">
        <Calendar className="size-4 text-accent" />
        <span className="text-sm font-medium">Schedule</span>
        <button
          onClick={toggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            enabled ? 'bg-accent' : 'bg-bg-panel border border-line/60'
          }`}
        >
          <span
            className={`inline-block size-4 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className="h-5 w-px bg-line/40 hidden sm:block" />

      <div className="flex items-center gap-1">
        {(['minutes', 'hours', 'daily', 'custom'] as ScheduleMode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m)
              apply({ mode: m })
            }}
            className={`px-2.5 py-1 text-[11.5px] rounded-md border transition-colors ${
              mode === m
                ? 'bg-accent/15 border-accent/40 text-accent'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {m === 'minutes' ? 'Min' : m === 'hours' ? 'Hour' : m === 'daily' ? 'Daily' : 'Custom'}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-sm">
        {mode === 'minutes' && (
          <>
            <span className="text-text-muted text-xs">every</span>
            <Select
              className="h-7 w-16 text-xs"
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
            <span className="text-text-muted text-xs">min</span>
          </>
        )}

        {mode === 'hours' && (
          <>
            <span className="text-text-muted text-xs">every</span>
            <Select
              className="h-7 w-16 text-xs"
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
            <span className="text-text-muted text-xs">hour</span>
          </>
        )}

        {mode === 'daily' && (
          <>
            <span className="text-text-muted text-xs">at</span>
            <Select
              className="h-7 w-14 text-xs"
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
              className="h-7 w-14 text-xs"
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
          </>
        )}

        {mode === 'custom' && (
          <Input
            className="h-7 w-44 text-xs font-mono"
            placeholder="*/15 * * * *"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => custom.trim() && apply({ custom: custom.trim() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) apply({ custom: custom.trim() })
            }}
          />
        )}
      </div>

      {enabled && next && (
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          <Clock className="size-3.5 text-accent" />
          <span className="text-text-muted">next in</span>
          <span className="font-mono text-accent">{formatCountdown(next.getTime() - now)}</span>
          <span className="text-text-muted/70">
            · {next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  )
}
