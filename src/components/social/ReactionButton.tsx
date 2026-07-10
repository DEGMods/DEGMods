import { useState, useEffect, type ComponentType } from 'react'
import { Heart, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { signAndPublish } from '@/lib/nostr/publish'
import {
  buildReactionEvent,
  buildReactionDeletion,
  fetchReactions,
  summarizeReactions,
  type NostrTarget,
  type ReactionBucket,
} from '@/lib/nostr/social'

interface ReactionButtonProps {
  target: NostrTarget
  /** Reaction content to publish. Defaults to `+` (a like). */
  content?: string
  /** Which bucket this button counts (positive/negative). Defaults to positive. */
  bucket?: ReactionBucket
  /** Icon component to render (Lucide or custom). Defaults to the heart. */
  icon?: ComponentType<{ className?: string }>
  className?: string
}

/**
 * Kind 7 reaction button. Aggregates reactions in its `bucket` (so e.g. all
 * positive emojis count toward the heart), shows the count, and lets the
 * logged-in user react / un-react.
 */
export function ReactionButton({ target, content = '+', bucket = 'positive', icon: Icon = Heart, className }: ReactionButtonProps) {
  const { pubkey } = useAuthStore()
  const [count, setCount] = useState(0)
  const [mineId, setMineId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const events = await fetchReactions(relays, target)
      if (cancelled) return
      const summary = summarizeReactions(events, pubkey, bucket)
      setCount(summary.count)
      setMineId(summary.mine?.id ?? null)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, pubkey, bucket])

  const reacted = !!mineId

  const handleClick = async () => {
    if (!pubkey) {
      toast.error('Log in to react')
      return
    }
    if (busy) return
    setBusy(true)

    const prevCount = count
    const prevMine = mineId
    try {
      if (reacted) {
        setCount(c => Math.max(0, c - 1))
        setMineId(null)
        const res = await signAndPublish(buildReactionDeletion(prevMine!))
        if (!res.success) throw new Error(res.error)
      } else {
        setCount(c => c + 1)
        const res = await signAndPublish(buildReactionEvent(target, content))
        if (!res.success || !res.event) throw new Error(res.error)
        setMineId(res.event.id)
      }
    } catch (err) {
      setCount(prevCount)
      setMineId(prevMine)
      toast.error(err instanceof Error ? err.message : 'Reaction failed')
    } finally {
      setBusy(false)
    }
  }

  const isLike = bucket === 'positive'
  const activeStyle = isLike
    ? 'border-pink-500/40 bg-pink-500/10 text-pink-400'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
        reacted ? activeStyle : 'border-[#262626] text-neutral-400 hover:border-[#404040] hover:text-neutral-200',
        busy && 'opacity-60',
        className,
      )}
      aria-pressed={reacted}
      aria-label={isLike ? (reacted ? 'Remove like' : 'Like') : 'React'}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className={cn('h-4 w-4', isLike && reacted && 'fill-current')} />
      )}
      <span className="tabular-nums">{count}</span>
    </button>
  )
}
