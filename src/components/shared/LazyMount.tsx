import { useEffect, useRef, useState, type ReactNode } from 'react'

interface LazyMountProps {
  children: ReactNode
  /** IntersectionObserver root (e.g. a horizontal scroll container). Defaults to the viewport. */
  root?: Element | null
  /** Preload margin so content mounts just before it scrolls into view. */
  rootMargin?: string
  className?: string
}

/**
 * Renders `children` only once the slot scrolls (near) into view, then keeps
 * them mounted. Used so off-screen carousel images aren't fetched until needed.
 */
export function LazyMount({ children, root = null, rootMargin = '300px', className }: LazyMountProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (show) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShow(true); return }
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setShow(true); obs.disconnect() } },
      { root, rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [root, rootMargin, show])

  return <div ref={ref} className={className}>{show ? children : null}</div>
}
