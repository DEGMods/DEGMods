import { useState } from 'react'
import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { XLogo } from '@/components/shared/XLogo'
import { NostrLogo } from '@/components/shared/NostrLogo'
import { ADMIN_PUBKEY } from '@/lib/constants'
import { CONTACT_SUBJECTS, sendContactMessage, type ContactSubject } from '@/lib/nostr/contact'

const DEG_X_URL = 'https://x.com/DEGMods'
const ADMIN_NPUB = nip19.npubEncode(ADMIN_PUBKEY)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Contact form modal. Submits an anonymous, proof-of-worked NIP-04 DM to the
 * admin (see sendContactMessage). `subject` presets the dropdown; `lockSubject`
 * fixes it (e.g. the /ads "Interested?" flow locks it to Advertisement).
 */
export function ContactModal({
  open,
  onClose,
  subject = 'advertisement',
  lockSubject = false,
}: {
  open: boolean
  onClose: () => void
  subject?: ContactSubject
  lockSubject?: boolean
}) {
  const [email, setEmail] = useState('')
  const [subj, setSubj] = useState<ContactSubject>(subject)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      toast.error('Enter a valid email so we can reach you back')
      return
    }
    if (!body.trim()) {
      toast.error('Enter a message')
      return
    }
    setSending(true)
    try {
      await sendContactMessage({ email: email.trim(), subject: subj, body: body.trim() })
      toast.success('Message sent. We will reply by email.')
      setEmail('')
      setBody('')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const inputClass = 'border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500'

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onClose() }}>
      <DialogContent className="max-w-md border-[#262626] bg-[#1c1c1c]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-100">
            <Send className="h-5 w-5 text-purple-400" /> Get in touch
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">
              Your email <span className="text-neutral-600">(required, we reply here)</span>
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Subject</label>
            <select
              value={subj}
              disabled={lockSubject}
              onChange={(e) => setSubj(e.target.value as ContactSubject)}
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputClass} disabled:cursor-not-allowed disabled:opacity-70`}
            >
              {CONTACT_SUBJECTS.map((s) => (
                <option key={s} value={s} className="bg-[#212121]">{cap(s)}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Message</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Tell us what you have in mind…"
              className={inputClass}
            />
          </div>

          <Button onClick={submit} disabled={sending} className="w-full gap-1.5 bg-purple-600 text-white hover:bg-purple-700">
            {sending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : 'Send message'}
          </Button>

          <div className="space-y-2 border-t border-[#262626] pt-3 text-center">
            <p className="text-xs text-neutral-500">Prefer social? You can also reach us on Nostr or X.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link
                to={`/profile/${ADMIN_NPUB}`}
                onClick={onClose}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#262626] px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-[#404040] hover:bg-[#212121]"
              >
                <NostrLogo /> Nostr
              </Link>
              <a
                href={DEG_X_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#262626] px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-[#404040] hover:bg-[#212121]"
              >
                <XLogo /> @DEGMods
              </a>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
