import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { FileUpload } from './FileUpload'
import { ServerBar, createSpeedTracker, SLOW_UPLOAD_WARNING, type ServerUpload } from './ServerBar'
import { uploadToAllServers, type UploadProgress as Prog } from '@/lib/blossom/client'
import { useSettingsStore } from '@/stores/settingsStore'
import { signEvent } from '@/stores/authStore'
import { X } from 'lucide-react'

interface Item {
  id: string
  name: string
  status: 'uploading' | 'success' | 'error'
  /** One entry per Blossom server this file is mirrored to. */
  servers: ServerUpload[]
  error?: string
}

interface MultiImageUploadFieldProps {
  accept?: string
  label?: string
  sublabel?: string
  /** Called once per file as it finishes uploading. */
  onUploaded: (url: string) => void
  /** Max Blossom servers to mirror each file to (best-effort). */
  maxServers?: number
}

/**
 * Drop or pick several images at once; each uploads sequentially (mirrored to up
 * to `maxServers` Blossom servers) and calls `onUploaded` as it lands. Each file
 * shows one progress bar per server, matching <BlossomUploadField>. Successful
 * rows clear themselves; failed rows stay with a dismiss button.
 */
export function MultiImageUploadField({ accept, label, sublabel, onUploaded, maxServers = 3 }: MultiImageUploadFieldProps) {
  const [items, setItems] = useState<Item[]>([])
  const queueRef = useRef<{ id: string; file: File }[]>([])
  const runningRef = useRef(false)

  const patch = (id: string, p: Partial<Item>) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...p } : it)))

  // Upsert a server bar for an item by index (padding earlier gaps as pending);
  // attempts arrive in index order. Bars appear only for servers actually tried,
  // so the media failover set (longer than the mirror count) doesn't show dead rows.
  const upsertServer = (id: string, urls: string[], i: number, fn: (s: ServerUpload) => ServerUpload) =>
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      const servers = it.servers.slice()
      while (servers.length <= i) servers.push({ url: urls[servers.length] ?? '', status: 'pending', percentage: 0, speed: 0, slow: false })
      servers[i] = fn(servers[i])
      return { ...it, servers }
    }))

  const drain = async () => {
    if (runningRef.current) return
    // Media: non-pinned servers (brs is archive-only), mirror to `maxServers` with
    // failover past any that error.
    const serverUrls = useSettingsStore.getState().getMediaBlossomUrls()
    if (serverUrls.length === 0) { toast.error('No Blossom servers configured'); return }
    runningRef.current = true
    try {
      while (queueRef.current.length > 0) {
        const { id, file } = queueRef.current.shift()!
        patch(id, { status: 'uploading', servers: [] })
        // Fresh tracker per file so speeds/slow-warnings don't leak across files.
        const track = createSpeedTracker()
        try {
          const results = await uploadToAllServers(
            file,
            serverUrls,
            signEvent,
            (p: Prog & { serverUrl: string; serverIndex: number }) => {
              const { speed, slow } = track(p.serverIndex, p.loaded)
              upsertServer(id, serverUrls, p.serverIndex, (s) => ({ ...s, status: 'uploading', percentage: p.percentage, speed: speed > 0 ? speed : s.speed, slow }))
            },
            undefined,
            (i, state) => upsertServer(id, serverUrls, i, (s) => ({
              ...s,
              status: state,
              percentage: state === 'success' ? 100 : s.percentage,
              slow: state === 'uploading' ? s.slow : false,
            })),
            maxServers,
          )
          if (results.length === 0) throw new Error('All servers failed')
          patch(id, { status: 'success' })
          onUploaded(results[0].url)
          setTimeout(() => setItems(prev => prev.filter(it => it.id !== id)), 1500)
        } catch (err) {
          patch(id, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
        }
      }
    } finally {
      runningRef.current = false
    }
  }

  const onFiles = (files: File[]) => {
    const added = files.map(f => ({ id: crypto.randomUUID(), file: f }))
    queueRef.current.push(...added)
    // Seed the server rows up front so queued files read as "Waiting…" rather
    // than sitting there bare until their turn in the queue (media set, capped to
    // the mirror count — drain() replaces these with the real attempts).
    const serverUrls = useSettingsStore.getState().getMediaBlossomUrls().slice(0, maxServers)
    setItems(prev => [
      ...prev,
      ...added.map(a => ({
        id: a.id,
        name: a.file.name,
        status: 'uploading' as const,
        servers: serverUrls.map(url => ({ url, status: 'pending' as const, percentage: 0, speed: 0, slow: false })),
      })),
    ])
    drain()
  }

  return (
    <div className="space-y-2">
      <FileUpload
        multiple
        accept={accept}
        onFilesSelect={onFiles}
        label={label || 'Drop images here or click to browse'}
        sublabel={sublabel || 'Select or drop several — they upload automatically'}
      />
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map(it => {
            const successCount = it.servers.filter(s => s.status === 'success').length
            const anySlow = it.servers.some(s => s.status === 'uploading' && s.slow)
            return (
              <div key={it.id} className="space-y-2.5 rounded-lg border border-[#262626] bg-[#1c1c1c] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-white">{it.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {it.servers.length > 0 && (
                      <span className="text-[11px] text-neutral-500">{successCount}/{it.servers.length} servers</span>
                    )}
                    {it.status === 'error' && (
                      <button onClick={() => setItems(prev => prev.filter(x => x.id !== it.id))} className="cursor-pointer text-neutral-500 hover:text-neutral-300">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {it.servers.length > 0 && (
                  <div className="space-y-2">
                    {it.servers.map((s, i) => <ServerBar key={i} server={s} />)}
                  </div>
                )}

                {anySlow && <p className="text-[11px] text-yellow-500/90">{SLOW_UPLOAD_WARNING}</p>}
                {it.error && <p className="text-xs text-red-400">{it.error}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
