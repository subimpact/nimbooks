// FIFO tax engine, adapted from nimiqtoolbox/nimiq-tax-dashboard (MIT).
import { classifyTx, timestampToMs, txLabel } from './chain'
import type { NimiqTx } from './chain'
import { getDailyNimPrices } from './statement'

export const LLAMA_PRICE_URL = 'https://coins.llama.fi/chart/coingecko:nimiq-2'

const PRICES_TAX_KEY = 'nimbooks:pricestax'
const PRICES_TAX_TTL = 24 * 60 * 60 * 1000 // 24h, daily closes are immutable history
// mirrors NIM_MAX_PLAUSIBLE_CLOSE_USD in statement.ts; local copy avoids a circular import
const MAX_PLAUSIBLE_NIM_USD = 0.02
const LLAMA_PAGES_MAX = 8 // safety cap, ~4000 days of history
const SPAN = 500
const NIM = 1e5 // Luna -> NIM

interface PriceCache {
  at: number
  prices: Record<string, number>
}

// Full (all-time) daily NIM closes. CoinGecko market_chart answers only the
// last 365 days, so the rest comes from DefiLlama's chart endpoint, paged
// backwards; llama wins per day where both cover it; any failure falls back to
// the CoinGecko 365-day map, never a throw. Cached 24h in localStorage.
export async function getAllDailyNimPrices(): Promise<Record<string, number>> {
  try {
    const raw = localStorage.getItem(PRICES_TAX_KEY)
    if (raw) {
      const entry = JSON.parse(raw) as PriceCache
      if (typeof entry?.at === 'number' && entry.prices && Date.now() - entry.at < PRICES_TAX_TTL) {
        return entry.prices
      }
    }
  } catch {
    /* corrupt cache, refetch */
  }

  // CoinGecko fallback: 365 days, may itself fail entirely (then {}).
  let coinGecko: Record<string, number> = {}
  try {
    coinGecko = await getDailyNimPrices()
  } catch {
    /* fall through, llama may still carry everything */
  }

  // Page llama backwards from a 500-day anchor. Each page stops where the
  // previous started minus a 10-day overlap, so no day straddles a page break.
  const llama: Record<string, number> = {}
  const todaySec = Math.floor(Date.now() / 1000)
  let start = todaySec - SPAN * 86400
  let priorEarliestDay: string | null = null

  for (let page = 0; page < LLAMA_PAGES_MAX; page++) {
    let json: unknown
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(`${LLAMA_PRICE_URL}?start=${start}&span=${SPAN}&period=1d`, {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Llama HTTP ${res.status}`)
      json = await res.json()
    } catch {
      break
    } finally {
      clearTimeout(timer)
    }

    const coins = (json as { coins?: Record<string, { prices?: unknown }> } | null)?.coins
    const points = coins?.['coingecko:nimiq-2']?.prices
    if (!Array.isArray(points) || points.length === 0) break
    let earliestTs = Infinity
    let pageEarliestDay: string | null = null
    for (const p of points as { timestamp?: unknown; price?: unknown }[]) {
      let ts = typeof p?.timestamp === 'number' ? p.timestamp : Number(p?.timestamp)
      if (ts > 1e12) ts /= 1000 // ms-scale value: DefiLlama changed units
      const price = typeof p?.price === 'number' ? p.price : Number(p?.price)
      if (!Number.isFinite(ts) || ts <= 0) continue
      // Same sanity clamp as statement.ts: NIM has never traded near a cent,
      // so anything at or above this is a wrong-id answer, not a rally.
      if (!Number.isFinite(price) || price > MAX_PLAUSIBLE_NIM_USD) continue
      if (ts < earliestTs) earliestTs = ts
      const day = new Date(ts * 1000).toISOString().slice(0, 10)
      if (pageEarliestDay === null || day < pageEarliestDay) pageEarliestDay = day
      // Later points on a day overwrite earlier ones, that day's close.
      llama[day] = price
    }

    // Stop when this page produced nothing earlier than what we already have:
    // a backwards walk never needs to re-read forward pages.
    if (pageEarliestDay === null) break
    if (priorEarliestDay !== null && pageEarliestDay >= priorEarliestDay) break
    priorEarliestDay = pageEarliestDay
    if (!Number.isFinite(earliestTs)) break
    start = Math.floor(earliestTs) - 10 * 86400
  }

  const merged: Record<string, number> = { ...coinGecko, ...llama }
  if (Object.keys(llama).length >= 300) {
    try {
      localStorage.setItem(PRICES_TAX_KEY, JSON.stringify({ at: Date.now(), prices: merged }))
    } catch {
      /* storage unavailable, serve from memory this session */
    }
  }
  return merged
}

export interface TaxLotRow {
  txHash: string
  date: string
  nim: number
  proceedsUsd: number | null
  costBasisUsd: number | null
  gainUsd: number | null
  direction: 'in' | 'out'
  synthetic?: string
}

export interface TaxYearSummary {
  year: string
  proceedsUsd: number
  costUsd: number
  gainUsd: number
  incomeUsd: number
  disposals: number
  incomplete: boolean
}

export interface TaxReport {
  rows: TaxLotRow[]
  incomeRows: TaxLotRow[]
  years: TaxYearSummary[]
  coverageStart: string | null
  missingPriceDays: number
  completeHistoryDays: number
  neutralAmbiguous: number
  unmatchedDisposals: number
}

function normAddr(a: string): string {
  return String(a ?? '').replace(/\s+/g, '').toUpperCase()
}

function dayOf(ts: number): string {
  // tx.timestamp may predate normalization: Nimiq 1.0 values are seconds.
  return new Date(timestampToMs(ts)).toISOString().slice(0, 10)
}

interface Lot {
  remaining: number // NIM
  costPer: number // USD per NIM at acquisition
}

interface YearAcc {
  year: string
  proceedsUsd: number
  costUsd: number
  gainUsd: number
  incomeUsd: number
  disposals: number
  unmatched: number
}

const CONTRACT_LABELS = new Set<string>(['swap', 'htlc', 'vesting'])

export function computeFifoGains(
  txs: NimiqTx[],
  ownAddress: string,
  prices: Record<string, number>
): TaxReport {
  const empty: TaxReport = {
    rows: [], incomeRows: [], years: [], coverageStart: null, missingPriceDays: 0,
    completeHistoryDays: 0, neutralAmbiguous: 0, unmatchedDisposals: 0,
  }
  try {
    return computeFifoGainsInner(txs, ownAddress, prices)
  } catch {
    // Pathological input never throws - degrade to the empty shape. The
    // guard itself must not throw: prices may be the pathological input.
    try {
      return { ...empty, completeHistoryDays: Object.keys(prices ?? {}).length }
    } catch {
      return empty
    }
  }
}

function computeFifoGainsInner(
  txs: NimiqTx[],
  ownAddress: string,
  prices: Record<string, number>
): TaxReport {
  const own = normAddr(ownAddress)
  const ownSet = new Set<string>([own])
  const isOwn = (a: string) => ownSet.has(normAddr(a))

  const valid = txs.filter((t) => {
    if (t.executionResult === false) return false
    return typeof t.timestamp === 'number' && Number.isFinite(t.timestamp)
  })

  // Earliest day the price history covers, and the first tx date - the gap
  // between them is what makes a year's figures incomplete.
  let coverageStart: string | null = null
  for (const day of Object.keys(prices)) {
    if (coverageStart === null || day < coverageStart) coverageStart = day
  }
  let firstTxDay: string | null = null
  for (const t of valid) {
    const day = dayOf(t.timestamp as number)
    if (firstTxDay === null || day < firstTxDay) firstTxDay = day
  }
  const coverageLate =
    firstTxDay !== null && (coverageStart === null || coverageStart > firstTxDay)

  // Sort oldest -> newest: FIFO needs acquisition order.
  const sorted = [...valid].sort(
    (a, b) => timestampToMs(a.timestamp as number) - timestampToMs(b.timestamp as number)
  )

  // Pre-pass over contract legs (HTLC / swap / vesting): per-contract running
  // balance. A fund leg (own -> contract) raises it; a resolve leg FROM the
  // contract lowers it. Balance > 0 at the end = still pending, so every leg
  // of that contract stays neutral (nothing has been disposed of yet).
  const balance = new Map<string, number>() // contract normAddr -> Luna
  const resolvedToOwn = new Set<string>()
  for (const t of sorted) {
    // A resolve leg reads as an ordinary transfer (its recipient is a basic
    // account), so walk contract machinery by the funded-address set too -
    // the sender being a contract we already funded makes it a contract leg.
    if (!CONTRACT_LABELS.has(txLabel(t, own)) && !balance.has(normAddr(t.sender))) continue
    const senderOwn = isOwn(t.sender)
    const recipientOwn = isOwn(t.recipient)
    const raw = Number(t.value)
    const luna = Number.isFinite(raw) ? raw : 0
    if (senderOwn && !recipientOwn) {
      const c = normAddr(t.recipient) // fund leg: contract = recipient
      if (c) balance.set(c, (balance.get(c) ?? 0) + luna)
    } else if (!senderOwn && recipientOwn) {
      const c = normAddr(t.sender) // recovery: contract = sender
      if (c) {
        balance.set(c, (balance.get(c) ?? 0) - luna)
        resolvedToOwn.add(c)
      }
    } else if (!senderOwn && !recipientOwn) {
      const c = normAddr(t.sender) // drain: contract = sender
      if (c) balance.set(c, (balance.get(c) ?? 0) - luna)
    }
  }

  const lots: Lot[] = []
  const rows: TaxLotRow[] = []
  const incomeRows: TaxLotRow[] = []
  const missingDays = new Set<string>()
  const yearAcc = new Map<string, YearAcc>()
  let neutralAmbiguous = 0
  let unmatchedDisposals = 0

  const priceAt = (day: string): number | null => {
    const p = prices[day]
    return typeof p === 'number' && Number.isFinite(p) ? p : null
  }

  const ensureYear = (day: string): YearAcc => {
    const year = day.slice(0, 4)
    let acc = yearAcc.get(year)
    if (!acc) {
      acc = { year, proceedsUsd: 0, costUsd: 0, gainUsd: 0, incomeUsd: 0, disposals: 0, unmatched: 0 }
      yearAcc.set(year, acc)
    }
    return acc
  }

  // Disposal: match lots oldest-first. Returns null when the queue was empty
  // (no lot coverage at all), otherwise { cost, matched } - matched < nim
  // means only part of the disposal found basis (the rest is unmatched: the
  // history lacks the lots, e.g. coins bought on an exchange before tracking).
  const matchFifo = (nim: number): { cost: number; matched: number } | null => {
    if (!lots.length) return null
    let cost = 0
    let matched = 0
    while (matched < nim && lots.length) {
      const lot = lots[0]
      const take = Math.min(nim - matched, lot.remaining)
      cost += take * lot.costPer
      lot.remaining -= take
      matched += take
      if (lot.remaining <= 1e-8) lots.shift()
    }
    return { cost, matched }
  }

  const pushDisposal = (t: NimiqTx, day: string, nim: number, price: number) => {
    const proceeds = nim * price
    const match = matchFifo(nim)
    const acc = ensureYear(day)
    acc.disposals += 1
    acc.proceedsUsd += proceeds
    if (match === null || match.matched < nim - 1e-8) {
      // No lot (or not enough of one) matched: proceed as far as the queue
      // goes, and say the coverage is incomplete rather than overstating
      // basis. A partial match books only the matched part's cost - the
      // remainder's basis is unknowable, never silently zero.
      const partial = match !== null && match.matched > 0
      unmatchedDisposals++
      acc.unmatched += 1
      const basis = partial ? match.cost : null
      if (partial) acc.costUsd += match.cost
      rows.push({
        txHash: t.hash, date: day, nim, proceedsUsd: proceeds,
        costBasisUsd: basis,
        gainUsd: partial ? proceeds - match.cost : null,
        direction: 'out',
      })
      if (partial) acc.gainUsd += proceeds - match.cost
    } else {
      acc.costUsd += match.cost
      acc.gainUsd += proceeds - match.cost
      rows.push({
        txHash: t.hash, date: day, nim, proceedsUsd: proceeds,
        costBasisUsd: match.cost, gainUsd: proceeds - match.cost, direction: 'out',
      })
    }
  }

  for (const t of sorted) {
    // Internal transfers move coins between our own addresses: no event.
    if (isOwn(t.sender) && isOwn(t.recipient)) continue

    const label = txLabel(t, own)
    const day = dayOf(t.timestamp as number)
    const raw = Number(t.value)
    const nim = Number.isFinite(raw) ? raw / NIM : NaN
    if (!Number.isFinite(nim) || nim <= 0) continue

    // Staking bucket moves: not taxable events, skip entirely.
    if (label === 'stake' || label === 'unstake') continue

    // Everything below needs the day's close; missing it means no lot and no
    // gain row for this tx, and the day counts against coverage.
    const price = priceAt(day)
    if (price === null) {
      missingDays.add(day)
      continue
    }

    // Contract legs - fund-flow model (see pre-pass above). The fund leg
    // carries toType 2 so its label names it; the resolve leg's recipient is
    // an ordinary account, so the label reads payment or unknown - identify
    // contract machinery by the sender being an address the wallet funded,
    // never by the leg's own account type.
    const senderContract = !isOwn(t.sender) && balance.has(normAddr(t.sender))
    if (CONTRACT_LABELS.has(label) || senderContract) {
      if (isOwn(t.sender)) continue // fund leg: disposal books on the drain leg
      if (isOwn(t.recipient)) continue // recovery to own: neutral
      const c = normAddr(t.sender)
      if (!c || (balance.get(c) ?? 0) > 0) continue // pending: all legs neutral
      if (!balance.has(c)) {
        // We never funded this contract: the drain's provenance is unknowable,
        // so neutral and counted as ambiguous.
        neutralAmbiguous++
        continue
      }
      pushDisposal(t, day, nim, price)
      continue
    }

    const kind = classifyTx(t, own)
    if (kind === 'fee') continue

    // Staking rewards: ordinary income at receipt, priced at that day's close,
    // and the receipt itself opens a cost-basis lot for later disposals.
    if (kind === 'reward') {
      lots.push({ remaining: nim, costPer: price })
      incomeRows.push({
        txHash: t.hash, date: day, nim, proceedsUsd: null, costBasisUsd: null,
        gainUsd: null, direction: 'in', synthetic: 'reward',
      })
      ensureYear(day).incomeUsd += nim * price
      continue
    }

    if (!isOwn(t.sender) && isOwn(t.recipient)) {
      // Acquisition.
      lots.push({ remaining: nim, costPer: price })
      rows.push({
        txHash: t.hash, date: day, nim, proceedsUsd: null,
        costBasisUsd: nim * price, gainUsd: null, direction: 'in',
      })
      continue
    }
    if (isOwn(t.sender) && !isOwn(t.recipient)) {
      pushDisposal(t, day, nim, price)
    }
  }

  const incompleteGlobal = coverageLate
  const years = [...yearAcc.values()]
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((acc) => ({
      year: acc.year,
      proceedsUsd: acc.proceedsUsd,
      costUsd: acc.costUsd,
      gainUsd: acc.gainUsd,
      incomeUsd: acc.incomeUsd,
      disposals: acc.disposals,
      incomplete:
        incompleteGlobal ||
        acc.unmatched > 0 ||
        [...missingDays].some((d) => d.startsWith(acc.year)),
    }))

  rows.sort((a, b) => a.date.localeCompare(b.date))
  incomeRows.sort((a, b) => a.date.localeCompare(b.date))

  return {
    rows,
    incomeRows,
    years,
    coverageStart,
    missingPriceDays: missingDays.size,
    completeHistoryDays: Object.keys(prices).length,
    neutralAmbiguous,
    unmatchedDisposals,
  }
}