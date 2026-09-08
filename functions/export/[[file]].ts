// Handles /export/<name>.csv?d=<gzip+base64url payload>
//
// Why this exists: inside Nimiq Pay's Android WebView there is no download
// listener, so `a.download` + blob silently no-ops and window.open(data:)
// renders a blank in-app page (both verified on device). The only reliable
// escape hatch is a real HTTPS URL the user opens in their system browser,
// where Content-Disposition is honoured natively.
//
// Stateless by design: the CSV travels in the query string, gets decompressed
// here, and is echoed straight back as an attachment. Nothing is ever written
// to storage — the app's "nothing is stored on a server" promise still holds.
//
// The URL path ends in .csv so listeners that take the filename from the URL
// (rather than the header) still get a sensible name.

// Minimal local types — @cloudflare/workers-types is not a dependency and this
// directory is outside the tsconfig includes (wrangler bundles it with esbuild).
interface Ctx {
  request: Request
  params: Record<string, string | string[]>
}

/** 16 KB URL cap minus path/query overhead, with a safety margin. */
const MAX_PAYLOAD = 12000

/** Header-safe, path-traversal-safe filename. */
function safeName(raw: string): string {
  const base = raw.split('/').pop() ?? ''
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100)
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'nimbooks.csv'
  return cleaned.endsWith('.csv') ? cleaned : cleaned + '.csv'
}

export const onRequestGet = async ({ request, params }: Ctx): Promise<Response> => {
  const url = new URL(request.url)
  const payload = url.searchParams.get('d')
  if (!payload) {
    return new Response('Missing ?d= payload', { status: 400 })
  }
  if (payload.length > MAX_PAYLOAD) {
    return new Response('Payload too large for a URL — use Copy CSV instead.', { status: 414 })
  }

  // Bytes, never a string: the CSV opens with a UTF-8 BOM (Excel needs it) and
  // Response.text() performs a spec UTF-8 decode, which strips a leading BOM.
  // Buffered rather than streamed so a corrupt payload fails here — as a 400 —
  // instead of truncating a body already committed to a 200.
  let body: ArrayBuffer
  try {
    // base64url → bytes
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const bin = atob(b64 + pad)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    body = await new Response(stream).arrayBuffer()
  } catch {
    return new Response('Malformed ?d= payload', { status: 400 })
  }

  const raw = params.file
  const name = safeName(Array.isArray(raw) ? (raw[raw.length - 1] ?? '') : (raw ?? ''))

  return new Response(body, {
    headers: {
      // The CSV already carries a UTF-8 BOM from buildCsv() — Excel needs it.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
