import { useState, useRef, useEffect, useMemo } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Custom date picker (ported from DEN Chat's, restyled to the DEG Mods palette
// with a watermelon accent). Value is a local "YYYY-MM-DD" string.

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parse(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return { year: y, month: m - 1, day: d }
}

export function DatePicker({ value, onChange, placeholder = 'Select date', minDate }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minDate?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => (value ? parse(value) : null), [value])
  const min = useMemo(() => (minDate ? parse(minDate) : null), [minDate])
  const now = new Date()
  const [viewMonth, setViewMonth] = useState(selected?.month ?? now.getMonth())
  const [viewYear, setViewYear] = useState(selected?.year ?? now.getFullYear())

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1).getDay()
    const dim = new Date(viewYear, viewMonth + 1, 0).getDate()
    const out: (number | null)[] = []
    for (let i = 0; i < first; i++) out.push(null)
    for (let d = 1; d <= dim; d++) out.push(d)
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [viewYear, viewMonth])

  const isToday = (d: number) => d === now.getDate() && viewMonth === now.getMonth() && viewYear === now.getFullYear()
  const isSelected = (d: number) => selected != null && d === selected.day && viewMonth === selected.month && viewYear === selected.year
  const isDisabled = (d: number) => {
    if (!min) return false
    const c = new Date(viewYear, viewMonth, d); c.setHours(0, 0, 0, 0)
    const m = new Date(min.year, min.month, min.day); m.setHours(0, 0, 0, 0)
    return c < m
  }

  const select = (d: number) => {
    if (isDisabled(d)) return
    onChange(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    setOpen(false)
  }
  const prev = () => (viewMonth === 0 ? (setViewMonth(11), setViewYear(viewYear - 1)) : setViewMonth(viewMonth - 1))
  const next = () => (viewMonth === 11 ? (setViewMonth(0), setViewYear(viewYear + 1)) : setViewMonth(viewMonth + 1))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2 text-sm transition-colors hover:border-[#fc4462]/40',
          value ? 'text-neutral-200' : 'text-neutral-500',
        )}
      >
        <span>{selected ? `${SHORT[selected.month]} ${selected.day}, ${selected.year}` : placeholder}</span>
        <CalendarDays size={14} className="shrink-0 text-neutral-500" />
      </button>

      {open && (
        <div className="absolute left-0 z-[60] mt-1 w-[260px] rounded-xl border border-[#262626] bg-[#1c1c1c] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <button onClick={prev} className="rounded p-1 text-neutral-400 transition-colors hover:bg-[#262626] hover:text-white"><ChevronLeft size={14} /></button>
            <span className="text-xs font-semibold text-white">{MONTHS[viewMonth]} {viewYear}</span>
            <button onClick={next} className="rounded p-1 text-neutral-400 transition-colors hover:bg-[#262626] hover:text-white"><ChevronRight size={14} /></button>
          </div>
          <div className="mb-0.5 grid grid-cols-7 gap-0.5">
            {DAYS.map((d) => <div key={d} className="py-0.5 text-center text-[9px] font-medium text-neutral-500">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} className="h-8" />
              const disabled = isDisabled(day)
              return (
                <button
                  key={day}
                  onClick={() => select(day)}
                  disabled={disabled}
                  className={cn(
                    'h-8 rounded-md text-xs font-medium transition-all',
                    disabled ? 'cursor-not-allowed text-neutral-700'
                      : isSelected(day) ? 'bg-[#fc4462] text-white'
                        : isToday(day) ? 'font-bold text-[#fc4462] hover:bg-[#262626]'
                          : 'text-neutral-300 hover:bg-[#262626]',
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
