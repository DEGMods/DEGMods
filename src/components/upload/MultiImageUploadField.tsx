import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { FileUpload } from './FileUpload'
import { UploadProgress } from './UploadProgress'
import { uploadToAllServers, type UploadProgress as Prog } from '@/lib/blossom/client'
import { useSettingsStore } from '@/stores/settingsStore'
import { signEvent } from '@/stores/authStore'
import { X } from 'lucide-react'

interface Item {
  id: string
  name: string
  status: 'uploading' | 'success' | 'error'
  percentage: number
  speed: number
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
 * to `maxServers` Blossom servers) and calls `onUploaded` as it lands. Successful
 * rows clear themselves; failed rows stay with a dismiss button.
 */
export function MultiImageUploadField({ accept, label, sublabel, onUploaded, maxServers = 3 }: MultiImageUploadFieldProps) {
  const [items, setItems] = useState<Item[]>([])
  const queueRef = useRef<{ id: string; file: File }[]>([])
  const runningRef = useRef(false)

  const patch = (id: string, p: Partial<Item>) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...p } : it)))

  const drain = async () => {
    if (runningRef.current) return
    const servers = useSettingsStore.getState().getAllEnabledBlossomUrls().slice(0, maxServers)
    if (servers.length === 0) { toast.error('No Blossom servers configured'); return }
    runningRef.current = true
    try {
      while (queueRef.current.length > 0) {
        const { id, file } = queueRef.current.shift()!
        patch(id, { status: 'uploading', percentage: 0 })
        let last = { loaded: 0, time: Date.now() }
        try {
          const results = await uploadToAllServers(file, servers, signEvent, (p: Prog & { serverUrl: string; serverIndex: number }) => {
            const now = Date.now()
            const elapsed = (now - last.time) / 1000
            const speed = elapsed > 0 ? (p.loaded - last.loaded) / elapsed : 0
            last = { loaded: p.loaded, time: now }
            patch(id, { percentage: p.percentage, speed })
          })
          if (results.length === 0) throw new Error('All servers failed')
          patch(id, { status: 'success', percentage: 100 })
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
    setItems(prev => [
      ...prev,
      ...added.map(a => ({ id: a.id, name: a.file.name, status: 'uploading' as const, percentage: 0, speed: 0 })),
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
          {items.map(it => (
            <div key={it.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <UploadProgress status={it.status} percentage={it.percentage} speed={it.speed} fileName={it.name} error={it.error} />
              </div>
              {it.status === 'error' && (
                <button onClick={() => setItems(prev => prev.filter(x => x.id !== it.id))} className="mt-0.5 cursor-pointer text-neutral-500 hover:text-neutral-300">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
