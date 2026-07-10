import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { signAndPublish } from '@/lib/nostr/publish'
import { buildSocialReply, type SocialRef } from '@/lib/nostr/socialThread'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface SocialReplyFormProps {
  root: SocialRef
  parent?: SocialRef
  placeholder?: string
  autoFocus?: boolean
  onPublished: () => void
  onCancel?: () => void
}

/** Composes a kind-1 (NIP-10) reply to a social note. */
export function SocialReplyForm({ root, parent, placeholder, autoFocus, onPublished, onCancel }: SocialReplyFormProps) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  const submit = async () => {
    if (!myPubkey) { toast.error('Log in to reply'); return }
    const content = text.trim()
    if (!content || posting) return
    setPosting(true)
    try {
      const res = await signAndPublish(buildSocialReply(content, root, parent))
      if (!res.success) throw new Error(res.error || 'Failed to publish')
      toast.success('Reply posted')
      setText('')
      onPublished()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reply')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? 'Post your reply…'}
        autoFocus={autoFocus}
        rows={2}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() } }}
        className="bg-[#212121] border-[#262626] text-white resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel} className="border-[#262626] text-xs">Cancel</Button>
        )}
        <Button size="sm" onClick={submit} disabled={posting || !text.trim()} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {posting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
          Reply
        </Button>
      </div>
    </div>
  )
}
