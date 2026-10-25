// History's filters, categories and totals, kept out of the JSX.
//
// One classification, used by the chip counts, the filtered list and the
// summary line, so the three can never disagree. Pure: no React, no DOM, no
// RPC. All NIM arithmetic is integer luna (BigInt) and only formatted at the
// edge (formatLuna in lib/chain, called by the UI).
//
// The category order is a precedence, not a set of exclusive address rules:
// a reward paid from a validator address is also "in", a cashlink funding is
// also "out", and a staking leg is also a plain transfer. Reward wins over
// staking, staking over cashlink, cashlink over Pay, and everything else is a
// payment.

import { decodeMemo, timestampToMs, txLabel, type NimiqTx } from './chain'
import { isCashlinkMemo } from './cashlink'
import type { FlowSplit } from './htlcFlows'

export type HistoryFilter =
  | 'all'
  | 'received'
  | 'sent'
  | 'rewards'
  | 'staking'
  | 'pay'
  | 'cashlinks'

export type HistoryCategory = 'reward' | 'staking' | 'cashlink' | 'pay' | 'payment'

export type HistoryDirection = 'in' | 'out'

/** The chip order the History tab renders. */
export const HISTORY_FILTERS: readonly HistoryFilter[] = [
  'all',
  'received',
  'sent',
  'rewards',
  'staking',
  'pay',
  'cashlinks',
]

/**
 * Everything the classification needs. `flows` is `splitHtlcFlows`' output for
 * the same rows (the map Analytics uses), so the "hide internal" switch and
 * the totals agree with Analytics by construction. `remote` is Nimiq Pay's
 * relay address: a row sent from it is outgoing for this wallet.
 */
export interface HistoryCtx {
  own: string
  remote?: string | null
  flows?: Map<string, FlowSplit>
  hideInternal: boolean
}

/** The staking actions History can synthesize a row for (not 'reward'). */
const STAKING_ACTION_KINDS: readonly string[] = ['deactivate', 'retire', 'withdraw', 'stake']
const STAKING_ACTION_KEYS = new Set(STAKING_ACTION_KINDS)

// Filters whose lists and totals the internal-transfers switch changes.
const INTERNAL_AWARE: readonly HistoryFilter[] = ['all', 'received', 'sent']

function flatAddr(addr: string | undefined | null): string {
  return (addr ?? '').replace(/\s+/g, '').toUpperCase()
}

// Integer luna from a tx value. Non-numeric values move nothing (read as 0),
// matching splitHtlcFlows' guard.
function lunaOf(tx: NimiqTx): bigint {
  const n = Math.round(Number(tx.value))
  return Number.isFinite(n) && n > 0 ? BigInt(n) : 0n
}

function bigFromNumber(n: number): bigint {
  const r = Math.round(n)
  return Number.isFinite(r) && r > 0 ? BigInt(r) : 0n
}

/** Precedence: reward, then staking, then cashlink, then Pay, then payment. */
export function historyCategory(tx: NimiqTx, ctx: HistoryCtx): HistoryCategory {
  const label = txLabel(tx, ctx.own)
  const synthetic = tx.synthetic
  // A daily restaked rollup (lib/stakingEvents) or a payout from a validator
  // reward address (classifyTx in lib/chain) is income.
  if (synthetic === 'reward' || label === 'reward') return 'reward'
  // A locally recorded staking action, or any indexed stake/unstake leg.
  // `staking` is deliberately in the list above too: a synthetic `stake` row
  // must stay staking, not fall through to a payment.
  if (
    (!!synthetic && STAKING_ACTION_KEYS.has(synthetic)) ||
    label === 'stake' ||
    label === 'unstake'
  ) {
    return 'staking'
  }
  if (isCashlinkMemo(decodeMemo(tx.data))) return 'cashlink'
  // Includes `tx.remote` rows: the relay's funding legs read as swap and its
  // other hops as htlc, and both are Nimiq Pay machinery rather than payments.
  if (label === 'swap' || label === 'htlc') return 'pay'
  return 'payment'
}

/**
 * Outgoing when the sender is the basic address, or (for a remote row) the
 * relay address. Everything else is incoming. Same rule the row's arrow and
 * colour used before this module existed.
 */
export function historyDirection(tx: NimiqTx, ctx: HistoryCtx): HistoryDirection {
  const sender = flatAddr(tx.sender)
  if (sender === flatAddr(ctx.own)) return 'out'
  if (tx.remote && ctx.remote && sender === flatAddr(ctx.remote)) return 'out'
  return 'in'
}

function categoryPasses(cat: HistoryCategory, filter: HistoryFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'received':
      return cat !== 'reward' && cat !== 'staking'
    case 'sent':
      return cat !== 'staking'
    case 'rewards':
      return cat === 'reward'
    case 'staking':
      return cat === 'staking'
    case 'pay':
      return cat === 'pay'
    case 'cashlinks':
      return cat === 'cashlink'
  }
}

function directionPasses(dir: HistoryDirection, filter: HistoryFilter): boolean {
  if (filter === 'received') return dir === 'in'
  if (filter === 'sent') return dir === 'out'
  return true
}

/** Category and direction only: the row belongs to the filter's list. */
function belongsToFilter(tx: NimiqTx, filter: HistoryFilter, ctx: HistoryCtx): boolean {
  return (
    categoryPasses(historyCategory(tx, ctx), filter) &&
    directionPasses(historyDirection(tx, ctx), filter)
  )
}

/** The row's split, or undefined for rows the netting left unsplit. */
function splitOf(tx: NimiqTx, ctx: HistoryCtx): FlowSplit | undefined {
  return ctx.flows?.get(tx.hash)
}

/**
 * No real part and something internal on the row's own direction: the money
 * never left (or never entered) the wallet in any meaningful way. Only rows in
 * the netting map can be fully internal (a failed row is never in it).
 */
function fullyInternal(sp: FlowSplit, dir: HistoryDirection): boolean {
  return dir === 'in'
    ? sp.realIn === 0 && sp.internalIn > 0
    : sp.realOut === 0 && sp.internalOut > 0
}

/**
 * The filtered rows, newest first (input order is preserved). With the switch
 * on, fully internal rows drop out of All, Received and Sent; the other
 * filters keep their rows, because a rewards or cashlink row is never one of
 * Nimiq Pay's round trips.
 */
export function filterHistory(
  rows: readonly NimiqTx[],
  filter: HistoryFilter,
  ctx: HistoryCtx
): NimiqTx[] {
  const hide = ctx.hideInternal && INTERNAL_AWARE.includes(filter)
  const out: NimiqTx[] = []
  for (const tx of rows) {
    if (!belongsToFilter(tx, filter, ctx)) continue
    if (hide) {
      const sp = splitOf(tx, ctx)
      if (sp && fullyInternal(sp, historyDirection(tx, ctx))) continue
    }
    out.push(tx)
  }
  return out
}

export type HistoryCounts = Record<HistoryFilter, number>

/** Row count per chip, over every row (not just the visible page). */
export function historyCounts(rows: readonly NimiqTx[], ctx: HistoryCtx): HistoryCounts {
  const counts = {} as HistoryCounts
  for (const filter of HISTORY_FILTERS) {
    counts[filter] = filterHistory(rows, filter, ctx).length
  }
  return counts
}

/**
 * Does the wallet have at least one fully internal row? Gates the switch: a
 * wallet with no Nimiq Pay round trips has nothing to hide.
 */
export function hasInternalTransfers(rows: readonly NimiqTx[], ctx: HistoryCtx): boolean {
  for (const tx of rows) {
    const sp = splitOf(tx, ctx)
    if (!sp) continue
    const dir = historyDirection(tx, ctx)
    if (fullyInternal(sp, dir)) return true
  }
  return false
}

export interface HistorySummary {
  filter: HistoryFilter
  /** Rows the filter lists, failed ones included (they are rows, not money). */
  count: number
  /** Distinct UTC days, for the Rewards filter (0 elsewhere). */
  days: number
  /** Exact integer luna, failed rows excluded. '' when the filter shows no total. */
  totalLuna: string
  /** Exact integer luna the internal switch hid, 0 when nothing was hidden. */
  hiddenLuna: string
}

const SUMMARY_WITH_TOTAL: readonly HistoryFilter[] = ['received', 'sent', 'rewards']

/**
 * The one-line summary under the chips. Computed over ALL filtered rows, not
 * the visible page, so "Load more" cannot change the figure.
 *
 * Failed rows are listed under their filter but never counted in NIM totals.
 * With the switch on, a row in the netting map contributes only its real part
 * for its direction; a row outside the map contributes its full value.
 */
export function historySummary(
  rows: readonly NimiqTx[],
  filter: HistoryFilter,
  ctx: HistoryCtx
): HistorySummary {
  const listed = filterHistory(rows, filter, ctx)

  let total = 0n
  let days = 0
  if (filter === 'rewards') {
    const seen = new Set<string>()
    for (const tx of listed) {
      if (tx.timestamp) seen.add(utcDayKey(tx.timestamp))
      if (tx.executionResult === false) continue
      total += lunaOf(tx)
    }
    days = seen.size
  } else if (filter === 'received' || filter === 'sent') {
    for (const tx of listed) {
      if (tx.executionResult === false) continue
      total += countedLuna(tx, historyDirection(tx, ctx), ctx)
    }
  }

  let hidden = 0n
  if (ctx.hideInternal && INTERNAL_AWARE.includes(filter)) {
    for (const tx of rows) {
      if (!belongsToFilter(tx, filter, ctx)) continue
      const dir = historyDirection(tx, ctx)
      const sp = splitOf(tx, ctx)
      if (!sp || !fullyInternal(sp, dir)) continue
      // Only rows the switch actually removes: a row that fails the filter on
      // its category or direction (an internal staking leg, say) is not
      // "hidden" by this switch, it was never in this filter.
      hidden += bigFromNumber(dir === 'in' ? sp.internalIn : sp.internalOut)
    }
  }

  return {
    filter,
    count: listed.length,
    days,
    totalLuna: SUMMARY_WITH_TOTAL.includes(filter) ? total.toString() : '',
    hiddenLuna: hidden.toString(),
  }
}

/** Real part for the row's direction when netted, full value when not. With
 * the switch off the totals are plain sums of values, exactly as before the
 * filters existed.
 */
function countedLuna(tx: NimiqTx, dir: HistoryDirection, ctx: HistoryCtx): bigint {
  if (!ctx.hideInternal) return lunaOf(tx)
  const sp = splitOf(tx, ctx)
  if (!sp) return lunaOf(tx)
  return bigFromNumber(dir === 'in' ? sp.realIn : sp.realOut)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** UTC calendar day (YYYY-MM-DD). Reward days close at UTC. */
function utcDayKey(ts: number): string {
  const d = new Date(timestampToMs(ts))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export interface RewardMonth {
  /** 'YYYY-MM', UTC. */
  key: string
  /** 'October 2026'. */
  label: string
  /** Distinct UTC dates in the month. */
  days: number
  /** Exact integer luna, failed rows excluded. */
  totalLuna: string
  /** The month's daily rows, newest first. */
  rows: NimiqTx[]
}

/**
 * Reward rows as one entry per UTC calendar month, newest month first. The
 * rows inside a month keep their newest-first order. Timestamps whose unit is
 * unclear go through `timestampToMs`, the same guard every date site uses.
 */
export function groupRewardsByMonth(rows: readonly NimiqTx[]): RewardMonth[] {
  const months = new Map<
    string,
    { label: string; rows: NimiqTx[]; days: Set<string>; total: bigint }
  >()
  for (const tx of rows) {
    if (!tx.timestamp) continue
    const d = new Date(timestampToMs(tx.timestamp))
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    const key = `${y}-${pad2(m + 1)}`
    let bucket = months.get(key)
    if (!bucket) {
      bucket = { label: `${MONTH_NAMES[m]} ${y}`, rows: [], days: new Set(), total: 0n }
      months.set(key, bucket)
    }
    bucket.rows.push(tx)
    bucket.days.add(utcDayKey(tx.timestamp))
    if (tx.executionResult !== false) bucket.total += lunaOf(tx)
  }
  return [...months.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, b]) => ({
      key,
      label: b.label,
      days: b.days.size,
      totalLuna: b.total.toString(),
      rows: b.rows,
    }))
}
