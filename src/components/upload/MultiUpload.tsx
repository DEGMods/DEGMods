import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { FileUpload } from './FileUpload'
import { UploadProgress } from './UploadProgress'
import { uploadToServers, computeFileHash, type UploadResult, type UploadProgress as UploadProg } from '@/lib/blossom/client'
import { useSettingsStore } from '@/stores/settingsStore'
import { signEvent } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { X, Plus } from 'lucide-react'

type FileUploadStatus = 'idle' | 'hashing' | 'uploading' | 'success' | 'error'

interface FileEntry {
  id: string
  file: File
  status: FileUploadStatus
  percentage: number
  speed: number
  error?: string
  result?: UploadResult
  lastLoaded: number
  lastTime: number
}

interface MultiUploadProps {
  onComplete?: (results: UploadResult[]) => void
  onFileUploaded?: (result: UploadResult, file: File) => void
  accept?: string
  maxFiles?: number
  maxSize?: number
  label?: string
  className?: string
}

export function MultiUpload({
  onComplete,
  onFileUploaded,
  accept,
  maxFiles = 20,
  maxSize,
  label,
  className,
}: MultiUploadProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [uploading, setUploading] = useState(false)
  const [skipAll, setSkipAll] = useState(false)


  const addFile = useCallback((file: File) => {
    setFiles(prev => {
      if (prev.length >= maxFiles) {
        toast.error(`Maximum ${maxFiles} files allowed`)
        return prev
      }
      return [...prev, {
        id: crypto.randomUUID(),
        file,
        status: 'idle' as const,
        percentage: 0,
        speed: 0,
        lastLoaded: 0,
        lastTime: Date.now(),
      }]
    })
  }, [maxFiles])

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const uploadAll = async () => {
    const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
    if (blossomUrls.length === 0) {
      toast.error('No Blossom servers configured')
      return
    }
    setUploading(true)
    setSkipAll(false)
    const results: UploadResult[] = []

    for (const entry of files) {
      if (skipAll) break
      if (entry.status === 'success') {
        if (entry.result) results.push(entry.result)
        continue
      }

      // Hashing
      setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'hashing' as const, percentage: 0 } : f))
      try {
        await computeFileHash(entry.file)
      } catch {
        setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'error' as const, error: 'Hash failed' } : f))
        continue
      }

      // Uploading
      setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'uploading' as const, lastTime: Date.now(), lastLoaded: 0 } : f))
      try {
        const result = await uploadToServers(entry.file, blossomUrls, signEvent, (progress: UploadProg & { serverUrl: string }) => {
          setFiles(prev => prev.map(f => {
            if (f.id !== entry.id) return f
            const now = Date.now()
            const elapsed = (now - f.lastTime) / 1000
            const speed = elapsed > 0 ? (progress.loaded - f.lastLoaded) / elapsed : 0
            return { ...f, percentage: progress.percentage, speed, lastLoaded: progress.loaded, lastTime: now }
          }))
        })
        setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'success' as const, percentage: 100, result } : f))
        results.push(result)
        onFileUploaded?.(result, entry.file)
      } catch (err) {
        setFiles(prev => prev.map(f => f.id === entry.id
          ? { ...f, status: 'error' as const, error: err instanceof Error ? err.message : 'Upload failed' }
          : f
        ))
      }
    }

    setUploading(false)
    if (results.length > 0) onComplete?.(results)
  }

  const pendingCount = files.filter(f => f.status !== 'success').length
  const successCount = files.filter(f => f.status === 'success').length

  return (
    <div className={cn('space-y-3', className)}>
      {/* Drop zone */}
      <FileUpload
        onFileSelect={addFile}
        accept={accept}
        maxSize={maxSize}
        label={label || 'Drop files here or click to add'}
        sublabel={`${files.length}/${maxFiles} files`}
        disabled={uploading}
      />

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(entry => (
            <div key={entry.id} className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <UploadProgress
                  status={entry.status}
                  percentage={entry.percentage}
                  speed={entry.speed}
                  fileName={entry.file.name}
                  error={entry.error}
                />
              </div>
              {!uploading && entry.status !== 'uploading' && (
                <button
                  onClick={() => removeFile(entry.id)}
                  className="text-neutral-500 hover:text-neutral-300 mt-0.5 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {files.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500">
            {successCount}/{files.length} uploaded
          </span>
          <div className="flex gap-2">
            {uploading && (
              <Button variant="outline" size="sm" onClick={() => setSkipAll(true)} className="text-xs border-[#262626]">
                Skip All
              </Button>
            )}
            {!uploading && pendingCount > 0 && (
              <Button size="sm" onClick={uploadAll} className="text-xs bg-purple-600 hover:bg-purple-700">
                Upload {pendingCount} file{pendingCount > 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
