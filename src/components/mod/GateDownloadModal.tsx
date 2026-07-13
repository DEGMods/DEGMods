import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, ShieldCheck, Cpu, Eye, ExternalLink, AlertTriangle, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BlossomImage } from '@/components/shared/BlossomImage'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  solvePow, fetchAdInventory, pickRotatedAd, buildAdProof, reportAdClick, nodeOrigin,
  POW_PROOF_HEADER, AD_PROOF_HEADER,
  type GateChallenge, type Ad,
} from '@/lib/blossom/gate'

interface GateDownloadModalProps {
  challenge: GateChallenge
  /** The gated blob URL (identifies the node for ad inventory + metrics). */
  url: string
  /** Called with the proof headers once every gate is satisfied. */
  onResolved: (headers: Record<string, string>) => void
  /** Called when the user abandons this source (fails over / graceful fallback). */
  onCancel: () => void
}

type AdState =
  | { kind: 'loading' }
  | { kind: 'ready'; ad: Ad }
  | { kind: 'none' } // no inventory — cannot honestly send a proof

/**
 * The download-gate modal: mines the BUD-POW proof and shows the BUD-Ads ad at
 * the same time (the two waits overlap), then hands back the proof headers so the
 * download retries and completes. Cooperative by design — if the ad can't be
 * shown, we refuse to send a proof and fail this source over.
 */
export function GateDownloadModal({ challenge, url, onResolved, onCancel }: GateDownloadModalProps) {
  const needPow = !!challenge.pow
  const needAd = !!challenge.ad

  const [powDone, setPowDone] = useState(!needPow)
  const [hashRate, setHashRate] = useState(0)
  const [adState, setAdState] = useState<AdState>(needAd ? { kind: 'loading' } : { kind: 'none' })
  const [adElapsed, setAdElapsed] = useState(0)
  const [adViewed, setAdViewed] = useState(!needAd)

  const powProofRef = useRef<string>('')
  const adRef = useRef<Ad | null>(null)
  const mediaRef = useRef<HTMLDivElement | null>(null)
  const visibleRef = useRef(true)
  const settledRef = useRef(false)

  // ── Mine PoW ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!challenge.pow) return
    const ctrl = new AbortController()
    solvePow(challenge.pow, {
      signal: ctrl.signal,
      onProgress: (p) => setHashRate(p.hashRate),
    })
      .then((proof) => { powProofRef.current = proof; setPowDone(true) })
      .catch(() => { /* aborted on unmount/cancel */ })
    return () => ctrl.abort()
  }, [challenge.pow])

  // ── Fetch + pick the ad ───────────────────────────────────────────
  useEffect(() => {
    if (!challenge.ad) return
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchAdInventory(challenge.ad.ref, relays)
      .then((ads) => {
        if (cancelled) return
        const ad = pickRotatedAd(ads, challenge.ad!.ref)
        if (ad) { adRef.current = ad; setAdState({ kind: 'ready', ad }) }
        else setAdState({ kind: 'none' })
      })
      .catch(() => { if (!cancelled) setAdState({ kind: 'none' }) })
    return () => { cancelled = true }
  }, [challenge.ad])

  // ── Ad view timer: count only while visible + tab focused ─────────
  useEffect(() => {
    if (adState.kind !== 'ready' || !challenge.ad) return
    const minMs = challenge.ad.minMs
    let acc = 0
    let last = performance.now()

    const io = new IntersectionObserver(
      ([e]) => { visibleRef.current = e.isIntersecting && e.intersectionRatio > 0.5 },
      { threshold: [0, 0.5, 1] },
    )
    if (mediaRef.current) io.observe(mediaRef.current)

    const iv = setInterval(() => {
      const now = performance.now()
      const active = document.visibilityState === 'visible' && visibleRef.current
      if (active) {
        acc += now - last
        setAdElapsed(Math.min(acc, minMs))
        if (acc >= minMs) { setAdViewed(true); clearInterval(iv) }
      }
      last = now
    }, 100)

    return () => { clearInterval(iv); io.disconnect() }
  }, [adState.kind, challenge.ad])

  // Proceed with the download once the user confirms. The ad stays on screen
  // until they click through — the 1s is only a MINIMUM view time (it enables the
  // button), not a timer that closes anything.
  const proceed = () => {
    if (settledRef.current || !powDone || !adViewed) return
    settledRef.current = true
    const headers: Record<string, string> = {}
    if (challenge.pow) headers[POW_PROOF_HEADER] = powProofRef.current
    if (challenge.ad && adRef.current) headers[AD_PROOF_HEADER] = buildAdProof(challenge.ad.c, adRef.current.id)
    onResolved(headers)
  }

  const cancel = () => { if (!settledRef.current) { settledRef.current = true; onCancel() } }

  const adPct = challenge.ad ? Math.round((adElapsed / challenge.ad.minMs) * 100) : 100
  const ready = powDone && adViewed
  const adUnavailable = needAd && adState.kind === 'none'

  // CTA buttons shown under the ad image. Prefer the ad's `buttons`; fall back to
  // the legacy single `link` as one "Visit" button so older inventory still works.
  const readyAd = adState.kind === 'ready' ? adState.ad : null
  const adLinks = readyAd
    ? (readyAd.buttons.length > 0
        ? readyAd.buttons
        : (readyAd.link ? [{ text: 'Visit', link: readyAd.link }] : []))
    : []

  return (
    <Dialog open onOpenChange={(o) => { if (!o) cancel() }}>
      <DialogContent className="max-w-md border-[#262626] bg-[#1c1c1c]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-neutral-100">
            {ready ? <ShieldCheck className="h-5 w-5 text-green-400" /> : <Loader2 className="h-5 w-5 animate-spin text-purple-400" />}
            {ready ? 'Ready to download' : 'Preparing your download'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Ad: the image is not clickable — only the CTA buttons below it are. */}
          {needAd && adState.kind === 'ready' && (
            <div>
              <div ref={mediaRef} className="overflow-hidden rounded-xl border border-[#262626] bg-[#161616]">
                <div className="relative aspect-[16/9] w-full">
                  <BlossomImage src={adState.ad.media} alt={adState.ad.alt || 'Sponsored'} className="h-full w-full object-cover" />
                </div>
              </div>
              {adLinks.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {adLinks.map((b, i) => (
                    <a
                      key={i}
                      href={b.link.startsWith('http') ? b.link : `https://${b.link}`}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                      onClick={() => reportAdClick(nodeOrigin(url), adState.ad.id, challenge.ad!.c)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-700"
                    >
                      {b.text}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-center text-[11px] uppercase tracking-wide text-neutral-500">Sponsored — keeps downloads free</p>
            </div>
          )}

          {needAd && adState.kind === 'loading' && (
            <div className="flex aspect-[16/9] items-center justify-center rounded-xl border border-[#262626] bg-[#161616] text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin" /> <span className="ml-2 text-sm">Loading ad…</span>
            </div>
          )}

          {adUnavailable && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-500/90">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              This source requires an ad view but has no ad to show right now. Trying another source instead.
            </div>
          )}

          {/* Status rows */}
          <div className="space-y-2.5">
            {needAd && !adUnavailable && (
              <GateRow
                icon={<Eye className="h-4 w-4" />}
                label={adViewed ? 'Ad viewed' : 'Viewing ad'}
                done={adViewed}
                pct={adPct}
              />
            )}
            {needPow && (
              <GateRow
                icon={<Cpu className="h-4 w-4" />}
                label={powDone ? 'Verification solved' : 'Solving verification'}
                sub={!powDone && hashRate > 0 ? `${(hashRate / 1000).toFixed(0)}k h/s` : undefined}
                done={powDone}
                indeterminate={!powDone}
              />
            )}
          </div>

          <p className="text-center text-[11px] text-neutral-500">
            No login or payment — a quick proof-of-work and a sponsor keep this node running.
          </p>

          {adUnavailable ? (
            <Button onClick={cancel} className="w-full bg-purple-600 text-white hover:bg-purple-700">Continue</Button>
          ) : (
            <div className="space-y-1.5">
              <Button
                onClick={proceed}
                disabled={!ready}
                className="w-full gap-1.5 bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
              >
                {ready ? <><Download className="h-4 w-4" /> Download</> : <><Loader2 className="h-4 w-4 animate-spin" /> Preparing…</>}
              </Button>
              <button onClick={cancel} className="w-full py-1 text-xs text-neutral-500 hover:text-neutral-300">Cancel</button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GateRow({ icon, label, sub, done, pct, indeterminate }: {
  icon: React.ReactNode
  label: string
  sub?: string
  done: boolean
  pct?: number
  indeterminate?: boolean
}) {
  return (
    <div className="rounded-lg bg-[#161616] p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className={cn('flex-shrink-0', done ? 'text-green-400' : 'text-purple-400')}>
          {done ? <ShieldCheck className="h-4 w-4" /> : icon}
        </span>
        <span className={cn(done ? 'text-neutral-200' : 'text-neutral-300')}>{label}</span>
        {sub && <span className="ml-auto text-[11px] text-neutral-500">{sub}</span>}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#262626]">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-150',
            done ? 'bg-green-500' : 'bg-purple-500',
            indeterminate && !done && 'w-1/3 animate-pulse',
          )}
          style={indeterminate && !done ? undefined : { width: `${done ? 100 : Math.max(3, pct ?? 0)}%` }}
        />
      </div>
    </div>
  )
}
