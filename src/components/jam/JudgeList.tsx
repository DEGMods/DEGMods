import { useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { Plus, X, User } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { CharCounter } from '@/components/shared/CharCounter'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { cn } from '@/lib/utils'

const inputCls = 'border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500'

/** Decode an npub to hex, or null if the value isn't a valid npub. */
function npubToHex(v: string): string | null {
  try {
    const d = nip19.decode(v.trim())
    return d.type === 'npub' ? d.data : null
  } catch {
    return null
  }
}

/** A full-width judge row. npubs resolve to a profile (pic, name, npub); plain names show as-is. */
/**
 * One judge as a full-width row. An npub resolves to its profile (picture, name,
 * npub); anything else renders as the plain name it is. Exported so the jam post
 * shows judges the same way the editor does — a truncated npub tells a reader
 * nothing about who is judging.
 */
export function JudgeRow({ value, onRemove, locked }: { value: string; onRemove?: () => void; locked?: boolean }) {
  const hex = npubToHex(value)
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    if (!hex) return
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(hex, relays).then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [hex])

  const npub = value.trim()
  const npubShort = hex ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : null
  const name = profile?.display_name || profile?.name

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2">
      {hex ? (
        <Avatar className="h-8 w-8 shrink-0">
          {profile?.picture ? <AvatarImage src={profile.picture} alt="" /> : null}
          <AvatarFallback className="bg-[#262626] text-neutral-400"><User className="h-4 w-4" /></AvatarFallback>
        </Avatar>
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#262626]"><User className="h-4 w-4 text-neutral-400" /></span>
      )}
      <div className="min-w-0 flex-1">
        {hex ? (
          <>
            <p className="truncate text-sm text-neutral-200">{name || 'Unknown profile'}</p>
            <p className="truncate font-mono text-[11px] text-neutral-500">{npubShort}</p>
          </>
        ) : (
          <p className="truncate text-sm text-neutral-200">{value}</p>
        )}
      </div>
      {!locked && onRemove && <button type="button" onClick={onRemove} className="shrink-0 text-neutral-500 hover:text-red-400"><X className="h-4 w-4" /></button>}
    </div>
  )
}

/** Judge entry: add by name or npub; each judge is a full-width row (npubs show a profile). */
export function JudgeList({ judges, onChange, maxLength, max, locked }: { judges: string[]; onChange: (v: string[]) => void; maxLength?: number; max?: number; locked?: boolean }) {
  const [val, setVal] = useState('')
  const full = locked || (max !== undefined && judges.length >= max)
  const add = () => {
    if (full) return
    const v = val.trim()
    if (v && !judges.includes(v)) onChange([...judges, v])
    setVal('')
  }
  return (
    <div className="space-y-2">
      {!locked && (
      <div className="flex gap-2">
        <Input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder="Add a judge (name or npub) and press Enter" maxLength={maxLength} disabled={full} className={inputCls} />
        <Button type="button" variant="outline" className="shrink-0 border-[#262626]" onClick={add} disabled={full}><Plus className="h-4 w-4" /></Button>
      </div>
      )}
      {!locked && (
      <div className="flex items-center justify-end gap-3">
        {maxLength && <CharCounter value={val} max={maxLength} />}
        {max !== undefined && <span className={cn('text-[10px] tabular-nums', judges.length >= max ? 'text-amber-400' : 'text-neutral-600')}>{judges.length}/{max}</span>}
      </div>
      )}
      {judges.length > 0 && (
        <div className="space-y-1.5">
          {judges.map((j) => <JudgeRow key={j} value={j} locked={locked} onRemove={() => onChange(judges.filter((x) => x !== j))} />)}
        </div>
      )}
    </div>
  )
}
