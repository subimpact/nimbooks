// Staking reward income (Nimiq Watch v2 events API)
//
// The v1 JSON-RPC index behind `getTransactionsByAddress` does not surface
// staking activity, so a staker's reward income is invisible in the plain tx
// history. The official wallet reads it from a second API instead: restaking
// events aggregated into 15-minute windows.
//
// Two properties of that endpoint shape everything below:
//
//   1. `to` is exclusive at 00:00 UTC and may not be in the future, so the
//      newest reward we can ever read is yesterday's last window. Reward rows
//      trail the live staker record by up to a day — by design, not a bug.
//   2. It returns one group per 15-minute window per validator: 7,373 groups
//      (~1 MB) for 90 days on a 3.3 M NIM stake. Rendered raw that buries a
//      real payment under ~100 reward rows a day and blows the localStorage
//      quota, so `rollUpRestakeRewards` collapses each UTC day into one row.
//      The statement aggregates by UTC day anyway, so the NIM totals are
//      identical either way.
//
// Rewards are restaked: they compound into the staked balance and never land in
// the basic account. They are income when paid — which is what History and the
// statement report — but the balance trajectory in Analytics deliberately
// ignores them, since it reconstructs the *basic* balance.

import type { NimiqTx } from './chain'

const V2_API = 'https://v2.nimiqwatch.com/api/v2'

const DAY_MS = 86400000

/** One 15-minute restaking window, exactly as the API returns it. */
export interface RestakeGroup {
  sender_address: string // validator that paid out
  time_window: string // ISO 8601 — start of the window (UTC)
  aggregated_value: number // Luna
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Aggregated restaking reward events for a staker between two instants.
 *
 * Returns `[]` on every failure path (network, 400, malformed body): reward
 * rows are additive, and History must never break because a second API is
 * down. Non-stakers legitimately return `[]` too — the endpoint answers
 * `{ groups: [] }` for an address with no staker record.
 */
export async function getRestakeEvents(
  address: string,
  fromMs: number,
  toMs: number
): Promise<RestakeGroup[]> {
  // The API rejects a `to` in the future and a `to` that is not after `from`.
  const from = utcDay(fromMs)
  const to = utcDay(Math.min(toMs, Date.now()))
  if (from >= to) return []

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(
      `${V2_API}/staker/${encodeURIComponent(address.replace(/\s+/g, ''))}` +
        `/events/restake-grouped?from=${from}&to=${to}`,
      { signal: controller.signal }
    )
    if (!res.ok) throw new Error(`Restake events HTTP ${res.status}`)
    const json = await res.json()
    if (!Array.isArray(json?.groups)) return []
    return json.groups.filter(
      (g: unknown): g is RestakeGroup =>
        !!g &&
        typeof (g as RestakeGroup).time_window === 'string' &&
        Number.isFinite(Number((g as RestakeGroup).aggregated_value))
    )
  } catch (e) {
    console.warn('getRestakeEvents failed:', e)
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Collapse 15-minute windows into one synthesized `NimiqTx` per UTC day per
 * validator, newest first. The rows carry `synthetic: 'reward'` so the chips,
 * the CSV `kind` column and the statement classify them without a hash lookup —
 * they have no on-chain hash to look up.
 */
export function rollUpRestakeRewards(groups: RestakeGroup[], ownAddress: string): NimiqTx[] {
  const byDay = new Map<string, { validator: string; day: string; luna: number; ts: number }>()

  for (const g of groups) {
    const ts = Date.parse(g.time_window)
    if (!Number.isFinite(ts)) continue
    const luna = Number(g.aggregated_value)
    if (!Number.isFinite(luna) || luna <= 0) continue
    const validator = g.sender_address ?? ''
    const day = utcDay(ts)
    const key = `${day}|${validator.replace(/\s+/g, '').toUpperCase()}`
    const bucket = byDay.get(key)
    if (bucket) {
      bucket.luna += luna
      // The day's last window — keeps the row inside its own UTC day, so the
      // statement bills it against that day's close.
      if (ts > bucket.ts) bucket.ts = ts
    } else {
      byDay.set(key, { validator, day, luna, ts })
    }
  }

  return [...byDay.values()]
    .sort((a, b) => b.ts - a.ts)
    .map((b) => ({
      hash: `restake:${b.day}:${b.validator.replace(/\s+/g, '').toUpperCase()}`,
      sender: b.validator,
      recipient: ownAddress,
      value: String(Math.round(b.luna)),
      fee: '0',
      timestamp: b.ts,
      executionResult: true,
      toType: 0,
      synthetic: 'reward',
    }))
}

// --- Cache (10 min, same shape as the tx cache in chain.ts) ---
//
// The rolled-up rows are cached rather than the raw groups: ~10 KB instead of
// ~1 MB for the same 90 days, which keeps a staker's history well clear of the
// storage quota.

const RESTAKE_CACHE_PREFIX = 'nimbooks:restake:'
const RESTAKE_CACHE_TTL = 10 * 60 * 1000 // 10 min — rewards trail by a day anyway

interface RestakeCacheEntry {
  from: string
  to: string
  at: number
  txs: NimiqTx[]
}

function cacheKey(address: string): string {
  return RESTAKE_CACHE_PREFIX + address.replace(/\s+/g, '').toUpperCase()
}

/**
 * Staking rewards for an address as History-shaped rows, one per UTC day per
 * validator. Never throws and never returns stale rows for a different range.
 */
export async function getRestakeRewardTxs(
  address: string,
  fromMs: number,
  toMs: number
): Promise<NimiqTx[]> {
  const from = utcDay(fromMs)
  const to = utcDay(Math.min(toMs, Date.now()))
  const key = cacheKey(address)

  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const entry = JSON.parse(raw) as RestakeCacheEntry
      if (
        entry.from === from &&
        entry.to === to &&
        Date.now() - entry.at < RESTAKE_CACHE_TTL &&
        Array.isArray(entry.txs)
      ) {
        return entry.txs
      }
    }
  } catch {
    /* corrupt cache — refetch */
  }

  const txs = rollUpRestakeRewards(await getRestakeEvents(address, fromMs, toMs), address)
  try {
    localStorage.setItem(key, JSON.stringify({ from, to, at: Date.now(), txs } as RestakeCacheEntry))
  } catch {
    /* storage full — skip */
  }
  return txs
}

/** History range for reward rows: the last 90 days, matching the analytics cap. */
export const RESTAKE_WINDOW_DAYS = 90

export function restakeWindow(now = Date.now()): { fromMs: number; toMs: number } {
  return { fromMs: now - RESTAKE_WINDOW_DAYS * DAY_MS, toMs: now }
}
