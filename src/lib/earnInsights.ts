// Earn card retention, computed locally from data the app already loads.
//
// Three "reasons to come back" (ROADMAP Week 2): rewards since your last
// visit, earnings per validator with an actual yield next to the estimate,
// and a "stake it?" prompt when a received payment leaves NIM idle. Everything
// here is a pure function of the tx rows the app already holds - nothing is
// sent to any server.
//
// Pure: no React, no DOM, no storage. Every row shape is the History-shaped
// NimiqTx the rest of the app already passes around.

import type { NimiqTx } from './chain'

const DAY_MS = 24 * 60 * 60 * 1000

// Rows carry amounts in Luna (NIM x 100 000); the card speaks NIM.
function rowToNim(tx: NimiqTx): number {
  return (Number(tx.value) || 0) / 100000
}

// UTC day key, so a reward row maps to the day it was paid regardless of the
// viewer's timezone.
function dayKey(ms: number): number {
  return Math.floor(ms / DAY_MS)
}

function normAddress(addr: string | undefined): string {
  return (addr ?? '').replace(/\s+/g, '').toUpperCase()
}

function isRewardRow(tx: NimiqTx): boolean {
  return tx.synthetic === 'reward' && typeof tx.timestamp === 'number' && Number.isFinite(tx.timestamp)
}

/** A staking reward earned from one validator. */
export interface ValidatorEarning {
  /** Validator address, flat and uppercased (matches `ValidatorInfo.address`). */
  address: string
  /** Total NIM earned from this validator. */
  nim: number
  /** Distinct UTC days with a reward from it. */
  days: number
  firstMs: number
  lastMs: number
}

/** Rewards earned in a period, and over how many days. */
export interface RewardSpan {
  nim: number
  days: number
}

/**
 * Rewards with a timestamp strictly after `sinceMs` - a row stamped exactly at
 * the cut-off was already seen in the previous visit and is excluded.
 */
export function rewardsSince(rewardTxs: readonly NimiqTx[], sinceMs: number): RewardSpan {
  let nim = 0
  const days = new Set<number>()
  for (const tx of rewardTxs) {
    if (!tx || tx.timestamp === undefined || tx.timestamp <= sinceMs) continue
    const v = rowToNim(tx)
    if (v <= 0) continue
    nim += v
    days.add(dayKey(tx.timestamp))
  }
  return { nim, days: days.size }
}

/**
 * Rewards grouped by paying validator (the reward row's sender), largest total
 * first. With `fromMs`, only rows after it are counted; without it, all time.
 */
export function rewardsByValidator(
  rewardTxs: readonly NimiqTx[],
  opts?: { fromMs?: number }
): ValidatorEarning[] {
  const fromMs = opts?.fromMs
  const byValidator = new Map<string, { nim: number; days: Set<number>; firstMs: number; lastMs: number }>()
  for (const tx of rewardTxs) {
    if (!isRewardRow(tx)) continue
    if (fromMs !== undefined && tx.timestamp !== undefined && tx.timestamp <= fromMs) continue
    const v = rowToNim(tx)
    if (v <= 0) continue
    const key = normAddress(tx.sender)
    if (!key) continue
    const entry = byValidator.get(key) ?? { nim: 0, days: new Set<number>(), firstMs: Infinity, lastMs: 0 }
    entry.nim += v
    entry.days.add(dayKey(tx.timestamp!))
    entry.firstMs = Math.min(entry.firstMs, tx.timestamp!)
    entry.lastMs = Math.max(entry.lastMs, tx.timestamp!)
    byValidator.set(key, entry)
  }
  return [...byValidator.entries()]
    .map(([address, e]) => ({ address, nim: e.nim, days: e.days.size, firstMs: e.firstMs, lastMs: e.lastMs }))
    .sort((a, b) => b.nim - a.nim || a.address.localeCompare(b.address))
}

/**
 * Actual yield over the trailing window: rewards paid inside the window
 * divided by the active stake, annualised. Fewer than `windowDays` of
 * rewards use the days actually covered as the window; under 7 covered days
 * (or no active stake) the figure is too thin to print, so null says "no line
 * yet" instead.
 */
export function trailingYield(
  rewardTxs: readonly NimiqTx[],
  activeStakeLuna: number,
  nowMs: number,
  windowDays = 30
): { rate: number; windowDays: number } | null {
  if (!Number.isFinite(activeStakeLuna) || activeStakeLuna <= 0) return null
  const sinceMs = nowMs - windowDays * DAY_MS
  let nim = 0
  const days = new Set<number>()
  for (const tx of rewardTxs) {
    if (!isRewardRow(tx)) continue
    if (tx.timestamp !== undefined && tx.timestamp <= sinceMs) continue
    const v = rowToNim(tx)
    if (v <= 0) continue
    nim += v
    days.add(dayKey(tx.timestamp!))
  }
  const covered = days.size
  if (covered < 7) return null
  const stakeNim = activeStakeLuna / 100000
  return { rate: (nim / stakeNim) * (365 / covered), windowDays: covered }
}

/** The newest received payment the Earn card should offer to stake. */
export interface StakeNudgeTx {
  hash: string
  nim: number
  timestamp: number
}

/**
 * The newest qualifying incoming payment of the last 7 days: `incomingTxs` are
 * the caller's real third-party payments (Nimiq Pay's internal contract legs
 * filtered out) with the recipient already matched. A dismissed hash is never
 * offered again, and the prompt only needs to exist when the new NIM could
 * actually be staked: any amount over 1 NIM for a staker, at least the
 * protocol minimum otherwise.
 */
export function stakeNudge(opts: {
  incomingTxs: readonly NimiqTx[]
  idleNim: number
  hasStaker: boolean
  minStakeNim: number
  dismissedHashes: ReadonlySet<string> | readonly string[]
  nowMs: number
}): StakeNudgeTx | null {
  const idleStakeable = opts.hasStaker ? opts.idleNim >= 1 : opts.idleNim >= opts.minStakeNim
  if (!idleStakeable) return null
  const dismissed = new Set<string>(
    Array.isArray(opts.dismissedHashes) ? opts.dismissedHashes : [...opts.dismissedHashes]
  )
  const sinceMs = opts.nowMs - 7 * DAY_MS
  let best: StakeNudgeTx | null = null
  for (const tx of opts.incomingTxs) {
    if (!tx?.hash || tx.executionResult === false) continue
    if (typeof tx.timestamp !== 'number' || !Number.isFinite(tx.timestamp)) continue
    if (tx.timestamp <= sinceMs || tx.timestamp > opts.nowMs) continue
    if (dismissed.has(tx.hash)) continue
    const nim = rowToNim(tx)
    if (nim <= 0) continue
    if (best === null || tx.timestamp > best.timestamp) {
      best = { hash: tx.hash, nim, timestamp: tx.timestamp }
    }
  }
  return best
}