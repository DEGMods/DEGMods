import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { EmbedInfo } from '@/lib/embeds'

/**
 * Universal iframe embed renderer (ported from DEN Chat). Layout modes:
 *   video    — 16:9 (YouTube, Twitch, Kick)
 *   vertical — portrait, fixed height (TikTok)
 *   compact  — fixed short height, full width (Spotify, Steam)
 *   card     — Twitter, which reports its height via postMessage
 */
export function LinkEmbed({ embed }: { embed: EmbedInfo }) {
  const { layout, height } = embed
  const isCard = layout === 'card'
  const isCompact = layout === 'compact'
  const isVertical = layout === 'vertical'

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const [measureTimedOut, setMeasureTimedOut] = useState(false)

  useEffect(() => {
    if (!isCard) return
    type ResizeMsg = { method?: string; params?: Array<{ height?: number; data?: { height?: number } }> }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      let raw: unknown = e.data
      if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { return } }
      if (!raw || typeof raw !== 'object') return
      const obj = raw as Record<string, unknown>
      const payload = (obj['twttr.embed'] ?? obj) as ResizeMsg
      if (payload.method !== 'twttr.private.resize') return
      const p = payload.params?.[0]
      const h = typeof p?.height === 'number' ? p.height : (typeof p?.data?.height === 'number' ? p.data.height : null)
      if (h && h > 0) setMeasuredHeight(Math.ceil(h))
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => setMeasureTimedOut(true), 2500)
    return () => { window.removeEventListener('message', onMessage); clearTimeout(timer) }
  }, [isCard])

  const collapsedHeight = height ?? 250
  const autoFit = isCard && measuredHeight !== null
  const showToggle = isCard && measuredHeight === null && measureTimedOut

  const effectiveHeight = !isCard
    ? height
    : autoFit
      ? measuredHeight! + 4
      : (expanded ? Math.max(collapsedHeight * 3, 720) : collapsedHeight)

  return (
    <div style={{ width: isVertical ? 325 : undefined, maxWidth: isVertical ? 325 : undefined }}>
      <div
        className={`overflow-hidden rounded-lg ${isCard ? 'border border-[#262626]' : ''}`}
        style={{ aspectRatio: layout === 'video' ? '16/9' : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        <iframe
          ref={iframeRef}
          src={embed.src}
          title={embed.title}
          allow={embed.allow || undefined}
          allowFullScreen
          scrolling={autoFit ? 'no' : undefined}
          className="w-full border-0"
          style={{
            height: (isCard || isCompact || isVertical) && effectiveHeight ? effectiveHeight : undefined,
            ...(layout === 'video' ? { height: '100%' } : {}),
          }}
          sandbox={embed.sandbox || undefined}
          loading={isCard ? 'lazy' : undefined}
        />
      </div>

      {showToggle && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
          className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          {expanded
            ? <><ChevronUp size={12} /> Shrink preview</>
            : <><ChevronDown size={12} /> View full preview</>}
        </button>
      )}
    </div>
  )
}
