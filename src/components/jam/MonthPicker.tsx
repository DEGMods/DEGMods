import { useState, useRef, useEffect, useMemo } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Month picker styled to match the jam DatePicker (watermelon accent).
// Value is a "YYYY-MM" string; '' means unset.

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parse(s: string) {
  const [y, m] = s.split('-').map(Number)
  return { year: y, month: m - 1 }
}

export function MonthPicker({ value, onChange, placeholder = 'Any month', minMonth, maxMonth }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Inclusive "YYYY-MM" bounds; months outside are disabled. */
  minMonth?: string
  maxMonth?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => (value ? parse(value) : null), [value])
  const now = new Date()
  const [viewYear, setViewYear] = useState(selected?.year ?? now.getFullYear())

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const key = (m: number) => `${viewYear}-${String(m + 1).padStart(2, '0')}`

  const select = (m: number) => {
    if (isDisabled(m)) return
    onChange(key(m))
    setOpen(false)
  }

  const isSelected = (m: number) => selected != null && m === selected.month && viewYear === selected.year
  const isThisMonth = (m: number) => m === now.getMonth() && viewYear === now.getFullYear()
  // "YYYY-MM" strings compare correctly lexicographically.
  const isDisabled = (m: number) => (!!minMonth && key(m) < minMonth) || (!!maxMonth && key(m) > maxMonth)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center justify-between gap-2 rounded-lg border border-[#262626] bg-[#212121] px-3 py-1.5 text-sm transition-colors hover:border-[#fc4462]/40',
          value ? 'text-neutral-200' : 'text-neutral-500',
        )}
      >
        <span>{selected ? `${SHORT[selected.month]} ${selected.year}` : placeholder}</span>
        <CalendarDays size={14} className="shrink-0 text-neutral-500" />
      </button>

      {open && (
        <div className="absolute left-0 z-[60] mt-1 w-[220px] rounded-xl border border-[#262626] bg-[#1c1c1c] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setViewYear(viewYear - 1)} className="rounded p-1 text-neutral-400 transition-colors hover:bg-[#262626] hover:text-white"><ChevronLeft size={14} /></button>
            <span className="text-xs font-semibold text-white">{viewYear}</span>
            <button type="button" onClick={() => setViewYear(viewYear + 1)} className="rounded p-1 text-neutral-400 transition-colors hover:bg-[#262626] hover:text-white"><ChevronRight size={14} /></button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {SHORT.map((m, i) => {
              const disabled = isDisabled(i)
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => select(i)}
                  disabled={disabled}
                  className={cn(
                    'h-8 rounded-md text-xs font-medium transition-all',
                    disabled ? 'cursor-not-allowed text-neutral-700'
                      : isSelected(i) ? 'bg-[#fc4462] text-white'
                        : isThisMonth(i) ? 'font-bold text-[#fc4462] hover:bg-[#262626]'
                          : 'text-neutral-300 hover:bg-[#262626]',
                  )}
                >
                  {m}
                </button>
              )
            })}
          </div>
          {value && (
            <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="mt-2 w-full rounded-md py-1 text-[11px] text-neutral-500 transition-colors hover:bg-[#262626] hover:text-neutral-300">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
