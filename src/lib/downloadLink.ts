// Real-HTTPS-download escape hatch for super-app WebViews.
//
// Nimiq Pay's WebView has no download listener, so anchor-download and
// window.open(data:) both dead-end (verified on device). A plain HTTPS link
// opened in the system browser does work, because Chrome honours the
// Content-Disposition header the /export Pages Function sets.
//
// The CSV is gzipped and base64url'd into the query string, so the Function
// stays stateless — nothing about the user's ledger is ever stored server-side.

/** 16 KB URL cap minus path/query overhead — must match functions/export. */
const MAX_PAYLOAD = 12000

/**
 * Build a real HTTPS download link for a CSV.
 * Returns null when gzip is unavailable or the payload is too large for a URL
 * (full histories run ~200 KB) — callers fall back to clipboard.
 */
export async function buildDownloadLink(csv: string, filename: string): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const compressed = blob.stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer())
  // Chunked so long CSVs don't blow the argument limit on String.fromCharCode.
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (b64.length > MAX_PAYLOAD) return null
  return `${window.location.origin}/export/${encodeURIComponent(filename)}?d=${b64}`
}
