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
 * Gated on the SHARER's device, the only signal there is: someone sharing from
 * a phone is almost certainly sending to a phone, where the wallet lives in
 * Nimiq Pay, so the link opens the route inside the app. A desktop user gets
 * the plain site and is never pushed into an app they may not have.
 */
export function appLink(route: string): string {
  const base = isInNimiqPay() || isMobileDevice() ? NIMIQ_PAY_APP_URL : NIMBOOKS_SITE_URL
  return `${base}/${route.startsWith('#') ? route : `#${route}`}`
}
