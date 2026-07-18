import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronDown, Check } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { signAndPublish } from '@/lib/nostr/publish'
import {
  buildBallotEvent, ballotCriteria, OVERALL_CRITERION,
  type JamBallot, type JamBallotFormState,
} from '@/lib/nostr/jamVoting'
import type { JamDetails } from '@/lib/nostr/jam'
import { cn } from '@/lib/utils'

// A foreign client could declare a far larger scale than the spec's 2–100, and
// rendering one option per point would then hang the browser. Cap what we draw.
const MAX_RENDERED_SCORE = 100
// Past this, a row of buttons stops being scannable — use a dropdown instead.
const BUTTON_SCALE_MAX = 20

/**
 * Pick a score from 0…max. Discrete options rather than a slider: a slider has a
 * position before you touch it, so an indifferent voter submits a real score
 * without choosing one. Here nothing is selected until it's chosen.
 */
function ScorePicker({ max, value, onChange, disabled }: {
  max: number
  value: number | null
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const top = Math.min(max, MAX_RENDERED_SCORE)
  const options = useMemo(() => Array.from({ length: top + 1 }, (_, i) => i), [top])

  if (top <= BUTTON_SCALE_MAX) {
    return (
      <div className="flex flex-wrap gap-1">
        {options.map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            className={cn(
              'h-8 min-w-8 rounded-md border px-2 text-xs font-medium tabular-nums transition-colors',
              value === n
                ? 'border-[#fc4462] bg-[#fc4462] text-white'
                : 'border-[#262626] bg-[#212121] text-neutral-300 hover:border-[#404040] hover:text-white',
              disabled && 'cursor-not-allowed opacity-60 hover:border-[#262626]',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'group inline-flex w-full items-center justify-between rounded-lg border border-[#262626] bg-[#212121] px-3 py-2 text-sm transition-colors hover:border-[#404040] focus:outline-none',
            value === null ? 'text-neutral-500' : 'text-neutral-200',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          {value === null ? 'Select a score…' : `${value} / ${top}`}
          <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto border-[#262626] bg-[#1c1c1c]">
        {options.map((n) => (
          <DropdownMenuItem key={n} onClick={() => onChange(n)} className="cursor-pointer justify-between gap-6 tabular-nums text-neutral-200">
            {n}
            {value === n && <Check className="h-4 w-4 text-[#fc4462]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
  // Only relevant for a malformed jam declaring more than the spec's 2–100.
  const clamped = criteria.some((c) => c.max > MAX_RENDERED_SCORE)

  // Nothing is pre-selected — an unscored criterion stays null until picked, so a
  // voter can't submit a score they never chose.
  const initialScores = useMemo(() => {
    const map: Record<string, number | null> = {}
    for (const c of criteria) {
      map[c.label] = existingBallot?.scores.find((s) => s.criterion === c.label)?.value ?? null
    }
    return map
  }, [criteria, existingBallot])

  const [scores, setScores] = useState<Record<string, number | null>>(initialScores)
  const [publishing, setPublishing] = useState(false)

  const setScore = (label: string, v: number) => setScores((p) => ({ ...p, [label]: v }))
  const allScored = criteria.every((c) => scores[c.label] != null)

  const publish = async () => {
    if (!allScored) return
    setPublishing(true)
    try {
      const form: JamBallotFormState = {
        jamCoordinate: jam.aTag,
        jamDTag: jam.dTag,
        submissionCoordinate,
        submissionDTag,
        scores: criteria.map((c) => ({ criterion: c.label, value: scores[c.label] as number })),
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
        comment: '',
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
      <DialogContent className="max-h-[85vh] overflow-y-auto border-[#262626] bg-[#1a1a1a] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {readOnly ? 'Your vote' : 'Score this entry'}
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            <span className="font-medium text-neutral-300">{submissionTitle}</span> · {jam.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {criteria.map((c) => {
            const value = scores[c.label] ?? null
            return (
              <div key={c.label} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-300">{isSingle ? 'Overall score' : c.label}</span>
                  <span className="tabular-nums font-semibold text-[#fc4462]">
                    {value ?? '—'}<span className="text-neutral-600"> / {Math.min(c.max, MAX_RENDERED_SCORE)}</span>
                  </span>
                </div>
                <ScorePicker max={c.max} value={value} onChange={(v) => setScore(c.label, v)} disabled={readOnly} />
              </div>
            )
          })}

          {clamped && !readOnly && (
            <p className="text-[11px] text-amber-400/90">
              This jam declares a scale above the 0–{MAX_RENDERED_SCORE} maximum, so scoring is capped here.
            </p>
          )}
          {!readOnly && !allScored && (
            <p className="text-[11px] text-neutral-500">Pick a score for every criterion to submit your vote.</p>
          )}
        </div>

        <DialogFooter>
          {readOnly ? (
            <Button variant="outline" className="border-[#262626]" onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <Button onClick={publish} disabled={publishing || !allScored} className="gap-2 bg-[#fc4462] text-white hover:bg-[#e23a56] disabled:opacity-50">
              {publishing ? <><Loader2 className="h-4 w-4 animate-spin" /> Publishing…</> : 'Submit vote'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
