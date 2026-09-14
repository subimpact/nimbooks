// POST /api/export-link — mints a short, scannable link for a CSV export.
//
// Why not /api/shorten: a share link carries a receipt, an export link carries
// the user's whole ledger. Handing that to short.io would hand them the ledger
// with it, so this route never leaves our own edge: the payload goes into our
// Workers KV namespace and comes back out of /s/<slug>.csv, which we serve.
//
// Why shorten it at all: the long /export/ URL holds the entire compressed CSV,
// and past a few hundred characters a QR code stops resolving on a phone camera
// — which is the whole point of the download-link modal inside Nimiq Pay, where
// the second device is how the file gets saved.
//
// The stored copy is not permanent: SHORT_LINK_TTL_SECONDS below is the whole
// lifetime of the data, and KV deletes it without us asking. The modal tells
// the user so.
//
// Exporting must never depend on this endpoint succeeding. Every failure path
// answers with an error status and the client falls back to the long /export/
// URL, which works exactly as it did before short links existed.

import { isFromApp } from '../_lib/fromApp'
import { MAX_PAYLOAD, decodeExportPayload, safeName } from '../_lib/exportPayload'

// Minimal local types — @cloudflare/workers-types is not a dependency and this
// directory is outside the tsconfig includes (wrangler bundles it with esbuild).
interface KVNamespace {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface Ctx {
  request: Request
  env: { EXPORT_KV?: KVNamespace }
}

/** 48 hours. Long enough to walk to a laptop and open the link, short enough
 *  that a ledger nobody downloaded stops existing on its own. */
const SHORT_LINK_TTL_SECONDS = 172800

/** 12 base62 chars is ~71 bits: a slug cannot be guessed or enumerated, which
 *  matters because the slug is the only thing protecting the export. */
const SLUG_LENGTH = 12

const SLUG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Rejection sampling, not `% 62`: 256 is not a multiple of 62, so plain modulo
 *  would make the first eight letters measurably likelier than the rest and
 *  quietly cost the slug some of its entropy. */
const randomSlug = (): string => {
  let slug = ''
  const limit = 256 - (256 % SLUG_ALPHABET.length)
  while (slug.length < SLUG_LENGTH) {
    const bytes = new Uint8Array(SLUG_LENGTH)
    crypto.getRandomValues(bytes)
    for (const b of bytes) {
      if (b >= limit) continue
      slug += SLUG_ALPHABET[b % SLUG_ALPHABET.length]
      if (slug.length === SLUG_LENGTH) break
    }
  }
  return slug
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  if (!isFromApp(request)) return json({ error: 'forbidden' }, 403)

  let payload: unknown
  let rawName: unknown
  try {
    const body = (await request.json()) as { d?: unknown; name?: unknown }
    payload = body?.d
    rawName = body?.name
  } catch {
    return json({ error: 'invalid payload' }, 400)
  }

  if (typeof payload !== 'string' || !payload || payload.length > MAX_PAYLOAD) {
    return json({ error: 'invalid payload' }, 400)
  }

  // Decoded, then thrown away: decodeExportPayload proves the body really is a
  // gzipped CSV — gzip plus a CSV-shape check on the decompressed first line —
  // before a slug gets spent on it, and it is the same check /s/<slug>.csv will
  // run on the way out. What gets stored is the compressed form, exactly as it
  // arrived — decompressing into KV would multiply the ledger sitting at rest.
  const decoded = await decodeExportPayload(payload)
  if (!decoded.ok) {
    return decoded.reason === 'too-large'
      ? json({ error: 'payload too large' }, 413)
      : json({ error: 'invalid payload' }, 400)
  }

  const name = safeName(typeof rawName === 'string' ? rawName : '')

  // Deployable before the binding exists: without EXPORT_KV there is nothing to
  // write to, so say so plainly and let the client use the long link.
  const kv = env.EXPORT_KV
  if (!kv) return json({ error: 'shortener unavailable' }, 503)

  const slug = randomSlug()
  try {
    await kv.put(slug, JSON.stringify({ name, d: payload }), {
      expirationTtl: SHORT_LINK_TTL_SECONDS,
    })
  } catch {
    return json({ error: 'shortener unavailable' }, 503)
  }

  // Origin from the request, not a constant: preview deployments and local
  // `wrangler pages dev` have to hand back a link to themselves.
  const { origin } = new URL(request.url)
  return json({ url: `${origin}/s/${slug}.csv` }, 200)
}
