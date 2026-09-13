// Shared request-origin check for the app's own POST endpoints.
//
// Moved out of functions/api/shorten.ts unchanged so /api/export-link gates on
// exactly the same rules. Files under functions/_lib are never routed by Pages,
// so this is a module, not an endpoint.

export const APP_ORIGIN = 'https://nimbooks.subimpact.net'

/** Did this come from one of the app's own pages?
 *
 *  Per-endpoint allowlists stop these routes being turned into something they
 *  are not; this is about the quota. Anyone can mint links by POSTing distinct
 *  payloads, and a browser tells us where a request came from: fetch metadata
 *  first, then Origin (a same-origin POST carries one), then Referer. A request
 *  that shows none of the three is not a button in the app, so it is refused —
 *  the client falls back to the long URL on any non-200, so a false negative
 *  costs the user nothing but a longer link.
 *
 *  Headers can be forged by anything that isn't a browser, so a rate-limit
 *  rule on the route stays the real quota control. */
export const isFromApp = (request: Request): boolean => {
  const site = request.headers.get('Sec-Fetch-Site')
  const origin = request.headers.get('Origin')
  const referer = request.headers.get('Referer')
  // 'none' is a top-level, user-initiated request (a privacy context that
  // strips the origin, say); anything cross-site is not ours.
  if (site && site !== 'same-origin' && site !== 'none') return false
  if (origin && origin !== APP_ORIGIN) return false
  if (referer && !referer.startsWith(`${APP_ORIGIN}/`)) return false
  return !!(site || origin || referer)
}
