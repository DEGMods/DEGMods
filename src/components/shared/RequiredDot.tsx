/**
 * The amber "still empty" marker used across the submit forms.
 *
 * Long forms hide what's left to fill in, and finding out only when publish
 * fails is a bad trade. A dot next to a section (or field) label says which ones
 * still need something, live, without shouting an error at input the user hasn't
 * reached yet.
 */
export function RequiredDot({ label = 'Something required here is still empty' }: { label?: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label={label} />
}
