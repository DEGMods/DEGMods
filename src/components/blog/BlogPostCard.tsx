import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { cn } from '@/lib/utils'
import { KINDS } from '@/lib/constants'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { BookOpen, User, AlertTriangle } from 'lucide-react'
import { useNsfwReveal } from '@/hooks/useNsfwReveal'
import { useModerationOverlay } from '@/hooks/useModerationTags'
import type { BlogDetails } from '@/types/blog'
import type { UserProfile } from '@/stores/userStore'

interface BlogPostCardProps {
  blog: BlogDetails
  author?: UserProfile
}

export function BlogPostCard({ blog, author }: BlogPostCardProps) {
  const { revealed, reveal } = useNsfwReveal()
  // The author's own warning, plus anything the admin tagged on top.
  const { overlay, checked } = useModerationOverlay(blog.aTag)
  const warning = blog.contentWarning || overlay?.contentWarning
  const hasWarning = !!warning && !revealed
  // Hold the image until the overlay has settled, so a post the admin marked
  // NSFW can't paint before we know. Only the image waits — the title, summary
  // and author render immediately.
  const holdImage = !checked && !blog.contentWarning

  const naddr = nip19.naddrEncode({
    identifier: blog.dTag,
    pubkey: blog.pubkey,
    kind: KINDS.BLOG,
  })

  const date = new Date(blog.publishedAt * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Link to={`/blog/${naddr}`} className="block group h-full">
      <div
        className={cn(
          'flex h-full gap-4 bg-[#1c1c1c] border border-[#262626] rounded-lg overflow-hidden',
          'hover:border-[#404040] transition-colors'
        )}
      >
        {/* Featured image: pulsing skeleton while loading, lazy-loaded in viewport */}
        <div className="relative w-full max-w-32 sm:max-w-[280px] shrink-0 self-stretch overflow-hidden bg-[#171717]">
          {blog.featuredImageUrl ? (
            <SkeletonImage
              src={blog.featuredImageUrl}
              alt={blog.title}
              className={cn(
                'absolute inset-0 w-full h-full object-cover',
                (hasWarning || holdImage) && 'blur-xl',
              )}
              fallback={
                <div className="absolute inset-0 flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-neutral-700" />
                </div>
              }
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-neutral-700" />
            </div>
          )}

          {hasWarning && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); reveal() }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/60 text-neutral-300"
            >
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <span className="px-2 text-center text-[10px] font-medium">{warning}</span>
              <span className="text-[10px] text-neutral-500">Click to reveal</span>
            </button>
          )}
        </div>

        {/* Text */}
        <div className="flex flex-1 min-w-0 flex-col py-4 pr-4">
          <div className="flex-1">
            <h3 className="font-semibold text-neutral-100 group-hover:text-purple-400 transition-colors line-clamp-2">
              {blog.title}
            </h3>
            {blog.summary && (
              <p className="text-sm text-neutral-400 mt-1 line-clamp-2">{blog.summary}</p>
            )}
          </div>
          <div className="flex items-center gap-2 mt-3">
            {author && (
              <>
                <Avatar className="h-5 w-5">
                  {author.picture ? (
                    <AvatarImage src={author.picture} alt={author.display_name || author.name || ''} />
                  ) : null}
                  <AvatarFallback className="bg-[#212121] text-neutral-400">
                    <User className="h-3 w-3" />
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-neutral-400 truncate">
                  {author.display_name || author.name || 'Anonymous'}
                </span>
                <span className="text-neutral-600">·</span>
              </>
            )}
            <span className="text-xs text-neutral-500 shrink-0">{date}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
