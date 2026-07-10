import { useEffect } from 'react'
import { toast } from 'sonner'
import { ExternalLink, ShieldCheck, Lock, Plus, X } from 'lucide-react'
import type { DownloadEntry, ScanReport } from '@/types/mod'
import { isSha256, SCAN_PROVIDERS, findScanProvider, type ScanProvider } from '@/lib/scan/reportLinks'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { CharCounter } from '@/components/shared/CharCounter'
import { Button } from '@/components/ui/button'

const inputClass = 'bg-[#212121] border-[#262626] text-white text-sm'
const MAX_SCANS = 5

/**
 * Per-download "malware scan reports" editor. Built-in providers (VirusTotal,
 * Hybrid Analysis) prefill a hash-verified report URL; Custom rows are free
 * label + URL. Every scan stores an explicit URL in the event.
 */
export function DownloadScanReports({
  dl,
  onChange,
}: {
  dl: DownloadEntry
  onChange: (patch: Partial<DownloadEntry>) => void
}) {
  const hasHash = isSha256(dl.hash)
  const scans = dl.scans ?? []
  const knownScans = scans.filter((s) => findScanProvider(s.label))
  const customScans = scans.filter((s) => !findScanProvider(s.label))

  const commit = (known: ScanReport[], custom: ScanReport[]) => {
    const next = [...known, ...custom]
    onChange({ scans: next.length ? next : undefined })
  }

  // Keep built-in provider URLs in sync with the current file hash.
  useEffect(() => {
    if (!isSha256(dl.hash)) return
    let changed = false
    const next = (dl.scans ?? []).map((s) => {
      const p = findScanProvider(s.label)
      if (p) { const u = p.reportUrl(dl.hash!); if (u !== s.url) { changed = true; return { ...s, url: u } } }
      return s
    })
    if (changed) onChange({ scans: next })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dl.hash])

  const atCap = scans.length >= MAX_SCANS

  const toggleProvider = (p: ScanProvider, on: boolean) => {
    if (on && atCap) { toast.error(`Up to ${MAX_SCANS} scan reports per download`); return }
    const others = knownScans.filter((s) => findScanProvider(s.label)?.id !== p.id)
    commit(on && hasHash ? [...others, { label: p.name, url: p.reportUrl(dl.hash!) }] : others, customScans)
  }

  const updateCustom = (i: number, patch: Partial<ScanReport>) =>
    commit(knownScans, customScans.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const removeCustom = (i: number) => commit(knownScans, customScans.filter((_, j) => j !== i))
  const addCustom = () => {
    if (atCap) { toast.error(`Up to ${MAX_SCANS} scan reports per download`); return }
    commit(knownScans, [...customScans, { label: '', url: '' }])
  }

  return (
    <div className="space-y-3 rounded-lg border border-[#262626] bg-[#1c1c1c] p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-purple-400" />
        <span className="text-xs font-medium text-neutral-300">Malware scan reports (optional)</span>
      </div>

      {!hasHash && (
        <p className="text-[11px] text-neutral-500">
          Upload the file via Blossom above to enable hash-verified report links. You can still add a custom report.
        </p>
      )}

      {SCAN_PROVIDERS.map((p) => {
        const enabled = knownScans.some((s) => findScanProvider(s.label)?.id === p.id)
        return (
          <div key={p.id} className="space-y-1.5">
            <label className="flex items-center justify-between gap-2">
              <span className={hasHash ? 'text-xs text-neutral-300' : 'text-xs text-neutral-600'}>{p.name}</span>
              <Switch checked={enabled && hasHash} disabled={!hasHash || (atCap && !enabled)} onCheckedChange={(v) => toggleProvider(p, v)} />
            </label>
            {enabled && hasHash && (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[#262626] bg-[#212121] px-2 py-1.5">
                    <Lock className="h-3 w-3 shrink-0 text-neutral-500" />
                    <span className="truncate font-mono text-[11px] text-neutral-400">{p.reportUrl(dl.hash!)}</span>
                  </div>
                  <a href={p.scanPageUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#262626] px-2 py-1.5 text-[11px] text-neutral-300 transition-colors hover:border-[#404040] hover:text-white">
                    Open to scan <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-[10px] text-neutral-600">Upload the file on {p.name}; afterward this hash link shows the report.</p>
              </>
            )}
          </div>
        )
      })}

      {/* Custom reports */}
      <div className="space-y-2">
        {customScans.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr]">
              <div className="min-w-0">
                <Input value={s.label} onChange={(e) => updateCustom(i, { label: e.target.value })} placeholder="Label (e.g. MetaDefender)" maxLength={75} className={inputClass} />
                <CharCounter value={s.label} max={75} />
              </div>
              <div className="min-w-0">
                <Input value={s.url} onChange={(e) => updateCustom(i, { url: e.target.value })} placeholder="https://report-url…" maxLength={300} className={inputClass} />
                <CharCounter value={s.url} max={300} />
              </div>
            </div>
            <button onClick={() => removeCustom(i)} className="mt-2 shrink-0 text-neutral-500 hover:text-red-400" aria-label="Remove report">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addCustom} disabled={atCap} className="border-[#262626] bg-transparent text-xs text-neutral-400 hover:bg-[#2a2a2a]">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add custom report
          </Button>
          <span className="text-[10px] text-neutral-600">{scans.length}/{MAX_SCANS}</span>
        </div>
      </div>
    </div>
  )
}
