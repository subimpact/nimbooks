// Historical daily FX for tax reports.
//
// A tax report must value each transaction at the exchange rate of its own
// day. The live FX table only knows today, so this module fetches and caches
// the daily series for the currencies tax reports can use:
//
// - ECB reference rates via Frankfurter (api.frankfurter.dev), one keyless
//   request per calendar year touched by the report. Business days only, so
//   weekends and holidays use the most recent earlier business day (at most
//   7 days back).
// - currency-api dated snapshots on jsDelivr for the currencies Frankfurter
//   does not publish (aed ars clp ngn pkr rub twd uah vnd), one request per
//   distinct tax day, four at a time.
//
// Closed years and past days are immutable and cached with no TTL. The current
// year is cached for 12 hours. Nothing here throws: a failed fetch simply
// leaves those days without a historical rate, and the report then falls back
// to today's rate while counting the fallback.

export const FX_HISTORY_CACHE_PREFIX = 'nimbooks:fxhist:'
const CURRENT_YEAR_TTL = 12 * 60 * 60 * 1000
const FETCH_TIMEOUT = 10_000
const CURRENCY_API_CONCURRENCY = 4

// Frankfurter's supported ECB currencies.
const FRANKFURTER_CURRENCIES = new Set([
  'aud', 'brl', 'cad', 'chf', 'cny', 'czk', 'dkk', 'eur', 'gbp', 'hkd',
  'huf', 'idr', 'ils', 'inr', 'isk', 'jpy', 'krw', 'mxn', 'myr', 'nok',
  'nzd', 'php', 'pln', 'ron', 'sek', 'sgd', 'thb', 'try', 'usd', 'zar',
])

// Tax currencies Frankfurter has no ECB reference rate for.
const CURRENCY_API_CURRENCIES = new Set([
  'aed', 'ars', 'clp', 'ngn', 'pkr', 'rub', 'twd', 'uah', 'vnd',
])

export const FRANKFURTER_SOURCE = 'ECB reference rates via Frankfurter, daily'
export const CURRENCY_API_SOURCE = 'currency-api daily snapshots'
export const USD_FX_SOURCE = 'none (USD)'

export interface DailyFx {
  /** Units of `currency` one USD bought on that UTC day, or null if unknown. */
  rateFor(day: string): number | null
  source: string
  /** Number of requested days with no historical rate. */
  fallbackDays: number
  /** Today's rate when the fetched series covers today, otherwise null. */
  todayRate: number | null
}

/** A per-day rate resolver with optional metadata computeFifoGains can use. */
export type DailyFxRate = ((day: string) => number | null) & {
  todayRate?: number | null
  source?: string
  fallbackDays?: number
}

interface YearCache {
  at: number
  rates: Record<string, number>
  source?: string
}

interface DayCache {
  at: number
  rate: number
}

function todayDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`)
}

function shiftDay(day: string, offset: number): string {
  return new Date(dayMs(day) + offset * 86_400_000).toISOString().slice(0, 10)
}

function usableRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: serve this session from memory */
  }
}

async function fetchJson(url: string): Promise<any | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function usableYearCache(cache: YearCache | null, year: string, now: number): cache is YearCache {
  if (!cache || typeof cache.at !== 'number' || !cache.rates) return false
  const currentYear = String(new Date(now).getUTCFullYear())
  // Past years never change. The current year can still grow, so it is only
  // trusted for 12 hours.
  return year < currentYear || now - cache.at < CURRENT_YEAR_TTL
}

function usableDayCache(cache: DayCache | null, day: string, now: number): cache is DayCache {
  if (!cache || typeof cache.at !== 'number' || !usableRate(cache.rate)) return false
  // A past UTC day is settled history. Today's snapshot may still be revised,
  // so it gets the 12-hour current-year TTL.
  return day < todayDay(now) || now - cache.at < CURRENT_YEAR_TTL
}

async function loadFrankfurterYear(currency: string, year: string, now: number): Promise<Record<string, number>> {
  const key = `${FX_HISTORY_CACHE_PREFIX}frankfurter:${currency}:${year}`
  const cached = readCache<YearCache>(key)
  if (usableYearCache(cached, year, now)) return cached.rates

  const url =
    `https://api.frankfurter.dev/v1/${year}-01-01..${year}-12-31` +
    `?base=USD&symbols=${currency.toUpperCase()}`
  const json = await fetchJson(url)
  const rates: Record<string, number> = {}
  const body = json && typeof json === 'object' ? (json as { rates?: unknown }).rates : null
  if (body && typeof body === 'object') {
    for (const [day, row] of Object.entries(body as Record<string, unknown>)) {
      const value = row && typeof row === 'object'
        ? (row as Record<string, unknown>)[currency.toUpperCase()]
        : undefined
      if (usableRate(value)) rates[day] = value
    }
  }
  if (Object.keys(rates).length > 0) {
    writeCache(key, { at: now, rates, source: FRANKFURTER_SOURCE } satisfies YearCache)
  }
  return rates
}

async function loadCurrencyApiDay(currency: string, day: string, now: number): Promise<number | null> {
  const key = `${FX_HISTORY_CACHE_PREFIX}currency-api:${currency}:${day}`
  const cached = readCache<DayCache>(key)
  if (usableDayCache(cached, day, now)) return cached.rate

  const url =
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}` +
    '/v1/currencies/usd.min.json'
  const json = await fetchJson(url)
  const usd = json && typeof json === 'object' ? (json as { usd?: unknown }).usd : null
  const value = usd && typeof usd === 'object'
    ? (usd as Record<string, unknown>)[currency]
    : undefined
  if (!usableRate(value)) return null
  writeCache(key, { at: now, rate: value } satisfies DayCache)
  return value
}

/**
 * Daily USD -> currency rates for the given UTC days.
 *
 * One Frankfurter request per calendar year touched, or one currency-api
 * snapshot per distinct day for the currencies ECB does not publish. A day
 * whose fetch failed stays null; the caller decides how to fall back and
 * surfaces `fallbackDays` so the fallback is never silent.
 */
export async function getDailyFx(currency: string, days: string[]): Promise<DailyFx> {
  const cur = String(currency || '').toLowerCase()
  const uniqueDays = [...new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
  const now = Date.now()

  if (cur === 'usd') {
    const rateFor = (() => 1) as DailyFxRate
    rateFor.todayRate = 1
    rateFor.source = USD_FX_SOURCE
    rateFor.fallbackDays = 0
    return {
      rateFor,
      source: USD_FX_SOURCE,
      fallbackDays: 0,
      todayRate: 1,
    }
  }

  if (FRANKFURTER_CURRENCIES.has(cur)) {
    // 1 January is an ECB holiday, so a day in the first week of January may
    // need the previous year's last business day: fetch that year too.
    const yearSet = new Set(uniqueDays.map((d) => d.slice(0, 4)))
    for (const d of uniqueDays) {
      if (d.slice(5) <= '01-07') yearSet.add(String(Number(d.slice(0, 4)) - 1))
    }
    const years = [...yearSet].sort()
    const byYear = new Map<string, Record<string, number>>()
    await Promise.all(
      years.map(async (year) => {
        byYear.set(year, await loadFrankfurterYear(cur, year, now))
      })
    )

    // Weekends and holidays use the most recent earlier business day, at most
    // seven days back. The same lookup also covers a day before the report's
    // first fetched year if the caller asks for it.
    const rateFor = ((day: string): number | null => {
      for (let offset = 0; offset <= 7; offset++) {
        const d = shiftDay(day, -offset)
        const value = byYear.get(d.slice(0, 4))?.[d]
        if (usableRate(value)) return value
      }
      return null
    }) as DailyFxRate
    let fallbackDays = 0
    for (const day of uniqueDays) if (rateFor(day) === null) fallbackDays++
    const today = todayDay(now)
    const todayRate = rateFor(today)
    rateFor.todayRate = todayRate
    rateFor.source = FRANKFURTER_SOURCE
    rateFor.fallbackDays = fallbackDays

    return { rateFor, source: FRANKFURTER_SOURCE, fallbackDays, todayRate }
  }

  if (CURRENCY_API_CURRENCIES.has(cur)) {
    const rates = new Map<string, number>()
    const toFetch: string[] = []
    for (const day of uniqueDays) {
      const key = `${FX_HISTORY_CACHE_PREFIX}currency-api:${cur}:${day}`
      const cached = readCache<DayCache>(key)
      if (usableDayCache(cached, day, now)) {
        rates.set(day, cached.rate)
      } else {
        toFetch.push(day)
      }
    }

    // Four at a time, each with its own 10 s timeout. Distinct days only.
    let next = 0
    const worker = async () => {
      while (next < toFetch.length) {
        const day = toFetch[next++]
        const rate = await loadCurrencyApiDay(cur, day, now)
        if (rate !== null) rates.set(day, rate)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CURRENCY_API_CONCURRENCY, toFetch.length) }, () => worker())
    )

    const rateFor = ((day: string): number | null => rates.get(day) ?? null) as DailyFxRate
    let fallbackDays = 0
    for (const day of uniqueDays) if (rateFor(day) === null) fallbackDays++
    const today = todayDay(now)
    const todayRate = rateFor(today)
    rateFor.todayRate = todayRate
    rateFor.source = CURRENCY_API_SOURCE
    rateFor.fallbackDays = fallbackDays

    return {
      rateFor,
      source: CURRENCY_API_SOURCE,
      fallbackDays,
      todayRate,
    }
  }

  const rateFor = (() => null) as DailyFxRate
  rateFor.todayRate = null
  rateFor.source = 'unavailable'
  rateFor.fallbackDays = uniqueDays.length
  return {
    rateFor,
    source: 'unavailable',
    fallbackDays: uniqueDays.length,
    todayRate: null,
  }
}
