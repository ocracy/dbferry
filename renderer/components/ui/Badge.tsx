import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warn'

const tones: Record<Tone, string> = {
  neutral: 'bg-bg-panel text-text-muted border-line/60',
  accent: 'bg-accent/15 text-accent border-accent/30',
  success: 'bg-success/15 text-success border-success/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  warn: 'bg-warn/15 text-warn border-warn/30'
}

export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider',
        tones[tone],
        className
      )}
      {...rest}
    />
  )
}
