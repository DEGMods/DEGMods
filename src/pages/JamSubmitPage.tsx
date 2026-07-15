import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { JamEditor } from '@/components/jam/JamEditor'
import { buildJamEvent, type JamFormState } from '@/lib/nostr/jam'
import { signAndPublish } from '@/lib/nostr/publish'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { KINDS } from '@/lib/constants'

export function JamSubmitPage() {
  const navigate = useNavigate()
  const pubkey = useAuthStore((s) => s.pubkey)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [publishing, setPublishing] = useState(false)

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <h1 className="text-xl font-semibold text-white">Login Required</h1>
        <p className="text-sm text-neutral-400">You need to be logged in to run a mod jam.</p>
        <button onClick={() => useLoginModalStore.getState().open()} className="text-sm text-[#fc4462] underline-offset-2 hover:underline">Go to Login</button>
      </div>
    )
  }

  const handlePublish = async (form: JamFormState) => {
    setPublishing(true)
    try {
      const result = await signAndPublish(buildJamEvent(form), (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: 'jam' })
        if (status === 'signing') toast.loading('Signing…', { id: 'jam' })
        if (status === 'publishing') toast.loading('Publishing…', { id: 'jam' })
      })
      if (!result.success) throw new Error(result.error || 'Failed to publish')
      toast.success('Mod jam published!', { id: 'jam' })
      const naddr = nip19.naddrEncode({ identifier: form.dTag, pubkey: pubkey!, kind: KINDS.JAM })
      navigate(`/mod-jam/${naddr}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'jam' })
      throw err
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="py-6">
      <div className="mx-auto mb-6 max-w-3xl">
        <h1 className="text-2xl font-bold text-white">Submit a Mod Jam</h1>
        <p className="mt-1 text-sm text-neutral-400">Run a time-boxed modding event with optional voting and prizes.</p>
      </div>
      <JamEditor onPublish={handlePublish} publishing={publishing} />
    </div>
  )
}
