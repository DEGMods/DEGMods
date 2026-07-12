import { useState, useEffect, useCallback, useRef } from 'react'
import { useGamesDbStore } from '@/stores/gamesDbStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useModerationStore } from '@/stores/moderationStore'
import { useAuthStore, signEvent } from '@/stores/authStore'
import { nip19 } from 'nostr-tools'
import { ADMIN_PUBKEY, CLIENT_NAME, KINDS, MODERATION_EXCLUDED_TAGS_DTAG, BLOCKED_MODS_DTAG } from '@/lib/constants'
import type { Event as NostrEvent } from 'nostr-tools'
import { fetchEvent } from '@/lib/nostr/relay-pool'
import {
  buildGameDbEvent, buildNip78ListEvent, buildAnnouncementEvent, buildMuteListEvent,
  extractAnnouncement, ANNOUNCEMENT_DTAG,
  buildAdsEvent, extractAds, ADS_DTAG, type AdEntry,
  buildFaqEvent, extractFaq, FAQ_DTAG, type FaqItem,
  buildTosEvent, extractTos, TOS_DTAG, type TosItem,
  buildFeaturedBannerEvent, extractFeaturedBanner, FEATURED_BANNER_DTAG,
  buildGuidesEvent, extractGuideCoordinates, GUIDES_DTAG, extractBlogData,
  EMULATED_PLATFORMS_DTAG, extractEmulatedPlatforms,
  SUGGESTED_TAGS_DTAG, extractSuggestedTags,
  SUGGESTED_CATEGORIES_DTAG, extractSuggestedCategories, buildSuggestedCategoriesEvent,
} from '@/lib/nostr/events'
import { CategoryChainsEditor } from '@/components/search/ModFiltersBar'
import { GameAutocomplete } from '@/components/shared/GameAutocomplete'
import { signAndPublish } from '@/lib/nostr/publish'
import { Markdown } from '@/components/shared/Markdown'
import { BlossomUploadField } from '@/components/upload/BlossomUploadField'
import { IMAGE_UPLOAD_ACCEPT } from '@/lib/constants'
import { Textarea } from '@/components/ui/textarea'
import {
  uploadFile, computeFileHash, createBlossomAuthEvent, downloadFile,
  type UploadResult,
} from '@/lib/blossom/client'
import CsvEditor from '@/components/admin/CsvEditor'
import { getNodeAds, saveNodeAds, getAdStats, MANAGED_BLOSSOMS, type AdStats } from '@/lib/blossom/adminApi'
import { parseCsvLine } from '@/lib/csv'
import { LEGACY_MOD_KIND, normalizeModCoord } from '@/lib/mods/legacy'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Pagination } from '@/components/shared/Pagination'
import {
  Database, Search, Star, Gamepad2, RefreshCw, Loader2, Megaphone,
  Upload, Trash2, FileText, Plus, Save, Pencil, SkipForward,
  AlertTriangle, X, Link2, Eye, GripVertical, ShieldAlert, EyeOff,
  Image as ImageIcon, HelpCircle, BookOpen, Joystick, Flag, Copy, ExternalLink, ChevronDown, Lightbulb,
  HardDrive, Radio, BarChart3, ScrollText,
} from 'lucide-react'
import { BlossomsTab } from './BlossomsTab'
import { RelaysTab } from './RelaysTab'
import { fetchEvents } from '@/lib/nostr/relay-pool'
import type { BlogDetails } from '@/types/blog'

// ─── Types ──────────────────────────────────────────────────────────

type AdminTab = 'games-db' | 'featured' | 'announcements' | 'ads' | 'faq' | 'tos' | 'guides' | 'suggestions' | 'moderation' | 'blossoms' | 'relays'

interface CsvFileEntry {
  hash: string
  title: string
  gameCount: number
  status: 'loaded' | 'loading' | 'error'
  preview: string[]
  csvText?: string
}

type UploadStatus = 'idle' | 'hashing' | 'uploading' | 'success' | 'error'

// ─── Helpers ────────────────────────────────────────────────────────

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
  }
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
}

function truncateUrl(url: string, maxLen = 40): string {
  try {
    const u = new URL(url)
    const host = u.hostname
    if (host.length <= maxLen) return host
    return host.slice(0, maxLen - 3) + '...'
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen - 3) + '...' : url
  }
}

// ─── Admin Tabs ─────────────────────────────────────────────────────

const adminTabs: { id: AdminTab; label: string; icon: typeof Database }[] = [
  { id: 'games-db', label: 'Games Database', icon: Database },
  { id: 'featured', label: 'Featured Content', icon: Star },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
  { id: 'ads', label: 'Ads', icon: ImageIcon },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
  { id: 'tos', label: 'ToS', icon: ScrollText },
  { id: 'guides', label: 'Guides', icon: BookOpen },
  { id: 'suggestions', label: 'Suggestions', icon: Lightbulb },
  { id: 'moderation', label: 'Moderation', icon: ShieldAlert },
  { id: 'blossoms', label: 'Blossoms', icon: HardDrive },
  { id: 'relays', label: 'Relays', icon: Radio },
]

// ─── Main AdminSettings ─────────────────────────────────────────────

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState<AdminTab>('games-db')

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-[#262626] pb-px">
        {adminTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap border-b-2 -mb-px cursor-pointer',
              activeTab === id
                ? 'border-purple-500 text-white'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'games-db' && <GamesDbTab />}
      {activeTab === 'featured' && <FeaturedTab />}
      {activeTab === 'announcements' && <AnnouncementsTab />}
      {activeTab === 'ads' && <AdsTab />}
      {activeTab === 'faq' && <FaqTab />}
      {activeTab === 'tos' && <TosTab />}
      {activeTab === 'guides' && <GuidesTab />}
      {activeTab === 'suggestions' && <SuggestionsTab />}
      {activeTab === 'moderation' && <ModerationTab />}
      {activeTab === 'blossoms' && <BlossomsTab />}
      {activeTab === 'relays' && <RelaysTab />}
    </div>
  )
}

// ─── Games Database Tab ─────────────────────────────────────────────

function GamesDbTab() {
  const gamesDb = useGamesDbStore()
  const [csvFiles, setCsvFiles] = useState<CsvFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Upload state
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [uploadPercent, setUploadPercent] = useState(0)
  const [uploadSpeed, setUploadSpeed] = useState(0)
  const [currentHost, setCurrentHost] = useState('')
  // Abort controller for the in-flight server upload, so "Skip server" cancels
  // the CURRENT upload and moves on (rather than skipping the next server).
  const skipAbortRef = useRef<AbortController | null>(null)

  // Change tracking
  const [pendingHashes, setPendingHashes] = useState<string[]>([])
  const [removedHashes, setRemovedHashes] = useState<string[]>([])
  const [hasChanges, setHasChanges] = useState(false)

  // Editing state
  const [editingHash, setEditingHash] = useState<string | null>(null)
  const [editingTitleHash, setEditingTitleHash] = useState<string | null>(null)
  const [editingTitleValue, setEditingTitleValue] = useState('')

  // ── Upload to all servers with skip support ──
  const uploadToAllWithSkip = useCallback(async (file: File | Blob) => {
    const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
    const hash = await computeFileHash(file)
    const authHeader = await createBlossomAuthEvent(signEvent, 'upload', hash)
    const results: UploadResult[] = []

    for (const serverUrl of blossomUrls) {
      setCurrentHost(serverUrl)
      setUploadPercent(0)
      setUploadSpeed(0)
      const controller = new AbortController()
      skipAbortRef.current = controller

      try {
        let lastLoaded = 0
        let lastTime = Date.now()
        const result = await uploadFile(file, serverUrl, authHeader, (p) => {
          const now = Date.now()
          const elapsed = (now - lastTime) / 1000
          if (elapsed > 0.2) {
            setUploadSpeed((p.loaded - lastLoaded) / elapsed)
            lastLoaded = p.loaded
            lastTime = now
          }
          setUploadPercent(p.percentage)
        }, 60000, controller.signal)
        results.push(result)
      } catch {
        // failed, skipped, or timed out on this server — move to the next.
      }
    }
    skipAbortRef.current = null
    return results
  }, [])

  // ── Load current event ──
  const loadCurrentEvent = useCallback(async () => {
    setLoading(true)
    try {
      const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
      const event = await fetchEvent(relayUrls, {
        kinds: [KINDS.GAME_DB],
        authors: [ADMIN_PUBKEY],
        '#d': ['games-db'],
      })

      if (!event) {
        setCsvFiles([])
        setLoading(false)
        return
      }

      const csvTags = event.tags.filter(t => t[0] === 'csv')
      const entries: CsvFileEntry[] = []

      for (const tag of csvTags) {
        const hash = tag[1]
        const title = tag[2] || ''
        try {
          let text = ''
          for (const url of blossomUrls) {
            try {
              const blob = await downloadFile(`${url.replace(/\/$/, '')}/${hash}`, undefined, 10000)
              text = await blob.text()
              break
            } catch { /* try next */ }
          }

          if (text) {
            const lines = text.split('\n').filter(l => l.trim())
            const gameLines = lines.slice(1)
            const preview = gameLines.slice(0, 5).map(l => parseCsvLine(l)[0]).filter(Boolean)
            entries.push({ hash, title, gameCount: gameLines.length, status: 'loaded', preview })
          } else {
            entries.push({ hash, title, gameCount: 0, status: 'error', preview: [] })
          }
        } catch {
          entries.push({ hash, title, gameCount: 0, status: 'error', preview: [] })
        }
      }

      setCsvFiles(entries)
      setPendingHashes([])
      setRemovedHashes([])
      setHasChanges(false)
    } catch {
      toast.error('Failed to load games-db event')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCurrentEvent() }, [loadCurrentEvent])

  // ── Upload a new CSV ──
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (!file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file')
      return
    }

    const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
    if (blossomUrls.length === 0) {
      toast.error('No Blossom servers configured')
      return
    }

    setUploadStatus('hashing')
    setUploadPercent(0)
    setUploadSpeed(0)
    setCurrentHost('')
    skipAbortRef.current = null

    try {
      const text = await file.text()
      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) {
        toast.error('CSV file appears empty (needs header + at least 1 game)')
        setUploadStatus('idle')
        return
      }

      const gameCount = lines.length - 1
      toast.info(`CSV contains ${gameCount.toLocaleString()} games. Uploading...`)

      setUploadStatus('uploading')
      const results = await uploadToAllWithSkip(file)

      if (results.length === 0) {
        toast.error('Upload failed on all servers')
        setUploadStatus('error')
        return
      }

      const hash = results[0].hash

      const allHashes = [
        ...csvFiles.filter(f => !removedHashes.includes(f.hash)).map(f => f.hash),
        ...pendingHashes,
      ]
      if (allHashes.includes(hash)) {
        toast.info('This CSV file is already in the database')
        setUploadStatus('idle')
        return
      }

      const preview = lines.slice(1, 6).map(l => parseCsvLine(l)[0]).filter(Boolean)
      const title = file.name.replace(/\.csv$/i, '')
      setCsvFiles(prev => [...prev, { hash, title, gameCount, status: 'loaded', preview }])
      setPendingHashes(prev => [...prev, hash])
      setHasChanges(true)
      setUploadStatus('success')
      toast.success(`Uploaded ${gameCount.toLocaleString()} games (${results.length} server${results.length > 1 ? 's' : ''})`)

      setTimeout(() => setUploadStatus('idle'), 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
      setUploadStatus('error')
    }
  }

  // ── Remove a CSV file ──
  const handleRemoveCsv = (hash: string) => {
    if (pendingHashes.includes(hash)) {
      setPendingHashes(prev => prev.filter(h => h !== hash))
      setCsvFiles(prev => prev.filter(f => f.hash !== hash))
    } else {
      setRemovedHashes(prev => [...prev, hash])
    }
    setHasChanges(true)
  }

  // ── Undo removal ──
  const handleUndoRemove = (hash: string) => {
    setRemovedHashes(prev => prev.filter(h => h !== hash))
    setHasChanges(
      pendingHashes.length > 0 ||
      removedHashes.filter(h => h !== hash).length > 0
    )
  }

  // ── Edit CSV ──
  const handleEditCsv = async (hash: string) => {
    const entry = csvFiles.find(f => f.hash === hash)
    if (!entry) return

    if (entry.csvText) {
      setEditingHash(hash)
      return
    }

    // Load CSV text from Blossom
    setCsvFiles(prev => prev.map(f => f.hash === hash ? { ...f, status: 'loading' } : f))
    const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
    let text = ''
    for (const url of blossomUrls) {
      try {
        const blob = await downloadFile(`${url.replace(/\/$/, '')}/${hash}`, undefined, 15000)
        text = await blob.text()
        break
      } catch { /* try next */ }
    }

    if (!text) {
      toast.error('Failed to download CSV for editing')
      setCsvFiles(prev => prev.map(f => f.hash === hash ? { ...f, status: 'error' } : f))
      return
    }

    setCsvFiles(prev => prev.map(f => f.hash === hash ? { ...f, csvText: text, status: 'loaded' } : f))
    setEditingHash(hash)
  }

  // ── Save edited CSV ──
  const handleSaveEditedCsv = async (newText: string, newTitle: string) => {
    if (!editingHash) return

    const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
    if (blossomUrls.length === 0) {
      toast.error('No Blossom servers configured')
      return
    }

    setUploadStatus('uploading')
    setUploadPercent(0)
    setUploadSpeed(0)
    setCurrentHost('')
    skipAbortRef.current = null

    try {
      const blob = new Blob([newText], { type: 'text/csv' })
      const results = await uploadToAllWithSkip(blob)

      if (results.length === 0) {
        toast.error('Upload failed on all servers')
        setUploadStatus('error')
        return
      }

      const newHash = results[0].hash
      const lines = newText.split('\n').filter(l => l.trim())
      const gameLines = lines.slice(1)
      const preview = gameLines.slice(0, 5).map(l => parseCsvLine(l)[0]).filter(Boolean)

      setCsvFiles(prev => prev.map(f => {
        if (f.hash !== editingHash) return f
        return {
          hash: newHash,
          title: newTitle,
          gameCount: gameLines.length,
          status: 'loaded' as const,
          preview,
          csvText: newText,
        }
      }))

      // Update pending hashes if this was a pending file
      if (pendingHashes.includes(editingHash)) {
        setPendingHashes(prev => prev.map(h => h === editingHash ? newHash : h))
      } else {
        // Old hash is effectively removed, new hash is pending
        setRemovedHashes(prev => [...prev, editingHash])
        setPendingHashes(prev => [...prev, newHash])
      }

      setHasChanges(true)
      setEditingHash(null)
      setUploadStatus('success')
      toast.success('CSV updated successfully')
      setTimeout(() => setUploadStatus('idle'), 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save CSV')
      setUploadStatus('error')
    }
  }

  // ── Title editing ──
  const startEditTitle = (hash: string, currentTitle: string) => {
    setEditingTitleHash(hash)
    setEditingTitleValue(currentTitle)
  }

  const commitTitle = () => {
    if (!editingTitleHash) return
    setCsvFiles(prev => prev.map(f =>
      f.hash === editingTitleHash ? { ...f, title: editingTitleValue } : f
    ))
    setHasChanges(true)
    setEditingTitleHash(null)
  }

  // ── Publish ──
  const handlePublish = async () => {
    setPublishing(true)
    try {
      const csvFilesData = csvFiles
        .filter(f => !removedHashes.includes(f.hash))
        .map(f => ({ hash: f.hash, title: f.title }))

      if (csvFilesData.length === 0) {
        toast.error('Cannot publish with zero CSV files')
        setPublishing(false)
        return
      }

      const unsignedEvent = buildGameDbEvent('games-db', csvFilesData)
      const result = await signAndPublish(unsignedEvent, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work...', { id: 'admin-publish' })
        if (status === 'signing') toast.loading('Signing event...', { id: 'admin-publish' })
        if (status === 'publishing') toast.loading('Publishing to relays...', { id: 'admin-publish' })
      })

      if (result.success) {
        toast.success(`Games database published with ${csvFilesData.length} CSV file${csvFilesData.length > 1 ? 's' : ''}`, { id: 'admin-publish' })
        setPendingHashes([])
        setRemovedHashes([])
        setHasChanges(false)
        const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
        await gamesDb.syncGamesDb(relayUrls, blossomUrls, ADMIN_PUBKEY)
        await loadCurrentEvent()
      } else {
        toast.error(result.error || 'Publish failed', { id: 'admin-publish' })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'admin-publish' })
    } finally {
      setPublishing(false)
    }
  }

  // ── Sync ──
  const handleSync = async () => {
    setSyncing(true)
    try {
      const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const blossomUrls = useSettingsStore.getState().getAllEnabledBlossomUrls()
      await gamesDb.syncGamesDb(relayUrls, blossomUrls, ADMIN_PUBKEY)
      toast.success('Games database synced')
      await loadCurrentEvent()
    } catch {
      toast.error('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  // ── Search ──
  const searchResults = searchQuery.trim()
    ? gamesDb.searchGames(searchQuery)
    : []

  const totalGames = csvFiles
    .filter(f => !removedHashes.includes(f.hash))
    .reduce((sum, f) => sum + f.gameCount, 0)

  // ── If editing, show CsvEditor ──
  if (editingHash) {
    const entry = csvFiles.find(f => f.hash === editingHash)
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm"
            onClick={() => setEditingHash(null)}
            className="text-neutral-400 hover:text-white text-xs"
          >
            <X size={14} className="mr-1" />
            Cancel
          </Button>
          <span className="text-sm text-neutral-300">
            Editing: <span className="text-white font-medium">{entry?.title || 'Untitled'}</span>
          </span>
        </div>

        {/* Upload progress during CSV save */}
        {uploadStatus === 'uploading' && (
          <UploadProgressCard
            currentHost={currentHost}
            uploadPercent={uploadPercent}
            uploadSpeed={uploadSpeed}
            onSkip={() => { skipAbortRef.current?.abort() }}
          />
        )}

        <CsvEditor
          csvText={entry?.csvText || ''}
          title={entry?.title || ''}
          onSave={handleSaveEditedCsv}
          onCancel={() => setEditingHash(null)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="border-[#262626] text-xs gap-1.5">
          <Database size={12} />
          {csvFiles.filter(f => !removedHashes.includes(f.hash)).length} CSV files
        </Badge>
        <Badge variant="outline" className="border-[#262626] text-xs gap-1.5">
          <Gamepad2 size={12} />
          {totalGames.toLocaleString()} games
        </Badge>
        <Badge variant="outline" className="border-[#262626] text-xs gap-1.5">
          Last synced: {gamesDb.lastUpdated
            ? new Date(gamesDb.lastUpdated).toLocaleString()
            : 'Never'}
        </Badge>
        <div className="flex-1" />
        <Button
          variant="outline" size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="border-[#262626] hover:bg-[#2a2a2a] text-xs"
        >
          {syncing ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <RefreshCw size={12} className="mr-1.5" />}
          Sync
        </Button>
      </div>

      <Separator className="bg-[#262626]" />

      {/* CSV Files List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">CSV Files</h3>
          <label>
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              className="hidden"
              disabled={uploadStatus === 'uploading' || uploadStatus === 'hashing'}
            />
            <Button
              variant="outline" size="sm" asChild
              className="border-[#262626] hover:bg-[#2a2a2a] text-xs cursor-pointer"
            >
              <span>
                <Plus size={12} className="mr-1.5" />
                Add CSV File
              </span>
            </Button>
          </label>
        </div>

        {/* Upload progress */}
        {(uploadStatus === 'uploading' || uploadStatus === 'hashing') && (
          <UploadProgressCard
            currentHost={currentHost}
            uploadPercent={uploadPercent}
            uploadSpeed={uploadSpeed}
            isHashing={uploadStatus === 'hashing'}
            onSkip={() => { skipAbortRef.current?.abort() }}
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 size={16} className="animate-spin text-purple-400" />
            <span className="text-xs text-neutral-500">Loading CSV files...</span>
          </div>
        ) : csvFiles.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-[#262626] rounded-lg">
            <FileText size={24} className="mx-auto text-neutral-600 mb-2" />
            <p className="text-xs text-neutral-500">No CSV files published yet</p>
            <p className="text-[11px] text-neutral-600 mt-1">Upload CSV files with format: Game Name,16 by 9 image,Boxart image</p>
          </div>
        ) : (
          <div className="space-y-2">
            {csvFiles.map((file) => {
              const isRemoved = removedHashes.includes(file.hash)
              const isPending = pendingHashes.includes(file.hash)

              return (
                <div
                  key={file.hash}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                    isRemoved
                      ? 'border-red-500/20 bg-red-500/5 opacity-60'
                      : isPending
                        ? 'border-purple-500/30 bg-purple-500/5'
                        : 'border-[#262626] bg-[#1c1c1c]'
                  )}
                >
                  <FileText size={16} className={cn(
                    'mt-0.5 shrink-0',
                    isRemoved ? 'text-red-400' : isPending ? 'text-purple-400' : 'text-neutral-500'
                  )} />

                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-center gap-2 mb-0.5">
                      {editingTitleHash === file.hash ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitTitle()
                              if (e.key === 'Escape') setEditingTitleHash(null)
                            }}
                            onBlur={commitTitle}
                            autoFocus
                            className="h-6 text-xs bg-[#212121] border-[#262626] px-1.5 w-48"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditTitle(file.hash, file.title)}
                          className="flex items-center gap-1 text-xs text-neutral-200 hover:text-white transition-colors cursor-pointer group"
                        >
                          <span className="font-medium truncate max-w-[200px]">
                            {file.title || 'Untitled'}
                          </span>
                          <Pencil size={10} className="text-neutral-600 group-hover:text-purple-400 shrink-0" />
                        </button>
                      )}
                      {isPending && <Badge className="bg-purple-600/20 text-purple-400 text-[10px] border-0">New</Badge>}
                      {isRemoved && <Badge className="bg-red-600/20 text-red-400 text-[10px] border-0">Removed</Badge>}
                    </div>

                    {/* Hash + meta */}
                    <div className="flex items-center gap-2">
                      <code className="text-[11px] text-neutral-500 font-mono">{file.hash.slice(0, 12)}...{file.hash.slice(-8)}</code>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[11px] text-neutral-500">{file.gameCount.toLocaleString()} games</span>
                      {file.status === 'error' && (
                        <span className="text-[11px] text-red-400 flex items-center gap-1">
                          <AlertTriangle size={10} /> Failed to load preview
                        </span>
                      )}
                      {file.status === 'loading' && (
                        <span className="text-[11px] text-neutral-500 flex items-center gap-1">
                          <Loader2 size={10} className="animate-spin" /> Loading...
                        </span>
                      )}
                    </div>
                    {file.preview.length > 0 && (
                      <p className="text-[11px] text-neutral-600 mt-1 truncate">
                        {file.preview.join(', ')}...
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    {isRemoved ? (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => handleUndoRemove(file.hash)}
                        className="text-xs text-neutral-400 hover:text-white"
                      >
                        Undo
                      </Button>
                    ) : (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleEditCsv(file.hash)}
                              className="text-neutral-600 hover:text-purple-400 cursor-pointer p-1 rounded hover:bg-[#2a2a2a] transition-colors"
                              aria-label="Edit CSV"
                            >
                              <Pencil size={13} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Edit CSV</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleRemoveCsv(file.hash)}
                              className="text-neutral-600 hover:text-red-400 cursor-pointer p-1 rounded hover:bg-[#2a2a2a] transition-colors"
                              aria-label="Remove"
                            >
                              <Trash2 size={13} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Remove</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Publish bar */}
      {hasChanges && (
        <>
          <Separator className="bg-[#262626]" />
          <div className="flex items-center justify-between bg-purple-500/5 border border-purple-500/20 rounded-lg p-3">
            <div className="text-xs text-neutral-300">
              <span className="font-medium text-white">Unsaved changes</span>
              {pendingHashes.length > 0 && <span className="text-purple-400 ml-2">+{pendingHashes.length} added</span>}
              {removedHashes.length > 0 && <span className="text-red-400 ml-2">-{removedHashes.length} removed</span>}
            </div>
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={publishing}
              className="bg-purple-600 hover:bg-purple-700 text-xs"
            >
              {publishing ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
              Publish Games DB
            </Button>
          </div>
        </>
      )}

      <Separator className="bg-[#262626]" />

      {/* Search */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white">Search Games</h3>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search games in database..."
            className="pl-9 bg-[#212121] border-[#262626] text-sm"
          />
        </div>
        {searchQuery.trim() && (
          <div className="max-h-48 overflow-y-auto space-y-0.5 rounded-lg border border-[#262626] bg-[#171717] p-2">
            {searchResults.length === 0 ? (
              <p className="text-xs text-neutral-600 py-2 text-center">No games found</p>
            ) : (
              searchResults.map((game, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-[#2a2a2a] transition-colors">
                  {game.wideImage ? (
                    <img src={game.wideImage} alt={game.name} className="w-10 h-6 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-6 rounded bg-[#262626] flex items-center justify-center shrink-0">
                      <Gamepad2 size={12} className="text-neutral-600" />
                    </div>
                  )}
                  <span className="text-xs text-neutral-300 truncate">{game.name}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Upload Progress Card ───────────────────────────────────────────

function UploadProgressCard({
  currentHost,
  uploadPercent,
  uploadSpeed,
  isHashing,
  onSkip,
}: {
  currentHost: string
  uploadPercent: number
  uploadSpeed: number
  isHashing?: boolean
  onSkip: () => void
}) {
  const [skipping, setSkipping] = useState(false)

  const handleSkip = () => {
    onSkip()
    setSkipping(true)
    setTimeout(() => setSkipping(false), 1200)
  }

  if (isHashing) {
    return (
      <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-3">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-purple-400" />
          <span className="text-xs text-neutral-300">Hashing file...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[#262626] bg-[#1c1c1c] p-3 space-y-2.5">
      {/* Host + speed row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Upload size={13} className="text-purple-400 shrink-0" />
          <span className="text-xs text-neutral-300 truncate">
            Uploading to <span className="text-white font-medium">{truncateUrl(currentHost)}</span>
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {uploadSpeed > 0 && (
            <span className="text-[11px] text-neutral-500 font-mono">
              {formatSpeed(uploadSpeed)}
            </span>
          )}
          <span className="text-xs text-purple-400 font-medium tabular-nums w-10 text-right">
            {uploadPercent}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-[#212121] rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-500 rounded-full transition-all duration-300"
          style={{ width: `${uploadPercent}%` }}
        />
      </div>

      {/* Skip button */}
      <div className="flex justify-end">
        <Button
          variant="ghost" size="sm"
          onClick={handleSkip}
          disabled={skipping}
          className="text-[11px] text-neutral-500 hover:text-neutral-300 h-6 px-2"
        >
          {skipping ? (
            <>
              <Loader2 size={11} className="animate-spin mr-1" />
              Skipping...
            </>
          ) : (
            <>
              <SkipForward size={11} className="mr-1" />
              Skip server
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ─── Featured Content Tab ───────────────────────────────────────────

function FeaturedTab() {
  return (
    <div className="space-y-6">
      <p className="text-xs text-neutral-500">
        Configure featured content shown on the home page. Each section is a NIP-78 (kind 30078)
        replaceable event under a fixed <code className="text-purple-400">d</code> tag.
      </p>

      <FeaturedModSection
        dTag="home-featured-mods-slider"
        title="Featured Mods Slider"
        desc="Mods shown in the hero slider at the top of the home page."
        icon={Star}
      />
      <FeaturedModSection
        dTag="home-featured-mods"
        title="Featured Mods Grid"
        desc="Mods highlighted in the featured grid section."
        icon={Gamepad2}
      />
      <FeaturedGamesSection
        dTag="home-featured-games"
        title="Featured Games"
        desc="Games featured on the home page."
      />
      <FeaturedBannerSection />
    </div>
  )
}

// ── Featured Mod Banner (single image + mod link, above the slider) ──

function FeaturedBannerSection() {
  const dTag = FEATURED_BANNER_DTAG
  const [image, setImage] = useState('')
  const [naddrInput, setNaddrInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [baseline, setBaseline] = useState('|')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [dTag] })
      const b = event ? extractFeaturedBanner(event) : null
      const img = b?.image ?? ''
      const addr = b?.coord ? (coordNaddr(b.coord) ?? b.coord) : ''
      setImage(img)
      setNaddrInput(addr)
      setBaseline(`${img}|${addr}`)
    } catch { toast.error('Failed to load banner') } finally { setLoading(false) }
  }, [dTag])
  useEffect(() => { load() }, [load])

  const dirty = `${image}|${naddrInput}` !== baseline

  const publish = async () => {
    const bothEmpty = !image.trim() && !naddrInput.trim()
    let banner = { image: '', coord: '' }
    if (!bothEmpty) {
      const parsed = naddrToModCoord(naddrInput)
      if ('error' in parsed) { toast.error(parsed.error); return }
      if (!image.trim()) { toast.error('Add a banner image'); return }
      banner = { image: image.trim(), coord: parsed.coord }
    }
    setPublishing(true)
    try {
      const result = await signAndPublish(buildFeaturedBannerEvent(banner), (s) => {
        if (s === 'mining') toast.loading('Processing proof of work…', { id: dTag })
        if (s === 'publishing') toast.loading('Publishing…', { id: dTag })
      })
      if (result.success) { toast.success(bothEmpty ? 'Banner cleared' : 'Featured mod banner published', { id: dTag }); setBaseline(`${image}|${naddrInput}`) }
      else toast.error(result.error || 'Publish failed', { id: dTag })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Publish failed', { id: dTag }) } finally { setPublishing(false) }
  }

  const inputClass = 'bg-[#212121] border-[#262626] text-white text-sm'
  return (
    <div className="p-4 rounded-lg border border-[#262626] bg-[#1c1c1c] space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon size={14} className="text-purple-400" />
        <h4 className="text-sm font-medium text-white">Featured Mod Banner</h4>
        <code className="ml-auto text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">d:{dTag}</code>
      </div>
      <p className="text-[11px] text-neutral-500">
        A full-width banner shown above the slider on the home page, linking to one mod. Needs both an
        image and the mod's <strong>naddr</strong>. Clear both fields and publish to hide it.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="text-xs text-neutral-400">Banner image</label>
            <BlossomUploadField accept={IMAGE_UPLOAD_ACCEPT} label="Drop an image or click to upload" sublabel="Mirrored to up to 3 servers" onUploaded={(r) => setImage(r.url)} resetAfter />
            <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="Banner image URL" className={`${inputClass} font-mono text-xs`} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-neutral-400">Mod address</label>
            <Input value={naddrInput} onChange={(e) => setNaddrInput(e.target.value)} placeholder="naddr1… (current or legacy mod)" className={`${inputClass} font-mono text-xs`} />
          </div>
          {image.trim() && (
            <div className="overflow-hidden rounded-lg border border-[#262626] bg-[#171717]">
              <img src={image} alt="" className="max-h-44 w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
            </div>
          )}
          <Button onClick={publish} disabled={!dirty || publishing} className="w-full">
            {publishing ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Publish
          </Button>
        </>
      )}
    </div>
  )
}

// ── Shared: decode an naddr (or raw coordinate) into a mod `a` coord ──
// Accepts current mods (kind 31142) and legacy mods (kind 30402).

function naddrToModCoord(input: string): { coord: string } | { error: string } {
  const value = input.trim()
  if (!value) return { error: 'Enter an naddr' }

  // Accept a raw coordinate too: 31142 (current) or 30402 (legacy) mods.
  if (/^(31142|30402):[0-9a-f]{64}:.+$/i.test(value)) return { coord: normalizeModCoord(value) }

  try {
    const decoded = nip19.decode(value)
    if (decoded.type !== 'naddr') return { error: 'Not an naddr address' }
    const { kind, pubkey, identifier } = decoded.data
    if (kind !== KINDS.MOD && kind !== LEGACY_MOD_KIND) {
      return { error: `naddr is kind ${kind}, expected a mod (31142 or legacy 30402)` }
    }
    return { coord: normalizeModCoord(`${kind}:${pubkey}:${identifier}`) }
  } catch {
    return { error: 'Invalid naddr' }
  }
}

interface FeaturedItem {
  coord: string
  title?: string
  resolving?: boolean
}

// ── Shared drag-to-reorder behaviour (HTML5 DnD, no library) ──

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr
  const next = arr.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

function useDragReorder<T>(
  setList: React.Dispatch<React.SetStateAction<T[]>>,
  onReorder: () => void,
) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const itemProps = (i: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move' },
    onDragOver: (e: React.DragEvent) => { e.preventDefault() },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      if (dragIndex !== null && dragIndex !== i) {
        setList(list => moveItem(list, dragIndex, i))
        onReorder()
      }
      setDragIndex(null)
    },
    onDragEnd: () => setDragIndex(null),
  })
  return { dragIndex, itemProps }
}

// ── Featured Mods (slider / grid) ──

function FeaturedModSection({
  dTag, title, desc, icon: Icon,
}: { dTag: string; title: string; desc: string; icon: typeof Star }) {
  const [items, setItems] = useState<FeaturedItem[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)

  const resolveTitle = useCallback(async (coord: string): Promise<string | undefined> => {
    const [kindStr, pubkey, ...rest] = coord.split(':')
    const identifier = rest.join(':')
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    const event = await fetchEvent(relays, {
      kinds: [Number(kindStr)], authors: [pubkey], '#d': [identifier],
    })
    if (!event) return undefined
    return event.tags.find(t => t[0] === 'title')?.[1] || undefined
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, {
        kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [dTag],
      })
      // Repair any legacy coords that were stored with a doubled prefix so they
      // resolve, and so a re-publish writes the clean form back.
      const raw = (event?.tags ?? []).filter(t => t[0] === 'a').map(t => t[1])
      const coords = raw.map(normalizeModCoord)
      setItems(coords.map(coord => ({ coord, resolving: true })))
      setDirty(coords.some((c, i) => c !== raw[i]))
      // Resolve titles in the background
      coords.forEach(async coord => {
        const title = await resolveTitle(coord).catch(() => undefined)
        setItems(prev => prev.map(it => it.coord === coord ? { ...it, title, resolving: false } : it))
      })
    } catch {
      toast.error(`Failed to load ${dTag}`)
    } finally {
      setLoading(false)
    }
  }, [dTag, resolveTitle])

  useEffect(() => { load() }, [load])

  const addItem = async () => {
    const result = naddrToModCoord(input)
    if ('error' in result) { toast.error(result.error); return }
    if (items.some(it => it.coord === result.coord)) {
      toast.error('Already in the list')
      return
    }
    const newItem: FeaturedItem = { coord: result.coord, resolving: true }
    setItems(prev => [...prev, newItem])
    setInput('')
    setDirty(true)
    const title = await resolveTitle(result.coord).catch(() => undefined)
    setItems(prev => prev.map(it => it.coord === newItem.coord ? { ...it, title, resolving: false } : it))
  }

  const removeItem = (coord: string) => {
    setItems(prev => prev.filter(it => it.coord !== coord))
    setDirty(true)
  }

  const { dragIndex, itemProps } = useDragReorder(setItems, () => setDirty(true))

  const publish = async () => {
    setPublishing(true)
    try {
      const unsigned = buildNip78ListEvent(dTag, items.map(it => ['a', it.coord]))
      const result = await signAndPublish(unsigned, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: dTag })
        if (status === 'signing') toast.loading('Signing…', { id: dTag })
        if (status === 'publishing') toast.loading('Publishing…', { id: dTag })
      })
      if (result.success) {
        toast.success(`${title} published (${items.length})`, { id: dTag })
        setDirty(false)
      } else {
        toast.error(result.error || 'Publish failed', { id: dTag })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: dTag })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="p-4 rounded-lg border border-[#262626] bg-[#1c1c1c] space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-purple-400" />
        <h4 className="text-sm font-medium text-white">{title}</h4>
        <code className="ml-auto text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">d:{dTag}</code>
      </div>
      <p className="text-[11px] text-neutral-500">{desc} Paste a mod's <strong>naddr</strong> to add it.</p>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
          placeholder="naddr1… (current or legacy mod)"
          className="bg-[#212121] border-[#262626] text-white text-xs font-mono"
        />
        <Button size="sm" onClick={addItem} disabled={!input.trim()} className="bg-purple-600 hover:bg-purple-700 shrink-0">
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2">
          <Loader2 size={14} className="animate-spin" /> Loading current selection…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-neutral-600 py-2">No mods featured yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li
              key={it.coord}
              {...itemProps(i)}
              className={cn(
                'flex items-center gap-2 rounded-md border border-[#262626] bg-[#212121] px-2.5 py-1.5',
                dragIndex === i && 'opacity-40',
              )}
            >
              <GripVertical size={14} className="text-neutral-600 cursor-grab shrink-0" />
              <span className="text-[10px] text-neutral-600 w-4 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-200 truncate">
                  {it.resolving ? 'Resolving…' : (it.title || <span className="text-neutral-500 italic">Unknown / not found</span>)}
                </p>
                <p className="text-[10px] text-neutral-600 font-mono truncate">{it.coord}</p>
              </div>
              <button onClick={() => removeItem(it.coord)} className="text-neutral-500 hover:text-red-400 shrink-0" aria-label="Remove">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={publish} disabled={publishing || !dirty} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
          Publish
        </Button>
        {dirty && <span className="text-[11px] text-yellow-500/80">Unpublished changes</span>}
      </div>
    </div>
  )
}

// ── Featured Games ──

function FeaturedGamesSection({ dTag, title, desc }: { dTag: string; title: string; desc: string }) {
  const [games, setGames] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, {
        kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [dTag],
      })
      const names = (event?.tags ?? []).filter(t => t[0] === 'game' || t[0] === 'g').map(t => t[1])
      setGames(names)
      setDirty(false)
    } catch {
      toast.error(`Failed to load ${dTag}`)
    } finally {
      setLoading(false)
    }
  }, [dTag])

  useEffect(() => { load() }, [load])

  const { dragIndex, itemProps } = useDragReorder(setGames, () => setDirty(true))

  const addGame = () => {
    const name = input.trim()
    if (!name) return
    if (games.some(g => g.toLowerCase() === name.toLowerCase())) {
      toast.error('Already in the list')
      return
    }
    setGames(prev => [...prev, name])
    setInput('')
    setDirty(true)
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const unsigned = buildNip78ListEvent(dTag, games.map(g => ['game', g]))
      const result = await signAndPublish(unsigned, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: dTag })
        if (status === 'publishing') toast.loading('Publishing…', { id: dTag })
      })
      if (result.success) {
        toast.success(`${title} published (${games.length})`, { id: dTag })
        setDirty(false)
      } else {
        toast.error(result.error || 'Publish failed', { id: dTag })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: dTag })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="p-4 rounded-lg border border-[#262626] bg-[#1c1c1c] space-y-3">
      <div className="flex items-center gap-2">
        <Database size={14} className="text-purple-400" />
        <h4 className="text-sm font-medium text-white">{title}</h4>
        <code className="ml-auto text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">d:{dTag}</code>
      </div>
      <p className="text-[11px] text-neutral-500">{desc} Type a game name to add it.</p>

      <div className="flex gap-2">
        <div className="flex-1">
          <GameAutocomplete
            value={input}
            onChange={setInput}
            placeholder="Search for a game to add…"
            className="bg-[#212121] border-[#262626] text-white text-xs"
          />
        </div>
        <Button size="sm" onClick={addGame} disabled={!input.trim()} className="bg-purple-600 hover:bg-purple-700 shrink-0">
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : games.length === 0 ? (
        <p className="text-xs text-neutral-600 py-2">No games featured yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {games.map((g, i) => (
            <span
              key={g}
              {...itemProps(i)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-[#262626] bg-[#212121] px-2 py-1 text-xs text-neutral-200',
                dragIndex === i && 'opacity-40',
              )}
            >
              <GripVertical size={12} className="text-neutral-600 cursor-grab" />
              {g}
              <button onClick={() => { setGames(prev => prev.filter(x => x !== g)); setDirty(true) }} className="text-neutral-500 hover:text-red-400" aria-label="Remove">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={publish} disabled={publishing || !dirty} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
          Publish
        </Button>
        {dirty && <span className="text-[11px] text-yellow-500/80">Unpublished changes</span>}
      </div>
    </div>
  )
}

// ─── Ads Tab ────────────────────────────────────────────────────────

interface EditAd extends AdEntry { id: string }

const emptyAd = (): EditAd => ({ id: crypto.randomUUID(), name: '', description: '', banner: '', profilePic: '', buttons: [] })

// ── Download-gate ads (node-signed NIP-78 inventory; BUD-Ads gate target) ──

interface GateAd { id: string; media: string; link: string; alt: string; weight: number }

function GateAdsSection() {
  // Today there's one managed node; a selector can be added when there are more.
  const node = MANAGED_BLOSSOMS[0]
  const [ads, setAds] = useState<GateAd[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [gateRef, setGateRef] = useState('')
  const [relays, setRelays] = useState<string[]>([])
  const [baseline, setBaseline] = useState('[]')
  const [stats, setStats] = useState<AdStats | null>(null)
  const [statsAdId, setStatsAdId] = useState<string | null>(null)

  const serialize = (l: GateAd[]) => JSON.stringify(l.map(({ id, media, link, alt, weight }) => ({ id, media, link, alt, weight })))

  const toRows = (items: { id: string; media: string; link?: string; alt?: string; weight?: number }[]): GateAd[] =>
    items.map((a) => ({ id: a.id, media: a.media, link: a.link ?? '', alt: a.alt ?? '', weight: a.weight ?? 1 }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const info = await getNodeAds(node.url)
      const rows = toRows(info.ads ?? [])
      setAds(rows)
      setGateRef(info.ref ?? '')
      setRelays(info.publish_relays ?? [])
      setBaseline(serialize(rows))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load gate ads')
    } finally {
      setLoading(false)
    }
  }, [node.url])

  useEffect(() => { load() }, [load])

  // Per-ad view/click counts (only served while the node's ad gate is enabled).
  useEffect(() => { getAdStats(node.url).then(setStats).catch(() => setStats(null)) }, [node.url])

  const dirty = serialize(ads) !== baseline
  const update = (id: string, patch: Partial<GateAd>) => setAds((prev) => prev.map((a) => a.id === id ? { ...a, ...patch } : a))
  const remove = (id: string) => setAds((prev) => prev.filter((a) => a.id !== id))
  const add = () => setAds((prev) => [...prev, { id: crypto.randomUUID().slice(0, 8), media: '', link: '', alt: '', weight: 1 }])

  const save = async () => {
    setSaving(true)
    try {
      const clean = ads
        .filter((a) => a.media.trim())
        .map((a) => ({
          id: a.id,
          media: a.media.trim(),
          link: a.link.trim() || undefined,
          alt: a.alt.trim() || undefined,
          weight: a.weight > 0 ? a.weight : 1,
        }))
      const res = await saveNodeAds(node.url, clean)
      const rows = toRows(res.ads ?? [])
      setAds(rows)
      setBaseline(serialize(rows))
      toast.success(`Published to ${res.published_to} relay${res.published_to === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'bg-[#212121] border-[#262626] text-white text-sm'

  return (
    <div className="space-y-3 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ImageIcon size={14} className="text-purple-400" /> Download-gate ads
          </h3>
          <p className="mt-1 text-[11px] text-neutral-500">
            Shown while a download is preparing (BUD-Ads). Signed and published by the node
            <span className="font-mono text-neutral-400"> {node.label}</span> with its own key — not your admin key.
          </p>
        </div>
        <Button onClick={add} variant="outline" size="sm" className="border-[#262626] shrink-0">
          <Plus size={14} className="mr-1.5" /> Add
        </Button>
      </div>

      {gateRef && (
        <p className="text-[10px] text-neutral-600 font-mono break-all">
          {gateRef}
          {relays.length > 0 && <span className="text-neutral-500"> → {relays.join(', ')}</span>}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-3"><Loader2 size={14} className="animate-spin" /> Loading inventory…</div>
      ) : (
        <>
          {ads.length === 0 && <p className="text-xs text-neutral-600 py-3 text-center">No gate ads. The ad gate will fail over to another source until one is added.</p>}
          {ads.map((ad, i) => (
            <div key={ad.id} className="space-y-3 rounded-lg border border-[#262626] bg-[#212121] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-300">Ad #{i + 1} <code className="text-[10px] text-neutral-600">{ad.id}</code></span>
                <div className="flex items-center gap-1">
                  {stats && (
                    <button
                      onClick={() => setStatsAdId(ad.id)}
                      className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-[#2a2a2a] hover:text-neutral-200"
                      title="View analytics"
                    >
                      <BarChart3 size={13} /> {(stats.views[ad.id] ?? 0).toLocaleString()}
                    </button>
                  )}
                  <button onClick={() => remove(ad.id)} className="text-neutral-500 hover:text-red-400" aria-label="Remove ad"><X size={16} /></button>
                </div>
              </div>

              {/* Ad image */}
              <div className="space-y-1.5">
                <label className="text-xs text-neutral-400">Ad image</label>
                <BlossomUploadField
                  accept={IMAGE_UPLOAD_ACCEPT}
                  label="Drop an image or click to upload"
                  sublabel="16:9 recommended · mirrored to up to 3 servers"
                  onUploaded={(r) => update(ad.id, { media: r.url })}
                  resetAfter
                />
                <Input value={ad.media} onChange={(e) => update(ad.id, { media: e.target.value })} placeholder="Image URL or blossom hash" className={`${inputClass} font-mono text-xs`} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-400">Click-through link (optional)</label>
                  <Input value={ad.link} onChange={(e) => update(ad.id, { link: e.target.value })} placeholder="https://…" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-400">Alt text (optional)</label>
                  <Input value={ad.alt} onChange={(e) => update(ad.id, { alt: e.target.value })} placeholder="Describe the ad" className={inputClass} />
                </div>
              </div>

              {/* Weight */}
              <div className="space-y-1.5">
                <label className="text-xs text-neutral-400">Weight <span className="text-neutral-600">· higher = shown more often in rotation</span></label>
                <div className="flex items-center gap-3">
                  <Slider value={[ad.weight]} onValueChange={([v]) => update(ad.id, { weight: v })} min={1} max={10} step={1} className="flex-1" />
                  <span className="text-lg font-bold text-foreground w-6 text-right">{ad.weight}</span>
                </div>
              </div>
            </div>
          ))}

          <Button onClick={save} disabled={!dirty || saving} className="w-full">
            {saving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Publish gate ads
          </Button>
        </>
      )}

      <Dialog open={!!statsAdId} onOpenChange={(o) => { if (!o) setStatsAdId(null) }}>
        <DialogContent className="max-w-sm border-[#262626] bg-[#1c1c1c]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-neutral-100">
              <BarChart3 size={16} className="text-purple-400" /> Ad analytics
            </DialogTitle>
          </DialogHeader>
          {statsAdId && (() => {
            const v = stats?.views[statsAdId] ?? 0
            const c = stats?.clicks[statsAdId] ?? 0
            const ctr = v > 0 ? `${((c / v) * 100).toFixed(1)}%` : '—'
            return (
              <div className="space-y-3">
                <p className="break-all font-mono text-[11px] text-neutral-500">{statsAdId}</p>
                <div className="flex gap-2">
                  {[['Views', v], ['Clicks', c], ['CTR', ctr]].map(([label, value]) => (
                    <div key={label} className="flex-1 rounded-lg border border-[#262626] bg-[#212121] p-3 text-center">
                      <div className="text-2xl font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</div>
                      <div className="text-[11px] text-neutral-500">{label}</div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-neutral-500">
                  Unique per rotating 24-hour window · aggregate-only, no IPs stored. Advertisers reconcile against their own analytics.
                </p>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AdsTab() {
  const [ads, setAds] = useState<EditAd[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [baseline, setBaseline] = useState('[]')

  const toAd = (a: EditAd): AdEntry => ({ name: a.name, description: a.description, banner: a.banner, profilePic: a.profilePic, buttons: a.buttons })
  const serialize = (list: EditAd[]) => JSON.stringify(list.map(toAd))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [ADS_DTAG] })
      const parsed = event ? extractAds(event) : []
      const withIds = parsed.map((a): EditAd => ({ ...a, id: crypto.randomUUID() }))
      setAds(withIds)
      setBaseline(serialize(withIds))
    } catch {
      toast.error('Failed to load ads')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const dirty = serialize(ads) !== baseline

  const update = (id: string, patch: Partial<EditAd>) => setAds(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
  const remove = (id: string) => setAds(prev => prev.filter(a => a.id !== id))
  const updateButton = (id: string, i: number, patch: Partial<AdEntry['buttons'][number]>) =>
    setAds(prev => prev.map(a => a.id === id ? { ...a, buttons: a.buttons.map((b, j) => j === i ? { ...b, ...patch } : b) } : a))
  const addButton = (id: string) =>
    setAds(prev => prev.map(a => (a.id === id && a.buttons.length < 3) ? { ...a, buttons: [...a.buttons, { text: '', link: '' }] } : a))
  const removeButton = (id: string, i: number) =>
    setAds(prev => prev.map(a => a.id === id ? { ...a, buttons: a.buttons.filter((_, j) => j !== i) } : a))

  const publish = async () => {
    setPublishing(true)
    try {
      const clean: AdEntry[] = ads
        .map(a => ({ ...toAd(a), buttons: a.buttons.filter(b => b.text.trim() && b.link.trim()) }))
        .filter(a => a.banner.trim() || a.name.trim() || a.description.trim())
      const result = await signAndPublish(buildAdsEvent(clean), (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: 'ads' })
        if (status === 'signing') toast.loading('Signing…', { id: 'ads' })
        if (status === 'publishing') toast.loading('Publishing…', { id: 'ads' })
      })
      if (result.success) { toast.success('Ads published', { id: 'ads' }); setBaseline(serialize(ads)) }
      else toast.error(result.error || 'Publish failed', { id: 'ads' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'ads' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="space-y-4">
      <GateAdsSection />

      <Separator className="bg-[#262626]" />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">
          <span className="font-semibold text-neutral-300">Sidebar ads.</span> Sponsored cards shown on the <span className="font-mono text-neutral-300">/ads</span> page. Each has a background image, a creator card (pic + name + description), and up to 3 link buttons.
        </p>
        <Button onClick={() => setAds(p => [...p, emptyAd()])} variant="outline" size="sm" className="border-[#262626] shrink-0">
          <Plus size={14} className="mr-1.5" /> Add Ad
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-4"><Loader2 size={14} className="animate-spin" /> Loading ads…</div>
      ) : (
        <>
          {ads.length === 0 && <p className="text-sm text-neutral-500 py-6 text-center">No ads yet. Click "Add Ad".</p>}
          {ads.map((ad, idx) => (
            <AdEditor
              key={ad.id}
              ad={ad}
              index={idx}
              onUpdate={(patch) => update(ad.id, patch)}
              onRemove={() => remove(ad.id)}
              onUpdateButton={(i, patch) => updateButton(ad.id, i, patch)}
              onAddButton={() => addButton(ad.id)}
              onRemoveButton={(i) => removeButton(ad.id, i)}
            />
          ))}

          <Button onClick={publish} disabled={!dirty || publishing} className="w-full">
            {publishing ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Publish Changes
          </Button>
        </>
      )}
    </div>
  )
}

function AdEditor({
  ad, index, onUpdate, onRemove, onUpdateButton, onAddButton, onRemoveButton,
}: {
  ad: EditAd
  index: number
  onUpdate: (patch: Partial<EditAd>) => void
  onRemove: () => void
  onUpdateButton: (i: number, patch: Partial<AdEntry['buttons'][number]>) => void
  onAddButton: () => void
  onRemoveButton: (i: number) => void
}) {
  const inputClass = 'bg-[#212121] border-[#262626] text-white text-sm'
  return (
    <div className="space-y-3 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-300">Ad #{index + 1}</span>
        <button onClick={onRemove} className="text-neutral-500 hover:text-red-400" aria-label="Remove ad"><X size={16} /></button>
      </div>

      <Input value={ad.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="Name" className={inputClass} />
      <Textarea value={ad.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="Description" rows={2} className={inputClass} />

      {/* Background image */}
      <div className="space-y-1.5">
        <label className="text-xs text-neutral-400">Background image</label>
        <BlossomUploadField accept={IMAGE_UPLOAD_ACCEPT} label="Drop an image or click to upload" sublabel="Mirrored to up to 3 servers" onUploaded={(r) => onUpdate({ banner: r.url })} resetAfter />
        <Input value={ad.banner} onChange={(e) => onUpdate({ banner: e.target.value })} placeholder="Background image URL" className={`${inputClass} font-mono text-xs`} />
      </div>

      {/* Profile picture */}
      <div className="space-y-1.5">
        <label className="text-xs text-neutral-400">Profile picture</label>
        <BlossomUploadField accept={IMAGE_UPLOAD_ACCEPT} label="Drop an image or click to upload" sublabel="Mirrored to up to 3 servers" onUploaded={(r) => onUpdate({ profilePic: r.url })} resetAfter />
        <Input value={ad.profilePic} onChange={(e) => onUpdate({ profilePic: e.target.value })} placeholder="Profile picture URL" className={`${inputClass} font-mono text-xs`} />
      </div>

      {/* Buttons */}
      <div className="space-y-2">
        <label className="text-xs text-neutral-400">Buttons (up to 3)</label>
        {ad.buttons.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={b.text} onChange={(e) => onUpdateButton(i, { text: e.target.value })} placeholder="Label" className={`${inputClass} flex-1`} />
            <Input value={b.link} onChange={(e) => onUpdateButton(i, { link: e.target.value })} placeholder="https://…" className={`${inputClass} flex-[2]`} />
            <button onClick={() => onRemoveButton(i)} className="shrink-0 text-neutral-500 hover:text-red-400" aria-label="Remove button"><X size={14} /></button>
          </div>
        ))}
        {ad.buttons.length < 3 && (
          <Button onClick={onAddButton} variant="outline" size="sm" className="border-[#262626] bg-transparent text-xs text-neutral-400">
            <Plus size={13} className="mr-1" /> Add button
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── FAQ Tab ────────────────────────────────────────────────────────

interface EditFaq extends FaqItem { id: string }

function FaqTab() {
  const [items, setItems] = useState<EditFaq[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [baseline, setBaseline] = useState('[]')

  const toFaq = (i: EditFaq): FaqItem => ({ question: i.question, answer: i.answer })
  const serialize = (list: EditFaq[]) => JSON.stringify(list.map(toFaq))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [FAQ_DTAG] })
      const parsed = event ? extractFaq(event) : []
      const withIds = parsed.map((i): EditFaq => ({ ...i, id: crypto.randomUUID() }))
      setItems(withIds)
      setBaseline(serialize(withIds))
    } catch { toast.error('Failed to load FAQ') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = serialize(items) !== baseline
  const update = (id: string, patch: Partial<EditFaq>) => setItems(p => p.map(i => i.id === id ? { ...i, ...patch } : i))
  const remove = (id: string) => setItems(p => p.filter(i => i.id !== id))

  const publish = async () => {
    setPublishing(true)
    try {
      const clean = items.map(toFaq).filter(i => i.question.trim() && i.answer.trim())
      const result = await signAndPublish(buildFaqEvent(clean), (s) => {
        if (s === 'mining') toast.loading('Processing proof of work…', { id: 'faq' })
        if (s === 'publishing') toast.loading('Publishing…', { id: 'faq' })
      })
      if (result.success) { toast.success('FAQ published', { id: 'faq' }); setBaseline(serialize(items)) }
      else toast.error(result.error || 'Publish failed', { id: 'faq' })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'faq' }) } finally { setPublishing(false) }
  }

  const inputClass = 'bg-[#212121] border-[#262626] text-white text-sm'
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">Questions &amp; answers shown on the <span className="font-mono text-neutral-300">/faq</span> page. Answers support markdown.</p>
        <Button onClick={() => setItems(p => [...p, { id: crypto.randomUUID(), question: '', answer: '' }])} variant="outline" size="sm" className="border-[#262626] shrink-0">
          <Plus size={14} className="mr-1.5" /> Add Q&amp;A
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          {items.length === 0 && <p className="text-sm text-neutral-500 py-6 text-center">No FAQ entries yet.</p>}
          {items.map((it, idx) => (
            <div key={it.id} className="space-y-2 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-300">Q&amp;A #{idx + 1}</span>
                <button onClick={() => remove(it.id)} className="text-neutral-500 hover:text-red-400" aria-label="Remove"><X size={16} /></button>
              </div>
              <Input value={it.question} onChange={(e) => update(it.id, { question: e.target.value })} placeholder="Question" className={inputClass} />
              <Textarea value={it.answer} onChange={(e) => update(it.id, { answer: e.target.value })} placeholder="Answer (markdown)" rows={3} className={inputClass} />
            </div>
          ))}
          <Button onClick={publish} disabled={!dirty || publishing} className="w-full">
            {publishing ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Publish Changes
          </Button>
        </>
      )}
    </div>
  )
}

// ─── Terms of Use Tab ───────────────────────────────────────────────

interface EditTos extends TosItem { id: string }

function TosTab() {
  const [items, setItems] = useState<EditTos[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [baseline, setBaseline] = useState('[]')

  const toTos = (i: EditTos): TosItem => ({ title: i.title, body: i.body })
  const serialize = (list: EditTos[]) => JSON.stringify(list.map(toTos))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [TOS_DTAG] })
      const parsed = event ? extractTos(event) : []
      const withIds = parsed.map((i): EditTos => ({ ...i, id: crypto.randomUUID() }))
      setItems(withIds)
      setBaseline(serialize(withIds))
    } catch { toast.error('Failed to load Terms of Use') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = serialize(items) !== baseline
  const update = (id: string, patch: Partial<EditTos>) => setItems(p => p.map(i => i.id === id ? { ...i, ...patch } : i))
  const remove = (id: string) => setItems(p => p.filter(i => i.id !== id))

  const publish = async () => {
    setPublishing(true)
    try {
      const clean = items.map(toTos).filter(i => i.title.trim() && i.body.trim())
      const result = await signAndPublish(buildTosEvent(clean), (s) => {
        if (s === 'mining') toast.loading('Processing proof of work…', { id: 'tos' })
        if (s === 'publishing') toast.loading('Publishing…', { id: 'tos' })
      })
      if (result.success) { toast.success('Terms of Use published', { id: 'tos' }); setBaseline(serialize(items)) }
      else toast.error(result.error || 'Publish failed', { id: 'tos' })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'tos' }) } finally { setPublishing(false) }
  }

  const inputClass = 'bg-[#212121] border-[#262626] text-white text-sm'
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">Sections shown on the <span className="font-mono text-neutral-300">/tos</span> page. Body text supports markdown.</p>
        <Button onClick={() => setItems(p => [...p, { id: crypto.randomUUID(), title: '', body: '' }])} variant="outline" size="sm" className="border-[#262626] shrink-0">
          <Plus size={14} className="mr-1.5" /> Add Section
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          {items.length === 0 && <p className="text-sm text-neutral-500 py-6 text-center">No terms yet.</p>}
          {items.map((it, idx) => (
            <div key={it.id} className="space-y-2 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-300">Section #{idx + 1}</span>
                <button onClick={() => remove(it.id)} className="text-neutral-500 hover:text-red-400" aria-label="Remove"><X size={16} /></button>
              </div>
              <Input value={it.title} onChange={(e) => update(it.id, { title: e.target.value })} placeholder="Title" className={inputClass} />
              <Textarea value={it.body} onChange={(e) => update(it.id, { body: e.target.value })} placeholder="Body (markdown)" rows={4} className={inputClass} />
            </div>
          ))}
          <Button onClick={publish} disabled={!dirty || publishing} className="w-full">
            {publishing ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Publish Changes
          </Button>
        </>
      )}
    </div>
  )
}

// ─── Guides Tab (curate kind:30023 long-form articles) ──────────────

function GuidesTab() {
  const [articles, setArticles] = useState<BlogDetails[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [baseline, setBaseline] = useState('[]')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const [posts, guidesEv] = await Promise.all([
        fetchEvents(relays, { kinds: [KINDS.BLOG], authors: [ADMIN_PUBKEY], limit: 200 }, 8000),
        fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [GUIDES_DTAG] }),
      ])
      const byKey = new Map<string, BlogDetails>()
      for (const ev of posts) {
        const b = extractBlogData(ev)
        if (b.isDeleted) continue
        const cur = byKey.get(b.aTag)
        if (!cur || b.createdAt > cur.createdAt) byKey.set(b.aTag, b)
      }
      setArticles(Array.from(byKey.values()).sort((a, b) => b.publishedAt - a.publishedAt))
      const coords = guidesEv ? extractGuideCoordinates(guidesEv) : []
      setSelected(coords)
      setBaseline(JSON.stringify(coords))
    } catch { toast.error('Failed to load guides') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = JSON.stringify(selected) !== baseline
  const toggle = (aTag: string) => setSelected(prev => prev.includes(aTag) ? prev.filter(c => c !== aTag) : [...prev, aTag])

  const publish = async () => {
    setPublishing(true)
    try {
      const result = await signAndPublish(buildGuidesEvent(selected), (s) => {
        if (s === 'mining') toast.loading('Processing proof of work…', { id: 'guides' })
        if (s === 'publishing') toast.loading('Publishing…', { id: 'guides' })
      })
      if (result.success) { toast.success('Guides published', { id: 'guides' }); setBaseline(JSON.stringify(selected)) }
      else toast.error(result.error || 'Publish failed', { id: 'guides' })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'guides' }) } finally { setPublishing(false) }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        Pick which of your long-form articles (kind 30023) appear on the <span className="font-mono text-neutral-300">/guides</span> page. Write guides as blog posts, then enable them here.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-4"><Loader2 size={14} className="animate-spin" /> Loading articles…</div>
      ) : articles.length === 0 ? (
        <p className="text-sm text-neutral-500 py-6 text-center">No long-form articles found for the admin account.</p>
      ) : (
        <>
          <div className="space-y-2">
            {articles.map((a) => (
              <label key={a.aTag} className="flex items-center justify-between gap-3 rounded-lg border border-[#262626] bg-[#1c1c1c] p-3 cursor-pointer">
                <div className="min-w-0">
                  <p className="truncate text-sm text-neutral-200">{a.title || 'Untitled'}</p>
                  {a.summary && <p className="truncate text-xs text-neutral-500">{a.summary}</p>}
                </div>
                <Switch checked={selected.includes(a.aTag)} onCheckedChange={() => toggle(a.aTag)} />
              </label>
            ))}
          </div>
          <Button onClick={publish} disabled={!dirty || publishing} className="w-full">
            {publishing ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
            Publish {selected.length} Guide{selected.length === 1 ? '' : 's'}
          </Button>
        </>
      )}
    </div>
  )
}

// ─── Suggestions Tab (platforms · tags · categories) ────────────────

function SuggestionsTab() {
  return (
    <div className="space-y-6">
      <p className="text-xs text-neutral-500">
        Suggestions offered to creators on the submit page (each a NIP-78 list). They're optional — creators can always type their own.
      </p>

      <StringListSuggestion
        title="Emulated platforms"
        desc='Offered when a creator marks a mod as "for an emulated game".'
        dTag={EMULATED_PLATFORMS_DTAG}
        tagName="platform"
        extract={extractEmulatedPlatforms}
        placeholder="Platform (e.g. PlayStation 4, Xbox 360)"
      />

      <StringListSuggestion
        title="Tags"
        desc="Suggested tags shown under the Tags field."
        dTag={SUGGESTED_TAGS_DTAG}
        tagName="t"
        extract={extractSuggestedTags}
        placeholder="Tag (e.g. graphics, weapons)"
        lowercase
      />

      <CategorySuggestionSection />
    </div>
  )
}

/** Reusable string-list NIP-78 editor (platforms, tags). */
function StringListSuggestion({ title, desc, dTag, tagName, extract, placeholder, lowercase }: {
  title: string
  desc: string
  dTag: string
  tagName: string
  extract: (event: NostrEvent) => string[]
  placeholder: string
  lowercase?: boolean
}) {
  const [items, setItems] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [dTag] })
      setItems(event ? extract(event) : [])
      setDirty(false)
    } catch { toast.error(`Failed to load ${title.toLowerCase()}`) } finally { setLoading(false) }
  }, [dTag, extract, title])
  useEffect(() => { load() }, [load])

  const add = () => {
    const name = (lowercase ? input.toLowerCase() : input).trim()
    if (!name) return
    if (items.some(p => p.toLowerCase() === name.toLowerCase())) { toast.error('Already in the list'); return }
    setItems(prev => [...prev, name]); setInput(''); setDirty(true)
  }
  const remove = (p: string) => { setItems(prev => prev.filter(x => x !== p)); setDirty(true) }

  const publish = async () => {
    setPublishing(true)
    try {
      const unsigned = buildNip78ListEvent(dTag, items.map(i => [tagName, i]))
      const result = await signAndPublish(unsigned, (s) => {
        if (s === 'mining') toast.loading('Processing proof of work…', { id: dTag })
        if (s === 'publishing') toast.loading('Publishing…', { id: dTag })
      })
      if (result.success) { toast.success(`${title} published (${items.length})`, { id: dTag }); setDirty(false) }
      else toast.error(result.error || 'Publish failed', { id: dTag })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Publish failed', { id: dTag }) } finally { setPublishing(false) }
  }

  return (
    <div className="space-y-3 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
      <div>
        <h4 className="text-sm font-medium text-white">{title}</h4>
        <p className="mt-0.5 text-xs text-neutral-500">{desc} <code className="text-purple-400">d:{dTag}</code></p>
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder}
          className="bg-[#212121] border-[#262626] text-white text-sm"
        />
        <Button size="sm" onClick={add} disabled={!input.trim()} className="bg-purple-600 hover:bg-purple-700 shrink-0"><Plus size={14} className="mr-1" /> Add</Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <p className="text-xs text-neutral-600 py-2">None yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map(p => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-md border border-[#262626] bg-[#212121] px-2 py-1 text-xs text-neutral-200">
              {p}
              <button onClick={() => remove(p)} className="text-neutral-500 hover:text-red-400" aria-label="Remove"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={publish} disabled={publishing || !dirty} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />} Publish
        </Button>
        {dirty && <span className="text-[11px] text-yellow-500/80">Unpublished changes</span>}
      </div>
    </div>
  )
}

/** Category-chain suggestions (NIP-78, c JSON tags) edited via the chain editor. */
function CategorySuggestionSection() {
  const dTag = SUGGESTED_CATEGORIES_DTAG
  const [chains, setChains] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [dTag] })
      setChains(event ? extractSuggestedCategories(event) : [])
      setDirty(false)
    } catch { toast.error('Failed to load categories') } finally { setLoading(false) }
  }, [dTag])
  useEffect(() => { load() }, [load])

  // Warn (don't block) on duplicate chains.
  const dupes = (() => {
    const seen = new Set<string>(); const out = new Set<string>()
    for (const c of chains) { const k = c.split(':').map(s => s.trim()).filter(Boolean).join(':').toLowerCase(); if (!k) continue; if (seen.has(k)) out.add(k); seen.add(k) }
    return out
  })()

  const publish = async () => {
    setPublishing(true)
    try {
      const result = await signAndPublish(buildSuggestedCategoriesEvent(chains), (s) => {
        if (s === 'mining') toast.loading('Processing proof of work…', { id: dTag })
        if (s === 'publishing') toast.loading('Publishing…', { id: dTag })
      })
      if (result.success) { toast.success('Categories published', { id: dTag }); setDirty(false) }
      else toast.error(result.error || 'Publish failed', { id: dTag })
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Publish failed', { id: dTag }) } finally { setPublishing(false) }
  }

  return (
    <div className="space-y-3 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
      <div>
        <h4 className="text-sm font-medium text-white">Categories</h4>
        <p className="mt-0.5 text-xs text-neutral-500">Suggested category chains shown under the Categories field. <code className="text-purple-400">d:{dTag}</code></p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <CategoryChainsEditor chains={chains} onChange={(c) => { setChains(c); setDirty(true) }} />
      )}
      {dupes.size > 0 && <p className="text-[11px] text-yellow-500/80">Duplicate categories will be merged on publish.</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={publish} disabled={publishing || !dirty} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />} Publish
        </Button>
        {dirty && <span className="text-[11px] text-yellow-500/80">Unpublished changes</span>}
      </div>
    </div>
  )
}

// ─── Moderation Tab ─────────────────────────────────────────────────

function ModerationTab() {
  return (
    <div className="space-y-6">
      <p className="text-xs text-neutral-500">
        Site-wide moderation defaults, each a NIP-78 (kind 30078) replaceable event under a
        fixed <code className="text-purple-400">d</code> tag. They apply to everyone who hasn't
        overridden them in their own filters.
      </p>

      <ExcludedTagsSection
        dTag={MODERATION_EXCLUDED_TAGS_DTAG}
        title="Default Excluded Tags"
        desc="Mods carrying any of these tags are hidden by default."
      />

      <BlockedModsSection />

      <BlockedUsersSection />

      <ReportsSection />
    </div>
  )
}

// ── Reports (NIP-56 kind 1984, filtered by client) ──

const REPORT_TYPES = ['nsfw', 'malware', 'illegal', 'spam', 'impersonation', 'other'] as const
const REPORT_RANGES = [
  { value: '48h', label: 'Last 48 hours', sec: 48 * 3600 },
  { value: 'week', label: 'Last week', sec: 7 * 24 * 3600 },
  { value: 'month', label: 'Last month', sec: 30 * 24 * 3600 },
  { value: 'year', label: 'Last year', sec: 365 * 24 * 3600 },
] as const
const REPORTS_PER_PAGE = 20

interface ParsedReport {
  ev: NostrEvent
  type: string
  kind: number
  coord?: string
  eventId?: string
  pubkey?: string
  comment: string
  hashes: string[]
  reporter: string
  createdAt: number
}

function parseReport(ev: NostrEvent): ParsedReport {
  const e = ev.tags.find(t => t[0] === 'e')
  const p = ev.tags.find(t => t[0] === 'p')
  const a = ev.tags.find(t => t[0] === 'a')
  const k = ev.tags.find(t => t[0] === 'k')
  return {
    ev,
    type: e?.[2] || p?.[2] || 'other',
    kind: k ? Number(k[1]) : (a ? Number(a[1].split(':')[0]) : 0),
    coord: a?.[1],
    eventId: e?.[1],
    pubkey: p?.[1],
    comment: ev.content,
    hashes: ev.tags.filter(t => t[0] === 'x' && t[1]).map(t => t[1]),
    reporter: ev.pubkey,
    createdAt: ev.created_at,
  }
}

function coordNaddr(coord: string): string | null {
  const [kindStr, pubkey, ...rest] = coord.split(':')
  if (!kindStr || !pubkey) return null
  try { return nip19.naddrEncode({ kind: Number(kindStr), pubkey, identifier: rest.join(':') }) } catch { return null }
}

function ReportsSection() {
  const [range, setRange] = useState<typeof REPORT_RANGES[number]['value']>('48h')
  const [types, setTypes] = useState<Set<string>>(new Set(REPORT_TYPES))
  const [typeOpen, setTypeOpen] = useState(false)
  const [reports, setReports] = useState<ParsedReport[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [tab, setTab] = useState<'mods' | 'blogs'>('mods')
  const [modPage, setModPage] = useState(1)
  const [blogPage, setBlogPage] = useState(1)
  const [detail, setDetail] = useState<ParsedReport | null>(null)

  const fetchReports = async () => {
    setLoading(true)
    try {
      const since = Math.floor(Date.now() / 1000) - REPORT_RANGES.find(r => r.value === range)!.sec
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const evs = await fetchEvents(relays, { kinds: [KINDS.REPORT], '#c': [CLIENT_NAME], since, limit: 500 }, 10000)
      setReports(evs.sort((a, b) => b.created_at - a.created_at).map(parseReport))
      setFetched(true); setModPage(1); setBlogPage(1)
    } catch { toast.error('Failed to fetch reports') } finally { setLoading(false) }
  }

  const visible = reports.filter(r => types.has(r.type))
  // LEGACY: legacy mods are kind 30402 — surface their reports in the Mods tab too.
  const mods = visible.filter(r => r.kind === KINDS.MOD || r.kind === LEGACY_MOD_KIND)
  const blogs = visible.filter(r => r.kind === KINDS.BLOG)
  const list = tab === 'mods' ? mods : blogs
  const page = tab === 'mods' ? modPage : blogPage
  const setPage = tab === 'mods' ? setModPage : setBlogPage
  const totalPages = Math.max(1, Math.ceil(list.length / REPORTS_PER_PAGE))
  const cur = Math.min(page, totalPages)
  const paged = list.slice((cur - 1) * REPORTS_PER_PAGE, cur * REPORTS_PER_PAGE)

  const toggleType = (t: string) => setTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })

  return (
    <div className="space-y-3 rounded-lg border border-[#262626] bg-[#1c1c1c] p-4">
      <div className="flex items-center gap-2">
        <Flag size={14} className="text-purple-400" />
        <h4 className="text-sm font-medium text-white">Reports</h4>
        <code className="ml-auto text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">c:{CLIENT_NAME}</code>
      </div>
      <p className="text-[11px] text-neutral-500">User reports (NIP-56) filed through this client. Fetches the latest 500 within the selected window.</p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTypeOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-[#262626] px-2.5 py-1.5 text-xs text-neutral-300 hover:border-[#404040]">
          Types ({types.size})
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-[#262626] px-2.5 py-1.5 text-xs text-neutral-300 hover:border-[#404040]">
              {REPORT_RANGES.find(r => r.value === range)?.label}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-[#1c1c1c] border-[#262626]">
            {REPORT_RANGES.map(r => (
              <DropdownMenuItem key={r.value} onClick={() => setRange(r.value)} className="cursor-pointer text-neutral-200">{r.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" onClick={fetchReports} disabled={loading} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {loading ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <RefreshCw size={12} className="mr-1.5" />} Fetch
        </Button>
      </div>

      {fetched && (
        <>
          {/* Mods / Blogs tabs */}
          <div className="flex gap-2 border-b border-[#262626]">
            <button onClick={() => setTab('mods')} className={cn('px-3 py-1.5 text-xs font-medium', tab === 'mods' ? 'text-purple-400 border-b-2 border-purple-500' : 'text-neutral-500')}>Mod posts ({mods.length})</button>
            <button onClick={() => setTab('blogs')} className={cn('px-3 py-1.5 text-xs font-medium', tab === 'blogs' ? 'text-purple-400 border-b-2 border-purple-500' : 'text-neutral-500')}>Blog posts ({blogs.length})</button>
          </div>

          {paged.length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-500">No reports.</p>
          ) : (
            <div className="space-y-1.5">
              {paged.map((r) => (
                <button key={r.ev.id} onClick={() => setDetail(r)} className="flex w-full items-center gap-2 rounded-md border border-[#262626] bg-[#212121] px-3 py-2 text-left hover:border-[#404040]">
                  <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-purple-300">{r.type}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">{r.comment || <span className="text-neutral-600">(no comment)</span>}</span>
                  {r.hashes.length > 0 && <span className="text-[10px] text-neutral-500">{r.hashes.length} hash{r.hashes.length > 1 ? 'es' : ''}</span>}
                  <span className="shrink-0 text-[10px] text-neutral-600">{new Date(r.createdAt * 1000).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}

          <Pagination page={cur} totalPages={totalPages} onPage={setPage} />
        </>
      )}

      {/* Type filter modal */}
      <Dialog open={typeOpen} onOpenChange={setTypeOpen}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Report types</DialogTitle>
            <DialogDescription className="text-neutral-400">Show only the selected report types.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            {REPORT_TYPES.map(t => (
              <label key={t} className="flex items-center justify-between gap-2 rounded-md border border-[#262626] bg-[#212121] px-3 py-2 cursor-pointer">
                <span className="text-sm capitalize text-neutral-200">{t}</span>
                <Switch checked={types.has(t)} onCheckedChange={() => toggleType(t)} />
              </label>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail modal */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="bg-[#1c1c1c] border-[#262626]">
          {detail && <ReportDetail r={detail} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReportDetail({ r }: { r: ParsedReport }) {
  const naddr = r.coord ? coordNaddr(r.coord) : null
  const postPath = r.kind === KINDS.BLOG ? 'blog' : 'mod'
  const authorNpub = r.pubkey ? nip19.npubEncode(r.pubkey) : null
  const reporterNpub = nip19.npubEncode(r.reporter)
  const copy = (text: string, msg: string) => { navigator.clipboard.writeText(text); toast.success(msg) }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-neutral-100">
          <span className="rounded bg-purple-500/15 px-2 py-0.5 text-xs font-medium uppercase text-purple-300">{r.type}</span>
          Report
        </DialogTitle>
        <DialogDescription className="text-neutral-400">{new Date(r.createdAt * 1000).toLocaleString()}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-1 text-sm">
        {r.comment && <p className="whitespace-pre-wrap rounded-md border border-[#262626] bg-[#212121] p-3 text-neutral-200">{r.comment}</p>}
        {r.hashes.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-neutral-400">Reported file hashes</p>
            <div className="space-y-1">
              {r.hashes.map(h => <p key={h} className="truncate rounded bg-[#212121] px-2 py-1 font-mono text-[11px] text-neutral-400">{h}</p>)}
            </div>
          </div>
        )}

        {/* Reported post */}
        {naddr && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 w-16 shrink-0">Post</span>
            <button onClick={() => copy(naddr, 'naddr copied')} className="inline-flex items-center gap-1 rounded-md border border-[#262626] px-2 py-1 text-xs text-neutral-300 hover:border-[#404040]"><Copy className="h-3 w-3" /> naddr</button>
            <a href={`/${postPath}/${naddr}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[#262626] px-2 py-1 text-xs text-neutral-300 hover:border-[#404040]"><ExternalLink className="h-3 w-3" /> Open</a>
          </div>
        )}

        {/* Reported author */}
        {authorNpub && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 w-16 shrink-0">Author</span>
            <button onClick={() => copy(authorNpub, 'npub copied')} className="inline-flex items-center gap-1 rounded-md border border-[#262626] px-2 py-1 text-xs text-neutral-300 hover:border-[#404040]"><Copy className="h-3 w-3" /> npub</button>
            <a href={`/profile/${authorNpub}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[#262626] px-2 py-1 text-xs text-neutral-300 hover:border-[#404040]"><ExternalLink className="h-3 w-3" /> Profile</a>
          </div>
        )}

        {/* Reporter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 w-16 shrink-0">Reporter</span>
          <button onClick={() => copy(reporterNpub, 'npub copied')} className="inline-flex items-center gap-1 rounded-md border border-[#262626] px-2 py-1 text-xs text-neutral-300 hover:border-[#404040]"><Copy className="h-3 w-3" /> npub</button>
          <a href={`/profile/${reporterNpub}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[#262626] px-2 py-1 text-xs text-neutral-300 hover:border-[#404040]"><ExternalLink className="h-3 w-3" /> Profile</a>
        </div>
      </div>
    </>
  )
}

// ── Blocked mods (hidden from discovery; optional render-block) ──

interface BlockedModItem {
  coord: string
  title?: string
  resolving?: boolean
  viewBlocked: boolean
}

function BlockedModsSection() {
  const dTag = BLOCKED_MODS_DTAG
  const [items, setItems] = useState<BlockedModItem[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)

  const resolveTitle = useCallback(async (coord: string): Promise<string | undefined> => {
    const [kindStr, pubkey, ...rest] = coord.split(':')
    const identifier = rest.join(':')
    const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    const event = await fetchEvent(relays, {
      kinds: [Number(kindStr)], authors: [pubkey], '#d': [identifier],
    })
    return event?.tags.find(t => t[0] === 'title')?.[1] || undefined
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, {
        kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [dTag],
      })
      const parsed: BlockedModItem[] = (event?.tags ?? [])
        .filter(t => t[0] === 'a' && t[1])
        .map(t => ({ coord: t[1], viewBlocked: t[2] === 'block', resolving: true }))
      setItems(parsed)
      setDirty(false)
      parsed.forEach(async ({ coord }) => {
        const title = await resolveTitle(coord).catch(() => undefined)
        setItems(prev => prev.map(it => it.coord === coord ? { ...it, title, resolving: false } : it))
      })
    } catch {
      toast.error(`Failed to load ${dTag}`)
    } finally {
      setLoading(false)
    }
  }, [dTag, resolveTitle])

  useEffect(() => { load() }, [load])

  const { dragIndex, itemProps } = useDragReorder(setItems, () => setDirty(true))

  const addItem = async () => {
    const result = naddrToModCoord(input)
    if ('error' in result) { toast.error(result.error); return }
    if (items.some(it => it.coord === result.coord)) { toast.error('Already in the list'); return }
    const newItem: BlockedModItem = { coord: result.coord, viewBlocked: false, resolving: true }
    setItems(prev => [...prev, newItem])
    setInput('')
    setDirty(true)
    const title = await resolveTitle(result.coord).catch(() => undefined)
    setItems(prev => prev.map(it => it.coord === newItem.coord ? { ...it, title, resolving: false } : it))
  }

  const toggleView = (coord: string) => {
    setItems(prev => prev.map(it => it.coord === coord ? { ...it, viewBlocked: !it.viewBlocked } : it))
    setDirty(true)
  }

  const removeItem = (coord: string) => {
    setItems(prev => prev.filter(it => it.coord !== coord))
    setDirty(true)
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const tags = items.map(it => it.viewBlocked ? ['a', it.coord, 'block'] : ['a', it.coord])
      const unsigned = buildNip78ListEvent(dTag, tags)
      const result = await signAndPublish(unsigned, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: dTag })
        if (status === 'publishing') toast.loading('Publishing…', { id: dTag })
      })
      if (result.success) {
        toast.success(`Blocked mods published (${items.length})`, { id: dTag })
        setDirty(false)
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        useModerationStore.getState().syncModeration(relays)
      } else {
        toast.error(result.error || 'Publish failed', { id: dTag })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: dTag })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="p-4 rounded-lg border border-[#262626] bg-[#1c1c1c] space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert size={14} className="text-purple-400" />
        <h4 className="text-sm font-medium text-white">Blocked Mods</h4>
        <code className="ml-auto text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">d:{dTag}</code>
      </div>
      <p className="text-[11px] text-neutral-500">
        Hidden from discovery; still openable directly with a warning. Toggle <strong>Block view</strong>
        {' '}to also stop it rendering when opened. Paste a mod's <strong>naddr</strong> to add it.
      </p>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
          placeholder="naddr1… (current or legacy mod)"
          className="bg-[#212121] border-[#262626] text-white text-xs font-mono"
        />
        <Button size="sm" onClick={addItem} disabled={!input.trim()} className="bg-purple-600 hover:bg-purple-700 shrink-0">
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-neutral-600 py-2">No blocked mods.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li
              key={it.coord}
              {...itemProps(i)}
              className={cn(
                'flex items-center gap-2 rounded-md border border-[#262626] bg-[#212121] px-2.5 py-1.5',
                dragIndex === i && 'opacity-40',
              )}
            >
              <GripVertical size={14} className="text-neutral-600 cursor-grab shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-200 truncate">
                  {it.resolving ? 'Resolving…' : (it.title || <span className="text-neutral-500 italic">Unknown / not found</span>)}
                </p>
                <p className="text-[10px] text-neutral-600 font-mono truncate">{it.coord}</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
                    <span className="text-[10px] text-neutral-400">Block view</span>
                    <Switch checked={it.viewBlocked} onCheckedChange={() => toggleView(it.coord)} />
                  </label>
                </TooltipTrigger>
                <TooltipContent>Block rendering even on direct open</TooltipContent>
              </Tooltip>
              <button onClick={() => removeItem(it.coord)} className="text-neutral-500 hover:text-red-400 shrink-0" aria-label="Remove">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={publish} disabled={publishing || !dirty} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
          Publish
        </Button>
        {dirty && <span className="text-[11px] text-yellow-500/80">Unpublished changes</span>}
      </div>
    </div>
  )
}

// ── Blocked users (NIP-51 mute list, kind 10000) ──

function BlockedUsersSection() {
  const [pubkeys, setPubkeys] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, { kinds: [KINDS.MUTE_LIST], authors: [ADMIN_PUBKEY] })
      const pks = (event?.tags ?? []).filter(t => t[0] === 'p' && t[1]).map(t => t[1])
      setPubkeys(pks)
      setDirty(false)
    } catch {
      toast.error('Failed to load mute list')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addUser = () => {
    const value = input.trim()
    if (!value) return
    let pk = value
    if (value.startsWith('npub')) {
      try {
        const decoded = nip19.decode(value)
        pk = decoded.type === 'npub' ? (decoded.data as string) : ''
      } catch { pk = '' }
    }
    if (!/^[0-9a-f]{64}$/i.test(pk)) { toast.error('Invalid npub or pubkey'); return }
    if (pubkeys.includes(pk)) { toast.error('Already muted'); return }
    setPubkeys(prev => [...prev, pk])
    setInput('')
    setDirty(true)
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const unsigned = buildMuteListEvent(pubkeys)
      const result = await signAndPublish(unsigned, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: 'mute-list' })
        if (status === 'publishing') toast.loading('Publishing…', { id: 'mute-list' })
      })
      if (result.success) {
        toast.success(`Blocked users published (${pubkeys.length})`, { id: 'mute-list' })
        setDirty(false)
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        useModerationStore.getState().syncModeration(relays)
      } else {
        toast.error(result.error || 'Publish failed', { id: 'mute-list' })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'mute-list' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="p-4 rounded-lg border border-[#262626] bg-[#1c1c1c] space-y-3">
      <div className="flex items-center gap-2">
        <Trash2 size={14} className="text-purple-400" />
        <h4 className="text-sm font-medium text-white">Blocked Users</h4>
        <code className="ml-auto text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">kind 10000</code>
      </div>
      <p className="text-[11px] text-neutral-500">
        Standard Nostr mute list. Content from these users is hidden from discovery. Paste an
        {' '}<strong>npub</strong> to add.
      </p>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUser() } }}
          placeholder="npub1…"
          className="bg-[#212121] border-[#262626] text-white text-xs font-mono"
        />
        <Button size="sm" onClick={addUser} disabled={!input.trim()} className="bg-purple-600 hover:bg-purple-700 shrink-0">
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : pubkeys.length === 0 ? (
        <p className="text-xs text-neutral-600 py-2">No blocked users.</p>
      ) : (
        <ul className="space-y-1.5">
          {pubkeys.map((pk) => (
            <li key={pk} className="flex items-center gap-2 rounded-md border border-[#262626] bg-[#212121] px-2.5 py-1.5">
              <code className="min-w-0 flex-1 truncate text-[10px] text-neutral-400 font-mono">
                {nip19.npubEncode(pk)}
              </code>
              <button onClick={() => { setPubkeys(prev => prev.filter(x => x !== pk)); setDirty(true) }} className="text-neutral-500 hover:text-red-400 shrink-0" aria-label="Remove">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={publish} disabled={publishing || !dirty} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
          Publish
        </Button>
        {dirty && <span className="text-[11px] text-yellow-500/80">Unpublished changes</span>}
      </div>
    </div>
  )
}

// ── Excluded tags (drag to reorder) ──

function ExcludedTagsSection({ dTag, title, desc }: { dTag: string; title: string; desc: string }) {
  const [tags, setTags] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, {
        kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [dTag],
      })
      const names = (event?.tags ?? []).filter(t => t[0] === 't' && t[1]).map(t => t[1])
      setTags(names)
      setDirty(false)
    } catch {
      toast.error(`Failed to load ${dTag}`)
    } finally {
      setLoading(false)
    }
  }, [dTag])

  useEffect(() => { load() }, [load])

  const { dragIndex, itemProps } = useDragReorder(setTags, () => setDirty(true))

  const addTag = () => {
    const name = input.trim().toLowerCase()
    if (!name) return
    if (tags.some(t => t.toLowerCase() === name)) {
      toast.error('Already in the list')
      return
    }
    setTags(prev => [...prev, name])
    setInput('')
    setDirty(true)
  }

  const publish = async () => {
    setPublishing(true)
    try {
      const unsigned = buildNip78ListEvent(dTag, tags.map(t => ['t', t]))
      const result = await signAndPublish(unsigned, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: dTag })
        if (status === 'publishing') toast.loading('Publishing…', { id: dTag })
      })
      if (result.success) {
        toast.success(`${title} published (${tags.length})`, { id: dTag })
        setDirty(false)
        // Refresh the live moderation defaults so the change applies immediately.
        const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
        useModerationStore.getState().syncModeration(relays)
      } else {
        toast.error(result.error || 'Publish failed', { id: dTag })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: dTag })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="p-4 rounded-lg border border-[#262626] bg-[#1c1c1c] space-y-3">
      <div className="flex items-center gap-2">
        <EyeOff size={14} className="text-purple-400" />
        <h4 className="text-sm font-medium text-white">{title}</h4>
        <code className="ml-auto text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">d:{dTag}</code>
      </div>
      <p className="text-[11px] text-neutral-500">{desc} Type a tag and press Enter to add it.</p>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
          placeholder="Tag (e.g. gore)"
          className="bg-[#212121] border-[#262626] text-white text-xs"
        />
        <Button size="sm" onClick={addTag} disabled={!input.trim()} className="bg-purple-600 hover:bg-purple-700 shrink-0">
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : tags.length === 0 ? (
        <p className="text-xs text-neutral-600 py-2">No excluded tags yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <span
              key={t}
              {...itemProps(i)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-[#262626] bg-[#212121] px-2 py-1 text-xs text-neutral-200',
                dragIndex === i && 'opacity-40',
              )}
            >
              <GripVertical size={12} className="text-neutral-600 cursor-grab" />
              {t}
              <button onClick={() => { setTags(prev => prev.filter(x => x !== t)); setDirty(true) }} className="text-neutral-500 hover:text-red-400" aria-label="Remove">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={publish} disabled={publishing || !dirty} className="bg-purple-600 hover:bg-purple-700 text-xs">
          {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
          Publish
        </Button>
        {dirty && <span className="text-[11px] text-yellow-500/80">Unpublished changes</span>}
      </div>
    </div>
  )
}

// ─── Announcements Tab ──────────────────────────────────────────────

function AnnouncementsTab() {
  const [content, setContent] = useState('')
  const [link, setLink] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [severity, setSeverity] = useState<'info' | 'warning'>('info')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const relays = useSettingsStore.getState().getAllEnabledRelayUrls('read')
      const event = await fetchEvent(relays, {
        kinds: [KINDS.GAME_DB], authors: [ADMIN_PUBKEY], '#d': [ANNOUNCEMENT_DTAG],
      })
      if (event) {
        const data = extractAnnouncement(event)
        setContent(data.content)
        setLink(data.link ?? '')
        setLinkLabel(data.linkLabel ?? '')
        setSeverity(data.severity)
      }
    } catch {
      toast.error('Failed to load announcement')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const doPublish = async (unsigned: ReturnType<typeof buildAnnouncementEvent>, successMsg: string) => {
    setPublishing(true)
    try {
      const result = await signAndPublish(unsigned, (status) => {
        if (status === 'mining') toast.loading('Processing proof of work…', { id: 'announce' })
        if (status === 'signing') toast.loading('Signing…', { id: 'announce' })
        if (status === 'publishing') toast.loading('Publishing…', { id: 'announce' })
      })
      if (result.success) toast.success(successMsg, { id: 'announce' })
      else toast.error(result.error || 'Publish failed', { id: 'announce' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed', { id: 'announce' })
    } finally {
      setPublishing(false)
    }
  }

  const publish = () => doPublish(
    buildAnnouncementEvent(content, { link, linkLabel, severity }),
    'Announcement published',
  )

  const clear = () => {
    setContent(''); setLink(''); setLinkLabel('')
    doPublish(buildAnnouncementEvent('', {}), 'Announcement cleared')
  }

  const hasContent = !!content.trim() || !!link.trim()

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        Publish a site-wide banner shown to all visitors below the header. Supports markdown
        (links open in a new tab), plus an optional call-to-action link. Replaces the previous
        announcement; clearing removes it for everyone.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-2">
          <Loader2 size={14} className="animate-spin" /> Loading current announcement…
        </div>
      ) : (
        <>
          {/* Severity */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">Style:</span>
            {(['info', 'warning'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs capitalize transition-colors',
                  severity === s
                    ? s === 'warning'
                      ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                      : 'border-purple-500/50 bg-purple-500/10 text-purple-400'
                    : 'border-[#262626] text-neutral-400 hover:border-[#404040]',
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Message (markdown) */}
          <div className="space-y-1">
            <label className="text-xs text-neutral-400">Message (markdown)</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="e.g. **Scheduled maintenance** Saturday 8pm UTC. [More info](https://example.com)"
              rows={3}
              className="w-full rounded-lg bg-[#212121] border border-[#262626] px-3 py-2 text-sm text-white placeholder:text-neutral-600 resize-none focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            />
          </div>

          {/* CTA link */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                <Link2 size={12} /> Button link (optional)
              </label>
              <Input
                value={link}
                onChange={e => setLink(e.target.value)}
                placeholder="https://…"
                className="bg-[#212121] border-[#262626] text-white text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-400">Button label</label>
              <Input
                value={linkLabel}
                onChange={e => setLinkLabel(e.target.value)}
                placeholder="Learn more"
                className="bg-[#212121] border-[#262626] text-white text-xs"
              />
            </div>
          </div>

          {/* Preview */}
          {hasContent && (
            <div className="space-y-1">
              <span className="flex items-center gap-1.5 text-xs text-neutral-400"><Eye size={12} /> Preview</span>
              <div className={cn(
                'rounded-lg border px-3 py-2 text-sm text-neutral-200',
                severity === 'warning' ? 'border-yellow-500/20 bg-yellow-500/10' : 'border-purple-500/20 bg-purple-500/10',
              )}>
                {content.trim() && <Markdown content={content} className="[&_p]:my-0 [&_p]:leading-snug" />}
                {link.trim() && (
                  <span className={cn('mt-1 inline-flex items-center gap-1 text-sm font-medium', severity === 'warning' ? 'text-yellow-300' : 'text-purple-300')}>
                    {linkLabel || 'Learn more'} ↗
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={publish} disabled={publishing || !hasContent} className="bg-purple-600 hover:bg-purple-700 text-xs">
              {publishing ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Megaphone size={12} className="mr-1.5" />}
              Publish Announcement
            </Button>
            <Button size="sm" variant="outline" onClick={clear} disabled={publishing} className="border-[#262626] text-xs text-neutral-300">
              <Trash2 size={12} className="mr-1.5" />
              Clear
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
