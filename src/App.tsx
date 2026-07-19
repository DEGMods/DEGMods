import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { RefreshIndicator } from '@/components/shared/RefreshIndicator'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAuthStore } from '@/stores/authStore'
import { useDMStore } from '@/stores/dmStore'
import { useDM17Store } from '@/stores/dm17Store'
import { useNotificationsStore } from '@/stores/notificationsStore'
import { useModerationStore } from '@/stores/moderationStore'
import { useWotStore } from '@/stores/wotStore'
import { useBlockStore } from '@/stores/blockStore'
import { useDnnStore } from '@/stores/dnnStore'
import { warmGamesDb } from '@/stores/gamesDbStore'
import { useRelayCapabilityStore } from '@/stores/relayCapabilityStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { StorageKey } from '@/lib/constants'
import { restoreSession } from '@/lib/auth/restore'
import { MainLayout } from '@/components/layout/MainLayout'
import { HomePage } from '@/pages/HomePage'
import { LoginPage } from '@/pages/LoginPage'
import ProfilePage from '@/pages/ProfilePage'
import { GamesPage } from '@/pages/GamesPage'
import { GamePage } from '@/pages/GamePage'
import { ModsPage } from '@/pages/ModsPage'
import { ModJamsPage } from '@/pages/ModJamsPage'
import { JamSubmitPage } from '@/pages/JamSubmitPage'
import { JamPage } from '@/pages/JamPage'
import { ShortAddressPage } from '@/pages/ShortAddressPage'
import { JamSubmissionsPage } from '@/pages/JamSubmissionsPage'
import ModPage from '@/pages/ModPage'
import { SubmitModPage } from '@/pages/SubmitModPage'
import { EditModPage } from '@/pages/EditModPage'
import BlogPage from '@/pages/BlogPage'
import BlogPostPage from '@/pages/BlogPostPage'
import { FeedPage } from '@/pages/FeedPage'
import WriteBlogPage from '@/pages/WriteBlogPage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import SettingsPage from '@/pages/SettingsPage'
import { AboutPage } from '@/pages/AboutPage'
import { ModManagerPage } from '@/pages/ModManagerPage'
import { AdsPage } from '@/pages/AdsPage'
import { FaqPage } from '@/pages/FaqPage'
import { TosPage } from '@/pages/TosPage'
import { GuidesPage } from '@/pages/GuidesPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/** Redirect that keeps the query string (so /write?edit=… survives the rename). */
function LegacyRedirect({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

/** Renders the login screen as a full-screen overlay, keeping the current page mounted. */
function LoginModalHost() {
  const isOpen = useLoginModalStore((s) => s.isOpen)
  const close = useLoginModalStore((s) => s.close)
  if (!isOpen) return null
  return <LoginPage onClose={close} />
}

export default function App() {
  useEffect(() => {
    // Rehydrate persisted settings + login on startup (e.g. new tab / reload).
    useSettingsStore.getState().loadFromStorage()
    // Probe relays' NIP-11 to learn which support NIP-50 search (cached locally).
    const probeRelayCaps = () =>
      useRelayCapabilityStore.getState().probeRelays(useSettingsStore.getState().getAllEnabledRelayUrls())
    probeRelayCaps()

    // App-wide open subscription: keep the DM inbox (and the notification badge)
    // live from app open, not just while on /feed. DMs are ingested encrypted;
    // nothing is auto-decrypted. Started on login, stopped/reset on logout.
    let stopDm: (() => void) | null = null
    let stopDm17: (() => void) | null = null
    const startMessaging = (pk: string) => {
      stopDm?.(); stopDm17?.()
      stopDm = useDMStore.getState().start(pk)
      stopDm17 = useDM17Store.getState().start(pk)
      useNotificationsStore.getState().refresh(pk)
    }
    const stopMessaging = () => {
      stopDm?.(); stopDm = null; useDMStore.getState().reset()
      stopDm17?.(); stopDm17 = null; useDM17Store.getState().reset()
    }

    restoreSession().finally(() => {
      // Build/refresh the Web of Trust graph + load the block list once login is restored.
      useWotStore.getState().init()
      useBlockStore.getState().loadBlockList()
      // Pull the user's published relay (10002) + blossom (10063) lists, then
      // re-probe so their relays get marked too.
      const pk = useAuthStore.getState().pubkey
      if (pk) {
        useSettingsStore.getState().loadUserLists(pk).finally(probeRelayCaps)
        startMessaging(pk)
      }
    })

    // Refresh admin moderation defaults (e.g. excluded tags) from NIP-78.
    const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    useModerationStore.getState().syncModeration(relayUrls)

    // Start the DNN naming service (resolves/verifies DNN IDs).
    useDnnStore.getState().initService()

    // Warm the (heavy) games DB into IndexedDB in the background, regardless of
    // the current route, so /games is usually instant when the user gets there.
    warmGamesDb()

    // Keep login state in sync across tabs.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== StorageKey.CURRENT_ACCOUNT) return
      const auth = useAuthStore.getState()
      if (!e.newValue) {
        // Logged out in another tab.
        if (auth.pubkey) auth.logout()
      } else if (e.newValue !== auth.pubkey) {
        // Logged in / switched account in another tab.
        restoreSession()
      }
    }
    window.addEventListener('storage', onStorage)

    // (Re)build the WoT graph whenever the logged-in account changes.
    let prevPk = useAuthStore.getState().pubkey
    const unsubAuth = useAuthStore.subscribe((s) => {
      if (s.pubkey !== prevPk) {
        prevPk = s.pubkey
        if (s.pubkey) {
          useWotStore.getState().init()
          useBlockStore.getState().loadBlockList()
          useSettingsStore.getState().loadUserLists(s.pubkey).finally(probeRelayCaps)
          startMessaging(s.pubkey)
        } else {
          useBlockStore.getState().reset()
          useSettingsStore.getState().resetUserLists()
          stopMessaging()
        }
      }
    })

    // Cooperative rebroadcasting: 30s after load, every visitor (logged in or
    // not) checks that the admin's important events are still widely replicated
    // and re-broadcasts any that relays have purged. Deferred so it never
    // competes with initial page work.
    const redundancyTimer = setTimeout(() => {
      import('@/lib/nostr/eventRedundancy').then(({ ensureAdminEventsRedundancy }) => {
        ensureAdminEventsRedundancy()
      })
    }, 30_000)

    return () => {
      window.removeEventListener('storage', onStorage)
      unsubAuth()
      clearTimeout(redundancyTimer)
      stopMessaging()
    }
  }, [])

  return (
    <>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:npub" element={<ProfilePage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/game/:name" element={<GamePage />} />
          <Route path="/mods" element={<ModsPage />} />
          <Route path="/mod-jams" element={<ModJamsPage />} />
          <Route path="/submit-mod-jam" element={<JamSubmitPage />} />
          <Route path="/mod-jam/:naddr" element={<JamPage />} />
          <Route path="/mod-jam/:naddr/edit" element={<JamSubmitPage />} />
          <Route path="/mod-jam/:naddr/submissions" element={<JamSubmissionsPage />} />
          <Route path="/mod/:naddr" element={<ModPage />} />
          <Route path="/submit-mod" element={<SubmitModPage />} />
          {/* legacy path — keep old links/bookmarks working */}
          <Route path="/submit" element={<LegacyRedirect to="/submit-mod" />} />
          <Route path="/mod/:naddr/edit" element={<EditModPage />} />
          <Route path="/blog" element={<BlogPage />} />
          <Route path="/blog/:naddr" element={<BlogPostPage />} />
          <Route path="/feed" element={<FeedPage />} />
          <Route path="/submit-blog" element={<WriteBlogPage />} />
          {/* legacy path — keep old links/bookmarks (and ?edit=…) working */}
          <Route path="/write" element={<LegacyRedirect to="/submit-blog" />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/s/:address" element={<ShortAddressPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/mod-manager" element={<ModManagerPage />} />
          <Route path="/ads" element={<AdsPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/tos" element={<TosPage />} />
          <Route path="/guides" element={<GuidesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <LoginModalHost />
      <RefreshIndicator />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'hsl(270 12% 12%)',
            border: '1px solid hsl(270 10% 18%)',
            color: 'hsl(270 5% 95%)',
          },
        }}
      />
    </>
  )
}
