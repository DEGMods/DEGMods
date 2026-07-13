import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { User, Globe, TreePine, MoreHorizontal, Eye, Pencil, ShieldBan, Loader2, AlertTriangle, RefreshCw, Flag, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useDMStore } from '@/stores/dmStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useBlockStore, type BlockType } from '@/stores/blockStore'
import { useDnnStore } from '@/stores/dnnStore'
import { IdentityLine } from '@/components/social/IdentityLine'
import { SafeImage } from '@/components/shared/SafeImage'
import { ZapButton } from '@/components/social/ZapButton'
import { FollowButton } from '@/components/social/FollowButton'
import { BlockTypeModal } from '@/components/social/BlockTypeModal'
import { EditProfileDialog } from '@/components/social/EditProfileDialog'
import { ReportDialog } from '@/components/shared/ReportDialog'
import { LinksModal } from '@/components/social/LinksModal'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

interface PublisherCardProps {
  pubkey: string
}

const iconBtn =
  'flex flex-1 items-center justify-center rounded-lg border border-[#262626] p-2 text-neutral-400 transition-colors hover:border-[#404040] hover:text-white'

export function PublisherCard({ pubkey }: PublisherCardProps) {
  const myPubkey = useAuthStore(s => s.pubkey)
  const [profile, setProfile] = useState<UserProfile | null>(null)

  const npub = nip19.npubEncode(pubkey)
  const profileHref = `/profile/${npub}`
  const displayName = profile?.display_name || `${npub.slice(0, 10)}…`
  const isSelf = myPubkey === pubkey

  const navigate = useNavigate()

  // Block state
  const blocked = useBlockStore(s => s.blockedPubkeys.has(pubkey))
  const blockLoaded = useBlockStore(s => s.loaded)
  const loadBlockList = useBlockStore(s => s.loadBlockList)
  const blockUser = useBlockStore(s => s.blockUser)
  const unblockUser = useBlockStore(s => s.unblockUser)

  const [editOpen, setEditOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
  const [blockTypeOpen, setBlockTypeOpen] = useState(false)
  const [warnOpen, setWarnOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingFromScratch, setPendingFromScratch] = useState(false)
  const [hasLinks, setHasLinks] = useState(false)

  // Fetch the publisher's profile + verify any DNN ID.
  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useUserStore.getState().fetchProfile(pubkey, relays).then(p => {
      if (cancelled) return
      setProfile(p)
      useDnnStore.getState().verifyPubkey(pubkey, p?.nip05 as string | undefined)
    })
    return () => { cancelled = true }
  }, [pubkey])

  // Load block list so we know if this user is already blocked.
  useEffect(() => {
    if (myPubkey && !isSelf) loadBlockList()
  }, [myPubkey, isSelf, loadBlockList])

  // Always fetch the user's link sets (NIP-51 kind 30003). The linktree button
  // only shows if there are links — unless this is your own card, where it's
  // always shown so you can add some.
  useEffect(() => {
    let cancelled = false
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchEvents(relays, { kinds: [30003], authors: [pubkey], limit: 50 }, 6000)
      .then((events) => {
        if (cancelled) return
        // Keep the latest event per "links-*" d-tag; it counts as having links
        // if it carries at least one r tag.
        const byD = new Map<string, NostrEvent>()
        for (const ev of events) {
          const d = ev.tags.find((t) => t[0] === 'd')?.[1] || ''
          if (!d.startsWith('links-')) continue
          const existing = byD.get(d)
          if (!existing || ev.created_at > existing.created_at) byD.set(d, ev)
        }
        setHasLinks(Array.from(byD.values()).some((ev) => ev.tags.some((t) => t[0] === 'r' && t[1])))
      })
      .catch(() => { if (!cancelled) setHasLinks(false) })
    return () => { cancelled = true }
  }, [pubkey])

  const handleBlockClick = async () => {
    if (!myPubkey) { toast.error('Log in to block'); return }
    if (blocked) {
      setBusy(true)
      const res = await unblockUser(pubkey)
      setBusy(false)
      if (res.success) toast.success('Unblocked')
      else toast.error(res.error || 'Failed to unblock')
      return
    }
    if (blockLoaded) { setPendingFromScratch(false); setBlockTypeOpen(true) }
    else setWarnOpen(true)
  }

  const handleRetry = async () => {
    setRetrying(true)
    const found = await loadBlockList(true)
    setRetrying(false)
    setWarnOpen(false)
    setPendingFromScratch(!found)
    setBlockTypeOpen(true)
  }

  const handleSelectType = async (type: BlockType) => {
    setBlockTypeOpen(false)
    setBusy(true)
    const res = await blockUser(pubkey, type, pendingFromScratch)
    setBusy(false)
    if (res.success) toast.success(type === 'public' ? 'Blocked publicly' : 'Blocked privately')
    else toast.error(res.error || 'Failed to block')
  }

  // Open (or start) a NIP-04 DM with this user in the feed's Direct Messages tab.
  const openDM = () => {
    useDMStore.getState().openConversation(pubkey)
    navigate('/feed?view=dm')
  }

  const websiteUrl = profile?.website
    ? (profile.website.startsWith('http') ? profile.website : `https://${profile.website}`)
    : null

  return (
    <div className="overflow-hidden rounded-lg bg-[#1c1c1c] shadow-md shadow-black/20">
      {/* Banner */}
      <Link to={profileHref} className="block">
        <div className="relative h-35 w-full bg-gradient-to-br from-purple-900/40 to-[#212121]">
          {profile?.banner && (
            <SafeImage src={profile.banner as string} alt="" className="h-full w-full object-cover" />
          )}
        </div>
      </Link>

      <div className="px-4 pb-4">
        {/* Avatar overlapping the banner */}
        <Link to={profileHref} className="inline-block">
          <Avatar className="-mt-8 h-16 w-16 ring-4 ring-[#1c1c1c]">
            {profile?.picture ? <AvatarImage src={profile.picture as string} alt={displayName} /> : null}
            <AvatarFallback className="bg-gradient-to-br from-purple-600 to-purple-800 text-white">
              <User className="h-7 w-7" />
            </AvatarFallback>
          </Avatar>
        </Link>

        {/* Name + 3-dot menu */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <Link to={profileHref} className="block">
              <p className="font-semibold text-white truncate hover:text-purple-300 transition-colors">
                {displayName}
              </p>
            </Link>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="shrink-0 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-[#262626] hover:text-white" aria-label="More">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#1c1c1c] border-[#262626]">
              <DropdownMenuItem onClick={() => navigate(profileHref)} className="cursor-pointer">
                <Eye className="h-4 w-4 mr-2" /> View profile
              </DropdownMenuItem>
              {isSelf && (
                <DropdownMenuItem onClick={() => setEditOpen(true)} className="cursor-pointer">
                  <Pencil className="h-4 w-4 mr-2" /> Edit profile
                </DropdownMenuItem>
              )}
              {!isSelf && (
                <>
                  <DropdownMenuSeparator className="bg-[#262626]" />
                  <DropdownMenuItem onClick={() => setReportOpen(true)} className="cursor-pointer">
                    <Flag className="h-4 w-4 mr-2" /> Report user
                  </DropdownMenuItem>
                  {myPubkey && (
                    <DropdownMenuItem
                      onClick={handleBlockClick}
                      className="cursor-pointer text-red-400 focus:text-red-300"
                    >
                      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldBan className="h-4 w-4 mr-2" />}
                      {blocked ? 'Unblock user' : 'Block user'}
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-2">
          <IdentityLine pubkey={pubkey} npub={npub} nip05={profile?.nip05 as string | undefined} />
        </div>

        {profile?.about && (
          <p className="mt-2 text-sm text-neutral-400 line-clamp-3">{profile.about as string}</p>
        )}

        {/* Follow */}
        {!isSelf && <FollowButton pubkey={pubkey} className="mt-3 w-full" />}

        {/* Action buttons: message · website · zap · links */}
        <div className="mt-2 flex items-center gap-2">
          {!isSelf && myPubkey && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={openDM} className={iconBtn} aria-label="Message">
                  <MessageSquare className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Message</TooltipContent>
            </Tooltip>
          )}
          {websiteUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className={iconBtn} aria-label="Website">
                  <Globe className="h-4 w-4" />
                </a>
              </TooltipTrigger>
              <TooltipContent>Website</TooltipContent>
            </Tooltip>
          )}
          {profile?.lud16 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex flex-1">
                  <ZapButton
                    recipientPubkey={pubkey}
                    recipientLud16={profile.lud16 as string}
                    iconOnly
                    className="flex-1 justify-center p-2 hover:border-yellow-500/40 hover:text-yellow-400"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>Zap</TooltipContent>
            </Tooltip>
          )}
          {(hasLinks || isSelf) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => setLinksOpen(true)} className={iconBtn} aria-label="Links">
                  <TreePine className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Links</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Modals */}
      <BlockTypeModal
        open={blockTypeOpen}
        onOpenChange={setBlockTypeOpen}
        onSelect={handleSelectType}
        displayName={displayName}
      />

      <EditProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        profile={profile}
        onSaved={(m) => setProfile(p => ({ ...(p ?? { pubkey, npub, created_at: 0 }), ...m }))}
      />

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} pubkey={pubkey} />

      <LinksModal open={linksOpen} onOpenChange={setLinksOpen} pubkey={pubkey} displayName={displayName} />

      {/* Block-list-not-loaded warning (mirrors the follow flow) */}
      <Dialog open={warnOpen} onOpenChange={setWarnOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              Block list not loaded
            </DialogTitle>
            <DialogDescription className="text-neutral-400">
              We couldn't load your existing block list: it either failed to load or you don't have one yet.
              Creating a new list now could overwrite an existing one you have elsewhere, so retrying is recommended.
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
            <Button onClick={() => { setWarnOpen(false); setPendingFromScratch(true); setBlockTypeOpen(true) }} className="bg-red-600 hover:bg-red-700">
              Block anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
