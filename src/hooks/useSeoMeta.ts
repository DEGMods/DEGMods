import { useEffect } from 'react'
import { buildMeta, DEFAULT_DESCRIPTION, SITE_NAME, type SeoInput } from '@/lib/seo/buildMeta'

/**
 * Imperatively manages the document head for SEO: title, description, canonical,
 * and Open Graph / Twitter tags. Dependency-free (no react-helmet). Pass null
 * while data is still loading; the head reverts to site defaults on unmount.
 *
 * This helps JS-rendering crawlers (Googlebot). Non-JS social scrapers need the
 * build-time sitemap / prerender layer.
 */
export function useSeoMeta(input: SeoInput | null) {
  const key = input ? JSON.stringify(input) : ''
  useEffect(() => {
    if (!input) return
    const meta = buildMeta(input)
    const canonical = meta.canonical || stripUrl(window.location.href)
    const prevTitle = document.title

    document.title = meta.title
    setMeta('name', 'description', meta.description)
    setMeta('property', 'og:title', meta.title)
    setMeta('property', 'og:description', meta.description)
    setMeta('property', 'og:type', meta.type)
    setMeta('property', 'og:site_name', SITE_NAME)
    setMeta('property', 'og:url', canonical)
    setCanonical(canonical)
    setMeta('name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary')
    if (meta.image) {
      setMeta('property', 'og:image', meta.image)
      setMeta('name', 'twitter:image', meta.image)
    } else {
      removeMeta('property', 'og:image')
      removeMeta('name', 'twitter:image')
    }

    return () => {
      document.title = prevTitle
      setMeta('name', 'description', DEFAULT_DESCRIPTION)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

function stripUrl(href: string): string {
  return href.split('#')[0].split('?')[0]
}

function setMeta(attr: 'name' | 'property', keyName: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${keyName}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, keyName)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function removeMeta(attr: 'name' | 'property', keyName: string) {
  document.head.querySelector(`meta[${attr}="${keyName}"]`)?.remove()
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}
