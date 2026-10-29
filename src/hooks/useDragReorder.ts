import { useState } from 'react'
import type { Dispatch, DragEvent, SetStateAction } from 'react'

/** Move an array item from one index to another (returns a new array). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr
  const next = arr.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * HTML5 drag-to-reorder for a list managed by `setList` (no library). Returns the
 * index currently being dragged (for styling) and `itemProps(i)` to spread on each
 * item element. `onReorder` fires after a successful drop (e.g. to mark dirty).
 */
export function useDragReorder<T>(
  setList: Dispatch<SetStateAction<T[]>>,
  onReorder: () => void,
) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const itemProps = (i: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move' },
    onDragOver: (e: DragEvent) => { e.preventDefault() },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      if (dragIndex !== null && dragIndex !== i) {
        setList((list) => moveItem(list, dragIndex, i))
        onReorder()
      }
      setDragIndex(null)
    },
    onDragEnd: () => setDragIndex(null),
  })
  return { dragIndex, itemProps }
}
