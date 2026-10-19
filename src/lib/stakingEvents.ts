// Staking reward income (Nimiq Watch v2 events API)
//
// The v1 JSON-RPC index behind `getTransactionsByAddress` does not surface
// staking activity, so a staker's reward income is invisible in the plain tx
// history. The official wallet reads it from a second API instead: restaking
// events aggregated into 15-minute windows.
//
// Three properties of that endpoint shape everything below:
//
//   1. `to` is exclusive at 00:00 UTC and may not be in the future, so the
//      newest reward we can ever read is yesterday's last window. Reward rows
//      trail the live staker record by up to a day - by design, not a bug.
//   2. It returns one group per 15-minute window per validator: a full year
//      is ~1,400 groups (a few hundred KB), a busy year to date several tens
//      of thousands. Rendered raw that buries a real payment under ~100
//      reward rows a day and blows the localStorage quota, so
//      `rollUpRestakeRewards` collapses each UTC day into one row. The
//      statement aggregates by UTC day anyway, so the NIM totals are
//      identical either way.
//   3. Responses leak a row or two past the requested edges (the server
//      stitches ranges together), so every fetch keeps only the groups whose
//      own window falls inside its requested [from, to) - two neighbouring
//      ranges can therefore never count a window twice.
//
// Coverage: the public restake events go back to January 2025 (probed live
// 2026-10-19: the first group is 2025-01-02; earlier existence is unproven),
// so fetching is sliced into calendar chunks from the proof-of-stake launch
// day on: closed years are fetched once and cached for a week, the year to
// date for a day, and the running month for 10 minutes. Statements and the
// tax report read the full merged list, so a closed tax year's staking
// income is complete instead of just the last 90 days.
//
// Rewards are restaked: they compound into the staked balance and never land
// in the basic account. They are income when paid - which is what History and
// the statement report - but the balance trajectory in Analytics deliberately
// ignores them, since it reconstructs the *basic* balance.

import type { NimiqTx } from './chain'

const V2_API = 'https://v2.nimiqwatch.com/api/v2'

const DAY_MS = 86400000

/** The UTC day proof-of-stake mainnet launched - the earliest day worth asking for. */
export const REWARDS_FLOOR_DAY = '2024-11-19'

/** One 15-minute restaking window, exactly as the API returns it. */
export interface RestakeGroup {
  sender_address: string // validator that paid out
  time_window: string // ISO 8601 - start of the window (UTC)
  aggregated_value: number // Luna
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function dayStartMs(day: string): number {
  return Date.parse(day + 'T00:00:00Z')
}

// Result of one straight API call, with the failure surfaced: a chunk whose
// request failed must never be cached as if it had no rewards.
interface RestakeFetch {
  /** false on any failure path: network, non-2xx, malformed body. */
  ok: boolean
  groups: RestakeGroup[]
}

/**
 * One straight API call, reporting failure instead of swallowing it. Keeps
 * only groups whose window lands inside `[from, to)` (both cut at 00:00 UTC):
 * the API answers with the last window before `from` and the first at/after
 * `to` at its edges, and a caller whose ranges abut must not double-count
 * those rows.
 */
async function fetchRestakeGroups(
  address: string,
  fromMs: number,
  toMs: number
): Promise<RestakeFetch> {
  // The API rejects a `to` in the future and a `to` that is not after `from`.
  const from = utcDay(fromMs)
  const to = utcDay(Math.min(toMs, Date.now()))
  if (from >= to) return { ok: true, groups: [] }
  const lo = dayStartMs(from)
  const hi = dayStartMs(to)

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
    // `{ groups: [] }` means "no staker record" - a valid, complete answer.
    // Anything that is not a groups array is a malformed body: a failure.
    if (!Array.isArray(json?.groups)) return { ok: false, groups: [] }
    const groups = (json.groups as unknown[]).filter(
      (g: unknown): g is RestakeGroup =>
        !!g &&
        typeof (g as RestakeGroup).time_window === 'string' &&
        Number.isFinite(Number((g as RestakeGroup).aggregated_value))
    )
    return {
      ok: true,
      groups: groups.filter((g) => {
        const t = Date.parse(g.time_window)
        return Number.isFinite(t) && t >= lo && t < hi
      }),
    }
  } catch (e) {
    console.warn('fetchRestakeGroups failed:', e)
    return { ok: false, groups: [] }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Aggregated restaking reward events for a staker between two instants.
 *
 * Returns `[]` on every failure path (network, 400, malformed body): reward
 * rows are additive, and History must never break because a second API is
 * down. Non-stakers legitimately return `[]` too - the endpoint answers
 * `{ groups: [] }` for an address with no staker record. Callers that need to
 * tell a failure from an empty answer use `fetchRestakeGroups` instead.
 */
export async function getRestakeEvents(
  address: string,
  fromMs: number,
  toMs: number
): Promise<RestakeGroup[]> {
  return (await fetchRestakeGroups(address, fromMs, toMs)).groups
}

/**
 * Collapse 15-minute windows into one synthesized `NimiqTx` per UTC day per
 * validator, newest first. The rows carry `synthetic: 'reward'` so the chips,
 * the CSV `kind` column and the statement classify them without a hash lookup -
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
      // The day's last window - keeps the row inside its own UTC day, so the
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

// --- Cache (one slot per chunk, same entry shape as the tx cache in chain.ts)
//
// The rolled-up rows are cached rather than the raw groups: hundreds of small
// rows instead of megabytes of windows, which keeps a staker's full history
// well clear of the storage quota. A closed year barely changes, so it is
// fetched once and kept for a week; the running year changes daily and is
// kept for a day; the running month can gain windows at any moment and is
// kept for 10 minutes - the same short TTL the old 90-day cache used.

interface RestakeChunk {
  id: string // cache key suffix: a year YYYY, or 'ytd' / 'month'
  from: string // YYYY-MM-DD, inclusive at 00:00 UTC
  to: string // YYYY-MM-DD, exclusive at 00:00 UTC
  ttlMs: number // how long a fetch of this chunk stays fresh
}

const RESTAKE_CACHE_PREFIX = 'nimbooks:restake:'

interface RestakeCacheEntry {
  from: string
  to: string
  at: number
  txs: NimiqTx[]
}

/**
 * The fetch plan covering everything the public rewards data has: one chunk
 * per closed year since proof-of-stake launched, then the current year to
 * date, then the running month - contiguous, non-empty, oldest first.
 */
export function restakeChunks(now = Date.now()): RestakeChunk[] {
  const d = new Date(now)
  const year = d.getUTCFullYear()
  const floorYear = Number(REWARDS_FLOOR_DAY.slice(0, 4))
  const chunks: RestakeChunk[] = []
  for (let y = floorYear; y < year; y++) {
    chunks.push({
      id: String(y),
      from: y > floorYear ? `${y}-01-01` : REWARDS_FLOOR_DAY,
      to: `${y + 1}-01-01`,
      ttlMs: 7 * DAY_MS,
    })
  }
  const firstOfThisMonth = `${year}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  // Year to date, January 1 to the 1st of the current month. Empty in January
  // (and, in the floor year, before the launch day itself).
  const ytdFrom = year > floorYear ? `${year}-01-01` : REWARDS_FLOOR_DAY
  if (ytdFrom < firstOfThisMonth) {
    chunks.push({ id: 'ytd', from: ytdFrom, to: firstOfThisMonth, ttlMs: DAY_MS })
  }
  // The running month, its 1st to today - and empty on the 1st, when its
  // whole range is already the ytd chunk's.
  const today = utcDay(now)
  if (firstOfThisMonth < today) {
    chunks.push({ id: 'month', from: firstOfThisMonth, to: today, ttlMs: 10 * 60 * 1000 })
  }
  return chunks
}

function readRestakeCache(key: string): RestakeCacheEntry | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as RestakeCacheEntry
    if (
      !!entry &&
      typeof entry.from === 'string' &&
      typeof entry.to === 'string' &&
      Number.isFinite(entry.at) &&
      Array.isArray(entry.txs)
    ) {
      return entry
    }
  } catch {
    /* corrupt cache - refetch */
  }
  return null
}

function writeRestakeCache(key: string, entry: RestakeCacheEntry): void {
  try {
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    /* storage full - skip */
  }
}

/**
 * Every staking reward the public data has for an address, as History-shaped
 * rows: one per UTC day per validator, newest first, merged across the
 * calendar chunks of `restakeChunks`. Fresh chunks come straight from the
 * cache; stale or missing ones are fetched - all chunks concurrently, so a
 * cold open sends its requests at once instead of in a queue - and a successful fetch is
 * cached even when it answers empty (a non-staker's "no rewards" is real). A
 * chunk that fails to fetch is never cached and contributes only its expired
 * cached rows, if any - and `complete: false` so callers can say the total may
 * be short. Never throws.
 */
export async function getAllRestakeRewardTxs(
  address: string,
  now = Date.now()
): Promise<{ txs: NimiqTx[]; complete: boolean }> {
  const flat = address.replace(/\s+/g, '')
  const base = RESTAKE_CACHE_PREFIX + flat.toUpperCase()
  try {
    // The pre-1.30 cache had a single slot per address (no chunk suffix) for
    // a rolling 90-day window - dead once per-chunk caching exists.
    localStorage.removeItem(base)
  } catch {
    /* storage unavailable - nothing to clean */
  }

  // All stale or missing chunks resolve concurrently - the same per-chunk
  // logic the sequential walk had, just overlapping on the wire. Each chunk
  // reports whether it is trustworthy so `complete` survives the fan-out.
  const settled = await Promise.all(
    restakeChunks(now).map(async (chunk): Promise<{ rows: NimiqTx[]; ok: boolean }> => {
      const key = `${base}:${chunk.id}`
      const cached = readRestakeCache(key)
      const fresh =
        cached !== null &&
        cached.from === chunk.from &&
        cached.to === chunk.to &&
        now - cached.at < chunk.ttlMs
      if (fresh) return { rows: cached.txs, ok: true }
      const got = await fetchRestakeGroups(address, dayStartMs(chunk.from), dayStartMs(chunk.to))
      if (got.ok) {
        // Rows keep one UTC day per validator; the fetcher already trimmed
        // the edge leaks, so abutting chunks cannot share a row.
        const rows = rollUpRestakeRewards(got.groups, address)
        writeRestakeCache(key, { from: chunk.from, to: chunk.to, at: now, txs: rows })
        return { rows, ok: true }
      }
      // The fetch failed: keep the expired rows standing in rather than
      // dropping the period, and say the list is not the whole truth.
      if (cached !== null && Array.isArray(cached.txs)) return { rows: cached.txs, ok: false }
      return { rows: [], ok: false }
    })
  )

  // `Promise.all` yields in input order, so the merge keeps chunk order and
  // the final newest-first sort stays well-defined regardless of settle order.
  const merged: NimiqTx[] = []
  let complete = true
  for (const s of settled) {
    merged.push(...s.rows)
    if (!s.ok) complete = false
  }

  merged.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  return { txs: merged, complete }
}
