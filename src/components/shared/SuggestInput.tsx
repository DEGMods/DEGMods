import { useState, useEffect, useMemo, useRef } from 'react'
import { Input } from '@/components/ui/input'

interface SuggestInputProps {
  value: string
  onChange: (val: string) => void
  /** Fired when a suggestion is picked from the dropdown (falls back to onChange). */
  onSelect?: (val: string) => void
  /** Candidate suggestions to match against. Free text is always allowed. */
  items: string[]
  /** Min query length before suggestions appear. 0 = show all on focus. */
  minChars?: number
  placeholder?: string
  className?: string
  maxLength?: number
  disabled?: boolean
}

/**
 * Text input with a suggestion dropdown. Free text is always allowed — the
 * dropdown is a convenience. Uses the app's canonical menu design (matching the
 * Radix DropdownMenu) so all such dropdowns look identical.
 */
export function SuggestInput({
  value, onChange, onSelect, items, minChars = 1, placeholder, className, maxLength, disabled,
}: SuggestInputProps) {
  const pick = onSelect ?? onChange
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const q = value.trim().toLowerCase()

  const suggestions = useMemo(() => {
    if (q.length < minChars) return []
    const matches = q ? items.filter((i) => i.toLowerCase().includes(q)) : items.slice()
    return matches
      .sort((a, b) => {
        if (q) {
          const aStarts = a.toLowerCase().startsWith(q)
          const bStarts = b.toLowerCase().startsWith(q)
          if (aStarts !== bStarts) return aStarts ? -1 : 1
        }
        return a.localeCompare(b, undefined, { sensitivity: 'base' })
      })
      .slice(0, 50)
  }, [q, items, minChars])

  const show = open && suggestions.length > 0

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        className={className}
      />
      {show && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto overflow-hidden rounded-lg border border-[#262626] bg-[#1c1c1c] p-1 shadow-md">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="flex w-full cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-left text-sm text-neutral-200 transition-colors hover:bg-[#262626]"
              onMouseDown={(e) => { e.preventDefault(); pick(s); setOpen(false) }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
