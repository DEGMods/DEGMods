import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/50 bg-background/50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="DEG MODS" className="h-5 w-auto" />
            <span className="text-sm text-muted-foreground">
              DEG MODS, Decentralized Game Mods on Nostr
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link to="/mod-manager" className="hover:text-foreground transition-colors">Mod Manager</Link>
            <Link to="/ads" className="hover:text-foreground transition-colors">Ads</Link>
            <Link to="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
            <Link to="/guides" className="hover:text-foreground transition-colors">Guides</Link>
            <Link to="/tos" className="hover:text-foreground transition-colors">Terms of Use</Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
