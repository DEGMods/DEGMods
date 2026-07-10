import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { StorageKey, SECURE_KEYS } from '@/lib/constants'
import { secureSet } from '@/lib/storage/secureStore'
import {
  Nip07Signer, hasNip07Extension,
  BunkerSigner,
  NostrConnectSigner, generateNostrConnectDetails,
  discover, PC55Signer,
  type DiscoverResult,
} from '@/lib/auth'
import upv2Service from '@/services/upv2.service'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

import {
  Key, Globe, Monitor, Lock, ChevronLeft, ChevronRight, Loader2,
  Copy, Check, QrCode, Link2, Eye, EyeOff, X, BookOpen, Rocket, ShieldAlert,
  ExternalLink, RefreshCw, Puzzle,
} from 'lucide-react'

import { motion, AnimatePresence } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'

// ── Screen types (no enum: erasableSyntaxOnly) ─────────────────────
type Screen = 'main' | 'extension' | 'nip46' | 'pc55' | 'upv2'

const fadeVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
}

/**
 * Login screen. Rendered both as a route (`/login`) and, with `onClose`, as a
 * full-screen overlay modal that keeps the current page mounted underneath.
 * After a successful login it closes the overlay (or navigates home on the route).
 */
export function LoginPage({ onClose }: { onClose?: () => void } = {}) {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const setSigner = useAuthStore((s) => s.setSigner)

  // Post-login: close the overlay (stay on the current page) or go home.
  const finish = () => { if (onClose) onClose(); else navigate('/') }

  // ── Core state ──────────────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>('main')
  const [loading, setLoading] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [showExtGuide, setShowExtGuide] = useState(false)
  const [showLocalGuide, setShowLocalGuide] = useState(false)

  // ── UPV2 ────────────────────────────────────────────────────────────
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // ── NIP-46 Bunker ───────────────────────────────────────────────────
  const [bunkerUrl, setBunkerUrl] = useState('')

  // ── NIP-46 Nostr Connect (QR) ───────────────────────────────────────
  const [connectDetails, setConnectDetails] = useState<ReturnType<typeof generateNostrConnectDetails> | null>(null)
  const [connectPending, setConnectPending] = useState(false)
  const connectAbortRef = useRef<AbortController | null>(null)
  const [copied, setCopied] = useState(false)

  // ── PC55 ────────────────────────────────────────────────────────────
  const [discoveryResult, setDiscoveryResult] = useState<DiscoverResult | null>(null)

  // ── Helpers ─────────────────────────────────────────────────────────
  const goBack = () => {
    connectAbortRef.current?.abort()
    setScreen('main')
    setConnectDetails(null)
    setConnectPending(false)
    setLoading(null)
  }

  // ═══════════════════════════════════════════════════════════════════
  //  1. NIP-07: Browser Extension Login
  // ═══════════════════════════════════════════════════════════════════
  const handleExtensionLogin = async () => {
    if (!hasNip07Extension()) {
      setShowExtGuide(true)
      return
    }
    setLoading('nip07')
    try {
      const signer = new Nip07Signer()
      await signer.init()
      const pubkey = await signer.getPublicKey()
      setSigner(signer)
      login(pubkey, 'nip07')
      toast.success('Logged in via browser extension')
      finish()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extension login failed')
    } finally {
      setLoading(null)
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  2a. NIP-46: Bunker URL Login
  // ═══════════════════════════════════════════════════════════════════
  const handleBunkerLogin = async () => {
    if (!bunkerUrl.trim()) {
      toast.error('Enter a bunker:// URL')
      return
    }
    setLoading('bunker')
    try {
      const signer = new BunkerSigner()
      const pubkey = await signer.login(bunkerUrl.trim())
      localStorage.setItem(StorageKey.BUNKER_KEY, signer.getClientSecretKey())
      // store bunker URL for session restore
      localStorage.setItem(StorageKey.BUNKER_STRING, bunkerUrl.trim())
      setSigner(signer)
      login(pubkey, 'nip46')
      toast.success('Connected via bunker')
      finish()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bunker login failed')
    } finally {
      setLoading(null)
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  2b. NIP-46: Nostr Connect (QR) Login
  // ═══════════════════════════════════════════════════════════════════
  const openNostrConnect = () => {
    const details = generateNostrConnectDetails()
    setConnectDetails(details)
    setConnectPending(true)
  }

  const handleNostrConnectLogin = useCallback(async () => {
    if (!connectDetails) return

    connectAbortRef.current?.abort()
    const abortController = new AbortController()
    connectAbortRef.current = abortController

    setConnectPending(true)
    try {
      const signer = new NostrConnectSigner(connectDetails.privKey)
      const { pubkey, bunkerString } = await signer.login(
        connectDetails.connectionString,
        abortController.signal,
      )
      if (abortController.signal.aborted) return
      if (bunkerString) {
        localStorage.setItem(StorageKey.BUNKER_STRING, bunkerString)
        localStorage.setItem(StorageKey.BUNKER_KEY, signer.getClientSecretKey())
      }
      setSigner(signer)
      login(pubkey, 'nip46')
      toast.success('Connected via Nostr Connect')
      finish()
    } catch (err) {
      if (abortController.signal.aborted) return
      toast.error(
        err instanceof Error
          ? `${err.message}. Try again or use a different method.`
          : 'Nostr Connect failed',
      )
      setConnectPending(false)
    }
  }, [connectDetails, setSigner, login, navigate])

  // Entering Connect defaults to the nostrconnect:// (QR) tab, so generate its
  // connection up front instead of waiting for a tab click.
  useEffect(() => {
    if (screen === 'nip46' && !connectDetails) openNostrConnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  // Auto-start connect when details are generated
  useEffect(() => {
    if (screen === 'nip46' && connectDetails && connectPending) {
      handleNostrConnectLogin()
    }
    return () => {
      connectAbortRef.current?.abort()
    }
  }, [screen, connectDetails, connectPending, handleNostrConnectLogin])

  const copyConnectionString = () => {
    if (!connectDetails?.connectionString) return
    navigator.clipboard.writeText(connectDetails.connectionString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ═══════════════════════════════════════════════════════════════════
  //  3. PC55: Local Signer Login
  // ═══════════════════════════════════════════════════════════════════
  const handleLocalSignerDiscover = async () => {
    setLoading('pc55')
    setDiscoveryResult(null)
    try {
      const info = await discover()
      if (!info) {
        setShowLocalGuide(true)
        setLoading(null)
        return
      }
      setDiscoveryResult(info)
      setScreen('pc55')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Discovery failed')
    } finally {
      setLoading(null)
    }
  }

  const handlePC55Login = async () => {
    setLoading('pc55-connect')
    try {
      const signer = new PC55Signer()
      await signer.init()
      const pubkey = await signer.getPublicKey()
      setSigner(signer)
      login(pubkey, 'pc55')
      toast.success('Connected to local signer')
      finish()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect to local signer')
    } finally {
      setLoading(null)
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  4. UPV2: Username & Password Login
  // ═══════════════════════════════════════════════════════════════════
  const handleUPV2Login = async () => {
    if (!identifier.trim()) {
      toast.error('Enter your npub, DNN ID, or username')
      return
    }
    if (!password.trim()) {
      toast.error('Enter your password')
      return
    }
    setLoading('upv2')
    try {
      const result = await upv2Service.login(identifier.trim(), password)
      if (!result.success || !result.session) {
        toast.error(result.error || 'Login failed')
        return
      }
      setSigner(upv2Service as any)
      login(result.session.signerPubkey, 'upv2')
      // Persist the session (encrypted, IndexedDB) so it survives new tabs/reloads.
      secureSet(SECURE_KEYS.UPV2_SESSION, result.session).catch(() => {})
      toast.success('Logged in successfully')
      finish()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(null)
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="fixed inset-0 top-16 z-30 flex items-center justify-center overflow-hidden p-4">
      {/* ── Background image ─────────────────────────────────────── */}
      <img
        src="/login-bg.jpg"
        alt=""
        className="fixed inset-0 w-full h-full object-cover object-right-bottom pointer-events-none"
      />

      {/* ── Close (overlay/modal mode only) ──────────────────────── */}
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="fixed right-4 top-20 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-[#262626] bg-[#1c1c1c]/80 text-neutral-300 backdrop-blur-sm transition-colors hover:bg-[#262626] hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      )}

      {/* ── Login card ───────────────────────────────────────────── */}
      <Card className="w-full max-w-sm relative z-10 border-[#262626] bg-[#1c1c1c]/90 backdrop-blur-sm">
        <CardContent className="p-8 flex flex-col items-center gap-6">
          <AnimatePresence mode="wait">
            {/* ── Main Screen ────────────────────────────────── */}
            {screen === 'main' && (
              <motion.div
                key="main"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="w-full"
              >
                {/* Logo + title */}
                <div className="flex flex-col items-center gap-3 mb-6">
                  <img src="/logo.png" className="h-14 w-auto" alt="DEG MODS" />
                  <h1 className="text-2xl font-bold text-white">DEG MODS</h1>
                </div>

                {/* Sign-in methods: each opens its own flow, DEN Chat style */}
                <div className="w-full flex flex-col gap-2">
                  <div className="w-full flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="grow gap-1.5 text-xs border-[#262626] bg-[#212121] text-white hover:bg-[#2a2a2a]"
                      onClick={() => setScreen('upv2')}
                      disabled={!!loading}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      ID & Pass
                    </Button>
                    <Button
                      variant="outline"
                      className="grow gap-1.5 text-xs border-[#262626] bg-[#212121] text-white hover:bg-[#2a2a2a]"
                      onClick={handleLocalSignerDiscover}
                      disabled={loading === 'pc55'}
                    >
                      {loading === 'pc55' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Monitor className="h-3.5 w-3.5" />
                      )}
                      Local
                    </Button>
                    <Button
                      variant="outline"
                      className="grow gap-1.5 text-xs border-[#262626] bg-[#212121] text-white hover:bg-[#2a2a2a]"
                      onClick={() => setScreen('nip46')}
                      disabled={!!loading}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      Connect
                    </Button>
                    <Button
                      variant="outline"
                      className="grow gap-1.5 text-xs border-[#262626] bg-[#212121] text-white hover:bg-[#2a2a2a]"
                      onClick={handleExtensionLogin}
                      disabled={loading === 'nip07'}
                    >
                      {loading === 'nip07' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Key className="h-3.5 w-3.5" />
                      )}
                      Extension
                    </Button>
                  </div>

                  {/* New user */}
                  <Button
                    className="w-full gap-2"
                    onClick={() => setShowGuide(true)}
                  >
                    <BookOpen size={15} />
                    New user?
                  </Button>
                </div>

                {/* Terms */}
                <p className="text-[11px] text-neutral-500 text-center mt-4">
                  By logging in, you agree to the Nostr protocol's decentralized nature.
                </p>
              </motion.div>
            )}

            {/* ── NIP-46 Screen ──────────────────────────────── */}
            {screen === 'nip46' && (
              <motion.div
                key="nip46"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="w-full"
              >
                <ScreenHeader title="Nostr Connect" onBack={goBack} />

                <Tabs defaultValue="qr" className="w-full">
                  <TabsList className="mb-4 w-full bg-[#212121]">
                    <TabsTrigger
                      value="qr"
                      className="flex-1 data-[state=active]:bg-[#2a2a2a]"
                      onClick={() => {
                        if (!connectDetails) openNostrConnect()
                      }}
                    >
                      <QrCode className="mr-1.5 h-3.5 w-3.5" />
                      QR Code
                    </TabsTrigger>
                    <TabsTrigger value="bunker" className="flex-1 data-[state=active]:bg-[#2a2a2a]">
                      <Link2 className="mr-1.5 h-3.5 w-3.5" />
                      Bunker URL
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="bunker" className="space-y-4">
                    <p className="text-sm text-neutral-400">
                      Paste your <code className="rounded bg-[#262626] px-1.5 py-0.5 text-xs text-purple-300">bunker://</code> URL from your remote signer.
                    </p>
                    <Input
                      placeholder="bunker://..."
                      value={bunkerUrl}
                      onChange={(e) => setBunkerUrl(e.target.value)}
                      className="border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleBunkerLogin()}
                    />
                    <Button
                      className="w-full bg-purple-600 text-white hover:bg-purple-700"
                      onClick={handleBunkerLogin}
                      disabled={loading === 'bunker'}
                    >
                      {loading === 'bunker' ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
                      ) : 'Connect'}
                    </Button>
                  </TabsContent>

                  <TabsContent value="qr" className="space-y-4">
                    {connectDetails ? (
                      <div className="flex flex-col items-center gap-4">
                        <p className="text-center text-sm text-neutral-400">
                          Scan this QR code with your signer app, or copy the connection string.
                        </p>
                        <div className="rounded-xl border border-[#262626] bg-white p-4">
                          <QRCodeSVG value={connectDetails.connectionString} size={200} level="M" />
                        </div>
                        <Button
                          variant="outline"
                          className="w-full border-[#262626] bg-[#212121] text-white hover:bg-[#2a2a2a]"
                          onClick={copyConnectionString}
                        >
                          {copied ? (
                            <><Check className="h-4 w-4 text-green-400" /> Copied!</>
                          ) : (
                            <><Copy className="h-4 w-4" /> Copy Connection String</>
                          )}
                        </Button>
                        {connectPending && (
                          <div className="flex items-center gap-2 text-sm text-neutral-400">
                            <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                            Waiting for signer to connect…
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
                        <p className="text-sm text-neutral-400">Generating connection…</p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </motion.div>
            )}

            {/* ── PC55 Screen ────────────────────────────────── */}
            {screen === 'pc55' && (
              <motion.div
                key="pc55"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="w-full"
              >
                <ScreenHeader title="Local Signer" onBack={goBack} />

                {discoveryResult ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-[#262626] bg-[#212121] p-4">
                      <div className="flex items-center gap-2 text-sm text-neutral-400">
                        <Monitor className="h-4 w-4 text-green-400" />
                        <span>
                          Found: <span className="font-medium text-white">{discoveryResult.name}</span>
                          {discoveryResult.version && (
                            <span className="ml-1 text-neutral-500">v{discoveryResult.version}</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {discoveryResult.accounts.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          Available Accounts
                        </p>
                        {discoveryResult.accounts.map((account) => (
                          <div
                            key={account.npub}
                            className="flex items-center gap-3 rounded-lg border border-[#262626] bg-[#212121] px-4 py-3"
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400">
                              <Key className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-white">
                                {account.display_name || 'Unnamed'}
                              </p>
                              <p className="truncate text-xs text-neutral-500">
                                {account.npub.slice(0, 16)}…{account.npub.slice(-8)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      className="w-full bg-purple-600 text-white hover:bg-purple-700"
                      onClick={handlePC55Login}
                      disabled={loading === 'pc55-connect'}
                    >
                      {loading === 'pc55-connect' ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
                      ) : 'Connect to Signer'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
                    <p className="text-sm text-neutral-400">Searching for local signer…</p>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── UPV2 Screen (kept for direct navigation) ───── */}
            {screen === 'upv2' && (
              <motion.div
                key="upv2"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="w-full"
              >
                <ScreenHeader title="Address & Password" onBack={goBack} />

                <div className="space-y-4">
                  <p className="text-sm text-neutral-400">
                    Enter your npub or DNN ID along with your password.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                        Identifier
                      </label>
                      <Input
                        placeholder="npub1... or nabandon..."
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="border-[#262626] bg-[#212121] text-white placeholder:text-neutral-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                        Password
                      </label>
                      <div className="relative">
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Enter your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="border-[#262626] bg-[#212121] pr-10 text-white placeholder:text-neutral-500"
                          onKeyDown={(e) => e.key === 'Enter' && handleUPV2Login()}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <Button
                    className="w-full bg-purple-600 text-white hover:bg-purple-700"
                    onClick={handleUPV2Login}
                    disabled={loading === 'upv2'}
                  >
                    {loading === 'upv2' ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Logging in…</>
                    ) : 'Login'}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      <GettingStartedGuide
        open={showGuide}
        onClose={() => setShowGuide(false)}
        onExtension={() => { setShowGuide(false); handleExtensionLogin() }}
        onConnect={() => { setShowGuide(false); setScreen('nip46') }}
        onLocal={() => { setShowGuide(false); handleLocalSignerDiscover() }}
      />
      <ExtensionGuideModal open={showExtGuide} onClose={() => setShowExtGuide(false)} />
      <LocalSignerGuideModal
        open={showLocalGuide}
        onClose={() => setShowLocalGuide(false)}
        onRetry={() => { setShowLocalGuide(false); handleLocalSignerDiscover() }}
      />
    </div>
  )
}

// ── "New user?" Getting-Started guide (in-app, like DEN Chat) ────────
function GettingStartedGuide({
  open, onClose, onExtension, onConnect, onLocal,
}: {
  open: boolean
  onClose: () => void
  onExtension: () => void
  onConnect: () => void
  onLocal: () => void
}) {
  const [track, setTrack] = useState<'choice' | 'quick'>('choice')
  const [page, setPage] = useState(0)

  useEffect(() => { if (open) { setTrack('choice'); setPage(0) } }, [open])
  if (!open) return null

  const SLIDES = [
    {
      icon: <Key size={40} className="text-purple-400" />,
      bg: 'bg-purple-500/10',
      title: 'Your keys are your account',
      body: 'Nostr has no email or password sign-up. Your identity is a cryptographic keypair held by a signer app or extension — no company owns it, and it works across every Nostr app.',
    },
    {
      icon: <ShieldAlert size={40} className="text-amber-400" />,
      bg: 'bg-amber-500/10',
      title: 'Back it up, or lose it forever',
      body: 'Your signer holds your private key (an nsec / seed phrase). Keep a safe backup — if you lose it, nobody, not even us, can recover your account.',
    },
  ]
  const lastPage = SLIDES.length // the CTA slide index

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 mx-4 w-full max-w-lg overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#262626] px-5 py-4">
          <div className="flex items-center gap-2.5">
            {track !== 'choice' && (
              <button
                onClick={() => { setTrack('choice'); setPage(0) }}
                className="rounded-md p-1 text-neutral-400 hover:bg-[#2a2a2a] hover:text-white transition-colors cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <BookOpen size={18} className="text-purple-400" />
            <h2 className="font-semibold text-white">Getting Started</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-[#2a2a2a] hover:text-white transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* Choice */}
        {track === 'choice' && (
          <div className="space-y-3 px-5 py-6">
            <p className="mb-4 text-center text-sm text-neutral-400">New to Nostr? Here's how to get going.</p>
            <button
              onClick={() => { setTrack('quick'); setPage(0) }}
              className="group flex w-full items-center gap-4 rounded-xl border border-[#262626] bg-[#212121] p-4 text-left transition-all hover:border-purple-500/30 hover:bg-[#242424] cursor-pointer"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 transition-colors group-hover:bg-purple-500/15">
                <Rocket size={24} className="text-purple-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-white">Quick Start</h3>
                <p className="mt-0.5 text-xs text-neutral-500">Up and running in under a minute</p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-neutral-500" />
            </button>
          </div>
        )}

        {/* Quick Start */}
        {track === 'quick' && (
          <>
            {page < lastPage && (
              <div className="flex min-h-[280px] flex-col items-center justify-center px-8 py-10 text-center">
                <div className={cn('mb-5 flex h-20 w-20 items-center justify-center rounded-2xl', SLIDES[page].bg)}>
                  {SLIDES[page].icon}
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">{SLIDES[page].title}</h3>
                <p className="max-w-sm text-sm leading-relaxed text-neutral-400">{SLIDES[page].body}</p>
              </div>
            )}

            {page === lastPage && (
              <div className="flex min-h-[280px] flex-col items-center px-6 py-8 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-500/10">
                  <Rocket size={32} className="text-purple-400" />
                </div>
                <h3 className="mb-1 text-lg font-bold text-white">Log in with a signer</h3>
                <p className="mb-5 max-w-sm text-sm leading-relaxed text-neutral-400">
                  Pick how your keys are stored. Don't have an account yet? Pick a method below —
                  each one will point you to the right signer to set one up.
                </p>
                <div className="w-full max-w-xs space-y-2">
                  <Button onClick={onExtension} className="w-full gap-2 bg-purple-600 text-white hover:bg-purple-700">
                    <Key size={15} /> Browser extension
                  </Button>
                  <Button onClick={onConnect} variant="outline" className="w-full gap-2 border-[#262626] bg-[#212121] text-white hover:bg-[#2a2a2a]">
                    <Globe size={15} /> Connect a signer app
                  </Button>
                  <Button onClick={onLocal} variant="outline" className="w-full gap-2 border-[#262626] bg-[#212121] text-white hover:bg-[#2a2a2a]">
                    <Monitor size={15} /> Local signer
                  </Button>
                </div>
              </div>
            )}

            {/* Footer: progress dots + next/back */}
            <div className="flex items-center justify-between border-t border-[#262626] px-5 py-3">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className={cn(
                  'text-xs transition-colors',
                  page === 0 ? 'text-neutral-700' : 'text-neutral-400 hover:text-white cursor-pointer',
                )}
              >
                Back
              </button>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: lastPage + 1 }).map((_, i) => (
                  <span key={i} className={cn('h-1.5 rounded-full transition-all', i === page ? 'w-4 bg-purple-500' : 'w-1.5 bg-[#333]')} />
                ))}
              </div>
              {page < lastPage ? (
                <button
                  onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                  className="text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors cursor-pointer"
                >
                  Next
                </button>
              ) : (
                <span className="w-8" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── "No extension detected" install guide (like DEN Chat) ────────────
const CHROME_EXTENSIONS = [
  { name: 'nos2x', url: 'https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp' },
  { name: 'Keys.Band', url: 'https://chromewebstore.google.com/detail/keysband/jdencabhccnfhedpfoojbbdlgmecnlkm' },
]
const FIREFOX_EXTENSIONS = [
  { name: 'nos2x-fox', url: 'https://addons.mozilla.org/en-US/firefox/addon/nos2x-fox/' },
  { name: 'Nostr Connect', url: 'https://addons.mozilla.org/en-US/firefox/addon/nostr-connect/' },
]

function ExtLink({ name, url }: { name: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#262626] bg-[#212121] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#2a2a2a]"
    >
      {name}
      <ExternalLink size={11} className="text-neutral-500" />
    </a>
  )
}

function ExtensionGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#262626] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Puzzle size={18} className="text-purple-400" />
            <h2 className="font-semibold text-white">Browser extension required</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-[#2a2a2a] hover:text-white transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-neutral-400">
            No Nostr signer extension was detected in your browser. To log in this way, install one first.
          </p>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
              <Globe size={13} className="shrink-0" /> Chrome / Chromium
            </p>
            <div className="flex gap-2">
              {CHROME_EXTENSIONS.map((e) => <ExtLink key={e.name} {...e} />)}
            </div>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
              <Globe size={13} className="shrink-0" /> Firefox
            </p>
            <div className="flex gap-2">
              {FIREFOX_EXTENSIONS.map((e) => <ExtLink key={e.name} {...e} />)}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
            <RefreshCw size={14} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-xs leading-relaxed text-neutral-400">
              After installing an extension and generating or importing an account in it,
              <strong className="text-neutral-200"> refresh this page</strong> and click "Extension" again.
            </p>
          </div>
        </div>

        <div className="border-t border-[#262626] px-5 py-3">
          <Button onClick={onClose} className="w-full bg-purple-600 text-white hover:bg-purple-700">Close</Button>
        </div>
      </div>
    </div>
  )
}

// ── "No local signer found" guide ───────────────────────────────────
function LocalSignerGuideModal({ open, onClose, onRetry }: { open: boolean; onClose: () => void; onRetry: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-xl border border-[#262626] bg-[#1c1c1c] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#262626] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Monitor size={18} className="text-purple-400" />
            <h2 className="font-semibold text-white">Local signer not found</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-[#2a2a2a] hover:text-white transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-neutral-400">
            No local signer was detected on <code className="rounded bg-[#262626] px-1.5 py-0.5 text-xs text-purple-300">ws://localhost:7777</code>.
            A local signer is a desktop app that holds your keys on this device and signs for the sites you use.
          </p>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
            <RefreshCw size={14} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-xs leading-relaxed text-neutral-400">
              Install and run a local signer (such as <strong className="text-neutral-200">DENOS</strong>), make sure it's
              running, then try again.
            </p>
          </div>
        </div>

        <div className="flex gap-2 border-t border-[#262626] px-5 py-3">
          <Button onClick={onClose} variant="outline" className="flex-1 border-[#262626] bg-[#212121] text-white hover:bg-[#2a2a2a]">Close</Button>
          <Button onClick={onRetry} className="flex-1 gap-1.5 bg-purple-600 text-white hover:bg-purple-700">
            <RefreshCw size={14} /> Try again
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Shared sub-screen header ─────────────────────────────────────────
function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <button
        onClick={onBack}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#262626] bg-[#212121] text-neutral-400 hover:bg-[#2a2a2a] hover:text-white transition-colors cursor-pointer"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
    </div>
  )
}
