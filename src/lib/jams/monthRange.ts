/**
 * Month-range helpers for the jam listing. A picked range is capped so the
 * relay-side `#y` filter stays small: one `y` value per month, so 12 months = at
 * most 12 tag values in the query.
 */

export const MAX_SPAN = 12

export function monthToTs(m: string, endOfMonth = false): number {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1, 1))
  if (endOfMonth) { d.setUTCMonth(d.getUTCMonth() + 1); return Math.floor(d.getTime() / 1000) - 1 }
  return Math.floor(d.getTime() / 1000)
}

const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number)
  return monthKeyOf(new Date(Date.UTC(y, mo - 1 + n, 1)))
}

/**
 * The month range to query, or null when the user hasn't picked one (the default:
 * just page through the newest jams). A single picked bound is extrapolated to a
 * full span, and a range wider than MAX_SPAN is clamped.
 */
export function effectiveRange(from: string, to: string): { from: string; to: string } | null {
  if (!from && !to) return null
  if (from && to) {
    const cap = addMonths(from, MAX_SPAN - 1)
    return { from, to: to > cap ? cap : to }
  }
  if (from) return { from, to: addMonths(from, MAX_SPAN - 1) }
  return { from: addMonths(to, -(MAX_SPAN - 1)), to }
}
