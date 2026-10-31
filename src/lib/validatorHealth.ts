// Validator health, from the validator's own record on the Nimiq chain.
//
// The user's NIM sits with one validator. Whether that pool is still doing its
// job is written on chain, and the three fields below are the whole story:
//
//   - `retired` (boolean): the validator stopped for good. Nothing more will be
//     earned there, and the stake has to be unstaked to move.
//   - `inactivityFlag` (block number or null): the validator deactivated
//     itself. Non-null means it is not elected and earns nothing until it
//     reactivates.
//   - `jailedFrom` (block number or null): the block it was jailed at. Jailing
//     lasts JAIL_EPOCHS epochs of BLOCKS_PER_EPOCH blocks each; the field is
//     NOT cleared afterwards, so an old value proves nothing on its own.
//
// While the delegated validator is jailed, a staker's inactive stake is not
// released: unstaking cannot complete until the jail ends. Under normal
// circumstances stakers do not lose the staked NIM.
//
// This module is pure: the RPC read lives in lib/chain.fetchValidatorHealth,
// so tests can pin the rules with no network.

/** Nimiq PoS: one epoch is 43,200 blocks at ~1 block/second (~12h). */
export const BLOCKS_PER_EPOCH = 43_200
/** core-rs-albatross: a jail lasts eight epochs. */
export const JAIL_EPOCHS = 8
/** One block is about a second (BLOCK_SEPARATION_TIME = 1000 ms). */
export const BLOCK_SEPARATION_MS = 1000

export type ValidatorHealthStatus = 'ok' | 'jailed' | 'inactive' | 'retired' | 'unknown'

/** The fields of `getValidatorByAddress` that decide health. */
export interface ValidatorRecord {
  inactivityFlag?: number | null
  retired?: boolean | null
  jailedFrom?: number | null
}

export interface ValidatorHealth {
  status: ValidatorHealthStatus
  /** First block that is no longer jailed. Null unless jailed. */
  jailEndsBlock: number | null
  /** Approximate jail time left in ms. Null when not jailed or the height is unknown. */
  jailEndsMs: number | null
  /**
   * The last read failed, so this is the previous answer kept on screen. Never
   * report an `ok` as fresh when this is set: a failed read proves nothing.
   */
  stale: boolean
}

/** The block a `jailedFrom` jail ends at (the first block outside the jail). */
export function jailEndsAt(jailedFrom: number): number {
  return jailedFrom + JAIL_EPOCHS * BLOCKS_PER_EPOCH + 1
}

const health = (
  status: ValidatorHealthStatus,
  extra?: { jailEndsBlock?: number | null; jailEndsMs?: number | null }
): ValidatorHealth => ({
  status,
  jailEndsBlock: extra?.jailEndsBlock ?? null,
  jailEndsMs: extra?.jailEndsMs ?? null,
  stale: false,
})

/**
 * Classify a validator record at a block height. Precedence: retired > jailed
 * > inactive > ok. A null record (the RPC says the address is not a validator)
 * is `unknown`, never `ok`.
 *
 * `currentBlock` 0 means the height is not known yet: a `jailedFrom` then
 * cannot be ruled out, so it reads as jailed rather than as a fresh ok.
 */
export function classifyValidatorHealth(
  record: ValidatorRecord | null | undefined,
  currentBlock: number
): ValidatorHealth {
  if (!record) return health('unknown')
  if (record.retired === true) return health('retired')
  const head = Number.isFinite(currentBlock) && currentBlock > 0 ? currentBlock : 0
  const jailedFrom = typeof record.jailedFrom === 'number' && record.jailedFrom > 0 ? record.jailedFrom : null
  if (jailedFrom !== null) {
    const ends = jailEndsAt(jailedFrom)
    if (head === 0 || head < ends) {
      return health('jailed', {
        jailEndsBlock: ends,
        jailEndsMs: head > 0 ? Math.max(0, (ends - head) * BLOCK_SEPARATION_MS) : null,
      })
    }
  }
  if (typeof record.inactivityFlag === 'number') return health('inactive')
  return health('ok')
}

export type ValidatorHealthTone = 'ok' | 'warn' | 'muted'

/** What a status line says, in one place so every screen says the same thing. */
export interface ValidatorHealthLine {
  status: ValidatorHealthStatus
  tone: ValidatorHealthTone
  text: string
  /** A retired validator: the line carries the way out. */
  unstake: boolean
}

/** The InfoIcon explainer on the status line. */
export const VALIDATOR_HEALTH_INFO =
  "NimBooks reads your validator's record on the Nimiq chain: whether it is active, jailed for misbehaving, or retired. A jailed or inactive validator earns nothing for those days."

/** Only shown over a previous answer: a first failed read says nothing. */
const UNCHECKED_COPY = 'Could not check the validator right now.'

/**
 * "about 5 more hours" / "about 3 more days". Days from 48 hours up, so a long
 * jail does not read as "about 120 more hours".
 */
export function jailLeftLabel(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null
  const hours = ms / 3_600_000
  if (hours > 48) {
    const days = Math.max(1, Math.round(hours / 24))
    return `${days} more ${days === 1 ? 'day' : 'days'}`
  }
  const h = Math.max(1, Math.round(hours))
  return `${h} more ${h === 1 ? 'hour' : 'hours'}`
}

/**
 * The one line under "X NIM staked with <pool>". Null when there is nothing
 * worth saying (no read yet, or a failed first read with no earlier answer).
 */
export function validatorHealthLine(
  healthState: ValidatorHealth | null | undefined,
  validatorName?: string | null
): ValidatorHealthLine | null {
  if (!healthState) return null
  const name = validatorName && validatorName.trim() ? validatorName.trim() : 'Your validator'
  if (healthState.status === 'ok') {
    // A stale ok is still a claim: say the read failed instead.
    if (healthState.stale) return { status: 'ok', tone: 'muted', text: UNCHECKED_COPY, unstake: false }
    return {
      status: 'ok',
      tone: 'ok',
      text: 'Validator is active and not jailed.',
      unstake: false,
    }
  }
  if (healthState.status === 'inactive') {
    return {
      status: 'inactive',
      tone: 'warn',
      text: `${name} is inactive, so your stake earns nothing until it comes back. Your NIM is safe.`,
      unstake: false,
    }
  }
  if (healthState.status === 'jailed') {
    const left = jailLeftLabel(healthState.jailEndsMs)
    return {
      status: 'jailed',
      tone: 'warn',
      text: left
        ? `${name} is jailed for about ${left}, so your stake earns nothing and unstaking waits until the jail ends. Your NIM is safe.`
        : `${name} is jailed, so your stake earns nothing and unstaking waits until the jail ends. Your NIM is safe.`,
      unstake: false,
    }
  }
  if (healthState.status === 'retired') {
    return {
      status: 'retired',
      tone: 'warn',
      text: `${name} has retired, so your stake no longer earns. Unstake to move it.`,
      unstake: true,
    }
  }
  // Unknown: silence unless a previous read exists and failed.
  if (healthState.stale) return { status: 'unknown', tone: 'muted', text: UNCHECKED_COPY, unstake: false }
  return null
}
