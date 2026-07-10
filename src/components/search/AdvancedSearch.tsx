import { useState } from 'react'
import { SlidersHorizontal, Search } from 'lucide-react'
import { nip19, type Filter } from 'nostr-tools'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { KINDS } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { GameAutocomplete } from '@/components/shared/GameAutocomplete'
import { TagEditor, CategoryChainsEditor } from './ModFiltersBar'

interface AdvancedSearchProps {
  /** When set (game page), the Game field is prefilled and locked. */
  fixedGame?: string
  /** Whether an advanced query is currently active. */
  active: boolean
  onSearch: (filter: Filter) => void
  onClear: () => void
}

/**
 * Relay-side advanced search for mods. Builds a Nostr filter (#g / #t / #c /
 * authors) and runs it against relays, replacing the current listing.
 */
export function AdvancedSearch({ fixedGame, active, onSearch, onClear }: AdvancedSearchProps) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [game, setGame] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [author, setAuthor] = useState('')

  const submit = () => {
    const filter: Filter = { kinds: [KINDS.MOD] }

    const q = term.trim()
    if (q) filter.search = q

    const g = (fixedGame ?? game).trim()
    if (g) filter['#g'] = [g]

    const t = tags.map((x) => x.trim().toLowerCase()).filter(Boolean)
    if (t.length) filter['#t'] = t

    // Category chains query the rooted-prefix index `h` (subtree match): a query
    // for graphics›reshade returns that path and anything beneath it. Each chain
    // is encoded as a JSON segment-array, matching how mods store h tags.
    const h = categories
      .map((x) => x.split(':').map((s) => s.trim()).filter(Boolean))
      .filter((segs) => segs.length > 0)
      .map((segs) => JSON.stringify(segs))
    if (h.length) filter['#h'] = h

    const a = author.trim()
    if (a) {
      let pk = a
      if (a.startsWith('npub')) {
        try {
          const decoded = nip19.decode(a)
          pk = decoded.type === 'npub' ? (decoded.data as string) : ''
        } catch {
          pk = ''
        }
      }
      if (!/^[0-9a-f]{64}$/i.test(pk)) {
        toast.error('Invalid author npub')
        return
      }
      filter.authors = [pk]
    }

    // Require at least one criterion beyond a fixed (locked) game.
    const hasCriteria = !!q || (!fixedGame && g) || t.length > 0 || h.length > 0 || !!filter.authors
    if (!hasCriteria) {
      toast.error('Add at least one search criterion')
      return
    }

    onSearch(filter)
    setOpen(false)
  }

  const clear = () => {
    onClear()
    setTerm('')
    setGame('')
    setTags([])
    setCategories([])
    setAuthor('')
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Advanced live search"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-[#262626] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-[#404040] hover:text-purple-300',
          active && 'border-purple-500/50 text-purple-400',
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Advanced live search
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626] max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100">
              <Search className="h-5 w-5 text-purple-400" />
              Advanced search
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              Query relays directly. Results replace the current list.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1">
              <label className="text-xs text-neutral-400">Name / keyword</label>
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search by mod name or keyword"
                className="bg-[#212121] border-[#262626] text-white"
              />
              <p className="text-[11px] text-neutral-500">Full-text search on relays that support it (NIP-50); other relays are matched on this device.</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-400">Game</label>
              <GameAutocomplete
                value={fixedGame ?? game}
                onChange={setGame}
                disabled={!!fixedGame}
                placeholder="Type or search game name"
                className="bg-[#212121] border-[#262626] text-white disabled:opacity-70"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-400">Tags (matches any)</label>
              <TagEditor tags={tags} onChange={setTags} placeholder="Add a tag…" />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-400">Categories (exact chain)</label>
              <CategoryChainsEditor chains={categories} onChange={setCategories} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-neutral-400">Author (npub)</label>
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="npub1…"
                className="bg-[#212121] border-[#262626] text-white font-mono text-sm"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {active && (
              <Button variant="outline" onClick={clear} className="border-[#262626]">
                Clear search
              </Button>
            )}
            <Button onClick={submit} className="bg-purple-600 hover:bg-purple-700">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
