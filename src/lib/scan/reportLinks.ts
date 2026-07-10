/**
 * Built-in malware-scan providers + helpers.
 *
 * Each scan report stores an explicit label + URL in the event (no client-side
 * link generation). For the known providers below, the editor prefills the URL
 * from the file's SHA-256, and the viewer shows a "hash-verified" badge when a
 * stored URL actually matches the one built from that download's hash — so a
 * tampered URL simply doesn't get the badge.
 *
 * MetaDefender is intentionally absent: its public web report is addressed by an
 * opaque dataId, not the hash, so it can't be hash-verified. Add it as a custom
 * report instead.
 */

export function isSha256(hash: string | undefined): hash is string {
  return !!hash && /^[a-f0-9]{64}$/i.test(hash)
}

export interface ScanProvider {
  id: string
  name: string
  /** Public, hash-addressed report page. */
  reportUrl: (hash: string) => string
  /** Where the creator uploads the file to generate a report ("Open to scan"). */
  scanPageUrl: string
}

export const SCAN_PROVIDERS: ScanProvider[] = [
  {
    id: 'vt',
    name: 'VirusTotal',
    reportUrl: (h) => `https://www.virustotal.com/gui/file/${h.toLowerCase()}`,
    scanPageUrl: 'https://www.virustotal.com/gui/home/upload',
  },
  {
    id: 'hybrid',
    name: 'Hybrid Analysis',
    reportUrl: (h) => `https://www.hybrid-analysis.com/sample/${h.toLowerCase()}`,
    scanPageUrl: 'https://www.hybrid-analysis.com/',
  },
]

/** Match a stored scan label to a known provider (by id or name, case-insensitive). */
export function findScanProvider(label: string): ScanProvider | undefined {
  const l = label.trim().toLowerCase()
  return SCAN_PROVIDERS.find((p) => p.id === l || p.name.toLowerCase() === l)
}

/** True when a scan's stored URL is the one built from this download's hash (→ verified badge). */
export function isVerifiedScan(scan: { label: string; url: string }, hash: string | undefined): boolean {
  if (!isSha256(hash)) return false
  const p = findScanProvider(scan.label)
  return !!p && scan.url.trim().toLowerCase() === p.reportUrl(hash).toLowerCase()
}
