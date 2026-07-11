import { Download, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

const MO2_VIDEO = 'https://www.youtube.com/embed/07-JVWDn7LA'
const MO2_RELEASES = 'https://github.com/ModOrganizer2/modorganizer/releases'

export function ModManagerPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 py-12">
      {/* Header */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">DEG MODS Manager</h1>
          <span className="rounded-full bg-purple-600/20 px-3 py-1 text-xs font-semibold text-purple-400">
            Coming Soon
          </span>
        </div>
        <div className="space-y-4 text-lg leading-relaxed text-neutral-400">
          <p>
            DEG Mods will eventually have its own mod manager software, likely a fork of{' '}
            <span className="text-neutral-200">Mod Organizer 2</span>, customized to work seamlessly
            with DEG Mods. Until then, you can use Mod Organizer 2 as it is. It is already a powerful
            and useful tool without any modifications, and it makes modding your games much easier.
          </p>
          <p>
            To help you get familiar with Mod Organizer 2, there are online videos that can guide
            you. Here is one of them.
          </p>
        </div>
      </section>

      {/* Video */}
      <section>
        <div className="overflow-hidden rounded-xl border border-[#262626] bg-black">
          <div className="relative aspect-video">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={MO2_VIDEO}
              title="Getting started with Mod Organizer 2"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      {/* Download */}
      <section
        className={cn(
          'flex flex-col items-center gap-4 rounded-xl border border-[#262626] bg-[#1c1c1c] p-8 text-center',
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-600/20">
          <Download size={24} className="text-purple-400" />
        </div>
        <p className="max-w-md text-sm text-neutral-400">
          You can find and download Mod Organizer 2 from their GitHub repository.
        </p>
        <a
          href={MO2_RELEASES}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white',
            'transition-colors hover:bg-purple-700',
          )}
        >
          Download Mod Organizer 2
          <ExternalLink size={16} />
        </a>
      </section>
    </div>
  )
}
