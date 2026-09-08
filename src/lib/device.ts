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
