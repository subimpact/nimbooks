// Connected-wallet metrics shared by /api/track-connect (writes) and /api/stats
// (reads). A module, not an endpoint: files under functions/_lib are never routed.
//
// Honesty is the design constraint. The public numbers count only what this
// store recorded: no seed, no estimate. Unique wallets are recounted from the
// per-wallet records rather than trusted from a running total, so two connects
// racing on the summary can't lose a wallet.

export interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: { name: string }[]
    list_complete: boolean
    cursor?: string
  }>
}

export interface ConnectStats {
  /** Schema version: 2 = seed removed, wallets counted from records. */
  v: 2
  uniqueWallets: number
  /** Real-wallet visits (Pay + Hub). Sample-wallet sessions are kept apart. */
  totalConnections: number
  pay: number
  hub: number
  demo: number
  /** First day the tracker recorded a connect (UTC), shown beside the count. */
  since: string
  updatedAt: number
}

export const SUMMARY_KEY = 'stats:summary'
export const WALLET_PREFIX = 'wallet:'
/** The tracker went live in v1.23.0; the first record is from this day. */
export const COUNTING_SINCE = '2026-10-09'
/** A returning wallet counts as a new visit only after this much quiet. */
export const VISIT_WINDOW_MS = 30 * 60 * 1000

/**
 * The v1 summary started from hard-coded numbers that no connect ever made.
 * Kept only so a v1 summary can be corrected exactly, never added to anything.
 */
const V1_SEED = { uniqueWallets: 18, pay: 31, hub: 14 }

export function emptyStats(): ConnectStats {
  return { v: 2, uniqueWallets: 0, totalConnections: 0, pay: 0, hub: 0, demo: 0, since: COUNTING_SINCE, updatedAt: Date.now() }
}

function count(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * The stored summary, normalised to v2. A v1 summary has the seed subtracted;
 * its wallet count is approximate until the next connect recounts the records.
 */
export function parseStats(raw: string | null): ConnectStats {
  const stats = emptyStats()
  if (!raw) return stats
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    return stats
  }
  const v1 = parsed.v !== 2
  stats.pay = Math.max(0, count(parsed.pay) - (v1 ? V1_SEED.pay : 0))
  stats.hub = Math.max(0, count(parsed.hub) - (v1 ? V1_SEED.hub : 0))
  stats.demo = count(parsed.demo)
  stats.uniqueWallets = Math.max(0, count(parsed.uniqueWallets) - (v1 ? V1_SEED.uniqueWallets : 0))
  stats.totalConnections = stats.pay + stats.hub
  stats.updatedAt = count(parsed.updatedAt) || stats.updatedAt
  return stats
}

/** True until a summary has been written as v2 (absent, unreadable or seeded). */
export function needsRecount(raw: string | null): boolean {
  if (!raw) return true
  try {
    return JSON.parse(raw).v !== 2
  } catch {
    return true
  }
}

/** Hex SHA-256. Unchanged from v1, so existing wallet records still match. */
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** The record key for an address (or the literal "demo"). */
export async function walletKey(address: string): Promise<string> {
  return WALLET_PREFIX + (await sha256(address.replace(/\s+/g, '').toLowerCase()))
}

/**
 * A well-formed Nimiq user address: NQ + two check digits + 32 characters of
 * Nimiq's base32 alphabet, passing the IBAN mod-97 check. Rejecting anything
 * else keeps random strings out of the count; it can't prove the caller owns
 * the address, which a public counter never could.
 */
export function isNimiqAddress(address: string): boolean {
  const a = address.replace(/\s+/g, '').toUpperCase()
  if (!/^NQ[0-9]{2}[0-9A-HJ-NP-VXY]{32}$/.test(a)) return false
  const rearranged = a.slice(4) + a.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const digits = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

/**
 * Sample-wallet addresses, current and former (src/lib/demoData.ts). Their
 * records are the demo, not users.
 */
const SAMPLE_WALLET_ADDRESSES = ['NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR', 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX']

/** Real wallets on record: every wallet: key except the sample wallet's. */
export async function countWalletRecords(kv: KVNamespace): Promise<number> {
  const demoKeys = new Set([
    await walletKey('demo'),
    ...(await Promise.all(SAMPLE_WALLET_ADDRESSES.map((a) => walletKey(a)))),
  ])
  let total = 0
  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix: WALLET_PREFIX, cursor, limit: 1000 })
    total += page.keys.filter((k) => !demoKeys.has(k.name)).length
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return total
}
