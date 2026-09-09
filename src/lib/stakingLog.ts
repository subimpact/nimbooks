// Local record of staking actions (deactivate / retire / withdraw)
//
// These are real, mined, on-chain transactions — they are simply invisible to
// the public index History reads. `getTransactionsByAddress` (nimiqwatch v1)
// returns no staking activity for either side of the transfer: not for the
// staker's own address, and not for the staking contract (whose list is all
// restakes). Verified on a live unstake — the staker record flipped to
// `inactiveBalance` and `getTransactionByHash` resolves the tx, yet neither
// address list contains it. The official wallet has the same gap.
//
// So the hash is recorded here at submit time, when the submit flow already
// knows the amount and the moment, and History renders it from this log. The
// row carries the real hash, so the explorer link works even though no address
// list would ever have surfaced it.
//
// This is a display log, not a ledger: the CSV, the tax statement and the
// balance analytics all stay on the indexed transactions. Staking actions move
// NIM between the user's own buckets, not in or out of their holdings, so they
// are not fiat flows and the statement methodology excludes them.

import type { StakingActionKind } from './chain'

export type { StakingActionKind }

export interface StakingAction {
  kind: StakingActionKind
  amountNim: number
  hash: string
  at: number // ms timestamp of submission
  // Flipped once the verification poll saw the tx on chain. An unconfirmed row
  // is still shown — it was submitted — but says so.
  confirmed: boolean
}

const KEY_PREFIX = 'nimbooks:stakingLog:'
// Deep enough that a heavy staker's actions survive, shallow enough that the
// log can never crowd out the tx cache in a WebView's storage quota.
const MAX_ENTRIES = 500

export function stakingLogKey(address: string): string {
  return KEY_PREFIX + address.replace(/\s+/g, '').toUpperCase()
}

/** Recorded actions for an address, newest first. Never throws. */
export function loadStakingLog(address: string): StakingAction[] {
  try {
    const raw = localStorage.getItem(stakingLogKey(address))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (a: unknown): a is StakingAction =>
        !!a &&
        typeof (a as StakingAction).hash === 'string' &&
        typeof (a as StakingAction).kind === 'string' &&
        Number.isFinite(Number((a as StakingAction).amountNim))
    )
  } catch {
    return []
  }
}

function save(address: string, actions: StakingAction[]): void {
  try {
    localStorage.setItem(stakingLogKey(address), JSON.stringify(actions.slice(0, MAX_ENTRIES)))
  } catch {
    /* storage full or unavailable — the caller keeps the row in memory, so it
       still shows for this session; only persistence is lost. */
  }
}

/**
 * Record a submitted action, newest first. Re-submitting the same hash replaces
 * the existing entry rather than duplicating it — History keys rows by hash.
 */
export function appendStakingAction(address: string, action: StakingAction): void {
  const next = [action, ...loadStakingLog(address).filter((a) => a.hash !== action.hash)]
  save(address, next)
}

export function markStakingActionConfirmed(address: string, hash: string): void {
  const log = loadStakingLog(address)
  if (!log.some((a) => a.hash === hash)) return
  save(
    address,
    log.map((a) => (a.hash === hash ? { ...a, confirmed: true } : a))
  )
}

/**
 * Drop a row whose transaction never reached the chain. The validity window
 * passed, nothing on chain records the attempt, and the submit flow has already
 * told the user — so the row must not linger claiming an action that never
 * happened.
 */
export function removeStakingAction(address: string, hash: string): void {
  const log = loadStakingLog(address)
  if (!log.some((a) => a.hash === hash)) return
  save(
    address,
    log.filter((a) => a.hash !== hash)
  )
}
