import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import type { Event as NostrEvent } from 'nostr-tools'
import { useAuthStore } from '@/stores/authStore'
import { signAndPublish } from '@/lib/nostr/publish'
import { buildSocialPost } from '@/lib/nostr/socialThread'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/** Compose + publish a top-level kind-1 note. */
export function ComposePost({ onPosted }: { onPosted?: (event: NostrEvent) => void }) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  const submit = async () => {
    if (!myPubkey) { toast.error('Log in to post'); return }
    const content = text.trim()
    if (!content || posting) return
    setPosting(true)
    try {
      const res = await signAndPublish(buildSocialPost(content))
      if (!res.success || !res.event) throw new Error(res.error || 'Failed to publish')
      toast.success('Posted')
      setText('')
      onPosted?.(res.event)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-3 space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind?"
        rows={3}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() } }}
        className="bg-[#212121] border-[#262626] text-white resize-none"
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={posting || !text.trim()} className="bg-purple-600 hover:bg-purple-700">
          {posting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
          Post
        </Button>
      </div>
    </div>
  )
}
