// POST /api/shorten — turns a NimBooks share link into a short.io link.
//
// Why a server Function: the short.io API key is a bearer secret. It lives
// only as the Cloudflare Pages secret SHORTIO_API_KEY, so the call has to
// happen here — putting it in the client bundle would publish it.
//
// Sharing must never depend on this endpoint succeeding. Every failure path
// answers with an error status and the client falls back to the long URL,
// which works exactly as it did before short links existed.
//
// No cache: short.io dedupes by originalURL server-side, so re-sharing the
// same receipt returns the same path and burns no extra quota.

// Minimal local types — @cloudflare/workers-types is not a dependency and this
// directory is outside the tsconfig includes (wrangler bundles it with esbuild).
interface Ctx {
  request: Request
  env: { SHORTIO_API_KEY?: string; SHORTIO_DOMAIN?: string }
}

const ORIGIN = 'https://nimbooks.subimpact.net'

/** Only NimBooks share links get shortened, so the short domain can't be
 *  turned into an open redirector pointing anywhere on the web. Each prefix
 *  carries its own cap: receipts ride in the fragment and stay small, while
 *  an /export link carries a gzipped CSV (up to ~12 KB) in its query string.
 *  The caps just keep a junk body from being forwarded upstream. */
const ALLOWED: ReadonlyArray<{ prefix: string; maxUrl: number }> = [
  { prefix: `${ORIGIN}/#/`, maxUrl: 4096 },
  { prefix: `${ORIGIN}/export/`, maxUrl: 16384 },
]

const isShareLink = (url: string): boolean =>
  ALLOWED.some(({ prefix, maxUrl }) => url.startsWith(prefix) && url.length <= maxUrl)

const DEFAULT_DOMAIN = 'nimbook.s.gy'

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  let url: unknown
  try {
    const body = (await request.json()) as { url?: unknown }
    url = body?.url
  } catch {
    return json({ error: 'invalid url' }, 400)
  }

  if (typeof url !== 'string' || !isShareLink(url)) {
    return json({ error: 'invalid url' }, 400)
  }

  const key = env.SHORTIO_API_KEY
  if (!key) return json({ error: 'shortener unavailable' }, 502)

  try {
    const res = await fetch('https://api.short.io/links', {
      method: 'POST',
      headers: {
        Authorization: key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ originalURL: url, domain: env.SHORTIO_DOMAIN || DEFAULT_DOMAIN }),
    })
    if (!res.ok) return json({ error: 'shortener unavailable' }, 502)

    const data = (await res.json()) as { shortURL?: unknown }
    if (typeof data?.shortURL !== 'string' || !data.shortURL) {
      return json({ error: 'shortener unavailable' }, 502)
    }
    return json({ shortUrl: data.shortURL }, 200)
  } catch {
    return json({ error: 'shortener unavailable' }, 502)
  }
}
