// Serves /s/<slug>.csv (and /s/<slug>) — the short half of a CSV export.
//
// /api/export-link parked a base64url(gzip(CSV)) payload in KV under the slug;
// this route reads it back and hands it over with the same attachment headers
// the long /export/ URL uses, so the file lands identically whichever link the
// user opened. The whole difference is the length: this one fits in a QR code
// a phone camera can actually resolve.
//
// The path ends in .csv for the same reason /export/ does: download listeners
// that take the filename from the URL rather than the header still get a
// sensible name. The slug alone is what identifies the export, so the
// extension is optional and stripped before the lookup.
//
// No cache, and 404s read as expiry rather than as an error: after 48h KV has
// dropped the key and the link is simply gone.

import { csvAttachment, decodeExportPayload } from '../_lib/exportPayload'

// Minimal local types — @cloudflare/workers-types is not a dependency and this
// directory is outside the tsconfig includes (wrangler bundles it with esbuild).
interface KVNamespace {
  get(key: string): Promise<string | null>
}

interface Ctx {
  params: Record<string, string | string[]>
  env: { EXPORT_KV?: KVNamespace }
}

/** What randomSlug() in api/export-link.ts mints, with room either side: the
 *  range is deliberately wider than 12 so an older link keeps working if the
 *  slug length is ever changed. */
const SLUG_PATTERN = /^[A-Za-z0-9]{6,32}$/

const gone = (): Response =>
  new Response('This download link has expired or does not exist.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })

export const onRequestGet = async ({ params, env }: Ctx): Promise<Response> => {
  const raw = params.slug
  const requested = Array.isArray(raw) ? (raw[raw.length - 1] ?? '') : (raw ?? '')
  const slug = requested.endsWith('.csv') ? requested.slice(0, -4) : requested
  if (!SLUG_PATTERN.test(slug)) return gone()

  // No binding means no short links were ever minted here, so any slug is one
  // that does not exist.
  const kv = env.EXPORT_KV
  if (!kv) return gone()

  let stored: string | null
  try {
    stored = await kv.get(slug)
  } catch {
    return gone()
  }
  if (!stored) return gone()

  let name: unknown
  let payload: unknown
  try {
    const record = JSON.parse(stored) as { name?: unknown; d?: unknown }
    name = record?.name
    payload = record?.d
  } catch {
    return gone()
  }
  if (typeof payload !== 'string' || !payload || typeof name !== 'string' || !name) return gone()

  // safeName() already ran when the record was written, so the stored name is
  // header-safe as it stands.
  const decoded = await decodeExportPayload(payload)
  if (!decoded.ok) {
    return decoded.reason === 'too-large'
      ? new Response('This export is too large to serve. Use Copy CSV instead.', {
          status: 413,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      : gone()
  }

  return csvAttachment(decoded.body, name)
}
