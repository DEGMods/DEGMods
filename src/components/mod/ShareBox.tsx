import { useState } from 'react'
import { Copy, Check, Share2 } from 'lucide-react'
import { toast } from 'sonner'

const X_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
const FACEBOOK_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
)
const DISCORD_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
    <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.07.07 0 0 0-.073.035c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.07.07 0 0 0-.073-.034A19.736 19.736 0 0 0 3.677 4.37a.064.064 0 0 0-.03.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.055 19.9 19.9 0 0 0 5.993 3.03.07.07 0 0 0 .076-.027c.462-.63.874-1.295 1.226-1.994a.07.07 0 0 0-.038-.097 13.1 13.1 0 0 1-1.872-.892.07.07 0 0 1-.007-.117c.126-.094.252-.192.371-.291a.07.07 0 0 1 .071-.01c3.927 1.793 8.18 1.793 12.061 0a.07.07 0 0 1 .072.009c.12.099.245.198.372.292a.07.07 0 0 1-.006.117c-.598.349-1.22.645-1.873.891a.07.07 0 0 0-.038.098c.36.698.772 1.362 1.225 1.993a.07.07 0 0 0 .076.028 19.84 19.84 0 0 0 6.002-3.03.07.07 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
)

/** Share box: a read-only link + copy, and one-click share to X / Facebook / Discord. */
export function ShareBox({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false)

  const copy = (text: string, msg: string) => {
    navigator.clipboard.writeText(text)
    toast.success(msg)
  }
  const copyLink = () => {
    copy(url, 'Link copied')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const text = `${title} — on DEG MODS`
  const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-200">
        <Share2 className="h-5 w-5 text-purple-400" /> Share
      </h2>
      <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 truncate rounded-md border border-[#262626] bg-[#212121] px-3 py-2 text-sm text-neutral-300"
          />
          <button
            onClick={copyLink}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">Share on</span>
          <a
            href={xUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#262626] px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-[#404040] hover:bg-[#212121]"
          >
            {X_ICON} X
          </a>
          <a
            href={fbUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#262626] px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-[#404040] hover:bg-[#212121]"
          >
            {FACEBOOK_ICON} Facebook
          </a>
          {/* Discord has no public share-intent URL — copy the link to paste in a channel. */}
          <button
            onClick={() => copy(`${text}\n${url}`, 'Copied — paste it in Discord')}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#262626] px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-[#404040] hover:bg-[#212121]"
          >
            {DISCORD_ICON} Discord
          </button>
        </div>
      </div>
    </section>
  )
}
