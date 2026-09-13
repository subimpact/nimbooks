// POST /api/shorten — turns a NimBooks receipt or invoice share link into a
// short.io link. Nothing that carries a ledger is shortened: the payload of a
// short link is handed to a third party, so only the small fragment-borne
// share links go through here.
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
 *  turned into an open redirector pointing anywhere on the web. Receipt and
 *  invoice links ride in the fragment and stay small; the cap just keeps a
 *  junk body from being forwarded upstream.
 *
 *  /export links are deliberately absent: those carry the user's whole ledger
 *  as a gzipped CSV in the query string, and shortening one would post it to
 *  short.io. Export links stay long and never leave the device. */
const ALLOWED: ReadonlyArray<{ prefix: string; maxUrl: number }> = [
  { prefix: `${ORIGIN}/#/`, maxUrl: 4096 },
]

const isShareLink = (url: string): boolean =>
  ALLOWED.some(({ prefix, maxUrl }) => url.startsWith(prefix) && url.length <= maxUrl)

/** Did this come from one of the app's own pages?
 *
 *  The allowlist above already stops the short domain becoming an open
 *  redirector; this is about the quota. Anyone can mint links by POSTing
 *  distinct `#/` payloads, and a browser tells us where a request came from:
 *  fetch metadata first, then Origin (a same-origin POST carries one), then
 *  Referer. A request that shows none of the three is not a share button, so
 *  it is refused — the client falls back to the long URL on any non-200, so
 *  a false negative costs the user nothing but a longer link.
 *
 *  Headers can be forged by anything that isn't a browser, so a rate-limit
 *  rule on the route stays the real quota control. */
const isFromApp = (request: Request): boolean => {
  const site = request.headers.get('Sec-Fetch-Site')
  const origin = request.headers.get('Origin')
  const referer = request.headers.get('Referer')
  // 'none' is a top-level, user-initiated request (a privacy context that
  // strips the origin, say); anything cross-site is not ours.
  if (site && site !== 'same-origin' && site !== 'none') return false
  if (origin && origin !== ORIGIN) return false
  if (referer && !referer.startsWith(`${ORIGIN}/`)) return false
  return !!(site || origin || referer)
}

const DEFAULT_DOMAIN = 'nimbook.s.gy'

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  if (!isFromApp(request)) return json({ error: 'forbidden' }, 403)

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
