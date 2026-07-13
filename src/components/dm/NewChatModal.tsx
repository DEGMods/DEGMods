import { useState } from 'react'
import { nip19 } from 'nostr-tools'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

/** Decode an npub / nprofile / raw hex pubkey to a hex pubkey, or null. */
function toPubkey(input: string): string | null {
  const s = input.trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  try {
    const d = nip19.decode(s)
    if (d.type === 'npub') return d.data as string
    if (d.type === 'nprofile') return (d.data as { pubkey: string }).pubkey
  } catch { /* invalid */ }
  return null
}

/** Start a fresh NIP-04 conversation by npub. Calls `onOpen(pubkey)` (which opens
 *  the chat locally even if there's no history yet). */
export function NewChatModal({ open, onClose, onOpen }: {
  open: boolean
  onClose: () => void
  onOpen: (pubkey: string) => void
}) {
  const [value, setValue] = useState('')

  const submit = () => {
    const pk = toPubkey(value)
    if (!pk) { toast.error('Enter a valid npub'); return }
    onOpen(pk)
    setValue('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm border-[#262626] bg-[#1c1c1c]">
        <DialogHeader>
          <DialogTitle className="text-neutral-100">New message</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-neutral-400">Enter an npub to start a conversation.</p>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="npub1…"
            className="border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500"
          />
          <Button onClick={submit} className="w-full bg-purple-600 text-white hover:bg-purple-700">Open chat</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
