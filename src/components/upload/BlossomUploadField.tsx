import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { FileUpload } from './FileUpload'
import {
  uploadToAllServers,
  type UploadResult,
  type UploadProgress as Prog,
} from '@/lib/blossom/client'
import { useSettingsStore } from '@/stores/settingsStore'
import { signEvent } from '@/stores/authStore'

interface BlossomUploadFieldProps {
  accept?: string
  label?: string
  sublabel?: string
  onUploaded: (result: UploadResult) => void
  /** Reset to the dropzone after a successful upload (for adding many). */
  resetAfter?: boolean
  /** Max number of Blossom servers to mirror to (best-effort). */
  maxServers?: number
  /** Override the size limit (MB). Defaults to the user's media upload limit. */
  maxSizeMb?: number
}

type Status = 'idle' | 'uploading' | 'success' | 'error'
type ServerStatus = 'pending' | 'uploading' | 'success' | 'error'

interface ServerUpload {
  url: string
  status: ServerStatus
  percentage: number
  speed: number // bytes/sec
  slow: boolean
}

// The DEG Mods node rejects uploads averaging below this (over a 5s window). Warn
// once a server's speed has stayed under it for that long.
const MIN_SPEED_BPS = 50 * 1024
const SLOW_GRACE_MS = 5000

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

/**
 * Uploads a file to up to `maxServers` enabled Blossom servers (best-effort:
 * succeeds if at least one accepts it). Shows one progress bar per server with
 * its own percentage/speed and a success or fail state. `resetAfter` returns to
 * the dropzone so multiple files can be added in sequence.
 */
export function BlossomUploadField({
  accept,
  label,
  sublabel,
  onUploaded,
  resetAfter,
  maxServers = 3,
  maxSizeMb,
}: BlossomUploadFieldProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState('')
  const [servers, setServers] = useState<ServerUpload[]>([])
  const [error, setError] = useState<string | undefined>()
  const lastRef = useRef<Record<number, { loaded: number; time: number }>>({})
  const slowSinceRef = useRef<Record<number, number | null>>({})

  const handleFile = async (file: File) => {
    const serverUrls = useSettingsStore.getState().getAllEnabledBlossomUrls().slice(0, maxServers)
    if (serverUrls.length === 0) {
      toast.error('No Blossom servers configured')
      return
    }
    setStatus('uploading')
    setError(undefined)
    setFileName(file.name)
    setServers(serverUrls.map((url) => ({ url, status: 'pending', percentage: 0, speed: 0, slow: false })))
    lastRef.current = {}
    slowSinceRef.current = {}

    try {
      const results = await uploadToAllServers(
        file,
        serverUrls,
        signEvent,
        (p: Prog & { serverUrl: string; serverIndex: number }) => {
          const i = p.serverIndex
          const now = Date.now()
          const last = lastRef.current[i] ?? { loaded: 0, time: now }
          const elapsed = (now - last.time) / 1000
          const sp = elapsed > 0 ? (p.loaded - last.loaded) / elapsed : 0
          lastRef.current[i] = { loaded: p.loaded, time: now }

          let slow = false
          if (sp > 0) {
            if (sp < MIN_SPEED_BPS) {
              if (slowSinceRef.current[i] == null) slowSinceRef.current[i] = now
              else if (now - (slowSinceRef.current[i] as number) >= SLOW_GRACE_MS) slow = true
            } else {
              slowSinceRef.current[i] = null
            }
          }

          setServers((prev) => prev.map((s, idx) =>
            idx === i ? { ...s, status: 'uploading', percentage: p.percentage, speed: sp > 0 ? sp : s.speed, slow } : s,
          ))
        },
        maxSizeMb,
        (i, state) => {
          setServers((prev) => prev.map((s, idx) =>
            idx === i
              ? { ...s, status: state, percentage: state === 'success' ? 100 : s.percentage, slow: state === 'uploading' ? s.slow : false }
              : s,
          ))
        },
      )
      if (results.length === 0) throw new Error('All servers failed')
      // Carry the original filename so callers (e.g. the mod download field) can
      // preserve it — the blob itself stays hash-addressed on the server.
      onUploaded({ ...results[0], filename: file.name })
      toast.success(`Uploaded to ${results.length}/${serverUrls.length} server${results.length > 1 ? 's' : ''}`)
      if (resetAfter) setStatus('idle')
      else setStatus('success')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Upload failed')
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  if (status === 'idle') {
    return <FileUpload onFileSelect={handleFile} accept={accept} label={label} sublabel={sublabel} />
  }

  const successCount = servers.filter((s) => s.status === 'success').length
  const anySlow = servers.some((s) => s.status === 'uploading' && s.slow)

  return (
    <div className="space-y-2.5 rounded-lg border border-[#262626] bg-[#1c1c1c] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm text-white">{fileName}</span>
        <span className="shrink-0 text-[11px] text-neutral-500">{successCount}/{servers.length} servers</span>
      </div>

      <div className="space-y-2">
        {servers.map((s, i) => <ServerBar key={i} server={s} />)}
      </div>

      {anySlow && (
        <p className="text-[11px] text-yellow-500/90">
          ⚠ An upload is below the 50 KB/s minimum — that server may reject it. Check your connection.
        </p>
      )}

      {error && status === 'error' && <p className="text-xs text-red-400">{error}</p>}

      {(status === 'success' || status === 'error') && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setStatus('idle')}
          className="text-xs border-[#262626]"
        >
          {status === 'success' ? 'Replace current file' : 'Try again'}
        </Button>
      )}
    </div>
  )
}

function ServerBar({ server }: { server: ServerUpload }) {
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
