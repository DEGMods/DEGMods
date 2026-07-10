import { useState, useEffect } from 'react'
import { UserPlus, UserCheck, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useFollowsStore } from '@/stores/followsStore'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

interface FollowButtonProps {
  pubkey: string
  className?: string
}

/**
 * Site-wide follow/unfollow button backed by the shared follows store.
 *
 * Follow/unfollow only touch this one `p` entry. If the user's contact list
 * couldn't be loaded (or doesn't exist), following first warns, to avoid
 * overwriting an existing list, offering Retry / Cancel / Create new list.
 */
export function FollowButton({ pubkey, className }: FollowButtonProps) {
  const myPubkey = useAuthStore(s => s.pubkey)
  const contactEvent = useFollowsStore(s => s.contactEvent)
  const loaded = useFollowsStore(s => s.loaded)
  const loadContacts = useFollowsStore(s => s.loadContacts)
  const setFollow = useFollowsStore(s => s.setFollow)

  const [busy, setBusy] = useState(false)
  const [warnOpen, setWarnOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const isSelf = myPubkey === pubkey
  const following = !!myPubkey && !!contactEvent?.tags.some(t => t[0] === 'p' && t[1] === pubkey)

  useEffect(() => {
    if (myPubkey && !isSelf) loadContacts()
  }, [myPubkey, isSelf, loadContacts])

  if (isSelf) return null

  const doFollow = async (fromScratch: boolean) => {
    setBusy(true)
    try {
      const res = await setFollow(pubkey, true, fromScratch)
      if (!res.success) throw new Error(res.error)
      toast.success('Following')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to follow')
    } finally {
      setBusy(false)
    }
  }

  const handleClick = async () => {
    if (!myPubkey) { toast.error('Log in to follow'); return }
    if (busy) return

    if (following) {
      // Safe: we only reach "following" when the list was loaded and contains them.
      setBusy(true)
      try {
        const res = await setFollow(pubkey, false, false)
        if (!res.success) throw new Error(res.error)
        toast.success('Unfollowed')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to unfollow')
      } finally {
        setBusy(false)
      }
      return
    }

    if (loaded) doFollow(false)
    else setWarnOpen(true)
  }

  const handleRetry = async () => {
    setRetrying(true)
    const found = await loadContacts(true)
    setRetrying(false)
    if (found) {
      setWarnOpen(false)
      doFollow(false)
    } else {
      toast.error('Still couldn’t load your follow list')
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60',
          following
            ? 'border border-[#262626] text-neutral-300 hover:border-red-500/40 hover:text-red-400'
            : 'bg-purple-600 text-white hover:bg-purple-700',
          className,
        )}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : following ? (
          <UserCheck className="h-4 w-4" />
        ) : (
          <UserPlus className="h-4 w-4" />
        )}
        {following ? 'Following' : 'Follow'}
      </button>

      <Dialog open={warnOpen} onOpenChange={setWarnOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              Follow list not loaded
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              We couldn't load your existing follow list: it either failed to load or you don't have one yet.
              Creating a new list now could overwrite an existing list you have elsewhere, so retrying is recommended.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setWarnOpen(false)} className="border-[#262626]">
              Cancel
            </Button>
            <Button variant="outline" onClick={handleRetry} disabled={retrying} className="border-[#262626]">
              {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Retry fetch
            </Button>
            <Button onClick={() => { setWarnOpen(false); doFollow(true) }} className="bg-purple-600 hover:bg-purple-700">
              Create list & follow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
