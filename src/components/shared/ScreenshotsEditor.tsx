import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Reorder, useDragControls } from 'framer-motion'
import { Plus, X, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { CharCounter } from '@/components/shared/CharCounter'
import { MultiImageUploadField } from '@/components/upload/MultiImageUploadField'
import { IMAGE_UPLOAD_ACCEPT } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface Row { id: string; url: string }

function ScreenshotRow({
  row, index, max, onChange, onRemove, onCommit, inputClass,
}: {
  row: Row
  index: number
  max: number
  onChange: (value: string) => void
  onRemove: () => void
  onCommit: () => void
  inputClass: string
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      as="div"
      value={row}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
      whileDrag={{ scale: 1.01, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}
      className="flex items-center gap-2 rounded-lg bg-[#1c1c1c] py-2"
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        aria-label="Drag to reorder"
        className="shrink-0 cursor-grab touch-none rounded p-1 text-neutral-600 hover:text-neutral-400 active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>
      <div className="h-12 w-16 shrink-0 overflow-hidden rounded border border-[#262626] bg-[#171717]">
        {row.url.trim() && (
          <img
            key={row.url}
            src={row.url}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
          />
        )}
      </div>
      <div className="flex-1">
        <Input
          value={row.url}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Screenshot URL #${index + 1}`}
          maxLength={max}
          className={cn(inputClass, 'w-full')}
        />
        <CharCounter value={row.url} max={max} />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 cursor-pointer rounded p-1.5 text-neutral-500 transition-colors hover:bg-[#2a2a2a] hover:text-neutral-300"
      >
        <X size={14} />
      </button>
    </Reorder.Item>
  )
}

/**
 * The screenshots field: drag-reorderable rows (thumbnail + URL), an "Add URL"
 * button, and a multi-image uploader. Shared by the mod and jam editors so both
 * behave identically.
 *
 * `urls` stays a plain string[] (the single source for validation/publish); the
 * rows here just carry a stable id per entry for animated reordering. Empty
 * entries are expected to be filtered out by the caller at publish time.
 */
export function ScreenshotsEditor({ urls, onChange, max, maxUrlLength, inputClass }: {
  urls: string[]
  onChange: (urls: string[]) => void
  /** Max number of screenshots. */
  max: number
  /** Max characters per URL. */
  maxUrlLength: number
  inputClass: string
}) {
  const [rows, setRows] = useState<Row[]>(
    () => (urls.length ? urls : ['']).map((url) => ({ id: crypto.randomUUID(), url })),
  )

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const sync = useCallback((next: Row[]) => {
    setRows(next)
    onChangeRef.current(next.map((r) => r.url))
  }, [])

  // Drag reorder only touches local row order (setRows) so the whole editor
  // doesn't re-render mid-drag (which glitched framer's drop animation). The new
  // order is pushed to the caller once, on drop, via commit.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const commit = useCallback(() => {
    onChangeRef.current(rowsRef.current.map((r) => r.url))
  }, [])

  // Pull external url changes (uploads, draft restore) back into rows, keeping
  // ids where the url at a position is unchanged. No-ops when the change
  // originated from sync (urls already match). An empty list still shows one
  // blank row, so callers may hold either [] or [''].
  useEffect(() => {
    setRows((prev) => {
      const target = urls.length ? urls : ['']
      if (target.length === prev.length && target.every((u, i) => u === prev[i].url)) return prev
      return target.map((url, i) => (prev[i]?.url === url ? prev[i] : { id: crypto.randomUUID(), url }))
    })
  }, [urls])

  const update = (id: string, value: string) =>
    sync(rows.map((r) => (r.id === id ? { ...r, url: value } : r)))

  const add = () => {
    if (rows.length >= max) { toast.error(`Up to ${max} screenshots`); return }
    sync([...rows, { id: crypto.randomUUID(), url: '' }])
  }

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id)
    sync(next.length === 0 ? [{ id: crypto.randomUUID(), url: '' }] : next)
  }

  const addUrl = (url: string) => {
    setRows((prev) => {
      const kept = prev.filter((r) => r.url.trim())
      if (kept.length >= max) { toast.error(`Up to ${max} screenshots`); return prev }
      const next = [...kept, { id: crypto.randomUUID(), url }]
      onChangeRef.current(next.map((r) => r.url))
      return next
    })
  }

  const filled = rows.filter((r) => r.url.trim()).length

  return (
    <>
      <div className="space-y-2">
        {rows.length > 1 && (
          <p className="text-[11px] text-neutral-600">Drag the handle to reorder — the first screenshot shows first.</p>
        )}
        <Reorder.Group as="div" axis="y" values={rows} onReorder={setRows} className="space-y-2">
          {rows.map((row, i) => (
            <ScreenshotRow
              key={row.id}
              row={row}
              index={i}
              max={maxUrlLength}
              onChange={(v) => update(row.id, v)}
              onRemove={() => remove(row.id)}
              onCommit={commit}
              inputClass={inputClass}
            />
          ))}
        </Reorder.Group>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={rows.length >= max}
          className="border-[#262626] bg-transparent text-xs text-neutral-400 hover:bg-[#2a2a2a]"
        >
          <Plus size={14} className="mr-1" /> Add URL
        </Button>
        <span className="ml-2 text-[10px] text-neutral-600">{filled}/{max}</span>
      </div>
      <Separator className="bg-[#262626]" />
      <div>
        <p className="mb-2 text-xs text-neutral-500">Or upload screenshots (mirrored to up to 3 servers)</p>
        <MultiImageUploadField
          accept={IMAGE_UPLOAD_ACCEPT}
          label="Drop screenshots here or click to browse"
          sublabel="Add several at once — they upload automatically"
          onUploaded={addUrl}
        />
      </div>
    </>
  )
}
