import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

/** shadcn/ui 風の最小プリミティブ。CLIが環境と噛み合わなかったため自前実装。 */

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'primary'

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'icon' }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3 text-sm',
        size === 'icon' && 'h-7 w-7 text-sm',
        variant === 'default' && 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200 border border-neutral-200',
        variant === 'outline' && 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50',
        variant === 'ghost' && 'text-neutral-600 hover:bg-neutral-100',
        variant === 'primary' && 'bg-neutral-900 text-white hover:bg-neutral-700',
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-800',
        'placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-400/40',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-800',
        'placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-400/40 resize-none',
        className,
      )}
      {...props}
    />
  )
}

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ButtonHTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'green' | 'red' | 'amber' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-neutral-100 text-neutral-600',
        tone === 'green' && 'bg-emerald-100 text-emerald-700',
        tone === 'red' && 'bg-red-100 text-red-700',
        tone === 'amber' && 'bg-amber-100 text-amber-700',
        className,
      )}
      {...props}
    />
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600',
        className,
      )}
    />
  )
}
