import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminSettings from '@/components/admin/AdminSettings'
import { cn } from '@/lib/utils'
import { useSettingsStore, relayListSignature, blossomListSignature } from '@/stores/settingsStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useWotStore } from '@/stores/wotStore'
import { useDnnStore } from '@/stores/dnnStore'
import { dnnService, type DnnNodeInfo } from '@/lib/dnn/dnnService'
import { useAuthStore, signEvent } from '@/stores/authStore'
import { ADMIN_PUBKEY, type RelayConfig, type BlossomConfig, type DnnNodeConfig } from '@/lib/constants'
import { buildRelayListEvent, buildBlossomListEvent } from '@/lib/nostr/events'
import { publishEvent } from '@/lib/nostr/relay-pool'
import { benchmarkHashRate, estimateSolveTime, getCachedHashRate } from '@/lib/pow/pow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useRelayCapabilityStore, isKnownSearchRelay } from '@/stores/relayCapabilityStore'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Globe, Server, Database, Cpu, Shield, Plus, Trash2, RefreshCw, Save,
  Loader2, CheckCircle, XCircle, Circle, ArrowUpDown, LogOut, AlertTriangle, RotateCcw,
  SlidersHorizontal, ShieldAlert, BadgeCheck, MessageSquare, Send, Search
} from 'lucide-react'
import type { Event as NostrEvent } from 'nostr-tools'

// ─── Sidebar navigation ────────────────────────────────────────────────

type SettingsTab = 'network' | 'preferences' | 'moderation' | 'admin'

const sidebarItems: { id: SettingsTab; label: string; icon: typeof Globe; adminOnly?: boolean }[] = [
  { id: 'network', label: 'Network', icon: Globe },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'moderation', label: 'Moderation', icon: ShieldAlert },
  { id: 'admin', label: 'Admin', icon: Shield, adminOnly: true },
]

// ─── Health dot component ───────────────────────────────────────────────

function HealthDot({ status }: { status?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full flex-shrink-0',
        status === true && 'bg-green-500',
        status === false && 'bg-red-500',
        status === undefined && 'bg-zinc-500'
      )}
    />
  )
}

// ─── Read/Write badges ──────────────────────────────────────────────────

function RWBadges({ read, write }: { read: boolean; write: boolean }) {
  return (
    <div className="flex gap-1">
      {read && (
        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/15 text-emerald-400">
          R
        </span>
      )}
      {write && (
        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-500/15 text-blue-400">
          W
        </span>
      )}
    </div>
  )
}

// ─── Relay row ──────────────────────────────────────────────────────────

function RelayRow({
  relay,
  onToggle,
  onRemove,
}: {
  relay: RelayConfig
  onToggle: () => void
  onRemove?: () => void
}) {
  const nip50 = useRelayCapabilityStore(s => {
    if (isKnownSearchRelay(relay.url)) return true
    return ((s.capabilities[relay.url]?.supportedNips ?? []).includes(50))
  })
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-[#212121] transition-colors group">
      <Switch checked={relay.enabled} onCheckedChange={onToggle} />
      <span className={cn('text-sm flex-1 truncate', !relay.enabled && 'text-muted-foreground')}>
        {relay.url}
      </span>
      {nip50 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-md border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">
              <Search size={10} /> Search
            </span>
          </TooltipTrigger>
          <TooltipContent>Supports NIP-50 relay search</TooltipContent>
        </Tooltip>
      )}
      <RWBadges read={relay.read} write={relay.write} />
      {onRemove && (
        <button onClick={onRemove} className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// ─── Blossom row ────────────────────────────────────────────────────────

function BlossomRow({
  server,
  onToggle,
  onRemove,
}: {
  server: BlossomConfig
  onToggle: () => void
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-[#212121] transition-colors group">
      <Switch checked={server.enabled} onCheckedChange={onToggle} />
      <span className={cn('text-sm flex-1 truncate', !server.enabled && 'text-muted-foreground')}>
        {server.url}
      </span>
      {onRemove && (
        <button onClick={onRemove} className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// ─── DNN node row ───────────────────────────────────────────────────────

function DnnNodeRow({
  node,
  onToggle,
  onRemove,
  readOnly,
}: {
  node: DnnNodeConfig
  onToggle?: () => void
  onRemove?: () => void
  readOnly?: boolean
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-[#212121] transition-colors group">
      <HealthDot status={node.healthy} />
      {onToggle && !readOnly ? (
        <Switch checked={node.enabled} onCheckedChange={onToggle} />
      ) : null}
      <span className={cn('text-sm flex-1 truncate', !node.enabled && 'text-muted-foreground')}>
        {node.url}
      </span>
      {onRemove && (
        <button onClick={onRemove} className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// ─── Section header ─────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  )
}

// ─── Boxed group (matches the Preferences/Admin section style) ──────────

function SettingsBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-4 space-y-5">{children}</div>
}

function ResetToDefault({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-neutral-300 cursor-pointer"
    >
      <RotateCcw size={11} /> Reset
    </button>
  )
}

// ─── DNN nodes (reads the live dnnService node list, not a stale copy) ──

function DnnNodes() {
  const [defaultNodes, setDefaultNodes] = useState<DnnNodeInfo[]>([])
  const [userNodes, setUserNodes] = useState<DnnNodeInfo[]>([])
  const [discovered, setDiscovered] = useState<DnnNodeInfo[]>([])
  const [checking, setChecking] = useState(false)

  const refresh = useCallback(() => {
    const known = dnnService.getKnownNodes()
    setDefaultNodes(known.filter(n => n.source === 'default'))
    setUserNodes(known.filter(n => n.source === 'user'))
    setDiscovered(dnnService.getDiscoveredNodes())
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await useDnnStore.getState().initService()
      if (!cancelled) refresh()
    })()
    return () => { cancelled = true }
  }, [refresh])

  const addNode = (url: string) => {
    dnnService.addUserNode(url)
    refresh()
    setTimeout(refresh, 1500) // reflect the async health check
  }
  const removeNode = (url: string) => { dnnService.removeUserNode(url); refresh() }
  const recheck = async () => {
    setChecking(true)
    await dnnService.healthCheckAll()
    setChecking(false)
    refresh()
  }

  const toRow = (n: DnnNodeInfo): DnnNodeConfig => ({ url: n.url, enabled: true, healthy: n.healthy, lastChecked: n.lastChecked })

  return (
    <div className="space-y-6">
      <SettingsBox>
        <div>
          <SectionHeader title="Default Nodes" description="Built-in DNN resolver nodes used to resolve & verify DNN IDs" />
          <div className="space-y-0.5">
            {defaultNodes.length === 0 && <p className="text-xs text-muted-foreground px-3 py-2">No default nodes.</p>}
            {defaultNodes.map(n => <DnnNodeRow key={n.url} node={toRow(n)} readOnly />)}
          </div>
        </div>

        {discovered.length > 0 && (
          <div>
            <SectionHeader title="Discovered Nodes" description="Auto-discovered via peer query" />
            <div className="space-y-0.5">
              {discovered.map(n => <DnnNodeRow key={n.url} node={toRow(n)} readOnly />)}
            </div>
          </div>
        )}
      </SettingsBox>

      <SettingsBox>
        <div>
          <SectionHeader title="Your Nodes" description="Resolver nodes you've added manually" />
          <div className="space-y-0.5">
            {userNodes.length === 0 && <p className="text-xs text-muted-foreground px-3 py-2">No custom nodes added.</p>}
            {userNodes.map(n => <DnnNodeRow key={n.url} node={toRow(n)} readOnly onRemove={() => removeNode(n.url)} />)}
          </div>
          <AddInput placeholder="https://node.example.com" onAdd={addNode} />
        </div>
      </SettingsBox>

      <Button variant="outline" onClick={recheck} disabled={checking} className="w-full border-[#262626]">
        {checking ? <Loader2 size={16} className="mr-2 animate-spin" /> : <RefreshCw size={16} className="mr-2" />}
        Re-check Health
      </Button>
    </div>
  )
}

// ─── Add input ──────────────────────────────────────────────────────────

function AddInput({ placeholder, onAdd }: { placeholder: string; onAdd: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="flex gap-2 mt-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-[#1c1c1c] border-[#262626] text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onAdd(value.trim())
            setValue('')
          }
        }}
      />
      <Button
        variant="outline"
        size="icon"
        className="border-[#262626] hover:bg-[#262626]"
        onClick={() => {
          if (value.trim()) {
            onAdd(value.trim())
            setValue('')
          }
        }}
      >
        <Plus size={16} />
      </Button>
    </div>
  )
}

// ─── Posting behaviour toggle row ───────────────────────────────────────

function PostingToggle({ title, description, checked, onChange }: {
  title: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-200">{title}</p>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </div>
  )
}

// ─── Network Tab ────────────────────────────────────────────────────────

function NetworkSettings() {
  const settings = useSettingsStore()
  const [saving, setSaving] = useState(false)

  const myPubkey = useAuthStore(s => s.pubkey)
  const [relayWarnOpen, setRelayWarnOpen] = useState(false)
  const [blossomWarnOpen, setBlossomWarnOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)

  // "Your list" publish is dirty when its membership differs from the last
  // published baseline. Local enable toggles don't count — they're client-only.
  const relaysDirty = useMemo(
    () => relayListSignature(settings.userRelays) !== settings.userRelaysBaseline,
    [settings.userRelays, settings.userRelaysBaseline],
  )
  const blossomsDirty = useMemo(
    () => blossomListSignature(settings.userBlossoms) !== settings.userBlossomsBaseline,
    [settings.userBlossoms, settings.userBlossomsBaseline],
  )
  const canPublishRelays = settings.userRelays.length > 0 && (relaysDirty || !settings.userRelaysFound)
  const canPublishBlossoms = settings.userBlossoms.length > 0 && (blossomsDirty || !settings.userBlossomsFound)

  const publishRelays = async () => {
    setSaving(true)
    try {
      const event = buildRelayListEvent(settings.userRelays.map(r => ({ url: r.url, read: r.read, write: r.write })))
      const signed = await signEvent(event as unknown as Record<string, unknown>) as unknown as NostrEvent
      await publishEvent(signed, settings.getAllEnabledRelayUrls('write'))
      settings.markUserRelaysPublished()
      toast.success('Relay list published to Nostr')
    } catch (err) {
      toast.error(`Failed to publish: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }
  const publishBlossoms = async () => {
    setSaving(true)
    try {
      const event = buildBlossomListEvent(settings.userBlossoms.map(s => s.url))
      const signed = await signEvent(event as unknown as Record<string, unknown>) as unknown as NostrEvent
      await publishEvent(signed, settings.getAllEnabledRelayUrls('write'))
      settings.markUserBlossomsPublished()
      toast.success('Blossom list published to Nostr')
    } catch (err) {
      toast.error(`Failed to publish: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  // If we never found a published list, warn before creating a brand-new one.
  const handlePublishRelays = () => { settings.userRelaysFound ? publishRelays() : setRelayWarnOpen(true) }
  const handlePublishBlossoms = () => { settings.userBlossomsFound ? publishBlossoms() : setBlossomWarnOpen(true) }

  const retryRelays = async () => {
    if (!myPubkey) return
    setRetrying(true)
    await settings.loadUserLists(myPubkey)
    setRetrying(false)
    if (useSettingsStore.getState().userRelaysFound) { setRelayWarnOpen(false); toast.success('Found your relay list — review, then publish') }
    else toast.error('Still couldn’t find a published relay list')
  }
  const retryBlossoms = async () => {
    if (!myPubkey) return
    setRetrying(true)
    await settings.loadUserLists(myPubkey)
    setRetrying(false)
    if (useSettingsStore.getState().userBlossomsFound) { setBlossomWarnOpen(false); toast.success('Found your Blossom list — review, then publish') }
    else toast.error('Still couldn’t find a published Blossom list')
  }

  return (
    <Tabs defaultValue="posting">
      <TabsList className="bg-[#1c1c1c] border border-[#262626] mb-6">
        <TabsTrigger value="posting" className="text-xs data-[state=active]:bg-[#262626]">
          <Send size={14} className="mr-1.5" /> Posting
        </TabsTrigger>
        <TabsTrigger value="relays" className="text-xs data-[state=active]:bg-[#262626]">
          <ArrowUpDown size={14} className="mr-1.5" /> Relays
        </TabsTrigger>
        <TabsTrigger value="blossom" className="text-xs data-[state=active]:bg-[#262626]">
          <Database size={14} className="mr-1.5" /> Blossom
        </TabsTrigger>
        <TabsTrigger value="dnn" className="text-xs data-[state=active]:bg-[#262626]">
          <Globe size={14} className="mr-1.5" /> DNN
        </TabsTrigger>
      </TabsList>

      {/* ── Posting behaviour ── */}
      <TabsContent value="posting" className="space-y-6">
        <SettingsBox>
          <div>
            <SectionHeader title="Posting behavior" description="Control where events are published and how media is uploaded." />
            <div className="divide-y divide-[#262626]">
              <PostingToggle title="Post to client relays" description="Publish events to your configured client relays" checked={settings.postToClientRelays} onChange={settings.setPostToClientRelays} />
              <PostingToggle title="Post to user relays" description="Publish events to your NIP-65 relay list" checked={settings.postToUserRelays} onChange={settings.setPostToUserRelays} />
              <PostingToggle title="Post to custom local relays" description="Publish events to your custom local relays" checked={settings.postToCustomRelays} onChange={settings.setPostToCustomRelays} />
              <PostingToggle title="Limit to max 3 relays per list" description="Randomly pick up to 3 relays from each enabled list to reduce publish load" checked={settings.limitRelaysPerList} onChange={settings.setLimitRelaysPerList} />
              <PostingToggle title="Limit to max 3 blossoms per list" description="Upload media to at most 3 blossom servers from each list" checked={settings.limitBlossomsPerList} onChange={settings.setLimitBlossomsPerList} />
              <PostingToggle title="Upload to blossom servers in parallel" description="Upload to up to 3 servers at once instead of one at a time — faster for large files on fast connections." checked={settings.parallelBlossomUpload} onChange={settings.setParallelBlossomUpload} />
            </div>
            {!settings.postToClientRelays && !settings.postToUserRelays && !settings.postToCustomRelays && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-yellow-500/90">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                No relay sources are enabled — your events won't be published anywhere.
              </p>
            )}
          </div>
        </SettingsBox>
      </TabsContent>

      {/* ── Relays ── */}
      <TabsContent value="relays" className="space-y-6">
        <SettingsBox>
        <div>
          <SectionHeader title="Client Default Relays" description="Built-in relays included with DEG MODS" />
          <div className="space-y-0.5">
            {settings.clientRelays.map(r => (
              <RelayRow key={r.url} relay={r} onToggle={() => settings.toggleClientRelay(r.url)} />
            ))}
          </div>
        </div>

        <div>
          <SectionHeader title="Custom local relays" description="Relays used only on this device — never published to Nostr" />
          <div className="space-y-0.5">
            {settings.customRelays.map(r => (
              <RelayRow
                key={r.url}
                relay={r}
                onToggle={() => settings.toggleCustomRelay(r.url)}
                onRemove={() => settings.removeCustomRelay(r.url)}
              />
            ))}
          </div>
          <AddInput
            placeholder="wss://relay.example.com"
            onAdd={(url) => {
              if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
                toast.error('Relay URL must start with wss:// or ws://')
                return
              }
              settings.addCustomRelay({ url, read: true, write: true, enabled: true })
            }}
          />
        </div>
        </SettingsBox>

        <SettingsBox>
        <div>
          <SectionHeader
            title="Your Relay List"
            description="Your published relay list (kind 10002). Toggle = use locally; add/remove changes what gets published."
          />
          <div className="space-y-0.5">
            {settings.userRelays.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">
                {settings.userRelaysFound ? 'Your published relay list is empty.' : 'No published relay list found. Add relays below, then Save & Publish to create one.'}
              </p>
            )}
            {settings.userRelays.map(r => (
              <RelayRow
                key={r.url}
                relay={r}
                onToggle={() => settings.toggleUserRelay(r.url)}
                onRemove={() => settings.removeUserRelay(r.url)}
              />
            ))}
          </div>
          <AddInput
            placeholder="wss://relay.example.com"
            onAdd={(url) => {
              if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
                toast.error('Relay URL must start with wss:// or ws://')
                return
              }
              settings.addUserRelay({ url, read: true, write: true, enabled: true })
            }}
          />
          <Button onClick={handlePublishRelays} disabled={saving || !canPublishRelays} className="w-full mt-3">
            {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
            Save &amp; Publish
          </Button>
        </div>
        </SettingsBox>

        {/* Warn before creating a brand-new relay list when none was found. */}
        <Dialog open={relayWarnOpen} onOpenChange={setRelayWarnOpen}>
          <DialogContent className="bg-[#1c1c1c] border-[#262626]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-neutral-100">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
                No relay list found
              </DialogTitle>
              <DialogDescription className="text-neutral-400">
                We couldn't find a published relay list for your account: it either failed to load or you don't have one yet.
                Publishing now will create a new kind 10002 list, which could overwrite one you have elsewhere — retrying first is recommended.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setRelayWarnOpen(false)} className="border-[#262626]">Cancel</Button>
              <Button variant="outline" onClick={retryRelays} disabled={retrying} className="border-[#262626]">
                {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Retry fetch
              </Button>
              <Button onClick={() => { setRelayWarnOpen(false); publishRelays() }} className="bg-purple-600 hover:bg-purple-700">
                Publish as new list
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>

      {/* ── Blossom ── */}
      <TabsContent value="blossom" className="space-y-6">
        {/* Upload Limit */}
        <SettingsBox>
        <div>
          <SectionHeader title="Media Upload Size Limit" description="Maximum size for image/media uploads to Blossom. Mod files have a separate fixed 500 MB limit." />
          <div className="space-y-3 mt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-300">{settings.blossomUploadLimitMb} MB</span>
              <button
                onClick={() => settings.setBlossomUploadLimitMb(10)}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
                Reset to default
              </button>
            </div>
            <Slider
              value={[settings.blossomUploadLimitMb]}
              onValueChange={([v]) => settings.setBlossomUploadLimitMb(v)}
              min={1}
              max={25}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-neutral-600">
              <span>1 MB</span>
              <span>25 MB</span>
            </div>
            {settings.blossomUploadLimitMb > 10 && (
              <div className="flex items-start gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2.5">
                <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-400/90 leading-relaxed">
                  Increasing the limit above the default of 10 MB may result in a lower chance of having your files accepted by Blossom servers.
                </p>
              </div>
            )}
          </div>
        </div>

        <div>
          <SectionHeader
            title="Media Download Size Limit"
            description="Images larger than this won't auto-load anywhere — featured images, screenshots, avatars, banners, and social posts. You can still load each one on demand."
          />
          <div className="space-y-3 mt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-300">
                {settings.mediaDownloadLimitMb === 0 ? 'Unlimited' : `${settings.mediaDownloadLimitMb} MB`}
              </span>
              <button
                onClick={() => settings.setMediaDownloadLimitMb(10)}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
                Reset to default
              </button>
            </div>
            <Slider
              value={[settings.mediaDownloadLimitMb]}
              onValueChange={([v]) => settings.setMediaDownloadLimitMb(v)}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-neutral-600">
              <span>Unlimited</span>
              <span>100 MB</span>
            </div>
          </div>
        </div>
        </SettingsBox>

        <SettingsBox>
        <div>
          <SectionHeader title="Client Default Servers" description="Built-in Blossom servers" />
          <div className="space-y-0.5">
            {settings.clientBlossoms.map(s => (
              <BlossomRow key={s.url} server={s} onToggle={() => settings.toggleClientBlossom(s.url)} />
            ))}
          </div>
        </div>

        <div>
          <SectionHeader title="Custom local Blossom servers" description="Servers used only on this device — never published to Nostr" />
          <div className="space-y-0.5">
            {settings.customBlossoms.map(s => (
              <BlossomRow
                key={s.url}
                server={s}
                onToggle={() => settings.toggleCustomBlossom(s.url)}
                onRemove={() => settings.removeCustomBlossom(s.url)}
              />
            ))}
          </div>
          <AddInput
            placeholder="https://blossom.example.com"
            onAdd={(url) => {
              if (!url.startsWith('https://') && !url.startsWith('http://')) {
                toast.error('Server URL must start with https:// or http://')
                return
              }
              settings.addCustomBlossom({ url, enabled: true })
            }}
          />
        </div>
        </SettingsBox>

        <SettingsBox>
        <div>
          <SectionHeader
            title="Your Blossom List"
            description="Your published Blossom server list (kind 10063). Toggle = use locally; add/remove changes what gets published."
          />
          <div className="space-y-0.5">
            {settings.userBlossoms.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">
                {settings.userBlossomsFound ? 'Your published Blossom list is empty.' : 'No published Blossom list found. Add servers below, then Save & Publish to create one.'}
              </p>
            )}
            {settings.userBlossoms.map(s => (
              <BlossomRow
                key={s.url}
                server={s}
                onToggle={() => settings.toggleUserBlossom(s.url)}
                onRemove={() => settings.removeUserBlossom(s.url)}
              />
            ))}
          </div>
          <AddInput
            placeholder="https://blossom.example.com"
            onAdd={(url) => {
              if (!url.startsWith('https://') && !url.startsWith('http://')) {
                toast.error('Server URL must start with https:// or http://')
                return
              }
              settings.addUserBlossom({ url, enabled: true })
            }}
          />
          <Button onClick={handlePublishBlossoms} disabled={saving || !canPublishBlossoms} className="w-full mt-3">
            {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
            Save &amp; Publish
          </Button>
        </div>
        </SettingsBox>

        <Dialog open={blossomWarnOpen} onOpenChange={setBlossomWarnOpen}>
          <DialogContent className="bg-[#1c1c1c] border-[#262626]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-neutral-100">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
                No Blossom list found
              </DialogTitle>
              <DialogDescription className="text-neutral-400">
                We couldn't find a published Blossom server list for your account: it either failed to load or you don't have one yet.
                Publishing now will create a new kind 10063 list, which could overwrite one you have elsewhere — retrying first is recommended.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setBlossomWarnOpen(false)} className="border-[#262626]">Cancel</Button>
              <Button variant="outline" onClick={retryBlossoms} disabled={retrying} className="border-[#262626]">
                {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Retry fetch
              </Button>
              <Button onClick={() => { setBlossomWarnOpen(false); publishBlossoms() }} className="bg-purple-600 hover:bg-purple-700">
                Publish as new list
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TabsContent>

      {/* ── DNN ── */}
      <TabsContent value="dnn" className="space-y-6">
        <DnnNodes />
      </TabsContent>
    </Tabs>
  )
}

// ─── Toggle row ─────────────────────────────────────────────────────────

function ToggleRow({
  label, description, checked, onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 py-3 cursor-pointer">
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </label>
  )
}

// ─── Preferences Tab ────────────────────────────────────────────────────

function PreferencesSettings() {
  const {
    renderImages, renderVideos, renderAudio, renderHyperlinks,
    setRenderImages, setRenderVideos, setRenderAudio, setRenderHyperlinks,
  } = usePreferencesStore()
  const { powDifficulty, setPowDifficulty, powFilterDifficulty, setPowFilterDifficulty } = useSettingsStore()
  const [hashRate, setHashRate] = useState<number | null>(getCachedHashRate())
  const [benchmarking, setBenchmarking] = useState(false)

  const runBenchmark = async () => {
    setBenchmarking(true)
    try {
      const rate = await benchmarkHashRate()
      setHashRate(rate)
      toast.success(`Benchmark complete: ${Math.round(rate).toLocaleString()} hashes/sec`)
    } catch {
      toast.error('Benchmark failed')
    } finally {
      setBenchmarking(false)
    }
  }

  const formatTime = (seconds: number): string => {
    if (seconds < 0.001) return '< 1ms'
    if (seconds < 1) return `~${Math.round(seconds * 1000)}ms`
    if (seconds < 60) return `~${seconds.toFixed(1)}s`
    if (seconds < 3600) return `~${Math.round(seconds / 60)}min`
    return `~${(seconds / 3600).toFixed(1)}hr`
  }

  const estimatedTime = estimateSolveTime(powDifficulty, hashRate ?? undefined)

  return (
    <div className="space-y-6">
      <SettingsCard
        icon={MessageSquare}
        title="Comments"
        description="By default, comments and replies show plain text only — links aren't clickable and media isn't embedded. Enable each below to render it (applies to comments only)."
      >
        <div className="divide-y divide-[#262626]">
          <ToggleRow
            label="Render images"
            description="Show image links as embedded images in comments."
            checked={renderImages}
            onCheckedChange={setRenderImages}
          />
          <ToggleRow
            label="Render videos"
            description="Show video links as embedded video players in comments."
            checked={renderVideos}
            onCheckedChange={setRenderVideos}
          />
          <ToggleRow
            label="Render audio"
            description="Show audio links as embedded audio players in comments."
            checked={renderAudio}
            onCheckedChange={setRenderAudio}
          />
          <ToggleRow
            label="Render hyperlinks"
            description="Make links clickable (they open in a new tab). Off means links show as plain, non-clickable text."
            checked={renderHyperlinks}
            onCheckedChange={setRenderHyperlinks}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Cpu}
        title="Publishing Difficulty"
        description="Higher difficulty requires more processing time but helps prioritize your content on relays."
      >
        <div className="flex items-center gap-4">
          <Slider value={[powDifficulty]} onValueChange={([v]) => setPowDifficulty(v)} min={0} max={32} step={1} className="flex-1" />
          <span className="text-lg font-bold text-foreground w-8 text-right">{powDifficulty}</span>
          <ResetToDefault onClick={() => setPowDifficulty(15)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Estimated processing time: <span className="text-foreground font-medium">{formatTime(estimatedTime)}</span>
        </p>
      </SettingsCard>

      <SettingsCard
        icon={Shield}
        title="Content Filter Difficulty"
        description="Only show posts, comments, and replies with at least this proof of work. Shared with the PoW filter on the mods pages."
      >
        <div className="flex items-center gap-4">
          <Slider value={[powFilterDifficulty]} onValueChange={([v]) => setPowFilterDifficulty(v)} min={0} max={32} step={1} className="flex-1" />
          <span className="text-lg font-bold text-foreground w-8 text-right">{powFilterDifficulty}</span>
          <ResetToDefault onClick={() => setPowFilterDifficulty(15)} />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2.5">
          <BadgeCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-400" />
          <p className="text-xs text-neutral-400">
            <span className="text-neutral-200 font-medium">People you follow are always shown.</span> Their mods,
            posts, and comments bypass this filter regardless of their proof of work.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Cpu}
        title="Device Benchmark"
        description="Measure your device's hash rate to estimate processing times."
      >
        {hashRate !== null && (
          <p className="text-sm text-foreground">
            Hash rate: <span className="font-bold text-purple-400">{Math.round(hashRate).toLocaleString()}</span> hashes/sec
          </p>
        )}
        <Button variant="outline" onClick={runBenchmark} disabled={benchmarking} className="border-[#262626] w-fit">
          {benchmarking ? <Loader2 size={16} className="animate-spin mr-2" /> : <Cpu size={16} className="mr-2" />}
          {benchmarking ? 'Running Benchmark...' : 'Run Benchmark'}
        </Button>
      </SettingsCard>
    </div>
  )
}

// ─── Settings card (boxed section, like admin Featured Content) ─────────

function SettingsCard({
  icon: Icon, title, description, children,
}: {
  icon: typeof Globe
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-purple-400 shrink-0" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {description && <p className="text-xs text-neutral-500 leading-relaxed">{description}</p>}
      <div className="space-y-4 pt-0.5">{children}</div>
    </div>
  )
}

// ─── Moderation Tab ─────────────────────────────────────────────────────

function ModerationSettings() {
  const { softModeration, hardModeration, setSoftModeration, setHardModeration } = usePreferencesStore()

  return (
    <div className="space-y-6">
      <SettingsCard
        icon={ShieldAlert}
        title="Admin moderation"
        description="The site admins maintain a moderation list. You can opt out of it here, at your own risk."
      >
        <div className="divide-y divide-[#262626]">
          <ToggleRow
            label="Soft moderation"
            description="Hide admin-flagged mods (and mods from blocked users) from listings, search, and other discovery surfaces. Turning this off makes hidden mods appear again and removes the warning shown on them."
            checked={softModeration}
            onCheckedChange={setSoftModeration}
          />
          <ToggleRow
            label="Hard moderation"
            description="Block rendering of mods the admins have marked as view-blocked, even when opened directly. Turning this off lets those mods render normally."
            checked={hardModeration}
            onCheckedChange={setHardModeration}
          />
        </div>

        {(!softModeration || !hardModeration) && (
          <div className="flex items-start gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2.5">
            <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-400/90 leading-relaxed">
              With moderation disabled you may see content the admins flagged as spam, non-mods,
              illegal, or otherwise removed from discovery.
            </p>
          </div>
        )}
      </SettingsCard>

      <WebOfTrustSettings />
    </div>
  )
}

// ─── Web of Trust ───────────────────────────────────────────────────────

const DEPTH_DESC = [
  'Only your direct follows contribute to scores.',
  'Follows of your follows also contribute (1 degree out).',
  'Two degrees of separation from your follows.',
  'Three degrees deep — a wide trust radius.',
]

function WebOfTrustSettings() {
  const settings = useWotStore((s) => s.settings)
  const updateWot = useWotStore((s) => s.updateSettings)
  const refreshGraph = useWotStore((s) => s.refreshGraph)
  const building = useWotStore((s) => s.building)
  const graphDepth = useWotStore((s) => s.graphDepth)
  const graphSize = useWotStore((s) => s.graphSize)
  const buildPhase = useWotStore((s) => s.buildPhase)
  const buildProgress = useWotStore((s) => s.buildProgress)
  const buildTotal = useWotStore((s) => s.buildTotal)
  const buildDepthTarget = useWotStore((s) => s.buildDepthTarget)
  const buildDepthCurrent = useWotStore((s) => s.buildDepthCurrent)

  return (
    <SettingsCard
      icon={BadgeCheck}
      title="Web of Trust"
      description="Scores users from your social graph: +1 for each of your network who follows them, −1 for each who publicly mutes them, +1 for a verified DNN ID. Mods and comments from users below your threshold are hidden. People you follow are never hidden. The graph is built from your own follows and cached locally."
    >

      {/* Score threshold */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-foreground">Score threshold</label>
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-sm font-mono font-semibold px-2 py-0.5 rounded',
              settings.scoreThreshold > 0 ? 'bg-emerald-500/15 text-emerald-400'
                : settings.scoreThreshold < 0 ? 'bg-red-500/15 text-red-400'
                  : 'bg-secondary text-muted-foreground',
            )}>
              {settings.scoreThreshold > 0 ? '+' : ''}{settings.scoreThreshold}
            </span>
            <ResetToDefault onClick={() => updateWot({ scoreThreshold: 0 })} />
          </div>
        </div>
        <Slider
          min={-5} max={5} step={1}
          value={[settings.scoreThreshold]}
          onValueChange={([v]) => updateWot({ scoreThreshold: v })}
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          Users below this score are hidden. Lower is more permissive, higher is stricter.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2.5">
          <BadgeCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-400" />
          <p className="text-xs text-neutral-400">
            <span className="text-neutral-200 font-medium">People you follow are always shown.</span> Their mods,
            posts, and comments bypass this filter regardless of their score.
          </p>
        </div>
      </div>

      {/* Follow depth */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-foreground">Follow depth</label>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-semibold px-2 py-0.5 rounded bg-secondary text-muted-foreground">
              {settings.followDepth}
            </span>
            <ResetToDefault onClick={() => updateWot({ followDepth: 1 })} />
          </div>
        </div>
        <Slider
          min={0} max={3} step={1}
          value={[settings.followDepth]}
          onValueChange={([v]) => updateWot({ followDepth: v })}
        />
        <p className="text-xs text-muted-foreground mt-1.5">{DEPTH_DESC[settings.followDepth]}</p>
      </div>

      <ToggleRow
        label="DNN ID bonus"
        description="A verified DNN ID adds +1 to a user's trust score."
        checked={settings.dnnBonus}
        onCheckedChange={(v) => updateWot({ dnnBonus: v })}
      />

      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Apply web of trust to</h4>
        <div className="divide-y divide-[#262626]">
          <ToggleRow
            label="Mods"
            description="Hide mods from low-trust users across listings, search, and discovery."
            checked={settings.applyMods}
            onCheckedChange={(v) => updateWot({ applyMods: v })}
          />
          <ToggleRow
            label="Comments"
            description="Hide comments and replies from low-trust users."
            checked={settings.applyComments}
            onCheckedChange={(v) => updateWot({ applyComments: v })}
          />
        </div>
      </div>

      {/* Trust graph status */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trust graph</h4>
        <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-2">
              {building ? (
                <Loader2 size={14} className="text-purple-400 animate-spin" />
              ) : (
                <BadgeCheck size={14} className="text-emerald-500" />
              )}
              <div>
                <p className="text-sm text-foreground">
                  {building ? 'Building graph…' : `${graphSize.toLocaleString()} users indexed`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {building
                    ? `Target depth: ${buildDepthTarget}`
                    : graphDepth >= 0 ? `Depth: ${graphDepth}` : 'Not built yet'}
                </p>
              </div>
            </div>
            <button
              onClick={() => { if (!building) refreshGraph() }}
              disabled={building}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[#262626] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={12} className={building ? 'animate-spin' : ''} />
              {building ? 'Building…' : 'Refresh'}
            </button>
          </div>

          {building && buildTotal > 0 && (
            <div className="px-3 pb-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{buildPhase}</span>
                <span className="text-foreground font-medium tabular-nums">
                  {buildProgress.toLocaleString()} / {buildTotal.toLocaleString()}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#262626] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, (buildProgress / buildTotal) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {buildDepthCurrent > 0 && `Depth ${buildDepthCurrent} of ${buildDepthTarget} · `}
                {graphSize.toLocaleString()} users indexed so far
              </p>
            </div>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}

// ─── Admin Tab ── (imported from @/components/admin/AdminSettings) ──────

// ─── Main Settings Page ─────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('network')
  const pubkey = useAuthStore((s) => s.pubkey)
  const isAdmin = pubkey === ADMIN_PUBKEY

  const visibleItems = sidebarItems.filter(item => !item.adminOnly || isAdmin)

  // Allow deep-linking to a tab via ?tab= (e.g. moderation notices link here).
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && visibleItems.some(i => i.id === t)) setActiveTab(t as SettingsTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isAdmin])

  return (
    <div className="py-8">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <nav className="flex md:flex-col gap-1 md:w-48 shrink-0">
          {visibleItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
                activeTab === id
                  ? 'bg-[#262626] text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-[#1c1c1c]'
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
          {pubkey && (
            <>
              <Separator className="my-2 bg-[#262626]" />
              <button
                onClick={() => {
                  useAuthStore.getState().logout()
                  toast.success('Logged out')
                }}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left text-red-400 hover:text-red-300 hover:bg-[#1c1c1c] cursor-pointer"
              >
                <LogOut size={16} />
                Logout
              </button>
            </>
          )}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="bg-[#0f0f0f] border border-[#262626] rounded-xl p-6">
            {activeTab === 'network' && <NetworkSettings />}
            {activeTab === 'preferences' && <PreferencesSettings />}
            {activeTab === 'moderation' && <ModerationSettings />}
            {activeTab === 'admin' && <AdminSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}
