import { useEffect, useState } from 'react'
import { MessageSquare, Lock, Info, Loader2, Eye, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useDMStore } from '@/stores/dmStore'
import { useDM17Store } from '@/stores/dm17Store'
import { signerSupportsDM } from '@/lib/nostr/dm'
import { signerSupportsNip17 } from '@/lib/nostr/nip17'
import { ConversationList } from './ConversationList'
import { DmChatView } from './DmChatView'
import type { DMStoreHook } from './store'

type Tab = 'nip04' | 'nip17'

const tabCls = (active: boolean) =>
  cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', active ? 'bg-[#262626] text-white' : 'text-neutral-400 hover:text-neutral-200')

/** Shared list + chat pane for one protocol. `topExtra` is the NIP-17 first-layer banner. */
function DMPane({ useStore, onDecryptAll, decryptingAll, topExtra, onSwitch, switchLabel }: {
  useStore: DMStoreHook
  onDecryptAll: () => void
  decryptingAll: boolean
  topExtra?: React.ReactNode
  onSwitch: (pubkey: string) => void
  switchLabel: string
}) {
  const active = useStore((s) => s.active)
  const openConversation = useStore((s) => s.openConversation)
  const closeConversation = useStore((s) => s.closeConversation)
  const cancelBatchDecrypt = useStore((s) => s.cancelBatchDecrypt)
  const convoCount = useStore((s) => Object.keys(s.conversations).length)

  return (
    <div className="flex flex-col">
      {topExtra}
      <div className="flex h-[70vh] overflow-hidden">
        <div className={cn('w-full flex-col border-r border-[#262626] lg:flex lg:w-72', active ? 'hidden lg:flex' : 'flex')}>
          <div className="border-b border-[#262626] p-2">
            <Button size="sm" variant="outline" className="w-full gap-1.5 border-[#262626]" disabled={!decryptingAll && convoCount === 0} onClick={decryptingAll ? () => cancelBatchDecrypt() : onDecryptAll}>
              {decryptingAll ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancel</> : <><Lock className="h-3.5 w-3.5" /> Decrypt all messages</>}
            </Button>
          </div>
          <ConversationList useStore={useStore} onSelect={(pk) => { void openConversation(pk) }} />
        </div>
        <div className={cn('min-w-0 flex-1', active ? 'flex' : 'hidden lg:flex')}>
          {active
            ? <DmChatView key={active} useStore={useStore} pubkey={active} onBack={closeConversation} onSwitch={onSwitch} switchLabel={switchLabel} />
            : <div className="m-auto px-6 text-center text-sm text-neutral-500">Select a conversation to start messaging.</div>}
        </div>
      </div>
    </div>
  )
}

/** The NIP-17 first-layer banner: peel encrypted wraps one signer request at a time. */
function FirstLayerBanner() {
  const activeCount = useDM17Store((s) => Object.values(s.pending).filter((p) => !p.failed).length)
  const peeling = useDM17Store((s) => s.peeling)
  const progress = useDM17Store((s) => s.peelProgress)
  const stopped = useDM17Store((s) => s.peelStopped)
  const decryptFirstLayerAll = useDM17Store((s) => s.decryptFirstLayerAll)
  const cancelFirstLayer = useDM17Store((s) => s.cancelFirstLayer)
  if (activeCount === 0 && !peeling) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#262626] bg-[#212121] p-3">
      <Lock className="h-4 w-4 shrink-0 text-purple-400" />
      <div className="min-w-0 flex-1 text-sm text-neutral-300">
        {peeling
          ? <>Revealing senders… {progress.done} / {progress.total}</>
          : <><span className="font-medium text-white">{activeCount}</span> message{activeCount === 1 ? '' : 's'} with undecrypted first layers{stopped ? ' — canceled' : ''}</>}
      </div>
      {peeling ? (
        <Button size="sm" variant="outline" className="gap-1.5 border-[#262626]" onClick={() => cancelFirstLayer()}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancel
        </Button>
      ) : (
        <Button size="sm" onClick={() => void decryptFirstLayerAll()} className="gap-1.5 bg-purple-600 text-white hover:bg-purple-700">
          <Eye className="h-3.5 w-3.5" /> Decrypt all first layers
        </Button>
      )}
    </div>
  )
}

function Unsupported() {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-neutral-400">
      <ShieldQuestion className="h-6 w-6 text-neutral-500" />
      Your login method does not support these messages. Log in with a browser extension, a remote
      signer (bunker), or a local signer to use them.
    </div>
  )
}

export function DirectMessagesView() {
  const [tab, setTab] = useState<Tab>('nip04')
  const [decrypting04, setDecrypting04] = useState(false)
  const [decrypting17, setDecrypting17] = useState(false)
  const decryptAll04 = useDMStore((s) => s.decryptAll)
  const decryptAll17 = useDM17Store((s) => s.decryptAll)
  const canDM = signerSupportsDM()
  const canDM17 = signerSupportsNip17()

  // Opening this view is the user seeing that undecrypted wraps exist. Peeling
  // them costs a signer prompt each, so they may reasonably never decrypt them —
  // the dot must still clear, or it can never be cleared at all.
  useEffect(() => { useDM17Store.getState().ackPending() })

  const run = (fn: () => Promise<void>, setter: (b: boolean) => void) => async () => {
    setter(true)
    try { await fn() } finally { setter(false) }
  }

  // Jump to the same conversation on the other protocol.
  const switchToNip17 = (pk: string) => { void useDM17Store.getState().openConversation(pk); setTab('nip17') }
  const switchToNip04 = (pk: string) => { void useDMStore.getState().openConversation(pk); setTab('nip04') }

  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c]">
      {/* Header: title + tabs + tooltips */}
      <div className="border-b border-[#262626] p-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Direct Messages</h2>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-neutral-500 transition-colors hover:text-neutral-300" aria-label="About message privacy"><Info className="h-4 w-4" /></button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                <p><span className="font-semibold text-purple-300">Private (NIP-04):</span> the message text is end-to-end encrypted, but relays can still see who you are talking to and when.</p>
                <p className="mt-1.5"><span className="font-semibold text-purple-300">Extra Private (NIP-17):</span> gift-wrapped so that even the metadata (who and when) is hidden. Each message hides its sender until you decrypt its first layer.</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-neutral-500 transition-colors hover:text-neutral-300" aria-label="About seen state"><Eye className="h-4 w-4" /></button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                <p>A <span className="font-semibold text-purple-300">purple</span> dot means new messages. Opening a chat stretches your &ldquo;seen&rdquo; range; chats inside it you didn&rsquo;t open show a <span className="font-semibold text-neutral-300">gray</span> dot.</p>
                <p className="mt-1.5">On Extra Private, senders are hidden until you &ldquo;Decrypt all first layers&rdquo;; that runs one signer request at a time and stops if you decline.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setTab('nip04')} className={tabCls(tab === 'nip04')}>Private</button>
          <button onClick={() => setTab('nip17')} className={tabCls(tab === 'nip17')}>Extra Private</button>
        </div>
      </div>

      {tab === 'nip04'
        ? (!canDM ? <Unsupported /> : <DMPane useStore={useDMStore as unknown as DMStoreHook} onDecryptAll={run(decryptAll04, setDecrypting04)} decryptingAll={decrypting04} onSwitch={switchToNip17} switchLabel="Extra Private" />)
        : (!canDM17 ? <Unsupported /> : <DMPane useStore={useDM17Store as unknown as DMStoreHook} onDecryptAll={run(decryptAll17, setDecrypting17)} decryptingAll={decrypting17} topExtra={<FirstLayerBanner />} onSwitch={switchToNip04} switchLabel="Private" />)}
    </div>
  )
}
