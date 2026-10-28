import { useEffect, useState } from 'react'
// @ts-expect-error - @nimiq/identicons does not ship TS types
import Identicons from '@nimiq/identicons'
import identiconsSvgUrl from '@nimiq/identicons/dist/identicons.min.svg?url'

// The library fetches its part sprites from /node_modules/@nimiq/identicons/...
// by default. The dev server serves that path; the production build does not,
// so the SPA fallback answered with index.html, the sprite parse failed (an
// "XML Parsing Error" in the console) and every Iqon rendered without its face,
// top, side and bottom. Point it at the hashed asset Vite emits instead.
Identicons.svgPath = identiconsSvgUrl

const cache = new Map<string, string>()

interface IqonProps {
  address: string
  size?: number
  className?: string
  alt?: string
}

export function Iqon({ address, size = 24, className = '', alt = '' }: IqonProps) {
  const clean = (address || '').replace(/\s+/g, '').toUpperCase()
  const [dataUrl, setDataUrl] = useState<string>(() => cache.get(clean) || '')

  useEffect(() => {
    if (!clean) return
    const cached = cache.get(clean)
    if (cached) {
      setDataUrl(cached)
      return
    }
    let active = true
    Identicons.toDataUrl(clean)
      .then((url: string) => {
        cache.set(clean, url)
        if (active) setDataUrl(url)
      })
      .catch(() => {
        /* fallback */
      })
    return () => {
      active = false
    }
  }, [clean])

  if (!clean || !dataUrl) {
    return (
      <span
        className={`iqon-placeholder ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'inline-block',
          background: 'var(--border, #2a2f3d)',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
    )
  }

  return (
    <img
      src={dataUrl}
      alt={alt || `Iqon for ${clean}`}
      width={size}
      height={size}
      className={`iqon ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        verticalAlign: 'middle',
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  )
}
export default Iqon