import { useState } from 'react'
import { Link } from 'react-router-dom'
import { User, ArrowLeft, Loader2, Lock, Send, RefreshCw, ArrowLeftRight } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { IdentityLine } from '@/components/social/IdentityLine'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useProfile } from '@/hooks/useProfile'
import type { DMStoreHook, DMViewMessage } from './store'

function shortTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function MessageBubble({ m, onDecrypt }: { m: DMViewMessage; onDecrypt: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const decrypted = m.plaintext !== undefined

  const run = () => {
    if (busy || decrypted) return
    setBusy(true)
    onDecrypt().finally(() => setBusy(false))
  }

  return (
    <div className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', m.mine ? 'bg-purple-600 text-white' : 'bg-[#262626] text-neutral-200')}>
        {decrypted ? (
          <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.plaintext}</span>
        ) : (
          <button
            onClick={run}
            className={cn('inline-flex items-center gap-1.5', m.mine ? 'text-white/90' : 'text-neutral-300', 'hover:underline')}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : m.error ? <RefreshCw className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {m.error ? 'Failed to decrypt, retry' : 'Encrypted, tap to decrypt'}
          </button>
        )}
        <div className={cn('mt-1 text-[10px]', m.mine ? 'text-white/60' : 'text-neutral-500')}>{shortTime(m.created_at)}</div>
      </div>
    </div>
  )
}

/** A DM conversation: bottom-pinned messages + composer. Store-agnostic (NIP-04 / NIP-17). */
export function DmChatView({ useStore, pubkey, onBack, onSwitch, switchLabel }: {
  useStore: DMStoreHook
  pubkey: string
  onBack: () => void
  onSwitch: (pubkey: string) => void
  switchLabel: string
}) {
  const conv = useStore((s) => s.conversations[pubkey])
  const decryptConversation = useStore((s) => s.decryptConversation)
  const decryptMessage = useStore((s) => s.decryptMessage)
  const cancelBatchDecrypt = useStore((s) => s.cancelBatchDecrypt)
  const send = useStore((s) => s.send)
  const { profile, name, npub } = useProfile(pubkey)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [decrypting, setDecrypting] = useState(false)

  const messages = conv?.messages ?? []

  const doSend = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      await send(pubkey, t)
      setText('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  const decryptHere = async () => {
    setDecrypting(true)
    try { await decryptConversation(pubkey) } finally { setDecrypting(false) }
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {/* Header */}
      <div className="border-b border-[#262626]">
        <div className="flex items-center gap-2 p-3 pb-2">
          <button onClick={onBack} className="rounded-md p-1 text-neutral-400 hover:bg-[#262626] hover:text-white lg:hidden" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Link to={`/profile/${npub}`}>
            <Avatar className="h-8 w-8">
              {profile?.picture ? <AvatarImage src={profile.picture} alt={name} /> : null}
              <AvatarFallback className="bg-[#212121] text-neutral-400"><User className="h-4 w-4" /></AvatarFallback>
            </Avatar>
          </Link>
          <Link to={`/profile/${npub}`} className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200 hover:text-purple-400">
            {name}
          </Link>
          <Button size="sm" variant="outline" className="gap-1.5 border-[#262626]" onClick={decrypting ? () => cancelBatchDecrypt() : decryptHere} disabled={!decrypting && messages.length === 0}>
            {decrypting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancel</> : <><Lock className="h-3.5 w-3.5" /> Decrypt all here</>}
          </Button>
        </div>
        <TooltipProvider delayDuration={150}>
          <div className="flex items-center gap-2 px-3 pb-2.5">
            <div className="min-w-0 flex-1">
              <IdentityLine pubkey={pubkey} npub={npub} nip05={profile?.nip05 as string | undefined} />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSwitch(pubkey)}
                  className="shrink-0 rounded-md border border-[#262626] p-2 text-neutral-400 transition-colors hover:border-[#404040] hover:text-white"
                  aria-label={`Switch to ${switchLabel}`}
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Switch to {switchLabel}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Messages (newest at the bottom; flex-col-reverse keeps it pinned there) */}
      <div className="flex min-w-0 flex-1 flex-col-reverse gap-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-neutral-500">No messages yet. Say hello.</p>
        ) : (
          [...messages].reverse().map((m) => (
            <MessageBubble key={m.id} m={m} onDecrypt={() => decryptMessage(pubkey, m.id)} />
          ))
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-[#262626] p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() } }}
          rows={1}
          placeholder="Write a message…"
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-[#262626] bg-[#212121] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-purple-600/50"
        />
        <Button onClick={doSend} disabled={sending || !text.trim()} className="h-10 shrink-0 gap-1.5 bg-purple-600 text-white hover:bg-purple-700">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
