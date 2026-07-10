import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PaginationProps {
  page: number
  totalPages: number
  onPage: (p: number) => void
  /** False while older items may still be fetched (keeps "next" enabled). */
  reachedEnd?: boolean
  loadingMore?: boolean
}

/** Numbered pagination with ellipses; grows as more items are progressively loaded. */
export function Pagination({ page, totalPages, onPage, reachedEnd = true, loadingMore }: PaginationProps) {
  const currentPage = Math.min(page, totalPages)

  const nums = useMemo(() => {
    const out: (number | 'ellipsis')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) out.push(i)
    } else {
      out.push(1)
      if (currentPage > 3) out.push('ellipsis')
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) out.push(i)
      if (currentPage < totalPages - 2) out.push('ellipsis')
      out.push(totalPages)
    }
    return out
  }, [currentPage, totalPages])

  if (totalPages <= 1 && !loadingMore) return null

  const nextDisabled = currentPage >= totalPages && reachedEnd

  return (
    <div className="pt-4">
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => onPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className={cn('p-2 rounded-lg transition-colors', currentPage <= 1 ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-400 hover:bg-[#2a2a2a]')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {nums.map((n, i) =>
            n === 'ellipsis' ? (
              <span key={`e${i}`} className="px-1 text-sm text-neutral-600">…</span>
            ) : (
              <button
                key={n}
                onClick={() => onPage(n)}
                className={cn(
                  'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
                  n === currentPage ? 'bg-purple-600 text-white' : 'text-neutral-400 hover:bg-[#2a2a2a]',
                )}
              >
                {n}
              </button>
            )
          )}

          <button
            onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
            disabled={nextDisabled}
            className={cn('p-2 rounded-lg transition-colors', nextDisabled ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-400 hover:bg-[#2a2a2a]')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {loadingMore && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading more…
        </div>
      )}
    </div>
  )
}
