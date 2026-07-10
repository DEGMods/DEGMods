import { useState } from 'react'
import { Flag, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { buildReportEvent, type ReportType } from '@/lib/nostr/events'
import { signAndPublish } from '@/lib/nostr/publish'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { DEFAULT_MIN_POW } from '@/stores/modFiltersStore'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'

const TYPES: { value: ReportType; label: string }[] = [
  { value: 'nsfw', label: 'NSFW' },
  { value: 'malware', label: 'Malware' },
  { value: 'illegal', label: 'Illegal' },
  { value: 'spam', label: 'Spam' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other' },
]

export interface ReportTarget {
  eventId: string
  coord: string
  kind: number
  authorPubkey: string
  title?: string
  /** Blossom blob hashes from the post's downloads, for malware reports. */
  hashes?: string[]
}

export function ReportDialog({
  open, onOpenChange, target, pubkey,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** A post (mod/blog) to report — enables the post/author toggle. */
  target?: ReportTarget
  /** Person-only report (e.g. from a user card) — no toggle. */
  pubkey?: string
}) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const pow = useSettingsStore((s) => s.powDifficulty)

  const personOnly = !target
  const reportedPubkey = target?.authorPubkey ?? pubkey ?? ''

  const [mode, setMode] = useState<'post' | 'author'>(personOnly ? 'author' : 'post')
  const [type, setType] = useState<ReportType>('nsfw')
  const [comment, setComment] = useState('')
  const [hashes, setHashes] = useState<string[]>([])
  const [publishing, setPublishing] = useState(false)

  const malware = type === 'malware'
  const showHashPicker = malware && mode === 'post' && (target?.hashes?.length ?? 0) > 0

  const toggleHash = (h: string) => setHashes((prev) => prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h])

  const submit = async () => {
    if (!myPubkey) { toast.error('Log in to report'); return }
    setPublishing(true)
    try {
      const event = (mode === 'post' && target)
        ? buildReportEvent({ type, comment, pubkey: target.authorPubkey, eventId: target.eventId, coord: target.coord, kind: target.kind, malwareHashes: showHashPicker ? hashes : undefined })
        : buildReportEvent({ type, comment, pubkey: reportedPubkey })
      const res = await signAndPublish(event)
      if (!res.success) throw new Error(res.error)
      toast.success('Report submitted')
      onOpenChange(false)
      setComment(''); setHashes([]); setType('nsfw'); setMode(personOnly ? 'author' : 'post')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit report')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1c1c1c] border-[#262626]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-100">
            <Flag className="h-5 w-5 text-purple-400" /> {personOnly ? 'Report user' : 'Report'}
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            Reports are public Nostr events (NIP-56) that moderators can review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Target (only when reporting a post, which can also target its author) */}
          {!personOnly && (
            <div className="grid grid-cols-2 gap-2">
              {([['post', 'This mod'], ['author', 'The author']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setMode(v)}
                  className={cn('rounded-lg border px-3 py-2 text-sm transition-colors',
                    mode === v ? 'border-purple-500/50 bg-purple-500/10 text-neutral-100' : 'border-[#262626] text-neutral-400 hover:border-[#404040]')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Type */}
          <div>
            <p className="mb-1.5 text-xs text-neutral-400">Reason</p>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    type === t.value ? 'border-purple-500/50 bg-purple-500/15 text-purple-300' : 'border-[#262626] text-neutral-400 hover:border-[#404040]')}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Malware hash picker */}
          {showHashPicker && (
            <div>
              <p className="mb-1.5 text-xs text-neutral-400">Affected file hashes</p>
              <div className="space-y-1.5">
                {(target?.hashes ?? []).map((h) => {
                  const on = hashes.includes(h)
                  return (
                    <div
                      key={h}
                      className={cn('flex items-center justify-between gap-2.5 rounded-md border px-2.5 py-2 transition-colors',
                        on ? 'border-purple-500/50 bg-purple-500/10' : 'border-[#262626] bg-[#212121]')}
                    >
                      <span className={cn('truncate font-mono text-[11px]', on ? 'text-neutral-200' : 'text-neutral-400')}>{h}</span>
                      <Switch checked={on} onCheckedChange={() => toggleHash(h)} className="shrink-0" />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* PoW notice + comment */}
          <div>
            <p className="mb-1 text-[11px] text-neutral-500">
              pow: <span className="font-mono text-neutral-300">{pow}</span>
              {pow < DEFAULT_MIN_POW && (
                <span className="ml-2 text-yellow-500/90">
                  ⚠ below the default ({DEFAULT_MIN_POW}) — moderators may not see this report.
                </span>
              )}
            </p>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment (optional)"
              rows={3}
              className="bg-[#212121] border-[#262626] text-white resize-none"
            />
          </div>

          {malware && mode === 'post' && (target?.hashes?.length ?? 0) === 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-neutral-500">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-yellow-500" />
              This mod has no Blossom-hosted files with hashes to attach.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[#262626]">Cancel</Button>
          <Button onClick={submit} disabled={publishing} className="bg-purple-600 hover:bg-purple-700">
            {publishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Flag className="h-4 w-4 mr-2" />}
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
