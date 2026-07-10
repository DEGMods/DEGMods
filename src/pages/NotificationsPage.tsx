import { Bell } from 'lucide-react'

export function NotificationsPage() {
  return (
    <div className="mx-auto space-y-8 py-12">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
        <p className="text-neutral-400">Stay up to date with activity on your content</p>
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-[#262626] bg-[#1c1c1c] px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-600/20 mb-4">
          <Bell size={28} className="text-purple-400" />
        </div>
        <h2 className="text-xl font-semibold">No notifications yet</h2>
        <p className="mt-2 max-w-sm text-sm text-neutral-400">
          When someone comments, reacts, or zaps your mods and blog posts, you'll see it here.
        </p>
      </div>
    </div>
  )
}
