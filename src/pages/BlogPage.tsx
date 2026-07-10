import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore } from '@/stores/userStore'
import type { UserProfile } from '@/stores/userStore'
import { extractBlogData } from '@/lib/nostr/events'
import { KINDS, ADMIN_PUBKEY } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { BlogDetails } from '@/types/blog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BlogPostCard } from '@/components/blog/BlogPostCard'
import { ChevronLeft, ChevronRight, BookOpen, Plus } from 'lucide-react'

const BLOGS_PER_PAGE = 10

export default function BlogPage() {
  const [allBlogs, setAllBlogs] = useState<BlogDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [authorProfiles, setAuthorProfiles] = useState<Map<string, UserProfile>>(new Map())

  useEffect(() => {
    let cancelled = false

    async function load() {
      const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      setLoading(true)
      try {
        const events = await fetchEvents(relayUrls, { kinds: [KINDS.BLOG], authors: [ADMIN_PUBKEY] }, 10000)
        if (!cancelled) {
          // Deduplicate by d-tag + pubkey, keep latest
          const byKey = new Map<string, typeof events[0]>()
          for (const event of events) {
            const dTag = event.tags.find(t => t[0] === 'd')?.[1] ?? ''
            const key = `${event.pubkey}:${dTag}`
            const existing = byKey.get(key)
            if (!existing || event.created_at > existing.created_at) {
              byKey.set(key, event)
            }
          }
          const parsed = Array.from(byKey.values())
            .map(extractBlogData)
            .filter(b => !b.isDeleted)
            .sort((a, b) => b.publishedAt - a.publishedAt)
          setAllBlogs(parsed)

          // Fetch author profiles
          const uniquePubkeys = [...new Set(parsed.map(b => b.pubkey))]
          const profiles = new Map<string, UserProfile>()
          await Promise.allSettled(
            uniquePubkeys.map(async (pk) => {
              const p = await useUserStore.getState().fetchProfile(pk, relayUrls)
              if (p) profiles.set(pk, p)
            })
          )
          if (!cancelled) setAuthorProfiles(profiles)
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const totalPages = Math.max(1, Math.ceil(allBlogs.length / BLOGS_PER_PAGE))
  const paged = useMemo(() => {
    const start = (page - 1) * BLOGS_PER_PAGE
    return allBlogs.slice(start, start + BLOGS_PER_PAGE)
  }, [allBlogs, page])

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-purple-400" />
          <h1 className="text-2xl font-bold text-neutral-100">Blog</h1>
        </div>
        <Link to="/write">
          <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5">
            <Plus size={14} />
            Publish Blog
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-[#1c1c1c] border border-[#262626] rounded-lg p-5 space-y-3">
              <Skeleton className="h-5 w-3/4 bg-[#212121]" />
              <Skeleton className="h-4 w-full bg-[#212121]" />
              <Skeleton className="h-4 w-1/2 bg-[#212121]" />
              <div className="flex items-center gap-2 pt-2">
                <Skeleton className="h-6 w-6 rounded-full bg-[#212121]" />
                <Skeleton className="h-3 w-24 bg-[#212121]" />
              </div>
            </div>
          ))}
        </div>
      ) : allBlogs.length === 0 ? (
        <div className="text-center py-20">
          <BookOpen className="h-12 w-12 text-neutral-600 mx-auto mb-4" />
          <p className="text-neutral-500 text-sm">No blog posts found.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {paged.map(blog => (
              <BlogPostCard
                key={blog.id}
                blog={blog}
                author={authorProfiles.get(blog.pubkey)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 border-[#262626] hover:bg-[#2a2a2a]"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-8 w-8 border-[#262626]',
                    page === i + 1
                      ? 'bg-purple-600 border-purple-600 text-white hover:bg-purple-700'
                      : 'hover:bg-[#2a2a2a]'
                  )}
                  onClick={() => setPage(i + 1)}
                >
                  {i + 1}
                </Button>
              ))}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 border-[#262626] hover:bg-[#2a2a2a]"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
