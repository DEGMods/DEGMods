import { useState, useMemo } from 'react'
import { Copy, Check, ArrowLeftRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useDnnStore } from '@/stores/dnnStore'
import { formatDnnId } from '@/lib/dnn/formatDnnId'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface IdentityLineProps {
  pubkey: string
  npub: string
  nip05?: string
}

/**
 * One identity line merging npub / NIP-05 / DNN ID, with a switch button to
 * cycle between them and a copy button. Defaults to npub, or the DNN ID when
 * the user has one that's verified.
 */
export function IdentityLine({ pubkey, npub, nip05 }: IdentityLineProps) {
  const verifiedDnnId = useDnnStore((s) => s.getVerifiedDnnId(pubkey))
  const [index, setIndex] = useState(0)
  const [copied, setCopied] = useState(false)

  const items = useMemo(() => {
    const out: { kind: 'dnn' | 'npub' | 'nip05'; display: string; copy: string }[] = []
    if (verifiedDnnId) {
      const pretty = formatDnnId(verifiedDnnId)
      out.push({ kind: 'dnn', display: pretty, copy: pretty })
    }
    out.push({ kind: 'npub', display: `${npub.slice(0, 12)}…${npub.slice(-6)}`, copy: npub })
    if (nip05 && nip05.includes('@')) out.push({ kind: 'nip05', display: nip05, copy: nip05 })
    return out
  }, [verifiedDnnId, npub, nip05])

  const current = items[Math.min(index, items.length - 1)]

  const copy = () => {
    navigator.clipboard.writeText(current.copy)
    setCopied(true)
    toast.success('Copied')
    setTimeout(() => setCopied(false), 1500)
  }
  const cycle = () => setIndex((i) => (i + 1) % items.length)

  return (
    <div className="flex items-center gap-2 rounded-lg bg-[#212121] px-2 py-1">
      <span className={cn('min-w-0 flex-1 truncate font-mono text-sm', current.kind === 'npub' ? 'text-neutral-400' : 'text-purple-400')}>
        {current.display}
      </span>
      {items.length > 1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={cycle} className="shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-[#2a2a2a] hover:text-neutral-200" aria-label="Switch ID">
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Switch ID</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={copy} className="shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-[#2a2a2a] hover:text-purple-400" aria-label="Copy">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
      </Tooltip>
    </div>
  )
}
