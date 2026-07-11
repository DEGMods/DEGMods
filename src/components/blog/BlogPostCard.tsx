import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { cn } from '@/lib/utils'
import { KINDS } from '@/lib/constants'
import { SkeletonImage } from '@/components/shared/SkeletonImage'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { BookOpen, User } from 'lucide-react'
import type { BlogDetails } from '@/types/blog'
import type { UserProfile } from '@/stores/userStore'

interface BlogPostCardProps {
  blog: BlogDetails
  author?: UserProfile
}

export function BlogPostCard({ blog, author }: BlogPostCardProps) {
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
        <div className="relative aspect-video shrink-0 self-stretch overflow-hidden bg-[#171717]">
          {blog.featuredImageUrl ? (
            <SkeletonImage
              src={blog.featuredImageUrl}
              alt={blog.title}
              className="absolute inset-0 w-full h-full object-cover"
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
