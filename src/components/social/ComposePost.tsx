import { useState } from 'react'
import { Loader2, Send, ImagePlus } from 'lucide-react'
import { toast } from 'sonner'
import type { Event as NostrEvent } from 'nostr-tools'
import { useAuthStore } from '@/stores/authStore'
import { signAndPublish } from '@/lib/nostr/publish'
import { buildSocialPost } from '@/lib/nostr/socialThread'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { BlossomUploadField } from '@/components/upload/BlossomUploadField'
import { SOCIAL_UPLOAD_ACCEPT } from '@/lib/constants'
import { cn } from '@/lib/utils'

/** Compose + publish a top-level kind-1 note. */
export function ComposePost({ onPosted }: { onPosted?: (event: NostrEvent) => void }) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [showUpload, setShowUpload] = useState(false)

  /** Put the uploaded link on its own line, so clients parse it as media. */
  const appendUrl = (url: string) => {
    setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${url}` : url))
    setShowUpload(false)
  }

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
        className="bg-[#212121] border-[#262626] text-white resize-y min-h-[84px]"
      />

      {/* Attachments are plain URLs in the note body — that's how kind-1 carries
          media, and it's what other clients render previews from. The uploader
          appends the link (extension intact, so clients can tell image from
          video) rather than hiding it, so it stays visible and editable. */}
      {showUpload && (
        <BlossomUploadField
          accept={SOCIAL_UPLOAD_ACCEPT}
          label="Drop a file or click to upload"
          sublabel="Mirrored to up to 3 servers · the link is added to your post"
          onUploaded={(r) => appendUrl(r.url)}
          resetAfter
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShowUpload((v) => !v)}
          className={cn('text-neutral-400 hover:text-neutral-200', showUpload && 'text-purple-400')}
        >
          <ImagePlus className="h-4 w-4 mr-1.5" />
          Media
        </Button>
        <Button size="sm" onClick={submit} disabled={posting || !text.trim()} className="bg-purple-600 hover:bg-purple-700">
          {posting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
          Post
        </Button>
      </div>
    </div>
  )
}
