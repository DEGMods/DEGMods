import { useState, useEffect } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { ADMIN_PUBKEY, KINDS } from '@/lib/constants'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { extractGuideCoordinates, GUIDES_DTAG, extractBlogData } from '@/lib/nostr/events'
import { useSettingsStore } from '@/stores/settingsStore'
import { BlogPostCard } from '@/components/blog/BlogPostCard'
import type { BlogDetails } from '@/types/blog'

export function GuidesPage() {
  const [guides, setGuides] = useState<BlogDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const listEv = await fetchEvents(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [GUIDES_DTAG], limit: 1 }, 6000)
        // Take the newest revision across relays, not whichever arrived first.
        const latestList = listEv.sort((a, b) => b.created_at - a.created_at)[0]
        const coords = latestList ? extractGuideCoordinates(latestList) : []
        if (coords.length === 0) { if (!cancelled) { setGuides([]); setLoading(false) } return }

        // Fetch each referenced kind:30023 article.
        const results = await Promise.all(coords.map((c) => {
          const [kind, pubkey, ...d] = c.split(':')
          if (!kind || !pubkey) return Promise.resolve<BlogDetails | null>(null)
          return fetchEvents(relays, { kinds: [Number(kind)], authors: [pubkey], '#d': [d.join(':')], limit: 1 }, 6000)
            .then((evs) => evs.length ? extractBlogData(evs.sort((a, b) => b.created_at - a.created_at)[0]) : null)
            .catch(() => null)
        }))
        // Preserve the curated order; drop missing / deleted.
        const ordered = results.filter((b): b is BlogDetails => !!b && !b.isDeleted)
        if (!cancelled) setGuides(ordered)
      } catch {
        if (!cancelled) setGuides([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="py-8">
      <div className="mb-6 flex items-center gap-3">
        <BookOpen className="h-7 w-7 text-purple-400" />
        <h1 className="text-3xl font-bold tracking-tight">Guides</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>
      ) : guides.length === 0 ? (
        <p className="py-16 text-center text-sm text-neutral-500">No guides yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {guides.map((g) => <BlogPostCard key={g.aTag} blog={g} />)}
        </div>
      )}
    </div>
  )
}
