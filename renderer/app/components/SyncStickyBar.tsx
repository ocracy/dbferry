import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, X, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useSync } from '@/stores/sync'
import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { formatNumber, formatDuration } from '@/lib/format'
import { useEffect, useState } from 'react'

export function SyncStickyBar() {
  const active = useSync((s) => s.active)
  const reset = useSync((s) => s.reset)
  const [, setTick] = useState(0)

  const isRunning = active?.status === 'running'

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setTick((t) => t + 1), 500)
    return () => clearInterval(id)
  }, [isRunning])

  useEffect(() => {
    if (!active || active.status === 'running') return
    const id = setTimeout(() => reset(), 2000)
    return () => clearTimeout(id)
  }, [active?.status, active?.runId, reset])

  if (!active) return null

  const pct = active.totalTables > 0 ? (active.finishedTables / active.totalTables) * 100 : 0

  const totalRows = Object.values(active.tables).reduce((s, t) => s + t.rowsCopied, 0)
  const elapsed = (active.finishedAt ?? Date.now()) - active.startedAt
  const etaMs =
    active.status === 'running' && active.finishedTables > 0
      ? Math.round((elapsed / active.finishedTables) * (active.totalTables - active.finishedTables))
      : null

  return (
    <AnimatePresence>
      <motion.div
        key="sync-bar"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="absolute bottom-4 left-4 right-4 z-40"
      >
        <div className="glass rounded-2xl shadow-2xl px-5 py-3.5 flex items-center gap-4">
          <div className="size-9 rounded-xl bg-accent/15 grid place-items-center">
            {active.status === 'running' ? (
              <Loader2 className="size-4 text-accent animate-spin" />
            ) : active.status === 'success' ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : (
              <AlertTriangle className="size-4 text-warn" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[13px] font-medium truncate">
                {active.status === 'running' ? (
                  active.runningTables.length > 1 ? (
                    <>
                      Syncing{' '}
                      <span className="text-accent">{active.runningTables.length} tables</span>{' '}
                      <span className="text-text-muted">
                        · {active.finishedTables}/{active.totalTables} done
                      </span>
                      {active.currentTableName && (
                        <span className="text-text-muted">
                          {' · '}
                          <span className="font-mono text-text">{active.currentTableName}</span>
                          {(() => {
                            const t = active.tables[active.currentTableName]
                            if (t?.total != null && t.total > 0) {
                              const pct = Math.min(100, Math.round((t.rowsCopied / t.total) * 100))
                              return <span> ({pct}%)</span>
                            }
                            return null
                          })()}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      Syncing{' '}
                      <span className="font-mono text-accent">
                        {active.currentTableName ?? active.runningTables[0] ?? '…'}
                      </span>{' '}
                      <span className="text-text-muted">
                        ({active.finishedTables + 1}/{active.totalTables})
                      </span>
                      {(() => {
                        const name = active.currentTableName ?? active.runningTables[0]
                        const t = name ? active.tables[name] : undefined
                        if (t?.total != null && t.total > 0) {
                          const pct = Math.min(100, Math.round((t.rowsCopied / t.total) * 100))
                          return (
                            <span className="text-text-muted">
                              {' · '}
                              {t.rowsCopied.toLocaleString()}/{t.total.toLocaleString()} ({pct}%)
                            </span>
                          )
                        }
                        return null
                      })()}
                    </>
                  )
                ) : (
                  <>
                    Sync {active.status} ·{' '}
                    <span className="text-text-muted">
                      {active.finishedTables}/{active.totalTables} tables
                    </span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-text-muted font-mono ml-3 shrink-0">
                {formatNumber(totalRows)} rows · {formatDuration(elapsed)}
                {etaMs != null && etaMs > 0 && (
                  <>
                    {' · '}
                    <span className="text-accent">~{formatDuration(etaMs)} left</span>
                  </>
                )}
              </div>
            </div>
            <div className="h-1 bg-bg-panel rounded-full overflow-hidden">
              <motion.div
                className={
                  active.status === 'running'
                    ? 'h-full shimmer-bar animate-shimmer'
                    : active.status === 'success'
                      ? 'h-full bg-success'
                      : 'h-full bg-warn'
                }
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(pct, active.status === 'running' ? 4 : 100)}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>
          </div>

          {active.status === 'running' ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => api.sync.cancel(active.projectId)}
            >
              <X className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={reset}>
              Dismiss
            </Button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
