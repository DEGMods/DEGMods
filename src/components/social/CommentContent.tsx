import { Fragment } from 'react'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * Renders comment/reply text. By default it shows plain text only — links are
 * not clickable and media is not embedded. The user can opt into rendering
 * images / videos / audio / clickable hyperlinks individually (Settings →
 * Preferences). Markdown is intentionally not interpreted.
 */

const URL_RE = /(https?:\/\/[^\s]+)/gi
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?[^\s]*)?$/i
const AUDIO_RE = /\.(mp3|ogg|wav|m4a|flac|aac)(\?[^\s]*)?$/i

export function CommentContent({ content }: { content: string }) {
  const { renderImages, renderVideos, renderAudio, renderHyperlinks } = usePreferencesStore()

  const parts = content.split(URL_RE)

  return (
    <div className="whitespace-pre-wrap break-words text-sm text-neutral-200">
      {parts.map((part, i) => {
        if (!part) return null
        const isUrl = i % 2 === 1 // odd indices are the captured URLs
        if (!isUrl) return <Fragment key={i}>{part}</Fragment>

        if (renderImages && IMAGE_RE.test(part)) {
          return (
            <img
              key={i}
              src={part}
              alt=""
              loading="lazy"
              className="my-1.5 block max-h-80 max-w-full rounded-lg border border-[#262626]"
            />
          )
        }
        if (renderVideos && VIDEO_RE.test(part)) {
          return (
            <video
              key={i}
              src={part}
              controls
              className="my-1.5 block max-h-80 max-w-full rounded-lg border border-[#262626]"
            />
          )
        }
        if (renderAudio && AUDIO_RE.test(part)) {
          return <audio key={i} src={part} controls className="my-1.5 block w-full" />
        }
        if (renderHyperlinks) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="text-purple-400 underline underline-offset-2 hover:text-purple-300 break-all"
            >
              {part}
            </a>
          )
        }
        // Default: plain, non-clickable text.
        return <Fragment key={i}>{part}</Fragment>
      })}
    </div>
  )
}
