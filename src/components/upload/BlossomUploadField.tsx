import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FileUpload } from './FileUpload'
import { ServerBar, createSpeedTracker, SLOW_UPLOAD_WARNING, type ServerUpload } from './ServerBar'
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
  /** Mod-file upload: use the full server set incl. the pinned mod-file node (brs).
   *  Default (media) excludes brs — it's archive-only — and fails over past any
   *  server that errors until `maxServers` mirrors succeed. */
  modFile?: boolean
}

type Status = 'idle' | 'uploading' | 'success' | 'error'

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
  modFile = false,
}: BlossomUploadFieldProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [fileName, setFileName] = useState('')
  const [servers, setServers] = useState<ServerUpload[]>([])
  const [error, setError] = useState<string | undefined>()
  const trackRef = useRef(createSpeedTracker())

  const handleFile = async (file: File) => {
    const settings = useSettingsStore.getState()
    // Mod file: the full set incl. the pinned mod-file node, mirror to all. Media:
    // the non-pinned set, mirror to `maxServers` with failover past dead servers.
    const serverUrls = modFile
      ? settings.getAllEnabledBlossomUrls().slice(0, maxServers)
      : settings.getMediaBlossomUrls()
    const targetSuccesses = modFile ? undefined : maxServers
    if (serverUrls.length === 0) {
      toast.error('No Blossom servers configured')
      return
    }
    setStatus('uploading')
    setError(undefined)
    setFileName(file.name)
    // Bars are created as servers are actually attempted (the media failover set
    // can be longer than the number we end up mirroring to).
    setServers([])
    trackRef.current = createSpeedTracker()

    // Ensure a bar exists for index i (padding any earlier gaps as pending), then
    // apply a merge — attempts always arrive in index order from 0.
    const upsert = (i: number, fn: (s: ServerUpload) => ServerUpload) => {
      setServers((prev) => {
        const next = prev.slice()
        while (next.length <= i) {
          next.push({ url: serverUrls[next.length] ?? '', status: 'pending', percentage: 0, speed: 0, slow: false })
        }
        next[i] = fn(next[i])
        return next
      })
    }

    try {
      const results = await uploadToAllServers(
        file,
        serverUrls,
        signEvent,
        (p: Prog & { serverUrl: string; serverIndex: number }) => {
          const i = p.serverIndex
          const { speed, slow } = trackRef.current(i, p.loaded)
          upsert(i, (s) => ({ ...s, status: 'uploading', percentage: p.percentage, speed: speed > 0 ? speed : s.speed, slow }))
        },
        maxSizeMb,
        (i, state) => {
          upsert(i, (s) => ({ ...s, status: state, percentage: state === 'success' ? 100 : s.percentage, slow: state === 'uploading' ? s.slow : false }))
        },
        targetSuccesses,
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

      {anySlow && <p className="text-[11px] text-yellow-500/90">{SLOW_UPLOAD_WARNING}</p>}

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
