import { useNavigate } from 'react-router-dom'
import { Package, BookOpen, ChevronRight } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { JamIcon } from '@/components/shared/JamIcon'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'

/**
 * "What do you want to submit?" — the single entry point to every publish flow.
 *
 * The submit pages have no shared navigation of their own, so without this a
 * blog post or a mod jam is only reachable by knowing the URL.
 */
const OPTIONS = [
  { to: '/submit-mod', icon: Package, title: 'Mod post', desc: 'Publish your mod for others to download' },
  { to: '/submit-blog', icon: BookOpen, title: 'Blog post', desc: 'Publish a blog post for your people to read' },
  { to: '/submit-mod-jam', icon: JamIcon, title: 'Mod jam', desc: 'Set up a Mod Jam event to entice creators' },
] as const

export function CreateMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const go = (to: string) => {
    onOpenChange(false)
    // Publishing needs a signer either way; ask up front rather than after the
    // user has filled in a whole form.
    if (!isAuthenticated) { useLoginModalStore.getState().open(); return }
    navigate(to)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#262626] bg-[#1a1a1a] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Create</DialogTitle>
          <DialogDescription className="text-neutral-400">What would you like to publish?</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          {OPTIONS.map(({ to, icon: Icon, title, desc }) => (
            <button
              key={to}
              type="button"
              onClick={() => go(to)}
              className="group flex w-full items-center gap-3 rounded-lg border border-[#262626] bg-[#212121] px-3 py-3 text-left transition-colors hover:border-purple-500/40 hover:bg-[#262626]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-neutral-100">{title}</span>
                <span className="block text-[11px] leading-relaxed text-neutral-500">{desc}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-neutral-600 transition-colors group-hover:text-purple-400" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
