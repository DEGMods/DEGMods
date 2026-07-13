import { useState } from 'react'
import { MessageSquare, Lock, Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useDMStore } from '@/stores/dmStore'
import { signerSupportsDM } from '@/lib/nostr/dm'
import { ConversationList } from './ConversationList'
import { DmChatView } from './DmChatView'

type Tab = 'nip04' | 'nip17'

const tabCls = (active: boolean) =>
  cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    active ? 'bg-[#262626] text-white' : 'text-neutral-400 hover:text-neutral-200',
  )

export function DirectMessagesView() {
  const active = useDMStore((s) => s.active)
  const openConversation = useDMStore((s) => s.openConversation)
  const closeConversation = useDMStore((s) => s.closeConversation)
  const decryptAll = useDMStore((s) => s.decryptAll)
  const loadingHistory = useDMStore((s) => s.loadingHistory)
  const convoCount = useDMStore((s) => Object.keys(s.conversations).length)
  const [tab, setTab] = useState<Tab>('nip04')
  const [decrypting, setDecrypting] = useState(false)
  const canDM = signerSupportsDM()

  const decryptEverything = async () => {
    setDecrypting(true)
    try { await decryptAll() } finally { setDecrypting(false) }
  }

  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c]">
      {/* Header: title + tabs + explanation tooltip */}
      <div className="border-b border-[#262626] p-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Direct Messages</h2>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-neutral-500 transition-colors hover:text-neutral-300" aria-label="About message privacy">
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                <p><span className="font-semibold text-purple-300">Private (NIP-04):</span> the message text is end-to-end encrypted, but relays can still see who you are talking to and when.</p>
                <p className="mt-1.5"><span className="font-semibold text-purple-300">Extra Private (NIP-17):</span> gift-wrapped so that even the metadata (who and when) is hidden. Coming soon.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setTab('nip04')} className={tabCls(tab === 'nip04')}>Private</button>
          <button disabled className={cn(tabCls(false), 'cursor-not-allowed opacity-50')}>
            Extra Private
            <span className="ml-1.5 rounded bg-[#262626] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-400">Soon</span>
          </button>
        </div>
      </div>

      {tab === 'nip17' ? (
        <div className="p-10 text-center text-sm text-neutral-500">Extra Private (NIP-17) messaging is coming soon.</div>
      ) : !canDM ? (
        <div className="p-10 text-center text-sm text-neutral-400">
          Your login method does not support NIP-04 messages. Log in with a browser extension, a remote signer
          (bunker), or a local signer to use direct messages.
        </div>
      ) : (
        <div className="flex h-[70vh]">
          {/* Conversation list */}
          <div className={cn('w-full flex-col border-r border-[#262626] lg:flex lg:w-72', active ? 'hidden lg:flex' : 'flex')}>
            <div className="border-b border-[#262626] p-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 border-[#262626]"
                disabled={decrypting || convoCount === 0}
                onClick={decryptEverything}
              >
                {decrypting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />} Decrypt all messages
              </Button>
            </div>
            {loadingHistory && convoCount === 0 ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-xs text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading conversations…
              </div>
            ) : (
              <ConversationList onSelect={openConversation} />
            )}
          </div>

          {/* Chat */}
          <div className={cn('min-w-0 flex-1', active ? 'flex' : 'hidden lg:flex')}>
            {active ? (
              <DmChatView pubkey={active} onBack={closeConversation} />
            ) : (
              <div className="m-auto px-6 text-center text-sm text-neutral-500">Select a conversation to start messaging.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
