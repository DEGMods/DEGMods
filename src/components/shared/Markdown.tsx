import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BlossomImage } from './BlossomImage'
import { embedFromIframe } from '@/lib/embeds'
import { LinkEmbed } from '@/components/social/LinkEmbed'

/**
 * Fenced code block with a header showing the language (if given) and a copy
 * button.
 */
function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="my-4 overflow-hidden rounded-lg border border-[#262626] bg-[#171717]">
      <div className="flex items-center justify-between border-b border-[#262626] bg-[#1c1c1c] px-3 py-1.5">
        <span className="font-mono text-xs text-neutral-500">{lang || 'text'}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-white"
        >
          {copied ? (
            <><Check className="h-3.5 w-3.5 text-green-400" /> Copied</>
          ) : (
            <><Copy className="h-3.5 w-3.5" /> Copy</>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm">
        <code className="font-mono text-neutral-200">{code}</code>
      </pre>
    </div>
  )
}

/**
 * Image rendered inside markdown bodies: lazy-loaded, with a pulsing
 * skeleton while it loads and Blossom server failover (via BlossomImage).
 * Uses <span> elements (not <div>) because markdown images live inside <p>.
 */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false)
  if (!src) return null

  return (
    <span
      className={cn(
        'relative my-4 block overflow-hidden rounded-lg border border-[#262626]',
        !loaded && 'min-h-[160px]'
      )}
    >
      {!loaded && (
        <span className="absolute inset-0 z-[1] block bg-[#262626] animate-pulse" />
      )}
      <BlossomImage
        src={src}
        alt={alt || ''}
        className="relative z-[2] block h-auto w-full"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </span>
  )
}

/**
 * An `<iframe>` an author put in a post body.
 *
 * The src is re-parsed and checked against the embed allowlist rather than
 * trusted — see embedFromIframe for why the destination, not the markup, is
 * what matters. A refused src degrades to a plain link so the content isn't
 * lost and the reader can still see where it points.
 *
 * Wrapped in `<span>`s because markdown puts inline HTML inside a `<p>`, where
 * a `<div>` would be invalid nesting (same reason MarkdownImage uses spans).
 */
function MarkdownEmbed({ src, title }: { src?: string; title?: string }) {
  if (!src) return null
  const embed = embedFromIframe(src)

  if (!embed) {
    return (
      <span className="my-4 block">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-purple-400 underline underline-offset-2 hover:text-purple-300"
        >
          {title || src}
        </a>
      </span>
    )
  }

  return (
    <span className="my-4 block">
      <LinkEmbed embed={title ? { ...embed, title } : embed} />
    </span>
  )
}

const components: Components = {
  p: ({ node, ...props }) => <p className="mb-3 leading-relaxed" {...props} />,
  iframe: ({ node, src, title }) => <MarkdownEmbed src={src as string} title={title as string} />,
  a: ({ node, ...props }) => (
    <a
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-purple-400 underline underline-offset-2 hover:text-purple-300"
      {...props}
    />
  ),
  img: ({ node, src, alt }) => <MarkdownImage src={src as string} alt={alt as string} />,
  h1: ({ node, ...props }) => <h1 className="mt-6 mb-3 text-2xl font-bold text-neutral-100" {...props} />,
  h2: ({ node, ...props }) => <h2 className="mt-5 mb-2.5 text-xl font-bold text-neutral-100" {...props} />,
  h3: ({ node, ...props }) => <h3 className="mt-4 mb-2 text-lg font-semibold text-neutral-100" {...props} />,
  h4: ({ node, ...props }) => <h4 className="mt-4 mb-2 text-base font-semibold text-neutral-200" {...props} />,
  h5: ({ node, ...props }) => <h5 className="mt-3 mb-1.5 text-sm font-semibold text-neutral-200" {...props} />,
  h6: ({ node, ...props }) => <h6 className="mt-3 mb-1.5 text-sm font-semibold text-neutral-400" {...props} />,
  ul: ({ node, ...props }) => <ul className="mb-3 list-disc space-y-1 pl-6" {...props} />,
  ol: ({ node, ...props }) => <ol className="mb-3 list-decimal space-y-1 pl-6" {...props} />,
  li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote className="mb-4 border-l-2 border-purple-500/50 pl-4 italic text-neutral-400" {...props} />
  ),
  hr: ({ node, ...props }) => <hr className="my-6 border-[#262626]" {...props} />,
  strong: ({ node, ...props }) => <strong className="font-semibold text-neutral-100" {...props} />,
  em: ({ node, ...props }) => <em className="italic" {...props} />,
  // Block code is rendered by the `code` handler as a full <CodeBlock>, so `pre`
  // just unwraps to avoid an extra <pre> wrapper.
  pre: ({ children }) => <>{children}</>,
  code: ({ node, className, children, ...props }) => {
    const raw = String(children)
    const match = /language-(\w+)/.exec(className || '')
    const isBlock = !!match || raw.includes('\n')
    if (!isBlock) {
      return (
        <code
          className="rounded bg-[#262626] px-1.5 py-0.5 font-mono text-[0.85em] text-purple-200"
          {...props}
        >
          {children}
        </code>
      )
    }
    return <CodeBlock lang={match?.[1]} code={raw.replace(/\n$/, '')} />
  },
  table: ({ node, ...props }) => (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => (
    <th className="border border-[#262626] bg-[#1c1c1c] px-3 py-1.5 text-left font-semibold text-neutral-200" {...props} />
  ),
  td: ({ node, ...props }) => <td className="border border-[#262626] px-3 py-1.5" {...props} />,
}

interface MarkdownProps {
  content: string
  className?: string
}

// Sanitize schema (GitHub's, hardened). rehype-sanitize runs AFTER rehype-raw,
// so it cleans any embedded/raw HTML before it becomes React elements: scripts,
// event handlers (onclick…), `javascript:`/`data:` URLs, <style>, etc. are
// dropped. We keep the code-block language class so fenced code still
// highlights, and let anchors carry href/title (our <a> component forces
// target=_blank rel=noopener noreferrer nofollow regardless).
//
// `iframe` is allowed through with a deliberately tiny attribute list so authors
// can paste a platform embed code. Note what is NOT allowed: `srcdoc` (which
// would let arbitrary HTML — and script — run in the frame), `name`, `style`,
// and every event handler. `src` survives sanitizing but is not trusted here;
// MarkdownEmbed re-parses it and refuses any origin that isn't a known player,
// so passing the sanitizer is necessary but not sufficient to get framed.
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'iframe'],
  attributes: {
    ...defaultSchema.attributes,
    iframe: ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'allowFullScreen'],
  },
}

/**
 * Renders user-authored markdown (mod bodies, blog posts) with GFM support,
 * single-newline line breaks, and dark-theme styling. Some legacy posts store
 * raw HTML bodies rather than markdown, so raw HTML IS rendered — but only after
 * rehype-sanitize strips anything unsafe, so output stays XSS-safe.
 */
export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn('text-sm leading-relaxed text-neutral-300 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
