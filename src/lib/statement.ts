// Tax-year statement: daily closes at CoinGecko UTC price, per-day aggregation.
//
// Methodology (accountant-safe, stated on the sheet):
// - All times are UTC; "day" = UTC calendar day.
// - Failed/reverted transactions are excluded (executionResult === false).
// - Fees are counted on outgoing transactions only (sender pays).
// - USD values use the CoinGecko daily close for the transaction's UTC day
//   (last price point observed on that day). Past prices are never restated —
//   this is a daily-close basis, not a "value today" basis.
// - Rewards (validator payouts) are split out of received for stakers.

import { classifyTx } from './chain'
import type { NimiqTx } from './chain'

export interface DailyRow {
  date: string // YYYY-MM-DD (UTC)
  receivedNim: number
  sentNim: number
  rewardsNim: number
  feeNim: number
  netNim: number
  closeUsd: number | null
  receivedUsd: number | null
  sentUsd: number | null
  netUsd: number | null
  txCount: number
}

export interface StatementTotals {
  receivedNim: number
  sentNim: number
  rewardsNim: number
  feeNim: number
  netNim: number
  receivedUsd: number | null
  sentUsd: number | null
  netUsd: number | null
  txCount: number
  daysActive: number
}

export interface Statement {
  period: string
  generatedAt: string
  rows: DailyRow[]
  totals: StatementTotals
}

const PRICES_KEY = 'nimbooks:prices365'
const PRICES_TTL = 12 * 60 * 60 * 1000 // 12h — daily closes don't move every minute

interface PriceCache {
  at: number
  prices: Record<string, number>
}

// CoinGecko market_chart: 366 daily points, 1 request (~39KB) — the plan's
// verified cheap call. Cached for 12h in localStorage.
export async function getDailyNimPrices(): Promise<Record<string, number>> {
  try {
    const cached: PriceCache | null = JSON.parse(localStorage.getItem(PRICES_KEY) ?? 'null')
    if (cached && typeof cached.at === 'number' && Date.now() - cached.at < PRICES_TTL && cached.prices) {
      return cached.prices
    }
  } catch {
    /* corrupt cache — refetch */
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/nimiq-2/market_chart?vs_currency=usd&days=365',
      { signal: controller.signal }
    )
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const json = await res.json()
    const prices: Record<string, number> = {}
    for (const point of json?.prices ?? []) {
      const ms = point?.[0]
      const price = point?.[1]
      if (typeof ms !== 'number' || typeof price !== 'number' || !Number.isFinite(price)) continue
      // Later entries on the same UTC day overwrite earlier ones → the day's
      // last observed price (the "close").
      prices[new Date(ms).toISOString().slice(0, 10)] = price
    }
    if (Object.keys(prices).length === 0) throw new Error('No price history returned')
    try {
      localStorage.setItem(PRICES_KEY, JSON.stringify({ at: Date.now(), prices }))
    } catch {
      /* storage unavailable */
    }
    return prices
  } finally {
    clearTimeout(timer)
  }
}

export function availableStatementYears(txs: NimiqTx[]): string[] {
  const years = new Set<string>()
  for (const t of txs) {
    if (typeof t.timestamp !== 'number' || !Number.isFinite(t.timestamp)) continue
    years.add(new Date(t.timestamp).getUTCFullYear().toString())
  }
  return [...years].sort().reverse()
}

export function computeStatement(
  txs: NimiqTx[],
  ownAddress: string,
  period: string, // 'all' or 'YYYY'
  prices: Record<string, number>
): Statement {
  const own = ownAddress.replace(/\s+/g, '').toUpperCase()
  const dayMap = new Map<string, DailyRow>()

  const ensure = (day: string): DailyRow => {
    let row = dayMap.get(day)
    if (!row) {
      row = {
        date: day,
        receivedNim: 0,
        sentNim: 0,
        rewardsNim: 0,
        feeNim: 0,
        netNim: 0,
        closeUsd: null,
        receivedUsd: null,
        sentUsd: null,
        netUsd: null,
        txCount: 0,
      }
      dayMap.set(day, row)
    }
    return row
  }
  // Deterministic row order — no Map iteration-order surprises
  const ordered: string[] = []

  for (const t of txs) {
    if (t.executionResult === false) continue
    if (typeof t.timestamp !== 'number' || !Number.isFinite(t.timestamp)) continue
    const day = new Date(t.timestamp).toISOString().slice(0, 10)
    if (period !== 'all' && !day.startsWith(period)) continue

    let row = dayMap.get(day)
    if (!row) {
      row = ensure(day)
      ordered.push(day)
    }
    row.txCount += 1

    const isOut = t.sender.replace(/\s+/g, '').toUpperCase() === own
    const value = Number(t.value) / 100000
    const fee = Number(t.fee) / 100000
    const kind = classifyTx(t, own)

    if (isOut) {
      row.sentNim += Number.isFinite(value) ? value : 0
      row.feeNim += Number.isFinite(fee) ? fee : 0
    } else {
      row.receivedNim += Number.isFinite(value) ? value : 0
      if (kind === 'reward') row.rewardsNim += Number.isFinite(value) ? value : 0
    }
  }

  const totals: StatementTotals = {
    receivedNim: 0,
    sentNim: 0,
    rewardsNim: 0,
    feeNim: 0,
    netNim: 0,
    receivedUsd: null,
    sentUsd: null,
    netUsd: null,
    txCount: 0,
    daysActive: 0,
  }
  let usdAvailable = true

  for (const day of ordered.sort()) {
    const row = dayMap.get(day)!
    row.netNim = row.receivedNim - row.sentNim - row.feeNim
    row.closeUsd = prices[day] ?? null
    if (row.closeUsd === null) usdAvailable = false
    row.receivedUsd = row.closeUsd !== null ? row.receivedNim * row.closeUsd : null
    row.sentUsd = row.closeUsd !== null ? row.sentNim * row.closeUsd : null
    row.netUsd = row.closeUsd !== null ? row.netNim * row.closeUsd : null

    totals.receivedNim += row.receivedNim
    totals.sentNim += row.sentNim
    totals.rewardsNim += row.rewardsNim
    totals.feeNim += row.feeNim
    totals.netNim += row.netNim
    totals.receivedUsd =
      totals.receivedUsd !== null && row.receivedUsd !== null
        ? totals.receivedUsd + row.receivedUsd
        : row.receivedUsd
    totals.sentUsd = totals.sentUsd !== null && row.sentUsd !== null ? totals.sentUsd + row.sentUsd : row.sentUsd
    totals.netUsd = totals.netUsd !== null && row.netUsd !== null ? totals.netUsd + row.netUsd : row.netUsd
    totals.txCount += row.txCount
    totals.daysActive += 1
  }
  if (!usdAvailable) {
    totals.receivedUsd = null
    totals.sentUsd = null
    totals.netUsd = null
  }

  return {
    period: period === 'all' ? 'All time' : `Year ${period}`,
    generatedAt: new Date().toISOString(),
    rows: ordered.map((d) => dayMap.get(d)!),
    totals,
  }
}

export function buildStatementCsv(s: Statement, address: string): string {
  const fmt = (n: number | null, digits = 6) => {
    if (n === null) return ''
    return n.toFixed(digits)
  }
  const rows: (string | number)[][] = [
    ['NimBooks statement'],
    [`Address`, address],
    [`Period`, s.period],
    [`Generated (UTC)`, s.generatedAt],
    [`Basis`, 'Daily CoinGecko close (UTC), USD'],
    [],
    [
      'date',
      'receivedNIM',
      'sentNIM',
      'rewardsNIM',
      'feeNIM',
      'netNIM',
      'closeUSD',
      'receivedUSD',
      'sentUSD',
      'netUSD',
      'txCount',
    ],
    ...s.rows.map((r) => [
      r.date,
      r.receivedNim.toFixed(5),
      r.sentNim.toFixed(5),
      r.rewardsNim.toFixed(5),
      r.feeNim.toFixed(5),
      r.netNim.toFixed(5),
      fmt(r.closeUsd, 8),
      fmt(r.receivedUsd),
      fmt(r.sentUsd),
      fmt(r.netUsd),
      r.txCount,
    ]),
    [],
    [
      'TOTAL',
      s.totals.receivedNim.toFixed(5),
      s.totals.sentNim.toFixed(5),
      s.totals.rewardsNim.toFixed(5),
      s.totals.feeNim.toFixed(5),
      s.totals.netNim.toFixed(5),
      '',
      fmt(s.totals.receivedUsd),
      fmt(s.totals.sentUsd),
      fmt(s.totals.netUsd),
      s.totals.txCount,
    ],
  ]
  const escape = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`
  return (
    '\uFEFF' + rows.filter((r) => r.length > 0).map((r) => r.map(escape).join(',')).join('\n')
  )
}
