import { useCallback } from 'react'
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link,
  Code,
  CodeSquare,
  Quote,
  ImageIcon,
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
}

export function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  const insertMarkdown = useCallback(
    (prefix: string, suffix = '', placeholder = '') => {
      const ta = textareaRef.current
      if (!ta) return

      const start = ta.selectionStart
      const end = ta.selectionEnd
      const selected = value.slice(start, end)
      const insert = selected || placeholder

      const before = value.slice(0, start)
      const after = value.slice(end)
      const newValue = before + prefix + insert + suffix + after
      onChange(newValue)

      // Restore cursor position
      requestAnimationFrame(() => {
        ta.focus()
        const cursorPos = selected
          ? start + prefix.length + selected.length + suffix.length
          : start + prefix.length + placeholder.length
        ta.setSelectionRange(
          selected ? cursorPos : start + prefix.length,
          cursorPos,
        )
      })
    },
    [textareaRef, value, onChange],
  )

  const tools = [
    { icon: Bold, action: () => insertMarkdown('**', '**', 'bold'), tip: 'Bold' },
    { icon: Italic, action: () => insertMarkdown('*', '*', 'italic'), tip: 'Italic' },
    { icon: Strikethrough, action: () => insertMarkdown('~~', '~~', 'strikethrough'), tip: 'Strikethrough' },
    { type: 'sep' as const },
    { icon: Heading1, action: () => insertMarkdown('# ', '', 'Heading'), tip: 'Heading 1' },
    { icon: Heading2, action: () => insertMarkdown('## ', '', 'Heading'), tip: 'Heading 2' },
    { icon: Heading3, action: () => insertMarkdown('### ', '', 'Heading'), tip: 'Heading 3' },
    { type: 'sep' as const },
    { icon: List, action: () => insertMarkdown('- ', '', 'item'), tip: 'Bullet List' },
    { icon: ListOrdered, action: () => insertMarkdown('1. ', '', 'item'), tip: 'Numbered List' },
    { icon: Quote, action: () => insertMarkdown('> ', '', 'quote'), tip: 'Quote' },
    { type: 'sep' as const },
    { icon: Link, action: () => insertMarkdown('[', '](url)', 'text'), tip: 'Link' },
    { icon: ImageIcon, action: () => insertMarkdown('![', '](url)', 'alt text'), tip: 'Image' },
    { icon: Code, action: () => insertMarkdown('`', '`', 'code'), tip: 'Inline Code' },
    { icon: CodeSquare, action: () => insertMarkdown('```\n', '\n```', 'code'), tip: 'Code Block' },
  ]

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {tools.map((tool, i) => {
        if ('type' in tool && tool.type === 'sep') {
          return <div key={i} className="w-px h-5 bg-[#333] mx-1" />
        }
        const Icon = tool.icon!
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={tool.action}
                className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-[#2a2a2a] transition-colors cursor-pointer"
              >
                <Icon size={15} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {tool.tip}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
