import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Footer } from './Footer'
import { AnnouncementBanner } from './AnnouncementBanner'
import { useAnalytics } from '@/hooks/useAnalytics'

export function MainLayout() {
  // Inside the router, so page views follow real navigation.
  useAnalytics()

  return (
    <div className="flex min-h-screen flex-col bg-surface-background">
      <Header />
      <AnnouncementBanner />
      <main className="flex-1 overflow-x-clip">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  )
}
