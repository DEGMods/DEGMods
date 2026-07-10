import { useState } from 'react'
import { Server, Code2, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

// Content-addressed on Blossom (immutable); hidden gracefully if it can't load.
const THUMB = 'https://blossom.primal.net/e745fcbb6066915129039d6a8dca6942ca91a79e5c4a01f73025e83f4876ea52.jpg'

const pillars = [
  {
    icon: Server,
    title: 'No single point of failure',
    desc: "DEG Mods is one part of a wider network of independent file servers, so even if it deletes a file from its own servers or shuts them down, the creator isn't stuck. Depending on the mod post and the file's size, they might not need to do anything at all, or they can simply update the mod post with new links.",
  },
  {
    icon: Code2,
    title: 'Open source & unstoppable',
    desc: 'Everything is open source. If the site shut down tomorrow, anyone could run the same code under a different name, and every mod, link, rating, and comment would still be there and fully functional. You can even run it on your own PC.',
  },
  {
    icon: ShieldCheck,
    title: "Can't be silenced",
    desc: "Built on Nostr, so no one, not even this site's creators, can censor a mod or ban a creator. Modders just want to mod, and gamers just want to game in peace.",
  },
]

export function AboutPage() {
  const [thumbOk, setThumbOk] = useState(true)

  return (
    <div className="mx-auto space-y-14 py-12">
      {/* Hero */}
      <section className="space-y-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Liberating <span className="text-purple-400">Game Mods</span>
        </h1>
        {thumbOk && (
          <img
            src={THUMB}
            alt="DEG Mods"
            loading="lazy"
            onError={() => setThumbOk(false)}
            className="mx-auto w-full rounded-xl border border-[#262626]"
          />
        )}
        <p className="text-lg leading-relaxed text-neutral-300">
          Never get your game mods censored, banned, lose your history, or lose the connection
          between creators and fans. Find the game mod you want and download it. Gamers and
          developers are getting censored and suppressed, and this is an attempt to stop it.
        </p>
      </section>

      <p className="text-neutral-400 leading-relaxed">
        DEG Mods (Decentralized Game Mods) is an actual platform where game mod creators can thrive
        without the fear of censorship, bans, or losing their connection with fans. Game mod
        creators and enthusiasts are empowered here because, well, we literally can&apos;t fuck with
        them.
      </p>

      {/* The story */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">What&apos;s the story with DEG Mods?</h2>
        <p className="text-neutral-400 leading-relaxed">
          The idea behind DEG Mods was born out of frustration with the widespread censorship and
          control imposed on game mods across various platforms. Many mod creators faced bans, lost
          their work, and had their voices silenced by platforms imposing their ideals. DEG Mods
          aims to change that narrative by being developed on Nostr, a revolutionary new
          communications protocol.
        </p>
      </section>

      {/* What's Nostr */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Real quick though. What&apos;s Nostr?</h2>
        <p className="text-neutral-400 leading-relaxed">
          Nostr is a communications protocol that makes it extremely hard for anyone to censor
          anyone&apos;s data, and can never have your &ldquo;account&rdquo; get
          &ldquo;banned&rdquo;. It ensures that even this site&apos;s creators cannot censor mods or
          ban anyone directly.
        </p>
      </section>

      {/* How it works */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold">How DEG Mods works</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {pillars.map((p) => (
            <div
              key={p.title}
              className={cn(
                'rounded-xl border border-[#262626] bg-[#1c1c1c] p-6 space-y-3',
                'hover:border-purple-600/50 transition-colors',
              )}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600/20">
                <p.icon size={20} className="text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold">{p.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-neutral-400 leading-relaxed">
          DEG Mods is a response to censorship and oppression, to bring freedom and not hinder
          people&apos;s desires and creativity. If you know a mod creator that&apos;s being
          censored, then show them the way.
        </p>
      </section>

      {/* So what is it */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">So, what is DEG Mods?</h2>
        <p className="text-neutral-400 leading-relaxed">
          DEG Mods is an open-source game mods browser (you can stop right here if you want) of
          what&apos;s uploaded on servers owned by unrelated people around the world. That&apos;s
          the appropriate description.
        </p>
        <blockquote className="border-l-2 border-purple-500 pl-4 text-lg text-neutral-200">
          Another way of describing it: <span className="font-semibold">a true mod site.</span>
        </blockquote>
      </section>
    </div>
  )
}
