import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ModEditor } from '@/components/mod/ModEditor'
import { buildModEvent, extractModData } from '@/lib/nostr/events'
import { jamNaddrFromCoordinate } from '@/lib/nostr/jam'
import { signAndPublish } from '@/lib/nostr/publish'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { cacheEvent } from '@/lib/nostr/eventCache'
import { decodePostParam } from '@/lib/nostr/nipShort'
import { nip19 } from 'nostr-tools'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'
import { LEGACY_MOD_KIND } from '@/lib/mods/legacy' // LEGACY
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { ModFormState } from '@/types/mod'

export function EditModPage() {
  const navigate = useNavigate()
  const { naddr } = useParams<{ naddr: string }>()
  const pubkey = useAuthStore(s => s.pubkey)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [publishing, setPublishing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [initialState, setInitialState] = useState<Partial<ModFormState> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!naddr) return
    const loadMod = async () => {
      const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      try {
        // The address here is whatever the mod page's URL held, which is a
        // NIP-SHORT address once one resolves — decoding it as bech32 fails on
        // the letters bech32 doesn't have ("Unknown letter: b"). Resolve it the
        // same way the mod page does so short links, reloads and bookmarks all
        // reach the editor.
        const decoded = await decodePostParam(naddr, relayUrls)
        if (!decoded) throw new Error('Mod not found')
        // An ambiguous short address can't be edited blind — send them to the
        // mod page, which offers the chooser, and they can edit from there.
        if ('candidates' in decoded) { navigate(`/mod/${naddr}`, { replace: true }); return }
        const { identifier, pubkey: eventPubkey, kind } = decoded

        // LEGACY: old mods can't be edited — send them back to the mod post.
        if (kind === LEGACY_MOD_KIND) { navigate(`/mod/${naddr}`, { replace: true }); return }

        const event = await fetchEvent(relayUrls, {
          kinds: [kind],
          authors: [eventPubkey],
          '#d': [identifier],
        })

        if (!event) throw new Error('Mod not found')
        if (event.pubkey !== pubkey) throw new Error('You can only edit your own mods')

        const modData = extractModData(event)
        setInitialState({
          dTag: modData.dTag,
          title: modData.title,
          summary: modData.summary,
          content: modData.content,
          game: modData.game,
          featuredImageUrl: modData.featuredImageUrl || '',
          featuredVideoUrl: modData.featuredVideoUrl || '',
          contentWarning: !!modData.contentWarning,
          contentWarningReason: modData.contentWarning || 'nsfw',
          isRepost: modData.isRepost,
          originalAuthor: modData.originalAuthor || '',
          emulation: modData.emulation,
          emulatedPlatform: modData.emulatedPlatform || '',
          forModEnabled: !!modData.forMod,
          forMod: modData.forMod || '',
          jamEnabled: !!modData.jamCoordinate,
          jamNaddr: modData.jamCoordinate ? (jamNaddrFromCoordinate(modData.jamCoordinate) || '') : '',
          elsewhere: modData.elsewhere,
          dependenciesEnabled: modData.dependencies.length > 0,
          dependencies: modData.dependencies.length > 0 ? modData.dependencies : [{ title: '', value: '' }],
          screenshots: modData.screenshots.length > 0 ? modData.screenshots : [''],
          tags: modData.tags.length > 0 ? modData.tags : [''],
          downloads: modData.downloads.length > 0 ? modData.downloads : [{ file: '' }],
          permissions: modData.permissions,
          notes: modData.notes || '',
          credits: modData.credits || '',
          categories: modData.categories.length > 0 ? modData.categories : [],
          isEdit: true,
          previousCreatedAt: modData.createdAt,
          publishedAt: modData.publishedAt,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load mod')
      } finally {
        setLoading(false)
      }
    }
    loadMod()
  }, [naddr, pubkey])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <h1 className="text-xl font-semibold text-white">Login Required</h1>
        <p className="text-neutral-400 text-sm">You need to be logged in to edit a mod.</p>
        <button
          onClick={() => useLoginModalStore.getState().open()}
          className="text-purple-400 hover:text-purple-300 text-sm underline-offset-2 hover:underline cursor-pointer"
        >
          Go to Login
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
        <p className="text-sm text-neutral-400">Loading mod data...</p>
      </div>
    )
  }

  if (error || !initialState) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <h1 className="text-xl font-semibold text-red-400">Error</h1>
        <p className="text-neutral-400 text-sm">{error || 'Failed to load mod data'}</p>
        <button
          onClick={() => navigate(-1)}
          className="text-purple-400 hover:text-purple-300 text-sm underline-offset-2 hover:underline cursor-pointer"
        >
          Go Back
        </button>
      </div>
    )
  }

  const handlePublish = async (form: ModFormState) => {
    setPublishing(true)
    try {
      const unsignedEvent = buildModEvent(form)
      const result = await signAndPublish(unsignedEvent, (status) => {
        switch (status) {
          case 'mining': toast.loading('Processing proof of work...', { id: 'publish' }); break
          case 'signing': toast.loading('Signing event...', { id: 'publish' }); break
          case 'publishing': toast.loading('Publishing to relays...', { id: 'publish' }); break
        }
      })

      if (!result.success || !result.event) {
        throw new Error(result.error || 'Failed to update')
      }
      // Cache the just-published revision so the mod page shows YOUR new version
      // immediately (newest-wins), instead of the stale cache + a "new version"
      // prompt a few seconds later.
      cacheEvent(result.event)
      toast.success('Mod updated successfully!', { id: 'publish' })
      const naddrEncoded = nip19.naddrEncode({
        identifier: form.dTag,
        pubkey: pubkey!,
        kind: KINDS.MOD,
      })
      navigate(`/mod/${naddrEncoded}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed', { id: 'publish' })
      throw err // signal failure so the editor keeps the draft
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="py-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Edit Mod</h1>
        <p className="text-sm text-neutral-400 mt-1">Update your published mod</p>
      </div>
      <ModEditor
        initialState={initialState}
        isEdit
        onPublish={handlePublish}
        publishing={publishing}
      />
    </div>
  )
}
