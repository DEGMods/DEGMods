import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Gavel } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { signAndPublish } from '@/lib/nostr/publish'
import {
  buildBallotEvent, ballotCriteria, OVERALL_CRITERION,
  type JamBallot, type JamBallotFormState,
} from '@/lib/nostr/jamVoting'
import type { JamDetails } from '@/lib/nostr/jam'

/**
 * The scoring dialog for one jam entry. In `readOnly` mode it shows a previously
 * cast ballot (no edit for now); otherwise it's a fresh ballot the voter fills and
 * publishes to the jam's relays + their own.
 */
export function JamVoteModal({
  open,
  onOpenChange,
  jam,
  submissionCoordinate,
  submissionDTag,
  submissionTitle,
  existingBallot,
  readOnly = false,
  onVoted,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  jam: JamDetails
  submissionCoordinate: string
  submissionDTag: string
  submissionTitle: string
  existingBallot?: JamBallot | null
  readOnly?: boolean
  onVoted?: (ballot: JamBallot) => void
}) {
  const criteria = useMemo(() => ballotCriteria(jam), [jam])
  const isSingle = criteria.length === 1 && criteria[0].label === OVERALL_CRITERION

  const initialScores = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of criteria) {
      const prev = existingBallot?.scores.find((s) => s.criterion === c.label)?.value
      map[c.label] = prev ?? Math.round(c.max / 2)
    }
    return map
  }, [criteria, existingBallot])

  const [scores, setScores] = useState<Record<string, number>>(initialScores)
  const [comment, setComment] = useState(existingBallot?.comment ?? '')
  const [publishing, setPublishing] = useState(false)

  const setScore = (label: string, v: number) => setScores((p) => ({ ...p, [label]: v }))

  const publish = async () => {
    setPublishing(true)
    try {
      const form: JamBallotFormState = {
        jamCoordinate: jam.aTag,
        jamDTag: jam.dTag,
        submissionCoordinate,
        submissionDTag,
        scores: criteria.map((c) => ({ criterion: c.label, value: scores[c.label] ?? 0 })),
        comment,
      }
      const result = await signAndPublish(
        buildBallotEvent(form),
        (status) => {
          if (status === 'mining') toast.loading('Processing proof of work…', { id: 'ballot' })
          if (status === 'signing') toast.loading('Signing your vote…', { id: 'ballot' })
          if (status === 'publishing') toast.loading('Publishing your vote…', { id: 'ballot' })
        },
        10000,
        jam.relays,
      )
      if (!result.success || !result.event) throw new Error(result.error || 'Failed to publish')
      toast.success('Your vote is in!', { id: 'ballot' })
      const cast: JamBallot = {
        id: result.event.id,
        pubkey: result.event.pubkey,
        dTag: result.event.tags.find((t) => t[0] === 'd')?.[1] ?? '',
        createdAt: result.event.created_at,
        jamCoordinate: jam.aTag,
        submissionCoordinate,
        scores: form.scores,
        comment: comment.trim(),
      }
      onVoted?.(cast)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Vote failed', { id: 'ballot' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#262626] bg-[#1a1a1a] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Gavel className="h-4 w-4 text-[#fc4462]" />
            {readOnly ? 'Your vote' : 'Score this entry'}
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            <span className="font-medium text-neutral-300">{submissionTitle}</span> · {jam.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {criteria.map((c) => (
            <div key={c.label} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-300">{isSingle ? 'Overall score' : c.label}</span>
                <span className="tabular-nums font-semibold text-[#fc4462]">{scores[c.label] ?? 0}<span className="text-neutral-600"> / {c.max}</span></span>
              </div>
              <Slider
                min={0}
                max={c.max}
                step={1}
                value={[scores[c.label] ?? 0]}
                onValueChange={([v]) => setScore(c.label, v)}
                disabled={readOnly}
              />
            </div>
          ))}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-400">Comment <span className="text-neutral-600">(optional)</span></label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="A quick note on your scoring…"
              className="border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500"
              disabled={readOnly}
            />
          </div>
        </div>

        <DialogFooter>
          {readOnly ? (
            <Button variant="outline" className="border-[#262626]" onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <Button onClick={publish} disabled={publishing} className="gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56]">
              {publishing ? <><Loader2 className="h-4 w-4 animate-spin" /> Publishing…</> : 'Submit vote'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
