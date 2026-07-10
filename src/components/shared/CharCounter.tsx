import { cn } from '@/lib/utils'

/** A character counter that only appears as the value approaches `max`. */
export function CharCounter({ value, max }: { value: string; max: number }) {
  if (value.length < max * 0.8) return null
  return (
    <p className={cn('text-right text-xs tabular-nums', value.length >= max ? 'text-red-400' : 'text-neutral-500')}>
      {value.length.toLocaleString()} / {max.toLocaleString()}
    </p>
  )
}
