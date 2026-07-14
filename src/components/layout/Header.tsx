import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Gamepad2, Package, PenLine, Rss, Settings, User, Menu, X, Eye, Pencil, LogOut, Bell, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useLoginModalStore } from '@/stores/loginModalStore'
import { useUserStore, type UserProfile } from '@/stores/userStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNotificationsStore, selectHasUnread } from '@/stores/notificationsStore'
import { useHasUnreadDM } from '@/stores/dmStore'
import { useHasUnreadDM17 } from '@/stores/dm17Store'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { EditProfileDialog } from '@/components/social/EditProfileDialog'

const navLinks = [
  { to: '/games', label: 'Games', icon: Gamepad2 },
  { to: '/mods', label: 'Mods', icon: Package },
  { to: '/blog', label: 'Blog', icon: PenLine },
  { to: '/feed', label: 'Feed', icon: Rss },
]

function ProfileButton() {
  const navigate = useNavigate()
  const pubkey = useAuthStore(s => s.pubkey)
  const logout = useAuthStore(s => s.logout)
  const profile = useUserStore(s => s.currentProfile)
  const fetchProfile = useUserStore(s => s.fetchProfile)
  const setCurrentProfile = useUserStore(s => s.setCurrentProfile)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    if (!pubkey) return
    const cached = useUserStore.getState().getCachedProfile(pubkey)
    if (cached) {
      setCurrentProfile(cached)
      return
    }
    const relayUrls = useSettingsStore.getState().getAllEnabledRelayUrls('read')
    fetchProfile(pubkey, relayUrls).then(p => {
      if (p) setCurrentProfile(p)
    })
  }, [pubkey, fetchProfile, setCurrentProfile])

  const displayName = profile?.display_name || 'Profile'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hover:bg-transparent gap-2 px-2 max-w-[140px]">
            {profile?.picture ? (
              <img src={profile.picture} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center shrink-0">
                <span className="text-[10px] text-white font-bold">{displayName[0]?.toUpperCase() || '?'}</span>
              </div>
            )}
            <span className="truncate text-xs font-medium">{displayName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-[#1c1c1c] border-[#262626]">
          <DropdownMenuItem onClick={() => navigate('/profile')} className="cursor-pointer">
            <Eye className="h-4 w-4 mr-2" /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)} className="cursor-pointer">
            <Pencil className="h-4 w-4 mr-2" /> Edit profile
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[#262626]" />
          <DropdownMenuItem onClick={() => { logout(); navigate('/') }} className="cursor-pointer text-red-400 focus:text-red-300">
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        profile={profile}
        onSaved={(m) => setCurrentProfile({ ...(profile ?? { pubkey: pubkey ?? '', npub: '', created_at: 0 }), ...m } as UserProfile)}
      />
    </>
  )
}


export function Header() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const pubkey = useAuthStore(s => s.pubkey)
  const hasUnread = useNotificationsStore(selectHasUnread)
  const hasUnreadDM = useHasUnreadDM() || useHasUnreadDM17()

  // Refresh the unread state on login (throttled inside the store).
  useEffect(() => {
    if (pubkey) useNotificationsStore.getState().refresh(pubkey)
  }, [pubkey])

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo: links to home */}
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="DEG MODS" className="h-8 w-auto" />
          <span className="text-lg font-bold tracking-tight hidden sm:block">
            DEG MODS
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
                location.pathname === to || location.pathname.startsWith(to)
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {Icon && <Icon size={16} />}
              {label}
            </Link>
          ))}
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          {isAuthenticated && (
            <Link to="/feed?view=notifications" aria-label="Notifications">
              <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground hover:bg-transparent">
                <Bell size={18} />
                {/* Unread dot (bordered so it reads on the icon) — wired to read-state next */}
                {hasUnread && (
                  <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-purple-500 ring-2 ring-background" />
                )}
              </Button>
            </Link>
          )}
          {isAuthenticated && (
            <Link to="/feed?view=dm" aria-label="Direct Messages">
              <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground hover:bg-transparent">
                <MessageSquare size={18} />
                {hasUnreadDM && (
                  <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-purple-500 ring-2 ring-background" />
                )}
              </Button>
            </Link>
          )}
          <Link to="/settings">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-transparent">
              <Settings size={18} />
            </Button>
          </Link>
          {isAuthenticated ? (
            <ProfileButton />
          ) : (
            <Button
              size="sm"
              onClick={() => useLoginModalStore.getState().open()}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5 px-3"
            >
              <User size={14} />
              Login
            </Button>
          )}

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden text-muted-foreground hover:text-foreground hover:bg-transparent"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </Button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <nav className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl px-4 py-3 space-y-1">
          {navLinks.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={() => setMobileMenuOpen(false)}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors',
                location.pathname === to || location.pathname.startsWith(to)
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {Icon && <Icon size={16} />}
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}
