import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, Check } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

type CheckResult = Awaited<ReturnType<typeof api.update.check>>

type Status = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'

export function UpdateButton() {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<CheckResult | null>(null)

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

  const openRelease = async () => {
    if (!result?.releaseUrl) return
    await api.update.open(result.releaseUrl)
  }

  if (status === 'available' && result?.latestVersion) {
    return (
      <button
        onClick={openRelease}
        title={`Open release v${result.latestVersion}`}
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
