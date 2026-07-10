import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ModEditor } from '@/components/mod/ModEditor'
import { buildModEvent } from '@/lib/nostr/events'
import { signAndPublish } from '@/lib/nostr/publish'
import { nip19 } from 'nostr-tools'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { KINDS } from '@/lib/constants'
import { toast } from 'sonner'
import type { ModFormState } from '@/types/mod'

export function SubmitModPage() {
  const navigate = useNavigate()
  const pubkey = useAuthStore(s => s.pubkey)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [publishing, setPublishing] = useState(false)

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <h1 className="text-xl font-semibold text-white">Login Required</h1>
        <p className="text-neutral-400 text-sm">You need to be logged in to submit a mod.</p>
        <button
          onClick={() => useLoginModalStore.getState().open()}
          className="text-purple-400 hover:text-purple-300 text-sm underline-offset-2 hover:underline cursor-pointer"
        >
          Go to Login
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
        throw new Error(result.error || 'Failed to publish')
      }
      toast.success('Mod published successfully!', { id: 'publish' })
      const naddr = nip19.naddrEncode({
        identifier: form.dTag,
        pubkey: pubkey!,
        kind: KINDS.MOD,
      })
      navigate(`/mod/${naddr}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'publish' })
      throw err // signal failure so the editor keeps the draft
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="py-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Submit a Mod</h1>
        <p className="text-sm text-neutral-400 mt-1">Publish a new game mod to the Nostr network</p>
      </div>
      <ModEditor onPublish={handlePublish} publishing={publishing} />
    </div>
  )
}
