// Daily statement — the app's `src/lib/statement.ts` aggregation, Node-side.
//
// Methodology, unchanged from the app (and stated on every sheet it prints):
// - All times are UTC; "day" = UTC calendar day.
// - Failed/reverted transactions are excluded (executionResult === false).
// - Fees are counted on outgoing transactions only (sender pays).
// - USD values use the CoinGecko daily close for the transaction's UTC day
//   (last price point observed on that day). Past prices are never restated.
// - Rewards (validator payouts) are split out of received for stakers.
//
// One deliberate difference: the app fetches `market_chart?days=365`, because
// the phone only ever shows the last year. A statement here can be asked for
// 2024, so this uses `market_chart/range` over the requested year instead.
// Same endpoint family, same "last point on the UTC day wins" close rule —
// only the window moves.

import { classifyTx, cleanAddress, ToolError, type NimiqTx } from './chain.ts'

const COINGECKO_RANGE =
  'https://api.coingecko.com/api/v3/coins/nimiq-2/market_chart/range?vs_currency=usd'

// Upper bound on a plausible daily NIM close, the same wrong-id guard the app
// runs: a close above 2¢ means CoinGecko answered for the retired NIM 1.0 id,
// and a statement priced at 72× is worse than one with a gap.
const NIM_MAX_PLAUSIBLE_CLOSE_USD = 0.02

// CoinGecko serves daily points only for ranges wider than 90 days; narrower
// ones come back hourly, which would make a one-month statement close on a
// different point than a year's would. Asking for a wider window and throwing
// the surplus away keeps every row on the same basis.
const MIN_RANGE_DAYS = 95
const DAY_MS = 86400000

// CoinGecko's public API serves at most the last 365 days of history; older
// windows come back as an error, not as data. The app has the same ceiling (it
// asks for `days=365`), so this is a limit of the free price source, not of the
// aggregation — but a statement whose USD column is empty has to say why rather
// than leave an accountant guessing.
const PRICE_HISTORY_DAYS = 365

export function priceCoverageNote(fromMs: number, now: number): string | null {
  if (fromMs >= now - PRICE_HISTORY_DAYS * DAY_MS) return null
  return (
    `CoinGecko's public API only serves the last ${PRICE_HISTORY_DAYS} days of ` +
    `prices, and this period starts before that — the NIM figures are exact, but ` +
    `the USD columns for those days cannot be filled from a free price source. ` +
    `(The NimBooks app has the same ceiling.)`
  )
}

export interface DailyRow {
  date: string // YYYY-MM-DD (UTC)
  inNim: number
  outNim: number
  feeNim: number
  rewardsNim: number
  netNim: number
  closeUsd: number | null
  inUsd: number | null
  outUsd: number | null
  txCount: number
}

export interface StatementResult {
  period: string
  rows: DailyRow[]
  totals: {
    inNim: number
    outNim: number
    feeNim: number
    rewardsNim: number
    netNim: number
    inUsd: number | null
    outUsd: number | null
    txCount: number
    daysActive: number
  }
  basis: string
  pricesMissing: number
}

/**
 * Daily NIM closes (UTC) covering `[fromMs, toMs]`. Best effort on the price
 * side: if CoinGecko is unreachable or rate-limited the statement still comes
 * out, with `closeUsd: null` on every row — a statement with a price gap is
 * useful, a statement that failed to render is not.
 */
export async function getDailyCloses(fromMs: number, toMs: number): Promise<Record<string, number>> {
  const span = toMs - fromMs
  const from = span < MIN_RANGE_DAYS * DAY_MS ? toMs - MIN_RANGE_DAYS * DAY_MS : fromMs
  const url = `${COINGECKO_RANGE}&from=${Math.floor(from / 1000)}&to=${Math.ceil(toMs / 1000)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const json = (await res.json()) as any
    const prices: Record<string, number> = {}
    for (const point of json?.prices ?? []) {
      const ms = point?.[0]
      const price = point?.[1]
      if (typeof ms !== 'number' || typeof price !== 'number' || !Number.isFinite(price)) continue
      if (price > NIM_MAX_PLAUSIBLE_CLOSE_USD) continue
      // Later entries on the same UTC day overwrite earlier ones → the day's
      // last observed price (the "close").
      prices[new Date(ms).toISOString().slice(0, 10)] = price
    }
    return prices
  } catch {
    return {}
  } finally {
    clearTimeout(timer)
  }
}

/** UTC bounds of a calendar year, or of one month inside it. */
export function periodBounds(year: number, month?: number): { from: number; to: number; label: string } {
  if (!Number.isInteger(year) || year < 2018 || year > 2100) {
    throw new ToolError(`"${year}" is not a year this can report on (2018–2100).`)
  }
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new ToolError(`"${month}" is not a month (1–12).`)
  }
  const from = month ? Date.UTC(year, month - 1, 1) : Date.UTC(year, 0, 1)
  const to = month ? Date.UTC(year, month, 1) - 1 : Date.UTC(year + 1, 0, 1) - 1
  const label = month ? `${year}-${String(month).padStart(2, '0')}` : String(year)
  return { from, to, label }
}

/**
 * Per-day aggregation over the window. Mirrors the app's `computeStatement`:
 * same exclusions, same sender-pays-fee rule, same rewards split, same
 * all-or-nothing USD totals (a single missing close leaves the totals null
 * rather than quietly summing a partial year).
 */
export function computeStatement(
  txs: NimiqTx[],
  ownAddress: string,
  bounds: { from: number; to: number; label: string },
  prices: Record<string, number>
): StatementResult {
  const own = cleanAddress(ownAddress).toUpperCase()
  const dayMap = new Map<string, DailyRow>()
  const ordered: string[] = []

  for (const t of txs) {
    if (t.executionResult === false) continue
    if (typeof t.timestamp !== 'number' || !Number.isFinite(t.timestamp)) continue
    if (t.timestamp < bounds.from || t.timestamp > bounds.to) continue
    const day = new Date(t.timestamp).toISOString().slice(0, 10)

    let row = dayMap.get(day)
    if (!row) {
      row = {
        date: day,
        inNim: 0,
        outNim: 0,
        feeNim: 0,
        rewardsNim: 0,
        netNim: 0,
        closeUsd: null,
        inUsd: null,
        outUsd: null,
        txCount: 0,
      }
      dayMap.set(day, row)
      ordered.push(day)
    }
    row.txCount += 1

    const isOut = t.sender.replace(/\s+/g, '').toUpperCase() === own
    const value = Number(t.value) / 100000
    const fee = Number(t.fee) / 100000
    const kind = classifyTx(t, own)

    if (isOut) {
      row.outNim += Number.isFinite(value) ? value : 0
      row.feeNim += Number.isFinite(fee) ? fee : 0
    } else {
      row.inNim += Number.isFinite(value) ? value : 0
      if (kind === 'reward') row.rewardsNim += Number.isFinite(value) ? value : 0
    }
  }

  const totals = {
    inNim: 0,
    outNim: 0,
    feeNim: 0,
    rewardsNim: 0,
    netNim: 0,
    inUsd: null as number | null,
    outUsd: null as number | null,
    txCount: 0,
    daysActive: 0,
  }
  let usdAvailable = true
  let pricesMissing = 0

  const rows = [...ordered].sort().map((day) => {
    const row = dayMap.get(day)!
    row.netNim = row.inNim - row.outNim - row.feeNim
    row.closeUsd = prices[day] ?? null
    if (row.closeUsd === null) {
      usdAvailable = false
      pricesMissing++
    }
    row.inUsd = row.closeUsd !== null ? row.inNim * row.closeUsd : null
    row.outUsd = row.closeUsd !== null ? row.outNim * row.closeUsd : null

    totals.inNim += row.inNim
    totals.outNim += row.outNim
    totals.feeNim += row.feeNim
    totals.rewardsNim += row.rewardsNim
    totals.netNim += row.netNim
    totals.inUsd = totals.inUsd !== null && row.inUsd !== null ? totals.inUsd + row.inUsd : row.inUsd
    totals.outUsd =
      totals.outUsd !== null && row.outUsd !== null ? totals.outUsd + row.outUsd : row.outUsd
    totals.txCount += row.txCount
    totals.daysActive += 1
    return row
  })

  if (!usdAvailable) {
    totals.inUsd = null
    totals.outUsd = null
  }

  return {
    period: bounds.label,
    rows,
    totals,
    basis: 'Daily CoinGecko close (UTC), USD. Fees counted on outgoing transactions only.',
    pricesMissing,
  }
}
