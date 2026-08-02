/**
 * LEGACY MIGRATION UI — author-only "Migrate" banner + steps modal for old
 * kind-30402 mods, and the post-migration notice modal shown to anyone visiting
 * a migrated legacy post. Remove on sunset (see lib/mods/legacy.ts).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpCircle, Loader2, Check, AlertTriangle } from 'lucide-react'
import type { Event as NostrEvent } from 'nostr-tools'
import type { ModDetails } from '@/types/mod'
import { migrateLegacyMod, migratedNaddr, republishMigratedMod, type MigrateStep } from '@/lib/mods/legacyMigrate'
import { useLegacyModsStore } from '@/stores/legacyModsStore'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { useSettingsStore } from '@/stores/settingsStore'
import { KINDS } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

const STEPS: { key: MigrateStep; label: string }[] = [
  { key: 'marking', label: 'Marking the old post as migrated' },
  { key: 'creating', label: 'Publishing the new mod post' },
  { key: 'done', label: 'Done' },
]

const ORDER: MigrateStep[] = ['marking', 'creating', 'done']

/** Author-only banner (shown below the Legacy notice) with a Migrate action. */
export function LegacyMigrateBanner({ rawEvent, mod }: { rawEvent: NostrEvent; mod: ModDetails }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [step, setStep] = useState<MigrateStep | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setRunning(true)
    setError(null)
    setStep(null)
    try {
      const { naddr } = await migrateLegacyMod(rawEvent, mod, setStep)
      // Drop it from the in-memory legacy list so it disappears from mod lists
      // immediately (fresh loads already exclude migrated posts).
      useLegacyModsStore.getState().dropMod(mod.pubkey, mod.dTag)
      // Brief pause so the "Done" state is visible, then go to the new post.
      setTimeout(() => navigate(`/mod/${naddr}`), 700)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed')
      setRunning(false)
    }
  }

  const activeIndex = step ? ORDER.indexOf(step) : -1

  return (
    <>
      <div className="flex items-start gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
        <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
        <div className="min-w-0 space-y-2">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-orange-300">Migrate this mod</p>
            <p className="text-sm text-neutral-300">
              To edit this mod, migrate it to the new post structure. Once migration is complete, all
              links to this old post will send visitors to the migrated one, so there&apos;s nothing to
              worry about.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            className="bg-orange-600 text-white hover:bg-orange-700"
          >
            <ArrowUpCircle className="mr-1.5 h-4 w-4" /> Migrate
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!running) setOpen(o) }}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Migrate to the new mod post</DialogTitle>
            <DialogDescription className="text-neutral-400">
              This keeps your old post as a redirect and republishes the mod in the current format
              (same title, content, downloads, images, permissions and more). Categories aren&apos;t
              carried over. You&apos;ll be taken to the new post when it&apos;s done.
            </DialogDescription>
          </DialogHeader>

          {running || step ? (
            <div className="space-y-2 py-1">
              {STEPS.map((s, i) => {
                const done = activeIndex > i || step === 'done'
                const active = activeIndex === i && step !== 'done'
                return (
                  <div key={s.key} className="flex items-center gap-2.5 text-sm">
                    {done ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : active ? (
                      <Loader2 className="h-4 w-4 animate-spin text-orange-400" />
                    ) : (
                      <span className="h-4 w-4 rounded-full border border-[#333]" />
                    )}
                    <span className={done ? 'text-neutral-300' : active ? 'text-neutral-200' : 'text-neutral-500'}>
                      {s.label}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="py-1 text-sm text-neutral-400">
              Ready to migrate. This publishes two events with your signer.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {!running && (
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} className="text-neutral-400">Cancel</Button>
              <Button onClick={start} className="bg-orange-600 text-white hover:bg-orange-700">
                {error ? 'Retry migration' : 'Start migration'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Notice for a legacy post that's marked migrated. Before redirecting, it verifies
 * the migrated (kind-31142, same coordinate) post actually exists:
 *   - found → the blocking "go to the migrated post" redirect (the normal case).
 *   - missing + author → a recovery notice: migration step 2 didn't land, offer to
 *     republish the migrated post (dismissible so the author can still view the old
 *     content, which is the only copy while the migrated post is missing).
 *   - missing + not author → nothing; let the legacy content render (it's the only
 *     available copy), rather than redirect to a post that isn't there.
 */
export function LegacyMigratedNotice({ mod, isOwner }: { mod: ModDetails; isOwner: boolean }) {
  const navigate = useNavigate()
  const naddr = migratedNaddr(mod)
  const [status, setStatus] = useState<'checking' | 'found' | 'missing'>('checking')
  const [dismissed, setDismissed] = useState(false)
  const [republishing, setRepublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const events = await fetchEvents(
          relays,
          { kinds: [KINDS.MOD], authors: [mod.pubkey], '#d': [mod.dTag], limit: 1 },
          8000,
        )
        if (!cancelled) setStatus(events.length > 0 ? 'found' : 'missing')
      } catch {
        // On a query error, don't cry wolf — assume the migrated post is there.
        if (!cancelled) setStatus('found')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mod.pubkey, mod.dTag])

  const republish = async () => {
    setRepublishing(true)
    setError(null)
    try {
      await republishMigratedMod(mod)
      navigate(`/mod/${naddr}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Republish failed')
      setRepublishing(false)
    }
  }

  // Missing + not the author (or author dismissed it): let the legacy content show.
  if ((status === 'missing' && !isOwner) || dismissed) return null

  return (
    <Dialog open>
      <DialogContent
        className="bg-[#1c1c1c] border-[#262626] [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {status === 'checking' && (
          <div className="flex items-center gap-2.5 py-4 text-sm text-neutral-300">
            <Loader2 className="h-4 w-4 animate-spin text-neutral-400" /> Checking the migrated post…
          </div>
        )}

        {status === 'found' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-neutral-100">This mod has been migrated</DialogTitle>
              <DialogDescription className="text-neutral-400">
                This post is from the old mod system and has been migrated to the new post structure.
                Visit the current version below.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => navigate(`/mod/${naddr}`)} className="bg-purple-600 text-white hover:bg-purple-700">
                Go to migrated mod post
              </Button>
            </DialogFooter>
          </>
        )}

        {status === 'missing' && isOwner && (
          <>
            <DialogHeader>
              <DialogTitle className="text-neutral-100">Migrated post not found</DialogTitle>
              <DialogDescription className="text-neutral-400">
                This post is marked as migrated, but its migrated post couldn&apos;t be found on your relays.
                The migration likely didn&apos;t finish — the old post was marked, but the new post never got
                published. If you believe it wasn&apos;t migrated properly, you can finish it now by
                republishing the migrated post.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                onClick={() => setDismissed(true)}
                disabled={republishing}
                className="text-neutral-400"
              >
                View old post
              </Button>
              <Button
                onClick={republish}
                disabled={republishing}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                {republishing ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Republishing…
                  </>
                ) : (
                  'Republish migrated post'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
