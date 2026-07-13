const NOSTR_ICON = 'https://blossom.primal.net/f76ad0ac4f8259bf34db40c3bc1050f03d4dc868532d14221fd195913ca6a68d.gif'

/** The Nostr logo (animated gif). Sized via className. */
export function NostrLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return <img src={NOSTR_ICON} alt="" aria-hidden className={`${className} object-contain`} />
}
