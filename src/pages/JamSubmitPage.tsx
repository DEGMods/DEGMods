import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { JamEditor } from '@/components/jam/JamEditor'
import { buildJamEvent, extractJam, type JamFormState, type JamDetails } from '@/lib/nostr/jam'
import { signAndPublish } from '@/lib/nostr/publish'
import { fetchLatestEvent } from '@/lib/nostr/relay-pool'
import { getCachedEvent, whenEventCacheReady, cacheEvent } from '@/lib/nostr/eventCache'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { KINDS } from '@/lib/constants'

export function JamSubmitPage() {
  const navigate = useNavigate()
  const { naddr } = useParams<{ naddr: string }>()
  const isEdit = !!naddr
  const pubkey = useAuthStore((s) => s.pubkey)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [publishing, setPublishing] = useState(false)

  // Edit mode: load the jam we're editing.
  const [editJam, setEditJam] = useState<JamDetails | null>(null)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    setLoadError(null)

    async function load() {
      let decoded
      try { decoded = nip19.decode(naddr!) } catch { setLoadError('Invalid jam link.'); setLoading(false); return }
      if (decoded.type !== 'naddr' || decoded.data.kind !== KINDS.JAM) { setLoadError('That link is not a mod jam.'); setLoading(false); return }
      const { pubkey: author, identifier } = decoded.data
      const coord = `${KINDS.JAM}:${author}:${identifier}`

      // 1. Instant: seed the editor from the shared cache (e.g. the jam post the
      // user just came from). JamEditor is keyed by created_at, so a newer
      // revision arriving below remounts it with fresh data.
      await whenEventCacheReady
      if (cancelled) return
      const cached = getCachedEvent(coord)
      if (cached) { const j = extractJam(cached); if (j) { setEditJam(j); setLoading(false) } }
      else setLoading(true)

      // 2. Fetch the true latest to edit against.
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const ev = await fetchLatestEvent(relays, { kinds: [KINDS.JAM], authors: [author], '#d': [identifier] })
        if (cancelled) return
        const j = ev ? extractJam(ev) : null
        if (!j) { if (!cached) { setLoadError('Mod jam not found.'); setLoading(false) } return }
        if (!cached || (ev && ev.created_at > cached.created_at)) setEditJam(j)
        setLoading(false)
      } catch {
        if (!cancelled && !cached) { setLoadError('Failed to load the mod jam.'); setLoading(false) }
      }
    }

    load()
    return () => { cancelled = true }
  }, [naddr, isEdit])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <h1 className="text-xl font-semibold text-white">Login Required</h1>
        <p className="text-sm text-neutral-400">You need to be logged in to run a mod jam.</p>
        <button onClick={() => useLoginModalStore.getState().open()} className="text-sm text-[#fc4462] underline-offset-2 hover:underline">Go to Login</button>
      </div>
    )
  }

  if (isEdit && loading) return <div className="flex items-center justify-center py-24 text-neutral-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading jam…</div>
  if (isEdit && loadError) return <div className="py-24 text-center text-neutral-400">{loadError}</div>
  if (isEdit && editJam && editJam.pubkey !== pubkey) {
    return <div className="py-24 text-center text-neutral-400">You can only edit your own mod jams.</div>
  }

  const handlePublish = async (form: JamFormState) => {
    setPublishing(true)
    try {
      const result = await signAndPublish(buildJamEvent(form), (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: 'jam' })
        if (status === 'signing') toast.loading('Signing…', { id: 'jam' })
        if (status === 'publishing') toast.loading('Publishing…', { id: 'jam' })
      })
      if (!result.success || !result.event) throw new Error(result.error || 'Failed to publish')
      // Cache the just-published revision so the jam post shows YOUR new version
      // immediately (newest-wins), instead of a stale cache + "newer version" prompt.
      cacheEvent(result.event)
      toast.success(isEdit ? 'Mod jam updated!' : 'Mod jam published!', { id: 'jam' })
      const naddrOut = nip19.naddrEncode({ identifier: form.dTag, pubkey: pubkey!, kind: KINDS.JAM })
      navigate(`/mod-jam/${naddrOut}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'jam' })
      throw err
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{isEdit ? 'Edit Mod Jam' : 'Submit a Mod Jam'}</h1>
        <p className="mt-1 text-sm text-neutral-400">Run a time-boxed modding event with optional voting and prizes.</p>
      </div>
      <JamEditor key={editJam?.createdAt ?? 'new'} editJam={editJam ?? undefined} onPublish={handlePublish} publishing={publishing} />
    </div>
  )
}
