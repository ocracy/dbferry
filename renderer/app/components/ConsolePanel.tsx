import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { Terminal, Trash2, X, ChevronRight } from 'lucide-react'
import { useSync } from '@/stores/sync'
import { cn } from '@/lib/cn'

export function ConsoleSidebarRow() {
  const open = useConsoleOpen((s) => s.open)
  const setOpen = useConsoleOpen((s) => s.setOpen)
  const liveLogs = useSync((s) => s.liveLogs)
  const errorCount = liveLogs.filter((l) => l.level === 'error').length
  const warnCount = liveLogs.filter((l) => l.level === 'warn').length

  return (
    <button
      onClick={() => setOpen(!open)}
      className={cn(
        'w-full flex items-center justify-between px-4 h-7 text-[11px]',
        'border-t border-line/40 transition-colors',
        open
          ? 'bg-bg-panel/60 text-accent'
          : errorCount > 0
            ? 'text-danger hover:bg-bg-panel/40'
            : 'text-text-muted hover:bg-bg-panel/40 hover:text-text'
      )}
    >
      <span className="flex items-center gap-1.5">
        <Terminal className="size-3" />
        <span>Console</span>
        {liveLogs.length > 0 && (
          <span className="font-mono opacity-80">
            {liveLogs.length}
            {errorCount > 0 && <span className="text-danger ml-1">·{errorCount}e</span>}
            {warnCount > 0 && <span className="text-warn ml-1">·{warnCount}w</span>}
          </span>
        )}
      </span>
      <ChevronRight
        className={cn('size-3 opacity-50 transition-transform', open && 'rotate-90')}
      />
    </button>
  )
}

interface ConsoleOpenState {
  open: boolean
  setOpen: (v: boolean) => void
}

export const useConsoleOpen = create<ConsoleOpenState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v })
}))

export function ConsolePanel() {
  const open = useConsoleOpen((s) => s.open)
  const setOpen = useConsoleOpen((s) => s.setOpen)
  const liveLogs = useSync((s) => s.liveLogs)
  const clearLogs = useSync((s) => s.clearLogs)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [liveLogs.length, open])

  const errorCount = liveLogs.filter((l) => l.level === 'error').length
  const warnCount = liveLogs.filter((l) => l.level === 'warn').length

  return (
    <>
      {open && (
        <div
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            'fixed top-12 right-4 z-30 w-[640px] max-w-[calc(100vw-32px)] h-[320px]',
            'glass rounded-xl border border-line/40 shadow-2xl flex flex-col'
          )}
        >
          <div className="px-3 py-1.5 flex items-center justify-between border-b border-line/40">
            <div className="flex items-center gap-2">
              <Terminal className="size-3.5 text-accent" />
              <span className="text-xs font-medium">Console</span>
              <span className="text-[10px] text-text-muted">{liveLogs.length} lines</span>
              {errorCount > 0 && (
                <span className="text-[10px] text-danger">{errorCount} errors</span>
              )}
              {warnCount > 0 && (
                <span className="text-[10px] text-warn">{warnCount} warnings</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearLogs}
                className="p-1 text-text-muted hover:text-text"
                title="Clear logs"
              >
                <Trash2 className="size-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-text-muted hover:text-text"
                title="Hide console"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
            {liveLogs.length === 0 ? (
              <div className="text-text-muted/60 italic">No logs yet. Logs appear here while syncing.</div>
            ) : (
              liveLogs.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex gap-2',
                    l.level === 'error' && 'text-danger',
                    l.level === 'warn' && 'text-warn',
                    l.level === 'info' && 'text-text-muted'
                  )}
                >
                  <span className="opacity-50 shrink-0">
                    {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span
                    className={cn('uppercase text-[9px] shrink-0 mt-[3px]', {
                      'text-danger': l.level === 'error',
                      'text-warn': l.level === 'warn',
                      'text-text-muted/60': l.level === 'info'
                    })}
                  >
                    {l.level}
                  </span>
                  <span className="break-all flex-1">{l.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}
