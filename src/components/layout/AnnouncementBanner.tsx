import { useState, useEffect } from 'react'
import { Megaphone, AlertTriangle, ExternalLink, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { extractAnnouncement, ANNOUNCEMENT_DTAG, type AnnouncementData } from '@/lib/nostr/events'
import { KINDS, ADMIN_PUBKEY } from '@/lib/constants'
import { Markdown } from '@/components/shared/Markdown'

const DISMISS_KEY = 'deg-mods:announcement-dismissed'

/**
 * Site-wide announcement banner: reads the admin's NIP-78 `site-announcement`
 * event and renders it below the header. Dismissible per announcement (a new
 * announcement re-appears because dismissal is keyed by event id).
 */
export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<AnnouncementData | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, {
        kinds: [KINDS.GAME_DB],
        authors: [ADMIN_PUBKEY],
        '#d': [ANNOUNCEMENT_DTAG],
      })
      if (cancelled || !event) return
      const data = extractAnnouncement(event)
      if (data.isEmpty) return
      setAnnouncement(data)
      setDismissed(localStorage.getItem(DISMISS_KEY) === data.id)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (!announcement || dismissed) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, announcement.id)
    setDismissed(true)
  }

  const warning = announcement.severity === 'warning'
  const Icon = warning ? AlertTriangle : Megaphone

  return (
    <div
      className={cn(
        'border-b',
        warning
          ? 'border-yellow-500/20 bg-yellow-500/10'
          : 'border-purple-500/20 bg-purple-500/10',
      )}
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', warning ? 'text-yellow-400' : 'text-purple-400')} />

        <div className="min-w-0 flex-1 text-sm text-neutral-200">
          <Markdown content={announcement.content} className="[&_p]:my-0 [&_p]:leading-snug" />
          {announcement.link && (
            <a
              href={announcement.link}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'mt-1 inline-flex items-center gap-1 text-sm font-medium hover:underline',
                warning ? 'text-yellow-300' : 'text-purple-300',
              )}
            >
              {announcement.linkLabel || 'Learn more'}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        <button
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="mt-0.5 shrink-0 text-neutral-400 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
