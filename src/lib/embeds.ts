/**
 * Embed detection — URL → embed-info extraction (ported from DEN Chat).
 *
 * Recognises specific platforms and returns the iframe details to render them.
 * (Generic OpenGraph link previews aren't included: fetching arbitrary pages
 * to read og:tags requires a server-side proxy and is blocked by CORS in the
 * browser.) Add new platforms here and every consumer picks them up.
 */

export type EmbedType = 'youtube' | 'twitch' | 'kick' | 'twitter' | 'spotify' | 'steam' | 'tiktok'

export type EmbedLayout = 'video' | 'vertical' | 'compact' | 'card'

export interface EmbedInfo {
  type: EmbedType
  src: string
  title: string
  allow: string
  layout: EmbedLayout
  sandbox?: string
  /** Explicit height for compact / card / vertical layouts. */
  height?: number
}

const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
const TWITCH_CLIP_RE = /^https?:\/\/(?:(?:www\.)?twitch\.tv\/[a-zA-Z0-9_]+\/clip\/|clips\.twitch\.tv\/)([a-zA-Z0-9_-]+)/
const TWITCH_VIDEO_RE = /^https?:\/\/(?:www\.)?twitch\.tv\/videos\/(\d+)/
const TWITCH_CHANNEL_RE = /^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]{1,25})\/?$/
const KICK_RE = /^https?:\/\/(?:www\.)?kick\.com\/([a-zA-Z0-9_-]+)\/?$/
const TWITTER_RE = /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/
const SPOTIFY_RE = /^https?:\/\/open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/
const STEAM_RE = /^https?:\/\/store\.steampowered\.com\/app\/(\d+)/
const TIKTOK_RE = /^https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/(\d+)/

/** Detect whether a URL should render as a platform embed, else null. */
export function detectEmbed(url: string): EmbedInfo | null {
  const yt = url.match(YOUTUBE_RE)
  if (yt) {
    return {
      type: 'youtube', layout: 'video',
      src: `https://www.youtube-nocookie.com/embed/${yt[1]}`,
      title: 'YouTube video',
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
    }
  }

  const parent = typeof window !== 'undefined' ? window.location.hostname : 'localhost'

  const tc = url.match(TWITCH_CLIP_RE)
  if (tc) {
    return { type: 'twitch', layout: 'video', src: `https://clips.twitch.tv/embed?clip=${tc[1]}&parent=${parent}&autoplay=false`, title: 'Twitch clip', allow: 'fullscreen' }
  }
  const tv = url.match(TWITCH_VIDEO_RE)
  if (tv) {
    return { type: 'twitch', layout: 'video', src: `https://player.twitch.tv/?video=${tv[1]}&parent=${parent}&autoplay=false`, title: 'Twitch video', allow: 'fullscreen' }
  }
  const tch = url.match(TWITCH_CHANNEL_RE)
  if (tch) {
    return { type: 'twitch', layout: 'video', src: `https://player.twitch.tv/?channel=${tch[1]}&parent=${parent}&autoplay=false`, title: 'Twitch stream', allow: 'fullscreen' }
  }

  const kick = url.match(KICK_RE)
  if (kick) {
    return { type: 'kick', layout: 'video', src: `https://player.kick.com/${kick[1]}?autoplay=false`, title: 'Kick stream', allow: 'fullscreen' }
  }

  const tw = url.match(TWITTER_RE)
  if (tw) {
    return {
      type: 'twitter', layout: 'card',
      src: `https://platform.twitter.com/embed/Tweet.html?id=${tw[1]}&theme=dark`,
      title: 'Twitter post', allow: '',
      sandbox: 'allow-scripts allow-same-origin allow-popups',
      height: 250,
    }
  }

  const sp = url.match(SPOTIFY_RE)
  if (sp) {
    const variant = sp[1]
    const isCompact = variant === 'track' || variant === 'episode'
    return {
      type: 'spotify', layout: 'compact',
      src: `https://open.spotify.com/embed/${variant}/${sp[2]}?theme=0`,
      title: `Spotify ${variant}`, allow: 'encrypted-media',
      height: isCompact ? 152 : 352,
    }
  }

  const steam = url.match(STEAM_RE)
  if (steam) {
    return { type: 'steam', layout: 'compact', src: `https://store.steampowered.com/widget/${steam[1]}/`, title: 'Steam store', allow: '', height: 190 }
  }

  const tt = url.match(TIKTOK_RE)
  if (tt) {
    return { type: 'tiktok', layout: 'vertical', src: `https://www.tiktok.com/player/v1/${tt[1]}?autoplay=0&music_info=1&description=1`, title: 'TikTok video', allow: 'fullscreen', height: 740 }
  }

  return null
}

export function isEmbeddable(url: string): boolean {
  return detectEmbed(url) !== null
}
