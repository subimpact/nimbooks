import { useMemo } from 'react'
import { encodeQr, qrPathData } from './lib/qr'

interface Props {
  value: string
  /** Rendered edge length in CSS pixels. */
  size?: number
  label?: string
}

/**
 * Scannable QR for a payment request. Rendered as a single SVG path so it
 * stays crisp at any size and prints cleanly (dark modules are pure black on
 * white in both themes — scanners need the contrast, not the theme).
 */
export default function QrCode({ value, size = 200, label = 'Payment request QR code' }: Props) {
  const qr = useMemo(() => {
    try {
      return encodeQr(value, 'M')
    } catch {
      // Fall back to the lower ECC level before giving up on very long links.
      try {
        return encodeQr(value, 'L')
      } catch {
        return null
      }
    }
  }, [value])

  if (!qr) return <p className="hint small">Link is too long to fit in a QR code.</p>

  const quiet = 4 // quiet zone required by the spec
  const dim = qr.size + quiet * 2
  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={dim} height={dim} fill="#fff" />
      <g transform={`translate(${quiet} ${quiet})`}>
        <path d={qrPathData(qr)} fill="#000" />
      </g>
    </svg>
  )
}
