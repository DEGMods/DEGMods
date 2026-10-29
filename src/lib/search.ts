/**
 * Prefix-first match ranking, shared by every game-name search surface (/games,
 * the /submit-mod autocomplete, the admin games search) so they order results
 * identically: the closest match — the ones whose text STARTS with what was typed
 * — come first, then the remaining substring matches.
 *
 * Only substring matches are kept. Among equal prefix-ness, an optional `tiebreak`
 * decides order; with none, the input order is preserved (JS sort is stable), so
 * a caller that has already sorted its list the way it wants (e.g. /games puts
 * games-with-mods first) keeps that order within each group.
 *
 * Case-insensitive. The key is lowercased once per item (not per comparison).
 */
export function rankByQuery<T>(
  items: T[],
  query: string,
  key: (t: T) => string,
  tiebreak?: (a: T, b: T) => number,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items.slice()
  const decorated: { item: T; starts: boolean }[] = []
  for (const item of items) {
    const idx = key(item).toLowerCase().indexOf(q)
    if (idx === -1) continue
    decorated.push({ item, starts: idx === 0 })
  }
  decorated.sort((a, b) => {
    if (a.starts !== b.starts) return a.starts ? -1 : 1
    return tiebreak ? tiebreak(a.item, b.item) : 0
  })
  return decorated.map((d) => d.item)
}

/** Case-insensitive alphabetical compare, matching the autocomplete's tiebreak. */
export function alphabetical(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}
