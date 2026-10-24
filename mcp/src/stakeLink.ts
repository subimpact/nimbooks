// Stake links: a shareable `#/stake?amount=…&validator=…` route that opens the
// stake panel pre-filled. This is a port of the app's `src/lib/stakeLink.ts`.
//
// The link never signs anything; the user checks both values and confirms in
// their own wallet, exactly as in the normal flow. The package cannot import
// the app at runtime, so `test/stake-link-parity.test.ts` imports the app's
// real module and pins this one to it, byte for byte.
//
// As with invoices, the site address is data written into a link, not a host
// this server ever calls.

import { NIMBOOKS_SITE_URL, formatLunaExact, parseNimToLuna } from './invoice.ts'
import { isValidNimiqAddress } from './chain.ts'

export interface StakeLinkIntent {
  amountLuna: number | null
  validator: string | null // cleaned, no spaces, uppercase
  warnings: string[]
}

export interface StakeLinkParams {
  amountNim?: number | string | null
  validator?: string | null
}

// Nimiq's total supply, in luna. One NIM is 100,000 luna; the integer luna
// value stays well inside Number.MAX_SAFE_INTEGER at this cap.
const MAX_STAKE_LUNA = 21_000_000_000 * 100_000

export const STAKE_AMOUNT_WARNING =
  'The amount in this link is not a valid NIM amount, so it was left out.'
export const STAKE_VALIDATOR_WARNING =
  'The validator address in this link is not valid, so it was left out.'

function cleanAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/**
 * Exact decimal NIM to integer luna, with the stake cap. The shared
 * `parseNimToLuna` already enforces the decimal rules, but it stops at the
 * invoice cap (2,000,000,000 NIM). A stake link may name up to the full
 * 21,000,000,000 NIM supply, so the same exact rules are applied above that.
 */
function parseAmountLuna(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, '')
  const shared = parseNimToLuna(cleaned)
  if (shared) {
    const luna = Number(shared)
    return luna <= MAX_STAKE_LUNA ? luna : null
  }
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  const [intPart, fracPart = ''] = cleaned.split('.')
  if (fracPart.length > 5 || intPart.length > 11) return null
  const luna = BigInt(intPart || '0') * 100000n + BigInt(fracPart.padEnd(5, '0') || '0')
  if (luna <= 0n || luna > BigInt(MAX_STAKE_LUNA)) return null
  return Number(luna)
}

/**
 * Parses a stake route hash. Returns null for every other hash (including
 * `#/verify/…` and `#/invoice/…`), so the router can keep those pages apart.
 * Bad optional params are dropped and explained in `warnings`; the route
 * itself still opens the panel.
 */
export function parseStakeLink(hash: string): StakeLinkIntent | null {
  if (hash !== '#/stake' && !hash.startsWith('#/stake?')) return null
  const query = hash.indexOf('?')
  const params = new URLSearchParams(query === -1 ? '' : hash.slice(query + 1))
  const warnings: string[] = []

  let amountLuna: number | null = null
  const amountRaw = params.get('amount')
  if (amountRaw !== null) {
    amountLuna = parseAmountLuna(amountRaw)
    if (amountLuna === null) warnings.push(STAKE_AMOUNT_WARNING)
  }

  let validator: string | null = null
  const validatorRaw = params.get('validator')
  if (validatorRaw !== null) {
    const cleaned = cleanAddress(validatorRaw)
    if (isValidNimiqAddress(cleaned)) validator = cleaned
    else warnings.push(STAKE_VALIDATOR_WARNING)
  }

  return { amountLuna, validator, warnings }
}

/**
 * Builds the public share link. Invalid values are left out rather than
 * written into a link that the app would only drop again on open.
 */
export function buildStakeLink({ amountNim, validator }: StakeLinkParams = {}): string {
  const params = new URLSearchParams()

  if (amountNim !== undefined && amountNim !== null) {
    const raw = typeof amountNim === 'number' ? String(amountNim) : amountNim
    const luna = parseAmountLuna(raw)
    if (luna !== null) params.set('amount', formatLunaExact(String(luna)))
  }

  if (validator) {
    const cleaned = cleanAddress(validator)
    if (isValidNimiqAddress(cleaned)) params.set('validator', cleaned)
  }

  const query = params.toString()
  const route = query ? `#/stake?${query}` : '#/stake'
  return `${NIMBOOKS_SITE_URL}/${route}`
}
