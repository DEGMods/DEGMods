import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MessagesSquare, Loader2, RefreshCw, Settings, ListFilter } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWotStore } from '@/stores/wotStore'
import { useBlockStore } from '@/stores/blockStore'
import { useFollowedSet } from '@/hooks/useFollowedSet'
import type { Event as NostrEvent } from 'nostr-tools'
import type { DownloadEntry } from '@/types/mod'
import {
  fetchComments,
  buildCommentTree,
  countComments,
  findCommentPath,
  type CommentNode,
  type NostrTarget,
} from '@/lib/nostr/social'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { CommentForm } from './CommentForm'
import { Comment } from './Comment'
import { CommentThreadModal } from './CommentThreadModal'
import { CommentFilters, DEFAULT_COMMENT_FILTERS, type CommentFilterState } from './CommentFilters'

interface CommentSectionProps {
  root: NostrTarget
  /** When set (e.g. arriving from a notification), scroll here and open the
   *  thread modal focused on this comment id. */
  focusCommentId?: string | null
  /** The mod's downloads — enables the download-snapshot option on top-level comments. */
  modDownloads?: DownloadEntry[]
}

export function CommentSection({ root, focusCommentId, modDownloads }: CommentSectionProps) {
  const defaultPow = useSettingsStore(s => s.powFilterDifficulty)
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const minPow = defaultPow // PoW filter is adjusted in Settings now, not inline
  const [threadFocusId, setThreadFocusId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<CommentFilterState>(DEFAULT_COMMENT_FILTERS)
  const activeFilterCount = filters.authorOnly ? 1 : 0
  const sectionRef = useRef<HTMLElement>(null)
  const handledFocusRef = useRef<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const closeThread = useCallback(() => {
    setThreadFocusId(null)
    // Drop the deep-link param so a refresh / share doesn't reopen the modal.
    if (searchParams.has('c')) {
      const next = new URLSearchParams(searchParams)
      next.delete('c')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const load = useCallback(async (isRefresh = false) => {
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const fetched = await fetchComments(relays, root)
      setEvents(fetched)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root.id])

  useEffect(() => { load() }, [load])

  // Refetch shortly after publishing so the new event has propagated.
  const handlePublished = useCallback(() => {
    setTimeout(() => load(true), 1200)
  }, [load])

  const followed = useFollowedSet()
  const powTree = useMemo(() => buildCommentTree(events, minPow, followed), [events, minPow, followed])

  // Hide comments/replies from low-trust (Web of Trust) or blocked users.
  const wotApply = useWotStore((s) => s.settings.applyComments)
  const wotThreshold = useWotStore((s) => s.settings.scoreThreshold)
  const wotDepth = useWotStore((s) => s.settings.followDepth)
  const wotUpdated = useWotStore((s) => s.lastUpdated)
  const blocked = useBlockStore((s) => s.blockedPubkeys)
  const tree = useMemo(() => {
    const shouldHide = useWotStore.getState().shouldHide
    const hide = (pubkey: string) =>
      blocked.has(pubkey) || (wotApply && shouldHide(pubkey, 'comments'))
    const prune = (nodes: CommentNode[]): CommentNode[] =>
      nodes
        .filter((n) => !hide(n.event.pubkey))
        .map((n) => ({ ...n, replies: prune(n.replies) }))
    return prune(powTree)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [powTree, blocked, wotApply, wotThreshold, wotDepth, wotUpdated])

  // Apply view filters. "Author only" shows just the post author's top-level
  // comments, without their reply threads.
  const displayTree = useMemo(() => {
    if (!filters.authorOnly) return tree
    return tree
      .filter((n) => n.event.pubkey === root.pubkey)
      .map((n) => ({ ...n, replies: [] as CommentNode[] }))
  }, [tree, filters.authorOnly, root.pubkey])

  const total = useMemo(() => countComments(displayTree), [displayTree])

  // Arriving from a notification: once the target comment is in the tree, scroll
  // here and open the thread modal focused on it (seeded with its ancestry).
  useEffect(() => {
    if (!focusCommentId || loading) return
    if (handledFocusRef.current === focusCommentId) return
    if (!findCommentPath(tree, focusCommentId)) return
    handledFocusRef.current = focusCommentId
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setThreadFocusId(focusCommentId)
  }, [focusCommentId, loading, tree])

  return (
    <section ref={sectionRef} className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-200">
          <MessagesSquare className="h-5 w-5 text-purple-400" />
          Comments
          {!loading && <span className="text-sm font-normal text-neutral-500">({total})</span>}
        </h2>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setFiltersOpen(true)}
                className="relative text-neutral-400 hover:text-neutral-200"
                aria-label="Comment filters"
              >
                <ListFilter className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-600 px-1 text-[10px] font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Filter comments</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon" className="text-neutral-400 hover:text-neutral-200">
                <Link to="/settings?tab=preferences" aria-label="Filter settings">
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Adjust content filters in Settings</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => load(true)}
            disabled={refreshing}
            className="text-neutral-400 hover:text-neutral-200"
            aria-label="Refresh comments"
          >
            <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      {/* New top-level comment */}
      <div className="rounded-lg bg-[#1c1c1c] p-4 shadow-md shadow-black/20">
        <CommentForm root={root} modDownloads={modDownloads} onPublished={handlePublished} />
      </div>

      {/* Thread */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        </div>
      ) : displayTree.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          {filters.authorOnly
            ? 'No comments from the author yet.'
            : 'No comments yet. Be the first to comment.'}
        </p>
      ) : (
        <div className="space-y-6">
          {displayTree.map(node => (
            <Comment
              key={node.event.id}
              node={node}
              root={root}
              onReplyPublished={handlePublished}
              onOpenThread={setThreadFocusId}
            />
          ))}
        </div>
      )}

      <CommentThreadModal
        open={threadFocusId !== null}
        onOpenChange={(o) => { if (!o) closeThread() }}
        tree={tree}
        focusId={threadFocusId}
        root={root}
        onReplyPublished={handlePublished}
      />

      <CommentFilters
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onChange={setFilters}
      />
    </section>
  )
}
