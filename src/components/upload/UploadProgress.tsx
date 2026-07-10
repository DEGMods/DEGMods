import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

type UploadStatus = 'idle' | 'hashing' | 'uploading' | 'success' | 'error'

interface UploadProgressProps {
  status: UploadStatus
  percentage: number
  speed?: number          // bytes per second
  fileName?: string
  serverUrl?: string
  error?: string
  className?: string
}

export function UploadProgress({
  status,
  percentage,
  speed,
  fileName,
  serverUrl,
  error,
  className,
}: UploadProgressProps) {
  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec < 1024) return `${bytesPerSec} B/s`
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
    return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* File name + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {status === 'hashing' && <Loader2 size={14} className="animate-spin text-purple-400 shrink-0" />}
          {status === 'uploading' && <Loader2 size={14} className="animate-spin text-purple-400 shrink-0" />}
          {status === 'success' && <CheckCircle size={14} className="text-green-500 shrink-0" />}
          {status === 'error' && <XCircle size={14} className="text-red-500 shrink-0" />}
          {fileName && <span className="text-sm text-white truncate">{fileName}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500 shrink-0">
          {status === 'hashing' && <span>Hashing...</span>}
          {status === 'uploading' && (
            <>
              {speed !== undefined && <span>{formatSpeed(speed)}</span>}
              <span>{percentage}%</span>
            </>
          )}
          {status === 'success' && <span>Done</span>}
          {status === 'error' && <span className="text-red-400">Failed</span>}
        </div>
      </div>

      {/* Progress bar */}
      {(status === 'uploading' || status === 'hashing') && (
        <div className="h-1.5 rounded-full bg-[#262626] overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              status === 'hashing' ? 'bg-purple-400/50 animate-pulse w-full' : 'bg-purple-500',
            )}
            style={status === 'uploading' ? { width: `${percentage}%` } : undefined}
          />
        </div>
      )}

      {/* Server URL */}
      {serverUrl && status === 'uploading' && (
        <p className="text-[11px] text-neutral-600 truncate">→ {serverUrl}</p>
      )}

      {/* Error message */}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
