import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// One progress row per Blossom server, shared by the single-file and multi-file
// image upload fields so mirrored uploads report identically everywhere.

export type ServerStatus = 'pending' | 'uploading' | 'success' | 'error'

export interface ServerUpload {
  url: string
  status: ServerStatus
  percentage: number
  speed: number // bytes/sec
  slow: boolean
}

// The DEG Mods node rejects uploads averaging below this (over a 5s window). Warn
// once a server's speed has stayed under it for that long.
export const MIN_SPEED_BPS = 50 * 1024
export const SLOW_GRACE_MS = 5000

export const SLOW_UPLOAD_WARNING =
  '⚠ An upload is below the 50 KB/s minimum — that server may reject it. Check your connection.'

export function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

/** Fresh per-server transfer-speed tracker + "too slow for too long" detector. */
export function createSpeedTracker() {
  const last: Record<number, { loaded: number; time: number }> = {}
  const slowSince: Record<number, number | null> = {}

  return (index: number, loaded: number): { speed: number; slow: boolean } => {
    const now = Date.now()
    const prev = last[index] ?? { loaded: 0, time: now }
    const elapsed = (now - prev.time) / 1000
    const speed = elapsed > 0 ? (loaded - prev.loaded) / elapsed : 0
    last[index] = { loaded, time: now }

    let slow = false
    if (speed > 0) {
      if (speed < MIN_SPEED_BPS) {
        if (slowSince[index] == null) slowSince[index] = now
        else if (now - (slowSince[index] as number) >= SLOW_GRACE_MS) slow = true
      } else {
        slowSince[index] = null
      }
    }
    return { speed, slow }
  }
}

export function ServerBar({ server }: { server: ServerUpload }) {
  const { url, status, percentage, speed } = server
  const barColor = status === 'success' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-purple-500'
  const width = status === 'success' || status === 'error' ? 100 : percentage

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          {status === 'pending' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-600" />}
          {status === 'uploading' && <Loader2 size={13} className="shrink-0 animate-spin text-purple-400" />}
          {status === 'success' && <CheckCircle size={13} className="shrink-0 text-green-500" />}
          {status === 'error' && <XCircle size={13} className="shrink-0 text-red-500" />}
          <span className="truncate text-neutral-300">{hostOf(url)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-neutral-500">
          {status === 'uploading' && (
            <>
              {speed > 0 && <span>{formatSpeed(speed)}</span>}
              <span>{percentage}%</span>
            </>
          )}
          {status === 'success' && <span className="text-green-500">Done</span>}
          {status === 'error' && <span className="text-red-400">Failed</span>}
          {status === 'pending' && <span>Waiting…</span>}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#262626]">
        <div
          className={cn('h-full rounded-full transition-all duration-300', barColor, status === 'error' && 'opacity-40')}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}
