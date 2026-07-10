import { useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Upload, X, FileIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Whether a file matches an `accept` string. Unlike the browser's `accept`
 * attribute (a picker-only hint that drag-drop ignores), this is enforced.
 * Tokens may be extensions ('.zip'), wildcard MIME ('image/*'), or exact MIME.
 */
function matchesAccept(file: File, accept: string): boolean {
  const tokens = accept.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
  if (tokens.length === 0) return true
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()
  return tokens.some(tok => {
    if (tok.startsWith('.')) return name.endsWith(tok)
    if (tok.endsWith('/*')) return mime.startsWith(tok.slice(0, -1))
    return mime === tok
  })
}

interface FileUploadProps {
  onFileSelect?: (file: File) => void
  /** Multi-file callback; used when `multiple` is set. */
  onFilesSelect?: (files: File[]) => void
  /** Allow selecting / dropping several files at once. */
  multiple?: boolean
  accept?: string                    // e.g. 'image/*', '.zip,.rar'
  maxSize?: number                   // bytes, default 500MB
  label?: string
  sublabel?: string
  disabled?: boolean
  className?: string
}

export function FileUpload({
  onFileSelect,
  onFilesSelect,
  multiple = false,
  accept,
  maxSize = 500 * 1024 * 1024,
  label = 'Drop file here or click to browse',
  sublabel,
  disabled = false,
  className,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setIsDragging(true)
  }, [disabled])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  // Validate a single file (toasts on failure).
  const isValid = useCallback((file: File): boolean => {
    if (accept && !matchesAccept(file, accept)) {
      toast.error(`Unsupported file type "${file.name}". Allowed: ${accept}`)
      return false
    }
    if (maxSize && file.size > maxSize) {
      const maxMB = Math.round(maxSize / 1024 / 1024)
      toast.error(`"${file.name}" is too large. Maximum size is ${maxMB} MB.`)
      return false
    }
    return true
  }, [accept, maxSize])

  const accept_ = useCallback((fileList: FileList | null | undefined) => {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    if (multiple) {
      const valid = files.filter(isValid)
      if (valid.length) onFilesSelect?.(valid)
    } else {
      const file = files[0]
      if (isValid(file)) { setSelectedFile(file); onFileSelect?.(file) }
    }
  }, [multiple, isValid, onFilesSelect, onFileSelect])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (disabled) return
    accept_(e.dataTransfer.files)
  }, [disabled, accept_])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    accept_(e.target.files)
    if (inputRef.current) inputRef.current.value = ''
  }, [accept_])

  const clearFile = () => {
    setSelectedFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className={className}>
      {selectedFile ? (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-[#262626] bg-[#1c1c1c]">
          <FileIcon size={20} className="text-purple-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white truncate">{selectedFile.name}</p>
            <p className="text-xs text-neutral-500">{formatSize(selectedFile.size)}</p>
          </div>
          <button onClick={clearFile} className="text-neutral-500 hover:text-neutral-300 cursor-pointer">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && inputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center gap-2 p-8 rounded-lg border-2 border-dashed transition-colors cursor-pointer',
            isDragging ? 'border-purple-500 bg-purple-500/5' : 'border-[#262626] hover:border-[#404040]',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Upload size={24} className={cn('text-neutral-500', isDragging && 'text-purple-400')} />
          <p className="text-sm text-neutral-400 text-center">{label}</p>
          {sublabel && <p className="text-xs text-neutral-600 text-center">{sublabel}</p>}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled}
      />
    </div>
  )
}
