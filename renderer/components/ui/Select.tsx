import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-9 w-full appearance-none rounded-lg border border-line/70 bg-bg-subtle px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent/50',
        className
      )}
      {...rest}
    >
      {children}
    </select>
  )
})
