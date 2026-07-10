/**
 * Build game-database CSVs from Steam's games-only app list.
 *
 * Uses IStoreService/GetAppList (games only, so no DLC / soundtracks / tools /
 * videos / hardware), cleans trademark symbols from titles, derives the wide
 * banner + portrait boxart URLs from each appid, and writes CSV chunks of
 * 10,000 rows each — ready to upload in Settings → Admin → Game Database.
 *
 * Columns match the importer: name, banner (wideImage), boxart (boxartImage).
 *
 *   STEAM_API_KEY=xxxx: node scripts/steam-games-csv.mjs
 *
 * Env:
 *   STEAM_API_KEY  required — https://steamcommunity.com/dev/apikey
 *   OUT_DIR        output folder (default: ./steam-games)
 *   CHUNK          rows per CSV file (default: 10000)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const KEY = process.env.STEAM_API_KEY
if (!KEY) {
  console.error('Set STEAM_API_KEY (get one at https://steamcommunity.com/dev/apikey)')
  process.exit(1)
}
const OUT_DIR = process.env.OUT_DIR || 'steam-games'
const CHUNK = Number(process.env.CHUNK || 10000)
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

// Strip trademark/copyright/registered/service/phono symbols; keep hyphens etc.
function cleanName(name) {
  return name.replace(/[™©®℠℗]/g, '').replace(/\s{2,}/g, ' ').trim()
}

// CSV field: quote if it contains a comma, quote, or newline; escape quotes.
function csvField(v) {
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

async function fetchAllGames() {
  const base = 'https://api.steampowered.com/IStoreService/GetAppList/v1/'
  const apps = []
  let lastAppid = 0
  for (;;) {
    const url = `${base}?key=${KEY}&include_games=true&include_dlc=false&include_software=false&include_videos=false&include_hardware=false&max_results=50000&last_appid=${lastAppid}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Steam API ${res.status} ${res.statusText}`)
    const r = (await res.json())?.response ?? {}
    for (const a of r.apps ?? []) apps.push(a)
    process.stdout.write(`\rfetched ${apps.length} apps…`)
    if (!r.have_more_results) break
    lastAppid = r.last_appid
  }
  process.stdout.write('\n')
  return apps
}

async function main() {
  const apps = await fetchAllGames()

  // Clean + dedupe by name (keep the first/lowest appid), build rows.
  const seen = new Set()
  const rows = []
  for (const app of apps) {
    const name = cleanName(app.name || '')
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push([
      name,
      `${CDN}/${app.appid}/library_hero.jpg`,      // banner (wide, 1920×620)
      `${CDN}/${app.appid}/library_600x900.jpg`,   // boxart (portrait)
    ])
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const header = 'name,banner,box art'
  let file = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    file++
    const body = rows.slice(i, i + CHUNK).map(r => r.map(csvField).join(',')).join('\n')
    writeFileSync(join(OUT_DIR, `steam-games-${file}.csv`), `${header}\n${body}\n`)
  }
  console.log(`${rows.length} games (from ${apps.length} apps) → ${file} file(s) in ${OUT_DIR}/`)
}

main().catch(err => { console.error('\nfailed:', err.message); process.exit(1) })
