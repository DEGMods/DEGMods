import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { detectEmbed, type EmbedInfo } from '@/lib/embeds'
import { SafeImage } from '@/components/shared/SafeImage'
import { EmbeddedNote, type EmbedRef } from './EmbeddedNote'
import { LinkEmbed } from './LinkEmbed'

const LINK_EMBED_LIMIT = 4

/**
 * Renders a Nostr note's text with inline media, clickable links, profile
 * mentions, and one embedded quoted event. Consecutive images group into a grid
 * with a gallery lightbox. Media is detected from content URLs (including
 * extensionless blossom-style hash URLs) and NIP-92 `imeta` attachments.
 */

const TOKEN_RE = /(https?:\/\/[^\s]+)|(?:nostr:)?(note1[0-9a-z]+|nevent1[0-9a-z]+|naddr1[0-9a-z]+|nprofile1[0-9a-z]+|npub1[0-9a-z]+)/gi
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?[^\s]*)?$/i
const AUDIO_RE = /\.(mp3|ogg|wav|m4a|flac|aac)(\?[^\s]*)?$/i

type MediaKind = 'image' | 'video' | 'audio' | 'link'
type Block =
  | { type: 'text'; parts: ReactNode[] }
  | { type: 'images'; urls: string[] }
  | { type: 'video'; url: string }
  | { type: 'audio'; url: string }
  | { type: 'embed'; ref: EmbedRef }
  | { type: 'linkembed'; info: EmbedInfo }

function parseImeta(event: NostrEvent): Map<string, string> {
  const map = new Map<string, string>()
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue
    let url = ''
    let mime = ''
    for (let i = 1; i < tag.length; i++) {
      const sp = tag[i].indexOf(' ')
      if (sp < 0) continue
      const key = tag[i].slice(0, sp)
      if (key === 'url') url = tag[i].slice(sp + 1)
      else if (key === 'm') mime = tag[i].slice(sp + 1)
    }
    if (url) map.set(url, mime)
  }
  return map
}

function lastSegment(url: string): string {
  try { return (new URL(url).pathname.split('/').pop() || '').toLowerCase() } catch { return '' }
}

function classify(url: string, mime?: string): MediaKind {
  if (mime) {
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
  }
  if (IMAGE_RE.test(url)) return 'image'
  if (VIDEO_RE.test(url)) return 'video'
  if (AUDIO_RE.test(url)) return 'audio'
  // Blossom-style bare hash path (no extension) → assume image.
  if (/^[a-f0-9]{32,}$/.test(lastSegment(url))) return 'image'
  return 'link'
}

function buildBlocks(event: NostrEvent, noEmbed: boolean): { blocks: Block[]; gallery: string[] } {
  const imeta = parseImeta(event)
  const content = event.content
  const blocks: Block[] = []
  const gallery: string[] = []
  let textParts: ReactNode[] = []
  let imageBuf: string[] = []
  let embeds = 0
  let linkEmbeds = 0
  let key = 0

  const flushText = () => { if (textParts.length) { blocks.push({ type: 'text', parts: textParts }); textParts = [] } }
  const flushImages = () => { if (imageBuf.length) { blocks.push({ type: 'images', urls: imageBuf }); imageBuf = [] } }
  const addText = (s: string) => { flushImages(); textParts.push(<Fragment key={key++}>{s}</Fragment>) }
  // Whitespace between images keeps the group together (images on separate lines still grid).
  const emitText = (s: string) => { if (!s) return; if (imageBuf.length && /^\s*$/.test(s)) return; addText(s) }

  const handleUrl = (url: string) => {
    const kind = classify(url, imeta.get(url))
    if (kind === 'image') { flushText(); imageBuf.push(url); gallery.push(url) }
    else if (kind === 'video') { flushImages(); flushText(); blocks.push({ type: 'video', url }) }
    else if (kind === 'audio') { flushImages(); flushText(); blocks.push({ type: 'audio', url }) }
    else {
      const info = !noEmbed && linkEmbeds < LINK_EMBED_LIMIT ? detectEmbed(url) : null
      if (info) { flushImages(); flushText(); blocks.push({ type: 'linkembed', info }); linkEmbeds++ }
      else {
        flushImages()
        textParts.push(
          <a key={key++} href={url} target="_blank" rel="noopener noreferrer nofollow ugc"
            className="text-purple-400 underline underline-offset-2 hover:text-purple-300 break-all">{url}</a>,
        )
      }
    }
  }

  const handleMention = (pubkey: string) => {
    const npub = nip19.npubEncode(pubkey)
    flushImages()
    textParts.push(
      <Link key={key++} to={`/profile/${npub}`} className="text-purple-400 hover:underline">@{npub.slice(0, 10)}…</Link>,
    )
  }

  const handleEmbed = (ref: EmbedRef, raw: string, bech: string) => {
    if (!noEmbed && embeds < 1) { flushImages(); flushText(); blocks.push({ type: 'embed', ref }); embeds++ }
    else {
      flushImages()
      textParts.push(
        <span key={key++} className="text-neutral-400 break-all">{raw.slice(0, 18)}…</span>,
      )
    }
  }

  let last = 0
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(content)) !== null) {
    if (m.index > last) emitText(content.slice(last, m.index))
    last = TOKEN_RE.lastIndex
    if (m[1]) { handleUrl(m[1]); continue }
    const bech = m[2]
    try {
      const dec = nip19.decode(bech)
      if (dec.type === 'npub') handleMention(dec.data)
      else if (dec.type === 'nprofile') handleMention(dec.data.pubkey)
      else if (dec.type === 'note') handleEmbed({ id: dec.data }, m[0], bech)
      else if (dec.type === 'nevent') handleEmbed({ id: dec.data.id }, m[0], bech)
      else if (dec.type === 'naddr') handleEmbed({ addr: { kind: dec.data.kind, pubkey: dec.data.pubkey, identifier: dec.data.identifier } }, m[0], bech)
      else addText(m[0])
    } catch { addText(m[0]) }
  }
  if (last < content.length) emitText(content.slice(last))
  flushText()
  flushImages()

  // Attachments declared only in imeta (not pasted in the content).
  const extraImages: string[] = []
  for (const [url, mime] of imeta) {
    if (gallery.includes(url)) continue
    const kind = classify(url, mime)
    if (kind === 'image') { extraImages.push(url); gallery.push(url) }
    else if (kind === 'video') blocks.push({ type: 'video', url })
    else if (kind === 'audio') blocks.push({ type: 'audio', url })
  }
  if (extraImages.length) blocks.push({ type: 'images', urls: extraImages })

  return { blocks, gallery }
}

function ImageGroup({ urls, onOpen }: { urls: string[]; onOpen: (url: string) => void }) {
  if (urls.length === 1) {
    return (
      <SafeImage src={urls[0]} alt="" loading="lazy"
        onClick={(e) => { e.stopPropagation(); onOpen(urls[0]) }}
        className="block max-h-96 max-w-full cursor-pointer rounded-lg border border-[#262626]" />
    )
  }
  return (
    <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-lg">
      {urls.map((u, i) => (
        <SafeImage key={i} src={u} alt="" loading="lazy"
          onClick={(e) => { e.stopPropagation(); onOpen(u) }}
          className="aspect-[4/3] w-full cursor-pointer object-cover" />
      ))}
    </div>
  )
}

export function NoteContent({ event, noEmbed = false }: { event: NostrEvent; noEmbed?: boolean }) {
  const { blocks, gallery } = buildBlocks(event, noEmbed)
  const [index, setIndex] = useState<number | null>(null)

  const open = (url: string) => { const i = gallery.indexOf(url); if (i >= 0) setIndex(i) }
  const close = () => setIndex(null)
  const step = (d: number) => setIndex((i) => (i === null ? i : (i + d + gallery.length) % gallery.length))

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  return (
    <div className="min-w-0 space-y-2 text-sm text-neutral-200">
      {blocks.map((b, i) => {
        if (b.type === 'text') return <div key={i} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{b.parts}</div>
        if (b.type === 'images') return <ImageGroup key={i} urls={b.urls} onOpen={open} />
        if (b.type === 'video') return <video key={i} src={b.url} controls className="block max-h-96 max-w-full rounded-lg border border-[#262626]" />
        if (b.type === 'audio') return <audio key={i} src={b.url} controls className="block w-full" />
        if (b.type === 'linkembed') return <LinkEmbed key={i} embed={b.info} />
        return <EmbeddedNote key={i} embed={b.ref} />
      })}

      {/* Gallery lightbox */}
      <Dialog open={index !== null} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="max-w-5xl w-full border-0 bg-transparent p-0 shadow-none">
          {index !== null && (
            <div className="relative flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <img src={gallery[index]} alt="" className="max-h-[85vh] w-full rounded-lg object-contain" />
              {gallery.length > 1 && (
                <>
                  <button onClick={() => step(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-neutral-200 hover:bg-black/80 hover:text-white">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button onClick={() => step(1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-neutral-200 hover:bg-black/80 hover:text-white">
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-neutral-300">
                    {index + 1} / {gallery.length}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
