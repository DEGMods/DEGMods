import { useState, useEffect } from 'react'
import { BookOpen } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { extractBlogData } from '@/lib/nostr/events'
import { KINDS } from '@/lib/constants'
import type { BlogDetails } from '@/types/blog'
import { BlogPostCard } from './BlogPostCard'
import { Skeleton } from '@/components/ui/skeleton'

interface AuthorBlogPostsProps {
  pubkey: string
  /** aTag of the post currently being viewed, so it's excluded. */
  excludeATag?: string
  limit?: number
}

/**
 * Shows an author's latest blog posts, used below mod/blog posts, mirroring
 * the "From the Blog" section on the home page. Always renders (with a loading
 * skeleton and an empty message), and can exclude the currently-viewed post.
 */
export function AuthorBlogPosts({ pubkey, excludeATag, limit = 2 }: AuthorBlogPostsProps) {
  const [blogs, setBlogs] = useState<BlogDetails[]>([])
  const [author, setAuthor] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const [events, profile] = await Promise.all([
        fetchEvents(relays, { kinds: [KINDS.BLOG], authors: [pubkey] }, 8000),
        useUserStore.getState().fetchProfile(pubkey, relays),
      ])
      if (cancelled) return

      const byKey = new Map<string, typeof events[0]>()
      for (const ev of events) {
        const d = ev.tags.find(t => t[0] === 'd')?.[1] ?? ''
        const key = `${ev.pubkey}:${d}`
        const existing = byKey.get(key)
        if (!existing || ev.created_at > existing.created_at) byKey.set(key, ev)
      }
      const parsed = Array.from(byKey.values())
        .map(extractBlogData)
        .filter(b => !b.isDeleted && b.aTag !== excludeATag)
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, limit)

      setBlogs(parsed)
      setAuthor(profile)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [pubkey, excludeATag, limit])

  const name = author?.display_name

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-200">
        <BookOpen className="h-5 w-5 text-purple-400" />
        {name ? `Blog posts from ${name}` : 'Blog posts from this author'}
      </h2>

      {loading ? (
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex min-w-[260px] flex-1 gap-4 overflow-hidden rounded-lg bg-[#1c1c1c]">
              <Skeleton className="aspect-video w-40 shrink-0 rounded-none" />
              <div className="flex-1 space-y-2 py-4 pr-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : blogs.length === 0 ? (
        <p className="text-sm text-neutral-500">No blog posts from this author yet.</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {blogs.map(blog => (
            <div key={blog.id} className="min-w-[260px] flex-1">
              <BlogPostCard blog={blog} author={author ?? undefined} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
