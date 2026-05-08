import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent hover:bg-accent-hover text-white shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_8px_24px_-12px_rgba(120,80,255,0.6)]',
  ghost: 'bg-transparent hover:bg-bg-panel text-text',
  outline: 'bg-transparent border border-line hover:bg-bg-panel text-text',
  danger: 'bg-danger/90 hover:bg-danger text-white',
  subtle: 'bg-bg-panel hover:bg-bg-subtle text-text border border-line/60'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs rounded-md',
  md: 'h-9 px-3.5 text-sm rounded-lg',
  lg: 'h-11 px-5 text-sm rounded-xl'
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'subtle', size = 'md', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-[background,color,box-shadow,transform] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    />
  )
})
