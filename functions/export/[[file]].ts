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
// to storage — the app's "nothing is stored on a server" promise still holds
// on this route. (Its short-link sibling, /s/<slug>.csv, does park the same
// payload in KV for 48h, and says so in the modal.)
//
// The URL path ends in .csv so listeners that take the filename from the URL
// (rather than the header) still get a sensible name.
//
// Decoding, filename cleanup and the attachment headers live in
// ../_lib/exportPayload.ts, shared with /s/<slug>.csv.

import { MAX_PAYLOAD, csvAttachment, decodeExportPayload, safeName } from '../_lib/exportPayload'

// Minimal local types — @cloudflare/workers-types is not a dependency and this
// directory is outside the tsconfig includes (wrangler bundles it with esbuild).
interface Ctx {
  request: Request
  params: Record<string, string | string[]>
}

export const onRequestGet = async ({ request, params }: Ctx): Promise<Response> => {
  const url = new URL(request.url)
  const payload = url.searchParams.get('d')
  if (!payload) {
    return new Response('Missing ?d= payload', { status: 400 })
  }
  if (payload.length > MAX_PAYLOAD) {
    return new Response('Payload too large for a URL. Use Copy CSV instead.', { status: 414 })
  }

  const decoded = await decodeExportPayload(payload)
  if (!decoded.ok) {
    return decoded.reason === 'too-large'
      ? new Response('Payload expands past the 1 MB limit. Use Copy CSV instead.', { status: 413 })
      : new Response('Malformed ?d= payload', { status: 400 })
  }

  const raw = params.file
  const name = safeName(Array.isArray(raw) ? (raw[raw.length - 1] ?? '') : (raw ?? ''))

  return csvAttachment(decoded.body, name)
}
