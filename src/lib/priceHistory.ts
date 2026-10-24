// NIM price history for the beta sidebar's price card: one GET against
// DefiLlama's chart endpoint (already in the CSP connect-src), a 10 minute
// localStorage cache, and the pure maths the widget draws with (change over
// the window, an SVG sparkline path, donut segments for the NIM ring).
//
// Everything here is pure except getNimPriceHistory, which performs at most
// one request per call and never throws: the price card is decoration, and a
// price source outage must never take the sidebar down with it.

import { hasRate } from './chain'
import { LLAMA_PRICE_URL } from './tax'

export type PriceRange = '24h' | '7d'

export interface PricePoint {
  /** Unix ms. */
  t: number
  /** USD per NIM. */
  usd: number
}

export interface PriceHistory {
  points: PricePoint[]
  /** Unix ms the points were fetched at (cache write time). */
  fetchedAt: number
}

/** Cache entries younger than this are served without a request. */
export const HISTORY_FRESH_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
const CACHE_PREFIX = 'nimbooks:nim-history:'
/** DefiLlama's coin id for NIM; the URL shape lives in lib/tax.ts. */
export const HISTORY_URLS: Record<PriceRange, string> = {
  '24h': `${LLAMA_PRICE_URL}?span=24&period=1h`,
  '7d': `${LLAMA_PRICE_URL}?span=28&period=6h`,
}
const CACHE_KEYS: Record<PriceRange, string> = {
  '24h': `${CACHE_PREFIX}24h`,
  '7d': `${CACHE_PREFIX}7d`,
}

const cacheKey = (range: PriceRange) => CACHE_KEYS[range]

/** One point per row: a finite, strictly positive USD price at a finite time. */
function isPoint(value: unknown): value is PricePoint {
  if (!value || typeof value !== 'object') return false
  const p = value as { t?: unknown; usd?: unknown }
  return (
    typeof p.t === 'number' &&
    Number.isFinite(p.t) &&
    typeof p.usd === 'number' &&
    Number.isFinite(p.usd) &&
    p.usd > 0
  )
}

/** Ascending copy with junk rows dropped. */
function cleanPoints(points: unknown): PricePoint[] {
  if (!Array.isArray(points)) return []
  const out: PricePoint[] = []
  for (const p of points) if (isPoint(p)) out.push({ t: p.t, usd: p.usd })
  // Array.prototype.toSorted would be tidier, but this file also runs in the
  // node oracle where the runtime is not guaranteed to have ES2023 helpers.
  return out.sort((a, b) => a.t - b.t)
}

/**
 * DefiLlama chart JSON -> points. The response is
 * `{"coins":{"coingecko:nimiq-2":{"prices":[{"timestamp":<unix s>,"price":<usd>}]}}}`;
 * anything else (an error body, a rate-limit page, a renamed coin id) is [].
 */
export function parseLlamaChart(json: unknown): PricePoint[] {
  if (!json || typeof json !== 'object') return []
  const coins = (json as { coins?: unknown }).coins
  if (!coins || typeof coins !== 'object') return []
  const entry = (coins as Record<string, unknown>)['coingecko:nimiq-2']
  if (!entry || typeof entry !== 'object') return []
  const prices = (entry as { prices?: unknown }).prices
  if (!Array.isArray(prices)) return []
  const out: PricePoint[] = []
  for (const row of prices) {
    if (!row || typeof row !== 'object') continue
    const { timestamp, price } = row as { timestamp?: unknown; price?: unknown }
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
    // DefiLlama speaks unix seconds; the app speaks ms everywhere else.
    out.push({ t: timestamp * 1000, usd: price })
  }
  return out.sort((a, b) => a.t - b.t)
}

function readCache(range: PriceRange): PriceHistory | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(cacheKey(range))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; points?: unknown }
    if (typeof parsed.fetchedAt !== 'number' || !Number.isFinite(parsed.fetchedAt)) return null
    const points = cleanPoints(parsed.points)
    if (!points.length) return null
    return { points, fetchedAt: parsed.fetchedAt }
  } catch {
    return null
  }
}

function writeCache(range: PriceRange, value: PriceHistory): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(cacheKey(range), JSON.stringify(value))
  } catch {
    /* storage full or disabled: the next mount just fetches again */
  }
}

/**
 * The NIM/USD series for a range. A cache entry under 10 minutes old answers
 * without a request; a failed request falls back to a cached value at any age
 * (stale-on-failure), and to null when there is nothing cached. Never throws.
 */
export async function getNimPriceHistory(
  range: PriceRange,
  opts: { fetchImpl?: typeof fetch; now?: () => number } = {}
): Promise<PriceHistory | null> {
  const now = opts.now ?? (() => Date.now())
  const cached = readCache(range)
  if (cached && now() - cached.fetchedAt < HISTORY_FRESH_MS) return cached

  const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await doFetch(HISTORY_URLS[range], { signal: controller.signal })
    if (!res || !res.ok) return cached
    const points = parseLlamaChart(await res.json())
    if (points.length < 2) return cached
    const fresh: PriceHistory = { points, fetchedAt: now() }
    writeCache(range, fresh)
    return fresh
  } catch {
    return cached
  } finally {
    clearTimeout(timer)
  }
}

/** (last - first) / first, as a fraction; null with fewer than two points. */
export function changePct(points: PricePoint[]): number | null {
  const pts = cleanPoints(points)
  if (pts.length < 2) return null
  const first = pts[0].usd
  const last = pts[pts.length - 1].usd
  if (!hasRate(first)) return null
  return (last - first) / first
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * An SVG path (`M x y L x y ...`) scaled into a width x height box with `pad`
 * of breathing room, using the min-max of the data. Flat data draws a
 * horizontal line through the vertical middle. Never emits NaN; [] in, '' out.
 */
export function sparklinePath(
  points: PricePoint[],
  width: number,
  height: number,
  pad = 2
): string {
  const pts = cleanPoints(points)
  if (!pts.length || !(width > 0) || !(height > 0)) return ''
  const inset = Math.min(Math.max(pad, 0), Math.min(width, height) / 2)
  const innerW = width - inset * 2
  const innerH = height - inset * 2
  const middle = height / 2
  if (pts.length === 1 || innerW <= 0 || innerH <= 0) {
    return `M ${round2(inset)} ${round2(middle)} L ${round2(width - inset)} ${round2(middle)}`
  }
  let min = Infinity
  let max = -Infinity
  for (const p of pts) {
    if (p.usd < min) min = p.usd
    if (p.usd > max) max = p.usd
  }
  const flat = !(max > min)
  const x = (i: number) => inset + (i / (pts.length - 1)) * innerW
  const y = (usd: number) => (flat ? middle : inset + (1 - (usd - min) / (max - min)) * innerH)
  const steps = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round2(x(i))} ${round2(y(p.usd))}`)
  return steps.join(' ')
}

export interface RingSegment {
  key: string
  /** The part's size in Luna, as given (non-positive parts are dropped). */
  luna: number
  /** Share of the total in percent, one decimal, summing to exactly 100. */
  pct: number
  /** `stroke-dasharray` value for a circle of r=16. */
  dash: string
  /** `stroke-dashoffset` value for a circle of r=16. */
  offset: number
}

/** Circumference of the ring circle the widget draws (r = 16). */
export const RING_CIRCUMFERENCE = 2 * Math.PI * 16

/**
 * Donut segments for the "Where your NIM is" ring. Parts are kept in the
 * order given; zero (or unusable) parts are dropped and percentages are
 * rounded to one decimal with the largest-remainder method, so they always
 * add up to 100.0 (a 0.1 step, i.e. 1000 tenths). No parts, no total or a
 * single part still answers [] / 100.0 respectively.
 */
export function ringSegments(parts: Array<{ key: string; luna: number }>): RingSegment[] {
  const live = parts.filter(
    (p) => p && typeof p.key === 'string' && Number.isFinite(p.luna) && p.luna > 0
  )
  if (!live.length) return []
  const total = live.reduce((sum, p) => sum + p.luna, 0)
  if (!(total > 0)) return []
  // Work in tenths of a percent so the rounding is integer maths.
  const exact = live.map((p) => (p.luna / total) * 1000)
  const tenths = exact.map((v) => Math.floor(v))
  const remainders = exact.map((v, i) => ({ i, frac: v - tenths[i] }))
  let left = 1000 - tenths.reduce((a, b) => a + b, 0)
  // Largest remainder first; ties keep the given order (stable enough index).
  remainders.sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; k < remainders.length && left > 0; k++) {
    tenths[remainders[k].i] += 1
    left -= 1
  }
  // A last-resort distribution if anything still does not add up (it always
  // will: left is never negative because floor never overshoots).
  if (left > 0) tenths[0] += left

  let cursor = 0
  return live.map((p, i) => {
    const pct = tenths[i] / 10
    const isLast = i === live.length - 1
    const len = isLast
      ? RING_CIRCUMFERENCE - cursor
      : (tenths[i] / 1000) * RING_CIRCUMFERENCE
    const offset = -cursor
    cursor += len
    return {
      key: p.key,
      luna: p.luna,
      pct,
      dash: `${len} ${RING_CIRCUMFERENCE - len}`,
      offset,
    }
  })
}
