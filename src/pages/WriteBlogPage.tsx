import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import { buildBlogEvent, extractBlogData } from '@/lib/nostr/events'
import { signAndPublish } from '@/lib/nostr/publish'
import { cacheEvent } from '@/lib/nostr/eventCache'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { KINDS, IMAGE_UPLOAD_ACCEPT } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { RequiredDot } from '@/components/shared/RequiredDot'
import { toast } from 'sonner'
import type { BlogFormState } from '@/types/blog'
import { createEmptyBlogFormState } from '@/types/blog'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, Plus, X, Save, Eye, Edit, BookOpen, RotateCcw } from 'lucide-react'
import { MarkdownToolbar } from '@/components/shared/MarkdownToolbar'
import { Markdown } from '@/components/shared/Markdown'
import { BlossomUploadField } from '@/components/upload/BlossomUploadField'

const DRAFT_KEY_PREFIX = 'deg-mods-blog-draft-'

const LIMITS = { title: 150, summary: 500, content: 30000, tag: 100, featuredImage: 200 } as const

/** A character counter that only appears as the value approaches `max`. */
function Counter({ value, max }: { value: string; max: number }) {
  if (value.length < max * 0.8) return null
  return (
    <p className={cn('text-right text-xs tabular-nums', value.length >= max ? 'text-red-400' : 'text-neutral-500')}>
      {value.length.toLocaleString()} / {max.toLocaleString()}
    </p>
  )
}

// Stable key so a new-post draft survives navigation / closing the tab.
const NEW_BLOG_DRAFT_KEY = `${DRAFT_KEY_PREFIX}new`

export default function WriteBlogPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isAuthenticated, pubkey } = useAuthStore()

  const editNaddr = searchParams.get('edit')

  const [form, setForm] = useState<BlogFormState>(createEmptyBlogFormState)
  const [publishing, setPublishing] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [errors, setErrors] = useState<{ title?: string; content?: string }>({})
  const [showResetDialog, setShowResetDialog] = useState(false)
  const blogBodyRef = useRef<HTMLTextAreaElement>(null)
  const tagInputsRef = useRef<(HTMLInputElement | null)[]>([])

  // Snapshot of the published values, to enable the Update button only on change.
  const publishedFormRef = useRef<BlogFormState | null>(null)
  const isDirty = useMemo(() => {
    if (!form.isEdit || !publishedFormRef.current) return true
    const normalize = (f: BlogFormState) =>
      JSON.stringify({ ...f, isEdit: false, previousCreatedAt: undefined, publishedAt: undefined })
    return normalize(form) !== normalize(publishedFormRef.current)
  }, [form])

  // Reset an in-progress edit back to the currently published post.
  const handleReset = () => {
    if (publishedFormRef.current) setForm(publishedFormRef.current)
    setErrors({})
    setShowResetDialog(false)
    toast.success('Changes reset to the published version')
  }

  // Auth gate
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <BookOpen className="h-12 w-12 text-neutral-500" />
        <h2 className="text-xl font-semibold text-neutral-200">Login required</h2>
        <p className="text-neutral-400 text-sm">You must be logged in to write blog posts.</p>
        <Button
          className="bg-purple-600 hover:bg-purple-700 text-white"
          onClick={() => useLoginModalStore.getState().open()}
        >
          Log In
        </Button>
      </div>
    )
  }

  // Load existing blog for editing
  useEffect(() => {
    if (!editNaddr) return
    let cancelled = false

    async function load() {
      const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      setLoadingEdit(true)
      try {
        const decoded = nip19.decode(editNaddr!)
        if (decoded.type !== 'naddr') {
          toast.error('Invalid blog address')
          setLoadingEdit(false)
          return
        }

        const { pubkey: authorPk, identifier, kind } = decoded.data
        const event = await fetchEvent(
          relayUrls,
          { kinds: [kind], authors: [authorPk], '#d': [identifier] }
        )

        if (cancelled) return

        if (!event) {
          toast.error('Blog post not found')
          setLoadingEdit(false)
          return
        }

        const blogData = extractBlogData(event)
        const loaded: BlogFormState = {
          dTag: blogData.dTag,
          title: blogData.title,
          summary: blogData.summary,
          content: blogData.content,
          featuredImageUrl: blogData.featuredImageUrl || '',
          tags: blogData.tags.length > 0 ? blogData.tags : [''],
          isEdit: true,
          previousCreatedAt: event.created_at,
          publishedAt: blogData.publishedAt,
        }
        setForm(loaded)
        publishedFormRef.current = loaded
      } catch {
        toast.error('Failed to load blog post')
      } finally {
        if (!cancelled) setLoadingEdit(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [editNaddr])

  // Auto-restore the new-post draft on mount (no prompt)
  useEffect(() => {
    if (editNaddr) return
    const saved = localStorage.getItem(NEW_BLOG_DRAFT_KEY)
    if (saved) {
      try {
        setForm(JSON.parse(saved) as BlogFormState)
      } catch {
        // Invalid draft
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save the new-post draft as the user edits
  const saveDraft = useCallback(() => {
    if (editNaddr) return
    localStorage.setItem(NEW_BLOG_DRAFT_KEY, JSON.stringify(form))
  }, [form, editNaddr])

  useEffect(() => {
    const timeout = setTimeout(saveDraft, 1000)
    return () => clearTimeout(timeout)
  }, [saveDraft])

  const updateField = <K extends keyof BlogFormState>(field: K, value: BlogFormState[K]) => {
    setForm(prev => ({ ...prev, [field]: value }))
    if (field === 'title' || field === 'content') {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  const addTag = () => {
    setForm(prev => ({ ...prev, tags: [...prev.tags, ''] }))
  }

  const removeTag = (index: number) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.filter((_, i) => i !== index),
    }))
  }

  const handleTagKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!form.tags[index]?.trim()) return
    const next = [...form.tags, '']
    setForm(prev => ({ ...prev, tags: next }))
    setTimeout(() => tagInputsRef.current[next.length - 1]?.focus(), 0)
  }

  const updateTag = (index: number, value: string) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.map((t, i) => (i === index ? value : t)),
    }))
  }

  const validate = (): boolean => {
    const newErrors: typeof errors = {}
    if (!form.title.trim()) newErrors.title = 'Title is required'
    if (!form.content.trim()) newErrors.content = 'Content is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handlePublish = async () => {
    if (!validate()) return

    setPublishing(true)
    try {
      const unsignedEvent = buildBlogEvent(form)
      const result = await signAndPublish(unsignedEvent)

      if (!result.success) {
        toast.error(result.error || 'Failed to publish')
        setPublishing(false)
        return
      }

      // Cache the just-published revision so the blog page shows YOUR new version
      // immediately (newest-wins), instead of the stale cache + a "new version" prompt.
      if (result.event) cacheEvent(result.event)

      // Clear the new-post draft (only relevant for new posts)
      if (!form.isEdit) localStorage.removeItem(NEW_BLOG_DRAFT_KEY)

      toast.success(form.isEdit ? 'Blog post updated!' : 'Blog post published!')

      // Navigate to the published post
      const naddr = nip19.naddrEncode({
        identifier: form.dTag,
        pubkey: pubkey!,
        kind: KINDS.BLOG,
      })
      navigate(`/blog/${naddr}`)
    } catch (err) {
      toast.error('Failed to publish blog post')
    } finally {
      setPublishing(false)
    }
  }

  if (loadingEdit) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    )
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-purple-400" />
        <h1 className="text-2xl font-bold text-neutral-100">
          {form.isEdit ? 'Edit Blog Post' : 'Write Blog Post'}
        </h1>
      </div>

      <Separator className="bg-[#262626]" />

      {/* Title */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-300">
          Title *
          {!form.title.trim() && <RequiredDot label="A title is still needed" />}
        </label>
        <Input
          value={form.title}
          onChange={e => updateField('title', e.target.value)}
          placeholder="Enter your blog post title"
          maxLength={LIMITS.title}
          className={cn(
            'bg-[#212121] border-[#262626] text-neutral-100 placeholder:text-neutral-500',
            errors.title && 'border-red-500'
          )}
        />
        <Counter value={form.title} max={LIMITS.title} />
        {errors.title && <p className="text-xs text-red-400">{errors.title}</p>}
      </div>

      {/* Featured Image */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-neutral-300">Featured Image</label>
        <Input
          value={form.featuredImageUrl}
          onChange={e => updateField('featuredImageUrl', e.target.value)}
          placeholder="https://example.com/image.jpg (optional)"
          maxLength={LIMITS.featuredImage}
          className="bg-[#212121] border-[#262626] text-neutral-100 placeholder:text-neutral-500"
        />
        <Counter value={form.featuredImageUrl} max={LIMITS.featuredImage} />
        <BlossomUploadField
          accept={IMAGE_UPLOAD_ACCEPT}
          label="Or drop an image here (mirrored to up to 3 servers)"
          sublabel="JPG, PNG, WebP, GIF, AVIF"
          onUploaded={(r) => updateField('featuredImageUrl', r.url)}
        />
        {form.featuredImageUrl && (
          <div className="mt-2 rounded-lg overflow-hidden border border-[#262626] max-h-48">
            <img
              src={form.featuredImageUrl}
              alt="Preview"
              className="w-full max-h-48 object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-neutral-300">Summary</label>
        <Textarea
          value={form.summary}
          onChange={e => updateField('summary', e.target.value)}
          placeholder="A brief summary of your blog post (optional)"
          rows={3}
          maxLength={LIMITS.summary}
          className="bg-[#212121] border-[#262626] text-neutral-100 placeholder:text-neutral-500 resize-none"
        />
        <Counter value={form.summary} max={LIMITS.summary} />
      </div>

      {/* Body with Edit/Preview tabs */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-300">
          Content *
          {!form.content.trim() && <RequiredDot label="The post body is still empty" />}
        </label>
        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="bg-[#1c1c1c] border border-[#262626]">
            <TabsTrigger
              value="edit"
              className="data-[state=active]:bg-[#262626] data-[state=active]:text-purple-400"
            >
              <Edit className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </TabsTrigger>
            <TabsTrigger
              value="preview"
              className="data-[state=active]:bg-[#262626] data-[state=active]:text-purple-400"
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              Preview
            </TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="mt-2 space-y-2">
            <MarkdownToolbar
              textareaRef={blogBodyRef}
              value={form.content}
              onChange={(val) => updateField('content', val)}
            />
            <Textarea
              ref={blogBodyRef}
              value={form.content}
              onChange={e => updateField('content', e.target.value)}
              placeholder="Write your blog post content here..."
              rows={15}
              maxLength={LIMITS.content}
              className={cn(
                'bg-[#212121] border-[#262626] text-neutral-100 placeholder:text-neutral-500 resize-y min-h-[300px] font-mono text-sm',
                errors.content && 'border-red-500'
              )}
            />
            <Counter value={form.content} max={LIMITS.content} />
            {errors.content && <p className="text-xs text-red-400 mt-1">{errors.content}</p>}
          </TabsContent>

          <TabsContent value="preview" className="mt-2">
            <div className="bg-[#212121] border border-[#262626] rounded-md p-5 min-h-[300px]">
              {form.content.trim() ? (
                <Markdown content={form.content} />
              ) : (
                <p className="text-neutral-500 text-sm italic">Nothing to preview yet.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Tags */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-neutral-300">Tags</label>
        <div className="space-y-2">
          {form.tags.map((tag, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  ref={(el) => { tagInputsRef.current[i] = el }}
                  value={tag}
                  onChange={e => updateTag(i, e.target.value)}
                  onKeyDown={(e) => handleTagKeyDown(e, i)}
                  placeholder={`Tag ${i + 1}`}
                  maxLength={LIMITS.tag}
                  className="bg-[#212121] border-[#262626] text-neutral-100 placeholder:text-neutral-500"
                />
                {form.tags.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-neutral-500 hover:text-red-400"
                    onClick={() => removeTag(i)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Counter value={tag} max={LIMITS.tag} />
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="border-[#262626] hover:bg-[#2a2a2a] text-neutral-400"
            onClick={addTag}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Tag
          </Button>
        </div>
      </div>

      <Separator className="bg-[#262626]" />

      {/* Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs text-neutral-500">
          {!editNaddr && <span>Draft auto-saved</span>}
        </div>
        <div className="flex flex-1 items-center gap-3">
          <Button
            variant="outline"
            className="border-[#262626] hover:bg-[#2a2a2a]"
            onClick={() => navigate(-1)}
          >
            Cancel
          </Button>
          {form.isEdit && (
            <Button
              variant="outline"
              onClick={() => setShowResetDialog(true)}
              disabled={publishing || !isDirty}
              className="border-[#262626] text-neutral-300 hover:bg-[#2a2a2a] disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4 mr-2" /> Reset changes
            </Button>
          )}
          <Button
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
            onClick={handlePublish}
            disabled={publishing || (form.isEdit && !isDirty)}
          >
            {publishing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {form.isEdit ? 'Update' : 'Publish'}
              </>
            )}
          </Button>
        </div>
      </div>

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Reset changes?</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This discards your edits and restores every field to the currently published version of this post. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)} className="border-[#262626]">Cancel</Button>
            <Button onClick={handleReset} className="bg-red-600 hover:bg-red-700 text-white">Reset to published</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
