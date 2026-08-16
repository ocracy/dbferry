import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, RefreshCw, Check, X, Loader2, FolderOpen, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { UpdateCheckResult, UpdateLogEvent, UpdateProgressEvent } from '@shared/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

type Status = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'

export function UpdateButton() {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const runCheck = useCallback(async (silent: boolean) => {
    setStatus('checking')
    try {
      const r = await api.update.check()
      setResult(r)
      if (r.error) {
        setStatus('error')
        if (!silent) toast.error(`Update check failed: ${r.error}`)
        return
      }
      if (r.hasUpdate) {
        setStatus('available')
        if (!silent) toast.success(`Update available: v${r.latestVersion}`)
      } else {
        setStatus('up-to-date')
        if (!silent) toast.success(`You're up to date (v${r.currentVersion})`)
      }
    } catch (err) {
      setStatus('error')
      if (!silent) toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    runCheck(true)
  }, [runCheck])

  if (status === 'available' && result?.latestVersion) {
    return (
      <>
        <button
          onClick={() => setDialogOpen(true)}
          title={`Update to v${result.latestVersion}`}
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium',
            'bg-accent hover:bg-accent-hover text-white',
            'shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_6px_18px_-10px_rgba(120,80,255,0.7)]',
            'transition-colors'
          )}
        >
          <Download className="size-3.5" />
          Update v{result.latestVersion}
        </button>
        {dialogOpen && <UpdateDialog result={result} onClose={() => setDialogOpen(false)} />}
      </>
    )
  }

  const label =
    status === 'checking'
      ? 'Checking for updates…'
      : status === 'up-to-date'
        ? `Up to date · v${result?.currentVersion ?? ''}`
        : status === 'error'
          ? `Update check failed${result?.error ? ` · ${result.error}` : ''}`
          : 'Check for updates'

  const Icon = status === 'up-to-date' ? Check : RefreshCw

  return (
    <button
      onClick={() => runCheck(false)}
      disabled={status === 'checking'}
      title={label}
      className={cn(
        'inline-flex items-center justify-center size-7 rounded-md text-text-muted',
        'hover:text-text hover:bg-bg-panel/60 transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none'
      )}
    >
      <Icon className={cn('size-3.5', status === 'checking' && 'animate-spin')} />
    </button>
  )
}

type Phase = 'idle' | 'running' | 'done' | 'error'

function UpdateDialog({ result, onClose }: { result: UpdateCheckResult; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [logs, setLogs] = useState<UpdateLogEvent[]>([])
  const [progress, setProgress] = useState<UpdateProgressEvent | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [finish, setFinish] = useState<{ mode?: string; quitting?: boolean } | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the log console to the newest line.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [logs])

  const start = useCallback(async () => {
    setPhase('running')
    setLogs([])
    setProgress(null)
    setFilePath(null)
    setFinish(null)
    const offLog = api.update.onLog((e) => setLogs((prev) => [...prev, e]))
    const offProgress = api.update.onProgress((e) => setProgress(e))
    try {
      const r = await api.update.download()
      if (r.ok) {
        setFilePath(r.filePath)
        setFinish({ mode: r.mode, quitting: r.quitting })
        setPhase('done')
      } else {
        setPhase('error')
      }
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        { level: 'error', message: err instanceof Error ? err.message : String(err), ts: Date.now() }
      ])
      setPhase('error')
    } finally {
      offLog()
      offProgress()
    }
  }, [])

  const running = phase === 'running'

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/50 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose()
      }}
    >
      <div className="glass w-full max-w-2xl rounded-xl border border-line/50 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-line/40">
          <Download className="size-4 text-accent" />
          <h3 className="font-semibold text-sm">
            Update to v{result.latestVersion}
            <span className="text-text-muted font-normal"> · from v{result.currentVersion}</span>
          </h3>
          <button
            onClick={onClose}
            disabled={running}
            title={running ? 'Update in progress…' : 'Close'}
            className="ml-auto text-text-muted hover:text-text disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3 min-h-0">
          {phase === 'idle' && (
            <p className="text-[12.5px] text-text-muted">
              This downloads {result.releaseName ? `“${result.releaseName}”` : 'the latest release'} for your
              platform, installs it over the running app and restarts. Live logs appear below so you
              can see any errors.
            </p>
          )}

          {phase === 'done' && finish?.quitting && (
            <p
              className={cn(
                'text-[12.5px] rounded-lg border px-3 py-2',
                finish.mode === 'self-update'
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-warn/40 bg-warn/10 text-warn'
              )}
            >
              {finish.mode === 'self-update'
                ? 'Installing and restarting dbferry — this window closes on its own.'
                : 'Quitting so the app is not running while you drop it into Applications.'}
            </p>
          )}

          {progress && running && (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 rounded-full bg-bg-panel overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width] duration-150"
                  style={{ width: `${progress.percent ?? 0}%` }}
                />
              </div>
              <div className="text-[10.5px] text-text-muted tabular-nums">
                {progress.percent != null ? `${progress.percent}%` : 'downloading…'}
                {progress.total
                  ? ` · ${fmtMB(progress.received)} / ${fmtMB(progress.total)}`
                  : ` · ${fmtMB(progress.received)}`}
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div className="rounded-lg border border-line/50 bg-black/40 font-mono text-[11px] leading-relaxed p-3 overflow-auto max-h-72">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    'whitespace-pre-wrap break-words',
                    l.level === 'error'
                      ? 'text-danger'
                      : l.level === 'warn'
                        ? 'text-warn'
                        : 'text-text-muted'
                  )}
                >
                  <span className="text-text-muted/40">{fmtTime(l.ts)} </span>
                  {l.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-line/40">
          {phase === 'done' && filePath && (
            <button
              onClick={() => api.projects.revealInFinder(filePath)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] border border-line/60 hover:bg-bg-panel/60 transition-colors"
            >
              <FolderOpen className="size-3.5" />
              Reveal file
            </button>
          )}
          {result.releaseUrl && (
            <button
              onClick={() => api.update.open(result.releaseUrl!)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] text-text-muted hover:text-text transition-colors"
            >
              <ExternalLink className="size-3.5" />
              Release page
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {phase !== 'running' && (
              <button
                onClick={onClose}
                className="h-8 px-3 rounded-md text-[12px] text-text-muted hover:text-text transition-colors"
              >
                {phase === 'done' ? 'Close' : 'Cancel'}
              </button>
            )}
            {(phase === 'idle' || phase === 'error') && (
              <button
                onClick={start}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md text-[12px] font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
              >
                <Download className="size-3.5" />
                {phase === 'error' ? 'Retry' : 'Download & install'}
              </button>
            )}
            {phase === 'running' && (
              <span className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] text-accent">
                <Loader2 className="size-3.5 animate-spin" />
                Working…
              </span>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function fmtMB(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour12: false })
}
