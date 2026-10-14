// Consent for the public wallet count (functions/api/track-connect.ts).
//
// Nothing is sent until the user has been told: either they connected from the
// landing screen, where the notice sits under the connect buttons, or they
// answered the one-time banner in the app (sessions restored from before the
// notice existed). "Don't count me" is remembered per device and can be
// changed later from Export → Backup & restore.

export type CountConsent = 'yes' | 'no'

const KEY = 'nimbooks:connect-count'

export const COUNT_NOTICE =
  'NimBooks counts connected wallets for its public usage number. It keeps a one-way hash and a masked form of your address, never balances or history.'

export function getCountConsent(): CountConsent | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'yes' || v === 'no' ? v : null
  } catch {
    return null
  }
}

export function setCountConsent(v: CountConsent): void {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* storage blocked — the choice holds for this session only */
  }
}

/** Connecting from the landing screen, with the notice in view, is consent — unless they already opted out. */
export function consentFromLanding(): void {
  if (getCountConsent() !== 'no') setCountConsent('yes')
}
