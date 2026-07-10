import { Link } from 'react-router-dom'
import { EyeOff, ShieldAlert, Settings2 } from 'lucide-react'
import { CLIENT_NAME } from '@/lib/constants'

const SETTINGS_LINK = '/settings?tab=moderation'

function DisableNote() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
      <span>You can disable the admins' moderation in settings, at your own risk.</span>
      <Link
        to={SETTINGS_LINK}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#262626] px-2.5 py-1 text-neutral-200 transition-colors hover:border-[#404040] hover:text-white"
      >
        <Settings2 className="h-3.5 w-3.5" />
        Moderation settings
      </Link>
    </div>
  )
}

/** Soft moderation: shown at the top of a hidden mod (content still visible). */
export function ModerationHiddenWarning() {
  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-2.5">
      <div className="flex items-start gap-2.5">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
        <p className="text-sm text-yellow-200/90 leading-relaxed">
          This mod is hidden from discovery and marked by the admins of {CLIENT_NAME}, on {CLIENT_NAME},
          as it may have been determined to be spam, a non-mod, illegal, or hidden for similar reasons.
          Since the admins can't delete the mod or the user's account, this is the best they can do.
        </p>
      </div>
      <DisableNote />
    </div>
  )
}

/** Hard moderation: shown instead of a render-blocked mod. */
export function ModerationBlockedScreen() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 space-y-4 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-red-400" />
        <h1 className="text-xl font-bold text-white">This mod has been hidden</h1>
        <p className="text-sm text-neutral-300 leading-relaxed">
          This mod has been hidden by the admins of {CLIENT_NAME}, on {CLIENT_NAME}, as it may have
          been determined to be spam, a non-mod, illegal, or hidden for similar reasons. Since the
          admins can't delete the mod or the user's account, this is the best they can do.
        </p>
        <div className="flex justify-center">
          <DisableNote />
        </div>
      </div>
    </div>
  )
}
