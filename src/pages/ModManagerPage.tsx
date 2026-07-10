import { FolderSync, RefreshCw, ShieldAlert, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

const features = [
  {
    icon: FolderSync,
    title: 'Auto-Install',
    desc: 'Automatically install mods to the correct game directory. No manual file copying required.',
  },
  {
    icon: RefreshCw,
    title: 'Update Tracking',
    desc: 'Get notified when mod authors publish updates. Keep your mods current with one click.',
  },
  {
    icon: ShieldAlert,
    title: 'Conflict Detection',
    desc: 'Detect and resolve conflicts between mods. See which files overlap before installing.',
  },
]

export function ModManagerPage() {
  return (
    <div className="mx-auto space-y-12 py-12">
      {/* Header */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">DEG MODS Manager</h1>
          <span className="rounded-full bg-purple-600/20 px-3 py-1 text-xs font-semibold text-purple-400">
            Coming Soon
          </span>
        </div>
        <p className="max-w-2xl text-lg text-neutral-400 leading-relaxed">
          A desktop application for managing your downloaded mods. Install, update, and organize
          mods across your games.
        </p>
      </section>

      {/* Feature Cards */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold">Features</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {features.map((item) => (
            <div
              key={item.title}
              className={cn(
                'rounded-xl border border-[#262626] bg-[#1c1c1c] p-6 space-y-3',
                'hover:border-purple-600/50 transition-colors'
              )}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600/20">
                <item.icon size={20} className="text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Download placeholder */}
      <section
        className={cn(
          'rounded-xl border border-dashed border-[#262626] bg-[#1c1c1c] p-8',
          'flex flex-col items-center gap-4 text-center'
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-600/20">
          <Download size={24} className="text-purple-400" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">Download</h3>
          <p className="text-sm text-neutral-400">
            The download will be available here when ready. The mod manager is currently in
            development.
          </p>
        </div>
      </section>
    </div>
  )
}
