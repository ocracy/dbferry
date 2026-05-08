import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-line/70 bg-bg-subtle px-3 text-sm text-text placeholder:text-text-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent/50 transition-[border-color,box-shadow]',
        className
      )}
      {...rest}
    />
  )
})
