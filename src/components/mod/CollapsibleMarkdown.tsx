import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/shared/Markdown'

const COLLAPSED_MAX = 600

function ShowButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#262626] bg-[#212121] p-3 text-xs font-medium text-neutral-200 shadow-sm transition-colors hover:bg-[#2a2a2a]"
    >
      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      {expanded ? 'Show less' : 'Show full'}
    </button>
  )
}

/**
 * Markdown body that collapses past ~600px with a "Show full" / "Show less"
 * toggle. When expanded, the collapse button sticks to the top of the box as you
 * scroll, so you can always close it.
 */
export function CollapsibleMarkdown({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const [collapsible, setCollapsible] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const check = () => setCollapsible(el.scrollHeight > COLLAPSED_MAX + 40)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [content])

  return (
    <div className="rounded-lg bg-[#1c1c1c] p-5 shadow-md shadow-black/20">
      <div className="relative">
        <div ref={contentRef} className={cn(collapsible && !expanded && 'max-h-[600px] overflow-hidden')}>
          <Markdown content={content} />
        </div>
        {collapsible && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#1c1c1c] to-transparent" />
        )}
      </div>

      {collapsible && !expanded && (
        <div className="mt-3">
          <ShowButton expanded={false} onClick={() => setExpanded(true)} />
        </div>
      )}
      {collapsible && expanded && (
        <div className="sticky bottom-4 z-10 mt-3">
          <ShowButton expanded onClick={() => setExpanded(false)} />
        </div>
      )}
    </div>
  )
}
