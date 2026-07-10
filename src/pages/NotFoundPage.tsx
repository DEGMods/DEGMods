import { Home, Package } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 px-4 text-center">
      {/* Mascot */}
      <img
        src="/moda-shocked.png"
        alt="Shocked mascot"
        className="w-40 h-40 object-contain"
      />

      {/* Large 404 number */}
      <span className="text-[8rem] font-extrabold leading-none tracking-tighter text-purple-400/20 select-none sm:text-[10rem]">
        404
      </span>

      {/* Text */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Page Not Found</h1>
        <p className="max-w-md text-neutral-400">
          The page you're looking for doesn't exist or has been removed.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Link to="/">
          <Button className="bg-purple-600 hover:bg-purple-700 text-white gap-2">
            <Home size={16} />
            Go Home
          </Button>
        </Link>
        <Link to="/mods">
          <Button variant="outline" className="gap-2 border-[#262626] hover:bg-[#1c1c1c]">
            <Package size={16} />
            Browse Mods
          </Button>
        </Link>
      </div>
    </div>
  )
}
