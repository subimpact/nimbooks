// Tax-tool CSV formats adapted from nimiqtoolbox/nimiq-tax-dashboard (MIT).

import type { TaxLotRow, TaxYearSummary, TaxReport } from './tax'

export type TaxFormat = 'koinly' | 'cointracking' | 'cryptotaxcalculator'

export const TAX_FORMAT_LABELS: Record<TaxFormat, string> = {
  koinly: 'Koinly',
  cointracking: 'CoinTracking',
  cryptotaxcalculator: 'CryptoTaxCalculator',
}

const NIM = 'NIM'
const USD = 'USD'

// --- helpers ported from export.js --------------------------------------

// Quote only when the value needs it (comma, quote, or newline inside).
function toCsv<T extends Record<string, string | number>>(rows: T[], headers: string[]): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return ''
    const s = v.toString()
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }
  const lines: string[] = []
  lines.push(headers.join(','))
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h])).join(','))
  }
  return lines.join('\n')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// UTC "YYYY-MM-DD HH:MM:SS" (+ optional suffix, e.g. " UTC" for Koinly).
// TaxLotRow carries a UTC calendar day, so the time component is midnight.
function dateUTC(day: string, suffix = ''): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return `${day}${suffix}`
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}${suffix}`
  )
}

// Luna-derived NIM has at most 5 decimals; render exactly, trimming trailing
// zeros for compactness.
function fmtNim(n: number): string {
  let s = (n || 0).toFixed(5)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

function usdStr(u: number | null): string {
  return u != null ? u.toFixed(2) : ''
}

// Tax category the three builders key off. Staking rewards are income; the
// disposal/acquisition rows carry their own direction.
function taxCat(r: TaxLotRow): 'income' | 'in' | 'out' {
  return r.synthetic === 'reward' ? 'income' : r.direction
}

// Fair USD value of the row. Disposals: proceeds; acquisitions: cost basis at
// the day's close; rewards: all price fields are null on the row (the engine
// books income per year), so blank. A row missing its price keeps its place
// with blank USD columns rather than being dropped: an omitted row would
// silently understate, and the report's incomplete flag warns separately.
function rowUsd(r: TaxLotRow): number | null {
  if (taxCat(r) === 'in') return r.costBasisUsd ?? r.proceedsUsd
  return r.proceedsUsd ?? r.costBasisUsd
}

function describe(r: TaxLotRow): string {
  const cat = taxCat(r)
  if (cat === 'income') return 'Staking reward'
  return cat === 'in' ? 'Received NIM' : 'Sent NIM'
}

// For formats without a dedicated fiat-value column, fold the USD value into
// the description so "value in USD" is present in every export.
function descWithUsd(r: TaxLotRow): string {
  const base = describe(r)
  const usd = rowUsd(r)
  return usd != null ? `${base} · $${usd.toFixed(2)} USD` : base
}

// Lot rows carry no fee leg, so fee columns stay blank (only a sender pays,
// and disposal-level fees are outside the FIFO lot model here).
function feeIfSent(): string {
  return ''
}

function txFeed(rows: TaxLotRow[], incomeRows: TaxLotRow[]): TaxLotRow[] {
  return [...rows, ...incomeRows]
}

// --- Koinly custom CSV ---------------------------------------------------
// Direction via Sent/Received, fiat value in Net Worth, staking income label.
// Ref: https://help.koinly.io/en/articles/3662999-how-to-create-a-custom-csv-file-with-your-data
const KOINLY_HEADERS = [
  'Date', 'Sent Amount', 'Sent Currency', 'Received Amount', 'Received Currency',
  'Fee Amount', 'Fee Currency', 'Net Worth Amount', 'Net Worth Currency', 'Label', 'Description', 'TxHash',
]

function koinlyCsv(feed: TaxLotRow[]): string {
  return toCsv(
    feed.map((r) => {
      const inn = taxCat(r) !== 'out'
      const fee = feeIfSent()
      const usd = rowUsd(r)
      return {
        'Date': dateUTC(r.date, ' UTC'),
        'Sent Amount': inn ? '' : fmtNim(r.nim),
        'Sent Currency': inn ? '' : NIM,
        'Received Amount': inn ? fmtNim(r.nim) : '',
        'Received Currency': inn ? NIM : '',
        'Fee Amount': fee,
        'Fee Currency': fee ? NIM : '',
        'Net Worth Amount': usdStr(usd),
        'Net Worth Currency': usd != null ? USD : '',
        'Label': taxCat(r) === 'income' ? 'staking' : '',
        'Description': describe(r),
        'TxHash': r.txHash || '',
      }
    }),
    KOINLY_HEADERS
  )
}

// --- CoinTracking custom CSV ---------------------------------------------
// Buy = received, Sell = sent; fiat in "…Value in Account Currency".
const CT_HEADERS = [
  'Type', 'Buy Amount', 'Buy Currency', 'Sell Amount', 'Sell Currency', 'Fee', 'Fee Currency',
  'Exchange', 'Trade-Group', 'Comment', 'Date', 'Tx-ID', 'Buy Value in Account Currency', 'Sell Value in Account Currency',
]

function cointrackingCsv(feed: TaxLotRow[]): string {
  return toCsv(
    feed.map((r) => {
      const inn = taxCat(r) !== 'out'
      const fee = feeIfSent()
      const usd = rowUsd(r)
      return {
        'Type': taxCat(r) === 'income' ? 'Staking' : inn ? 'Deposit' : 'Withdrawal',
        'Buy Amount': inn ? fmtNim(r.nim) : '',
        'Buy Currency': inn ? NIM : '',
        'Sell Amount': inn ? '' : fmtNim(r.nim),
        'Sell Currency': inn ? '' : NIM,
        'Fee': fee,
        'Fee Currency': fee ? NIM : '',
        'Exchange': 'Nimiq',
        'Trade-Group': '',
        'Comment': describe(r),
        'Date': dateUTC(r.date),
        'Tx-ID': r.txHash || '',
        'Buy Value in Account Currency': inn ? usdStr(usd) : '',
        'Sell Value in Account Currency': inn ? '' : usdStr(usd),
      }
    }),
    CT_HEADERS
  )
}

// --- CryptoTaxCalculator advanced CSV ------------------------------------
// Single-asset movements as transfer-in/out (+ staking income).
const CALC_HEADERS = [
  'Timestamp (UTC)', 'Type', 'Base Currency (Optional)', 'Base Amount (Optional)',
  'Quote Currency (Optional)', 'Quote Amount (Optional)', 'Fee Currency (Optional)', 'Fee Amount (Optional)',
  'From (Optional)', 'To (Optional)', 'ID (Optional)', 'Description (Optional)',
]

function calculatorCsv(feed: TaxLotRow[], ownAddress: string): string {
  return toCsv(
    feed.map((r) => {
      const inn = taxCat(r) !== 'out'
      const fee = feeIfSent()
      return {
        'Timestamp (UTC)': dateUTC(r.date),
        'Type': taxCat(r) === 'income' ? 'staking' : inn ? 'transfer-in' : 'transfer-out',
        'Base Currency (Optional)': NIM,
        'Base Amount (Optional)': fmtNim(r.nim),
        'Quote Currency (Optional)': '',
        'Quote Amount (Optional)': '',
        'Fee Currency (Optional)': fee ? NIM : '',
        'Fee Amount (Optional)': fee,
        'From (Optional)': inn ? '' : ownAddress,
        'To (Optional)': inn ? ownAddress : '',
        'ID (Optional)': r.txHash || '',
        'Description (Optional)': descWithUsd(r),
      }
    }),
    CALC_HEADERS
  )
}

// --- public builders ------------------------------------------------------

export function buildTaxTransactionsCsv(
  format: TaxFormat,
  rows: TaxLotRow[],
  incomeRows: TaxLotRow[],
  address: string
): string {
  const feed = txFeed(rows, incomeRows)
  const csv =
    format === 'koinly'
      ? koinlyCsv(feed)
      : format === 'cointracking'
        ? cointrackingCsv(feed)
        : calculatorCsv(feed, address)
  return '\uFEFF' + csv
}

export function buildTaxSummaryCsv(report: TaxReport, address: string): string {
  const generatedAt = new Date().toISOString()
  const years = [...report.years].sort((a, b) => a.year.localeCompare(b.year))
  const escape = (c: string | number): string => `"${String(c).replace(/"/g, '""')}"`
  const body: (string | number)[][] = [
    [
      'Year', 'Proceeds USD', 'Cost Basis USD', 'Capital Gain USD', 'Staking Income USD',
      'Disposals', 'Incomplete', 'Address', 'Generated (UTC)',
    ],
    ...years.map((y: TaxYearSummary) => [
      y.year,
      usdStr(y.proceedsUsd),
      usdStr(y.costUsd),
      usdStr(y.gainUsd),
      usdStr(y.incomeUsd),
      y.disposals,
      y.incomplete ? 1 : 0,
      address,
      generatedAt,
    ]),
  ]
  return (
    '\uFEFF' + body.map((r) => r.map((c) => escape(c)).join(',')).join('\n')
  )
}