import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Download, ExternalLink, Copy, Check, Shield, Hash, Loader2, ShieldCheck,
  AlertCircle, AlertTriangle, ChevronDown, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { BlossomImage } from '@/components/shared/BlossomImage'
import {
  buildDownloadCandidates,
  downloadWithFailoverProgress,
  type DownloadProgress,
  type GateResolver,
} from '@/lib/blossom/client'
import type { GateChallenge } from '@/lib/blossom/gate'
import { GateDownloadModal } from './GateDownloadModal'
import { collectCommenterBlossomServers } from '@/lib/nostr/commenterBlossoms'
import type { NostrTarget } from '@/lib/nostr/social'
import { isSha256, isVerifiedScan } from '@/lib/scan/reportLinks'
import type { DownloadEntry } from '@/types/mod'

/** Per-download malware-scan report links (hash-verified + custom). */
function ScanReportLinks({ dl }: { dl: DownloadEntry }) {
  const [showAll, setShowAll] = useState(false)
  const scans = dl.scans ?? []

  if (scans.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-500/90">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        No malware scan provided. Download at your own risk.
      </div>
    )
  }

  const overCap = scans.length > SCAN_RENDER_CAP
  const visible = showAll ? scans : scans.slice(0, SCAN_RENDER_CAP)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((s, i) => {
        const verified = isVerifiedScan(s, dl.hash)
        const href = s.url.startsWith('http') ? s.url : `https://${s.url}`
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#262626] px-2 py-1 text-xs text-purple-400 transition-colors hover:border-[#404040] hover:text-purple-300"
          >
            {verified ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
                </TooltipTrigger>
                <TooltipContent>Hash-verified — this report is for this exact file</TooltipContent>
              </Tooltip>
            ) : (
              <Shield className="w-3.5 h-3.5" />
            )}
            {s.label || 'Report'}
            <ExternalLink className="w-3 h-3" />
          </a>
        )
      })}
      {overCap && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="rounded-md border border-dashed border-[#333] px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-[#505050] hover:text-white"
        >
          +{scans.length - SCAN_RENDER_CAP} more — view all
        </button>
      )}
    </div>
  )
}

interface ModDownloadsProps {
  downloads: DownloadEntry[]
  /** The mod being viewed — enables commenter-Blossom failover on download. */
  root?: NostrTarget
}

const REST_PER_PAGE = 3
// Defensive render caps for events from other clients that allow more.
const DOWNLOAD_RENDER_CAP = 12
const SCAN_RENDER_CAP = 6

export function ModDownloads({ downloads, root }: ModDownloadsProps) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)
  const [showAll, setShowAll] = useState(false)

  if (!downloads.length) return null

  const overCap = downloads.length > DOWNLOAD_RENDER_CAP
  const list = showAll ? downloads : downloads.slice(0, DOWNLOAD_RENDER_CAP)
  const [first, ...rest] = list
  const totalPages = Math.max(1, Math.ceil(rest.length / REST_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = rest.slice((currentPage - 1) * REST_PER_PAGE, currentPage * REST_PER_PAGE)

  return (
    <div className="space-y-3">
      <DownloadCard dl={first} root={root} />

      {rest.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex w-full items-center justify-between rounded-lg bg-[#1c1c1c] px-4 py-2.5 text-sm font-medium text-neutral-300 shadow-md shadow-black/20 transition-colors hover:text-white"
            aria-expanded={expanded}
          >
            <span>{rest.length} more download{rest.length > 1 ? 's' : ''}</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
          </button>

          {expanded && (
            <div className="flex flex-col gap-4 rounded-2xl border border-[#262626] p-2">
              {pageItems.map((dl) => (
                <DownloadCard key={dl.file} dl={dl} root={root} />
              ))}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1 pt-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className={cn('p-1.5 rounded-md transition-colors', currentPage <= 1 ? 'text-neutral-600' : 'text-neutral-400 hover:bg-[#2a2a2a]')}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i + 1)}
                      className={cn(
                        'h-7 w-7 rounded-md text-xs font-medium transition-colors',
                        i + 1 === currentPage ? 'bg-purple-600 text-white' : 'text-neutral-400 hover:bg-[#2a2a2a]',
                      )}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className={cn('p-1.5 rounded-md transition-colors', currentPage >= totalPages ? 'text-neutral-600' : 'text-neutral-400 hover:bg-[#2a2a2a]')}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {overCap && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full rounded-lg border border-dashed border-[#333] bg-[#171717] px-4 py-2 text-xs text-neutral-400 transition-colors hover:border-[#505050] hover:text-white"
        >
          +{downloads.length - DOWNLOAD_RENDER_CAP} more download{downloads.length - DOWNLOAD_RENDER_CAP > 1 ? 's' : ''} not shown — View all {downloads.length}
        </button>
      )}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatSpeed(bps: number): string {
  if (bps <= 0) return ''
  const mb = bps / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`
  return `${(bps / 1024).toFixed(0)} KB/s`
}

function deriveFilename(dl: DownloadEntry): string {
  // Prefer the original filename saved on the mod event (the blob itself stays
  // hash-addressed on Blossom). Strip path separators defensively.
  if (dl.filename?.trim()) return dl.filename.trim().replace(/[/\\]+/g, '_')
  try {
    const last = new URL(dl.file).pathname.split('/').pop()
    if (last && /\.[a-z0-9]+$/i.test(last)) return decodeURIComponent(last)
  } catch { /* not a URL */ }
  const base = (dl.title || 'download').replace(/[^\w.-]+/g, '_')
  const ext = dl.file.match(/(\.[a-zA-Z0-9]+)(?:[?#]|$)/)?.[1] ?? ''
  return /\.[a-z0-9]+$/i.test(base) ? base : base + ext
}

/** Content-addressed link (a sha256 in its last path segment) — a Blossom source
 *  the failover already covers, so opening it raw in a tab adds nothing (and if
 *  it's gated, only shows the 428 page). */
function isHashAddressed(url: string): boolean {
  try {
    const seg = new URL(url).pathname.split('/').pop() ?? ''
    return isSha256(seg.replace(/\.[a-z0-9]+$/i, ''))
  } catch { return false }
}

/** The URL path ends in a file extension (a direct file, not a page to open). */
function hasFileExtension(url: string): boolean {
  try {
    const seg = new URL(url).pathname.split('/').pop() ?? ''
    return /\.[a-z0-9]{1,8}$/i.test(seg)
  } catch { return false }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

type Status = 'idle' | 'downloading' | 'verifying' | 'done' | 'error'

// ─── Single download entry ───────────────────────────────────────────

function DownloadCard({ dl, root }: { dl: DownloadEntry; root?: NostrTarget }) {
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [serverNote, setServerNote] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [gate, setGate] = useState<
    { challenge: GateChallenge; url: string; resolve: (h: Record<string, string>) => void; reject: (e: Error) => void } | null
  >(null)
  const busyRef = useRef(false)
  const [linkCopied, setLinkCopied] = useState(false)

  // A source answered 428 with gate challenges: open the modal, resolve once the
  // user's client has mined the PoW and shown the ad (or reject to fail over).
  const resolveGate: GateResolver = (challenge, url) =>
    new Promise((resolve, reject) => setGate({ challenge, url, resolve, reject }))

  const verify = isSha256(dl.hash)

  const copyHash = () => {
    if (!dl.hash) return
    navigator.clipboard.writeText(dl.hash)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const copyLink = () => {
    if (!dl.file) return
    navigator.clipboard.writeText(dl.file)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const handleDownload = async () => {
    if (busyRef.current) return

    // A plain page link — nothing to stream by hash and no file extension (a mega
    // page, a mod page, etc.). You can't "download" a webpage as a file, so just
    // open it. Direct files and hash-addressed blobs fall through to the fetch flow.
    const hashable = isSha256(dl.hash)
    if (dl.file && !hashable && !isHashAddressed(dl.file) && !hasFileExtension(dl.file)) {
      window.open(dl.file, '_blank', 'noopener,noreferrer')
      return
    }

    busyRef.current = true
    setStatus('downloading')
    setProgress(null)
    setServerNote(null)

    const servers = useSettingsStore.getState().getAllEnabledBlossomUrls()
    const progressOpts = {
      expectedHash: verify ? dl.hash : undefined,
      onProgress: (p: DownloadProgress) => {
        setProgress(p)
        if (verify && p.percentage >= 100) setStatus('verifying')
      },
      onServerChange: (_url: string, index: number, total: number) => {
        if (index > 0) setServerNote(`Source ${index + 1} of ${total}…`)
      },
      resolveGate,
    }
    const finishOk = (blob: Blob) => {
      saveBlob(blob, deriveFilename(dl))
      setStatus('done')
      toast.success(verify ? 'Downloaded: hash verified' : 'Download complete')
      setTimeout(() => setStatus('idle'), 4000)
    }

    try {
      // 1) Original link + the viewer's own Blossom servers (client/user lists).
      const candidates = buildDownloadCandidates(dl.file, dl.hash, servers)
      finishOk(await downloadWithFailoverProgress(candidates, progressOpts))
    } catch (primaryErr) {
      // 2) Last resort: Blossom servers of users who commented on this mod. Only
      //    possible when the file is hash-addressed (content is served by hash).
      const canWiden = root && dl.hash && isSha256(dl.hash)
      if (canWiden) {
        try {
          setServerNote('Trying community sources…')
          const already = new Set(servers.map((s) => s.replace(/\/+$/, '')))
          const extra = (await collectCommenterBlossomServers(root!))
            .filter((s) => !already.has(s.replace(/\/+$/, '')))
          if (extra.length) {
            // hash-only candidates on the new servers (original link already tried)
            const widened = buildDownloadCandidates(dl.file, dl.hash, extra).slice(1)
            finishOk(await downloadWithFailoverProgress(widened, progressOpts))
            busyRef.current = false
            return
          }
        } catch { /* fall through to the graceful fallback below */ }
      }
      setStatus('error')
      if (dl.file && !isHashAddressed(dl.file)) {
        // An external file/page link (github release, mega, a mod page): the browser
        // can fetch or display it directly, so open it as a last resort.
        toast.error('Couldn’t download in-page. Opening the source link instead.')
        window.open(dl.file, '_blank', 'noopener,noreferrer')
      } else {
        // A hash-addressed (Blossom) link: failover already tried every server, and
        // opening it raw would only 404 or show the gate page. Fail cleanly.
        toast.error('Download not completed — no available source for this file.')
      }
      setTimeout(() => setStatus('idle'), 4000)
    } finally {
      busyRef.current = false
    }
  }

  const downloading = status === 'downloading' || status === 'verifying'
  const pct = progress?.percentage ?? 0
  const indeterminate = downloading && (progress == null || pct < 0)

  return (
    <Card className="overflow-hidden border-0 bg-[#1c1c1c] p-0 shadow-md shadow-black/20">
      {/* Preview image: full row, click to open the gallery */}
      {dl.image && (
        <>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block w-full focus:outline-none focus:ring-2 focus:ring-purple-600"
            aria-label="Open preview"
          >
            <div className="relative aspect-video w-full">
              <SkeletonImage
                src={dl.image}
                alt={dl.title || 'Download preview'}
                className="absolute inset-0 h-full w-full object-cover transition-opacity hover:opacity-90"
              />
            </div>
          </button>

          <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
            <DialogContent className="max-w-4xl w-full border-0 bg-[#1c1c1c] p-0 overflow-hidden">
              <div className="flex min-h-[200px] items-center justify-center">
                <BlossomImage
                  src={dl.image}
                  alt={dl.title || 'Download preview'}
                  loading="eager"
                  className="w-full max-h-[80vh] object-contain"
                />
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-white truncate">{dl.title || 'Download'}</span>
          {dl.version && (
            <Badge variant="secondary" className="bg-[#212121] text-neutral-300 text-xs">
              v{dl.version}
            </Badge>
          )}
          {verify && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-[10px] text-green-500/80">
                  <ShieldCheck className="w-3 h-3" />
                  Verifiable
                </span>
              </TooltipTrigger>
              <TooltipContent>SHA-256 is checked after download</TooltipContent>
            </Tooltip>
          )}
        </div>

        {dl.note && (
          <>
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="w-full text-left text-sm text-neutral-400 hover:text-neutral-300"
            >
              <span className="line-clamp-3">{dl.note}</span>
            </button>
            <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
              <DialogContent className="bg-[#1c1c1c] border-[#262626] max-h-[80vh] overflow-auto">
                <DialogHeader>
                  <DialogTitle className="text-neutral-100">{dl.title || 'Download'}: Note</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">{dl.note}</p>
              </DialogContent>
            </Dialog>
          </>
        )}

        {dl.hash && (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Hash className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-mono truncate">{dl.hash}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={copyHash} className="text-neutral-500 hover:text-white transition-colors flex-shrink-0">
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied!' : 'Copy hash'}</TooltipContent>
            </Tooltip>
          </div>
        )}

        <ScanReportLinks dl={dl} />

        {/* Progress bar */}
        {downloading && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#262626]">
              <div
                className={cn(
                  'h-full rounded-full bg-purple-500 transition-[width] duration-150',
                  indeterminate && 'w-1/3 animate-pulse',
                )}
                style={indeterminate ? undefined : { width: `${Math.max(2, pct)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>
                {status === 'verifying'
                  ? 'Verifying SHA-256…'
                  : serverNote ?? (indeterminate ? 'Downloading…' : `${pct}%`)}
              </span>
              {progress && progress.bytesPerSecond > 0 && status === 'downloading' && (
                <span>{formatSpeed(progress.bytesPerSecond)}</span>
              )}
            </div>
          </div>
        )}

        {/* Download button: full width, at the bottom */}
        <Button
          onClick={handleDownload}
          disabled={downloading}
          className={cn(
            'w-full gap-1.5 text-white',
            status === 'error' ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700',
          )}
        >
          {status === 'downloading' && <><Loader2 className="w-4 h-4 animate-spin" /> {indeterminate ? 'Downloading…' : `${pct}%`}</>}
          {status === 'verifying' && <><ShieldCheck className="w-4 h-4 animate-pulse" /> Verifying</>}
          {status === 'done' && <><Check className="w-4 h-4" /> Done</>}
          {status === 'error' && <><AlertCircle className="w-4 h-4" /> Retry</>}
          {status === 'idle' && <><Download className="w-4 h-4" /> Download</>}
        </Button>

        {/* See / copy the raw link behind the button, without downloading. */}
        {dl.file && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={copyLink}
                className="flex w-full items-center justify-center gap-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
              >
                {linkCopied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                {linkCopied ? 'Link copied' : 'Copy download link'}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs break-all">{dl.file}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {gate && (
        <GateDownloadModal
          challenge={gate.challenge}
          url={gate.url}
          onResolved={(headers) => { const g = gate; setGate(null); g.resolve(headers) }}
          onCancel={() => { const g = gate; setGate(null); g.reject(new Error('gate cancelled')) }}
        />
      )}
    </Card>
  )
}
