import { useState, useMemo, useCallback } from 'react'
import { cn } from '@/lib/utils'

// Custom time picker (ported from DEN Chat's, restyled). Value is always stored
// as 24h "HH:mm"; display is 12h (AM/PM toggle) or 24h per the `use12h` prop.

/** Whether the browser locale defaults to a 12-hour clock. */
export function browserUses12h(): boolean {
  try {
    const r = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
    return r.hourCycle === 'h12' || r.hourCycle === 'h11'
  } catch { return true }
}

export function TimePicker({ value, onChange, use12h }: { value: string; onChange: (v: string) => void; use12h: boolean }) {
  return use12h ? <TimePicker12h value={value} onChange={onChange} /> : <TimePicker24h value={value} onChange={onChange} />
}

const boxCls = 'flex flex-1 items-center gap-0.5 rounded-lg border border-[#262626] bg-[#212121] px-2 py-2'
const inputCls = 'w-7 rounded-sm bg-transparent text-center text-sm text-neutral-200 outline-none placeholder:text-neutral-600'

function TimePicker12h({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = useMemo(() => {
    if (!value) return { hour12: '', minute: '', period: 'AM' as 'AM' | 'PM' }
    const [hStr, mStr] = value.split(':')
    let h = parseInt(hStr, 10)
    const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM'
    if (h === 0) h = 12; else if (h > 12) h -= 12
    return { hour12: String(h), minute: mStr || '00', period }
  }, [value])

  const [hour, setHour] = useState(parsed.hour12)
  const [minute, setMinute] = useState(parsed.minute)
  const [period, setPeriod] = useState<'AM' | 'PM'>(parsed.period)

  const emit = useCallback((h: string, m: string, p: 'AM' | 'PM') => {
    const hn = parseInt(h, 10), mn = parseInt(m, 10)
    if (isNaN(hn) || isNaN(mn) || hn < 1 || hn > 12 || mn < 0 || mn > 59) return
    let h24 = hn
    if (p === 'AM' && h24 === 12) h24 = 0; else if (p === 'PM' && h24 !== 12) h24 += 12
    onChange(`${String(h24).padStart(2, '0')}:${String(mn).padStart(2, '0')}`)
  }, [onChange])

  return (
    <div className={boxCls}>
      <input inputMode="numeric" value={hour} placeholder="--" maxLength={2} className={inputCls}
        onChange={(e) => { const c = e.target.value.replace(/\D/g, '').slice(0, 2); setHour(c); if (c) emit(c, minute || '00', period) }}
        onBlur={() => { if (!hour) return; let h = Math.min(12, Math.max(1, parseInt(hour, 10))); setHour(String(h)); emit(String(h), minute || '00', period) }} />
      <span className="text-sm font-medium text-neutral-500">:</span>
      <input inputMode="numeric" value={minute} placeholder="--" maxLength={2} className={inputCls}
        onChange={(e) => { const c = e.target.value.replace(/\D/g, '').slice(0, 2); setMinute(c); if (hour) emit(hour, c || '00', period) }}
        onBlur={() => { if (!minute) { setMinute('00'); return } const m = String(Math.min(59, Math.max(0, parseInt(minute, 10)))).padStart(2, '0'); setMinute(m); emit(hour || '12', m, period) }} />
      <button type="button" onClick={() => { const p = period === 'AM' ? 'PM' : 'AM'; setPeriod(p); if (hour) emit(hour, minute || '00', p) }}
        className="ml-1.5 rounded bg-[#fc4462]/15 px-2 py-0.5 text-[11px] font-bold text-[#fc4462] transition-colors hover:bg-[#fc4462]/25">
        {period}
      </button>
    </div>
  )
}

function TimePicker24h({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = useMemo(() => {
    if (!value) return { hour: '', minute: '' }
    const [hStr, mStr] = value.split(':')
    return { hour: String(parseInt(hStr, 10)), minute: mStr || '00' }
  }, [value])

  const [hour, setHour] = useState(parsed.hour)
  const [minute, setMinute] = useState(parsed.minute)

  const emit = useCallback((h: string, m: string) => {
    const hn = parseInt(h, 10), mn = parseInt(m, 10)
    if (isNaN(hn) || isNaN(mn) || hn < 0 || hn > 23 || mn < 0 || mn > 59) return
    onChange(`${String(hn).padStart(2, '0')}:${String(mn).padStart(2, '0')}`)
  }, [onChange])

  return (
    <div className={boxCls}>
      <input inputMode="numeric" value={hour} placeholder="--" maxLength={2} className={inputCls}
        onChange={(e) => { const c = e.target.value.replace(/\D/g, '').slice(0, 2); setHour(c); if (c) emit(c, minute || '00') }}
        onBlur={() => { if (!hour) return; const h = String(Math.min(23, Math.max(0, parseInt(hour, 10)))).padStart(2, '0'); setHour(h); emit(h, minute || '00') }} />
      <span className="text-sm font-medium text-neutral-500">:</span>
      <input inputMode="numeric" value={minute} placeholder="--" maxLength={2} className={inputCls}
        onChange={(e) => { const c = e.target.value.replace(/\D/g, '').slice(0, 2); setMinute(c); if (hour) emit(hour, c || '00') }}
        onBlur={() => { if (!minute) { setMinute('00'); return } const m = String(Math.min(59, Math.max(0, parseInt(minute, 10)))).padStart(2, '0'); setMinute(m); emit(hour || '00', m) }} />
    </div>
  )
}
