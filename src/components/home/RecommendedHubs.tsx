import { ExternalLink } from 'lucide-react'
import { HubCard } from '@/components/hubs/HubCard'
import type { HubRec } from '@/lib/nostr/hubs'

const DENCHAT_URL = 'https://denchat.top'

/**
 * "Community hubs" — the admin-curated DEN Chat hubs near the bottom of the landing
 * page. The first (priority) hub sits on the left of the top row next to a DEN Chat
 * promo that invites mod creators to start their own hub; up to four more hubs
 * render in a grid below. Five hubs total.
 */
export function RecommendedHubs({ recs }: { recs: HubRec[] }) {
  const top = recs.slice(0, 5)
  if (top.length === 0) return null
  const [first, ...rest] = top

  return (
    <div className="mb-10">
      <h2 className="mb-4 text-2xl font-bold text-white">Community hubs</h2>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <div className="lg:w-1/3">
          <HubCard rec={first} />
        </div>
        <DenChatPromo />
      </div>

      {rest.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((r) => (
            <HubCard key={r.coord} rec={r} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Promotes starting a DEN Chat hub to mod creators / communities. */
function DenChatPromo() {
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-[#262626] bg-[#1c1c1c] p-5 md:p-6">
      <div className="flex items-center gap-3">
        <img src="/denchat-logo.svg" alt="" className="h-12 w-12 shrink-0" />
        <span className="text-2xl font-bold text-white">DEN Chat</span>
      </div>
      <h3 className="mt-4 text-lg font-bold text-white">Start your own community hub</h3>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-neutral-400">
        Running a mod or a community? Spin up your own hub on DEN Chat — decentralized,
        encrypted group chat on Nostr that no one can take down.
      </p>
      <div className="mt-auto flex justify-end pt-4">
        <a
          href={DENCHAT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
        >
          Create a hub on DEN Chat <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}
