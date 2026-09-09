// One-path-per-device detection, shared by the connect screen and the
// invoice page so both offer exactly one wallet route.
// Mobile = touch-primary device (phone/tablet) → Nimiq Pay is the natural
// wallet. Desktop → Nimiq Hub browser login is the primary path.
// Real phones always report touch capability — pointer:coarse alone fails in
// some WebViews and desktop-mode browsers, so check every touch signal.
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0 ||
    'ontouchstart' in window ||
    window.innerWidth < 768 ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  )
}

export function isInNimiqPay(): boolean {
  return typeof window !== 'undefined' && !!window.nimiqPay
}

// Deep link that opens NimBooks inside Nimiq Pay. Hardcoded to the registered
// host (not window.location) so preview/staging URLs can't produce a dead link.
export const NIMIQ_PAY_APP_URL = 'https://nimpay.app/miniapps/open/nimbooks.subimpact.net'

// The public site, hardcoded for the same reason: a link built from a preview
// or localhost URL is dead for everyone who receives it.
export const NIMBOOKS_SITE_URL = 'https://nimbooks.subimpact.net'

/**
 * Absolute link to a NimBooks hash route (`#/invoice/…`, `#/verify/…`) for
 * sharing — share sheet, clipboard, QR.
 *
 * Every share goes to the plain site, never through the Pay deep link:
 * nimpay.app drops the fragment when it hands a miniapp off to the Pay
 * WebView, so a shared `…/miniapps/open/nimbooks.subimpact.net/#/verify/…`
 * arrives with the payload gone and lands on the miniapps page. The site URL
 * keeps the route, opens in any browser, and is shorter; the invoice page
 * offers its own hand-off into Pay once it is open.
 */
export function siteLink(route: string): string {
  return `${NIMBOOKS_SITE_URL}/${route.startsWith('#') ? route : `#${route}`}`
}

/**
 * Hand-off from a mobile browser into the Nimiq Pay app, carrying the route.
 * The custom scheme takes the whole site URL as a query param, which survives
 * the hand-off intact — unlike the fragment on the https miniapps link.
 *
 * Silently does nothing when Pay is not installed, so every caller must leave
 * a second path (the Hub login) on screen.
 */
export function payDeepLink(route: string): string {
  return `nimiqpay://miniapp?url=${encodeURIComponent(siteLink(route))}`
}

const QUERY_ROUTES = ['verify', 'invoice']

/**
 * `?route=invoice&p=<payload>` → `#/invoice/<payload>`, or null if the params
 * are missing or the route is not one we serve.
 *
 * A fallback for hosts that forward a link's query string but drop its
 * fragment. Nothing NimBooks hands out is in this shape; it only has to be
 * here for the day something arrives that way.
 */
export function hashRouteFromQuery(search: string): string | null {
  const params = new URLSearchParams(search)
  const route = params.get('route')
  const payload = params.get('p')
  if (!route || !payload || !QUERY_ROUTES.includes(route)) return null
  return `#/${route}/${payload}`
}
