// Staking maths, ported from the NimBooks app. The app's files are the source
// of truth; every function here mirrors one of them behaviour for behaviour:
//
//   from the app's src/lib/chain.ts:
//     supplyAtTime, annualRewardFor, ValidatorInfo (trimmed), compareValidators,
//     sortValidators, the pinned (builder's) pool address, the validator-list
//     field mapping, and the network-stake inference (all there inside
//     fetchValidatorsFresh, minus logos, accent colours and localStorage:
//     this server has no DOM and must never pull a megabyte of base64 logos
//     it cannot render),
//   from the app's src/lib/yieldCalc.ts:
//     projectStake, compoundsFor, typicalRate,
//   from the app's src/lib/earnInsights.ts:
//     rewardsByValidator, trailingYield.
//
// A port either drifts or it does not: test/staking-parity.test.ts imports
// the app's real modules and pins these to them.
//
// Pure: no fetch, no DOM, no storage, and no clock of its own. Every place
// the app reads Date.now() is a `now` parameter here (defaulting to
// Date.now()), so tests can pin time and a caller can project from a fixed
// instant.

import type { NimiqTx } from './chain.ts'
import { ToolError } from './chain.ts'

export const PINNED_VALIDATOR_ADDRESS = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'

// App staking constants (src/App.tsx, where they are not exported, so the
// values travel with the ports and the parity tests pin them).
// Nimiq PoS: one epoch is 43,200 blocks at about 1 block per second (~12 h).
export const BLOCKS_PER_EPOCH = 43_200
export const MIN_STAKE_NIM = 100
export const MIN_STAKE_NOTE =
  'Nimiq needs at least 100 NIM to open a stake. A partial unstake may not leave a staker record below 100 NIM either.'

export interface ValidatorInfo {
  id: number
  name: string
  address: string
  fee: number | null // 0.01 = 1%; null when the pool publishes no fee
  reliability: number | null // null = not producing (no score this epoch)
  payoutType?: string
  isListed: boolean
  balance: number // Luna staked with this validator
  annualReward: number | null // net annual yield after fee, as a fraction (0.0831 = 8.31% p.a.)
}

// --- Circulating supply and validator yield ---
// Ported verbatim from the app's src/lib/chain.ts (Nimiq wallet's
// AlbatrossMath.calculateStakingReward convention).

const TOTAL_SUPPLY = 21e14 // total NIM supply in Luna
const SUPPLY_DECAY = 0.9999999999960264 // supply decay per ms
const GENESIS_DATE = Date.UTC(2024, 10, 19, 16, 0, 0) // mainnet genesis
const GENESIS_SUPPLY = 12_893_109_654_06244

/** Circulating NIM supply (Luna) at a moment, on the protocol's emission curve. */
export function supplyAtTime(ms: number): number {
  const t = ms - GENESIS_DATE
  return TOTAL_SUPPLY - (TOTAL_SUPPLY - GENESIS_SUPPLY) * Math.pow(SUPPLY_DECAY, t)
}

/** Net annual yield for a validator, in the wallet's convention (fraction). */
export function annualRewardFor(fee: number | null, networkStakeLuna: number, now = Date.now()): number | null {
  if (fee === null || !(networkStakeLuna > 0)) return null
  const emission = supplyAtTime(now + 365 * 86400000) - supplyAtTime(now)
  return (emission / networkStakeLuna) * (1 - fee)
}

// --- The validator list ---

const flat = (address: string): string => (address ?? '').replace(/\s+/g, '').toUpperCase()

/** The builder's pool: ImpactZero, the validator run by the developer of NimBooks. */
export function isBuildersPool(address: string): boolean {
  return flat(address) === flat(PINNED_VALIDATOR_ADDRESS)
}

/**
 * The validator order, as one pure comparator. Producing pools (a reliability
 * score this epoch) come first, ordered by net annual yield descending with
 * any pool that publishes no yield last, then by reliability descending, then
 * by name so the order is stable between loads. Non-producing pools come
 * last, ordered the same inner way. Verbatim from the app's chain.ts.
 */
export function compareValidators(a: ValidatorInfo, b: ValidatorInfo): number {
  const ar = a.reliability
  const br = b.reliability
  // Producing before non-producing, either way.
  if (ar === null && br !== null) return 1
  if (br === null && ar !== null) return -1
  const ay = a.annualReward
  const by = b.annualReward
  // Net yield descending within each group, no-yield pools last.
  if (ay === null && by !== null) return 1
  if (by === null && ay !== null) return -1
  if (ay !== null && by !== null && ay !== by) return by - ay
  // Reliability descending, for pools that share a yield.
  if (ar !== null && br !== null && ar !== br) return br - ar
  return a.name.localeCompare(b.name)
}

export function sortValidators(list: ValidatorInfo[]): ValidatorInfo[] {
  return [...list].sort(compareValidators)
}

/**
 * The network's total active stake, inferred from the validators payload the
 * way the app infers it inside fetchValidatorsFresh: each listed validator's
 * `dominanceRatio` is its balance over the network total, so the total is
 * backed out from every row with both fields and the mean is taken.
 */
export function networkStakeLunaFrom(rawJson: unknown): number {
  const raw = Array.isArray(rawJson) ? (rawJson as unknown[]) : []
  const inferred = raw
    .map((v: any) => ({ bal: Number(v?.balance) || 0, dom: Number(v?.dominanceRatio) || 0 }))
    .filter((x) => x.bal > 0 && x.dom > 0)
    .map((x) => x.bal / x.dom)
  return inferred.length > 0 ? inferred.reduce((a, b) => a + b, 0) / inferred.length : 0
}

/**
 * The validators API payload mapped into ValidatorInfo rows, sorted in the
 * app's neutral order. Port of the mapping inside the app's
 * fetchValidatorsFresh, minus logos, accent colours and caching. Never keeps
 * `logo`: third-party inlined images are content this server cannot render
 * and should not carry.
 */
export function parseValidators(rawJson: unknown, now = Date.now()): ValidatorInfo[] {
  if (!Array.isArray(rawJson)) throw new Error('Validators API returned no list')
  const raw = (rawJson as any[]).filter((v: any) => v?.address)
  const networkStakeLuna = networkStakeLunaFrom(raw)
  const validators: ValidatorInfo[] = raw.map((v: any) => {
    const fee = typeof v?.fee === 'number' ? v.fee : null
    const balance = Number(v.balance) || 0
    return {
      id: Number(v?.id),
      name: String(v?.name || v?.address || 'Unknown validator'),
      address: String(v?.address ?? ''),
      fee,
      reliability: typeof v?.score?.reliability === 'number' ? v.score.reliability : null,
      payoutType: typeof v?.payoutType === 'string' ? v.payoutType : undefined,
      isListed: v?.isListed !== false,
      balance,
      // Same convention as the Nimiq wallet's validator list: annual yield on
      // the network's total active stake, net of this pool's fee.
      annualReward: annualRewardFor(fee, networkStakeLuna, now),
    }
  })
  if (validators.length === 0) throw new Error('Validators API returned no validators')
  return sortValidators(validators)
}

// --- Yield projection (app's src/lib/yieldCalc.ts) ---

const MONTH_MS = (365 * 86400000) / 12
const YEAR_MS = 365 * 86400000

export interface ProjectionPoint {
  /** Months from now (0 = today). */
  month: number
  /** Stake at the end of this month, NIM (principal plus restaked rewards when compounding). */
  balanceNim: number
  /** Rewards earned so far, NIM. */
  rewardsNim: number
}

export interface Projection {
  points: ProjectionPoint[]
  /** Total rewards over the whole horizon, NIM. */
  rewardsNim: number
  /** Rewards in the first twelve months, NIM. */
  firstYearNim: number
}

/**
 * Month-by-month projection of a stake. Ported verbatim from the app's
 * projectStake: emission falls every block along the protocol's supply curve
 * and a compounding stake grows by its rewards, while the network's total
 * stake is held fixed (the one assumption the app states in its UI too).
 */
export function projectStake({
  principalNim,
  annualRateNow,
  months,
  compound,
  now = Date.now(),
}: {
  principalNim: number
  annualRateNow: number
  months: number
  compound: boolean
  now?: number
}): Projection {
  const points: ProjectionPoint[] = [{ month: 0, balanceNim: principalNim, rewardsNim: 0 }]
  const valid = principalNim > 0 && annualRateNow > 0 && Number.isFinite(principalNim) && Number.isFinite(annualRateNow)
  const yearEmissionNow = supplyAtTime(now + YEAR_MS) - supplyAtTime(now)
  let balance = principalNim
  let rewards = 0
  let firstYear = 0
  for (let m = 1; m <= Math.max(0, Math.floor(months)); m++) {
    if (valid && yearEmissionNow > 0) {
      const from = now + (m - 1) * MONTH_MS
      const stepEmission = supplyAtTime(from + MONTH_MS) - supplyAtTime(from)
      const stepRate = annualRateNow * (stepEmission / yearEmissionNow)
      const earned = (compound ? balance : principalNim) * stepRate
      rewards += earned
      if (compound) balance += earned
      if (m <= 12) firstYear = rewards
    }
    points.push({ month: m, balanceNim: compound ? balance : principalNim, rewardsNim: rewards })
  }
  return { points, rewardsNim: rewards, firstYearNim: firstYear }
}

/** Whether a pool adds rewards to the stake (compounds) rather than paying them out. */
export function compoundsFor(v: Pick<ValidatorInfo, 'payoutType'> | null | undefined): boolean {
  return v?.payoutType !== 'direct'
}

/**
 * A neutral "what staking pays" figure: the median net yield of the pools
 * with a reliability score and a positive published yield. Null without data.
 */
export function typicalRate(validators: ValidatorInfo[]): number | null {
  const rates = validators
    .filter((v) => v.reliability !== null && v.annualReward !== null && v.annualReward > 0)
    .map((v) => v.annualReward as number)
    .sort((a, b) => a - b)
  if (rates.length === 0) return null
  const mid = Math.floor(rates.length / 2)
  return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2
}

// --- Reward insights (app's src/lib/earnInsights.ts) ---

// Rows carry amounts in Luna (NIM x 100 000); the insights speak NIM.
function rowToNim(tx: { value: string }): number {
  return (Number(tx.value) || 0) / 100000
}

// UTC day key, so a reward row maps to the day it was paid regardless of the
// viewer's timezone.
function dayKey(ms: number): number {
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

function normAddress(addr: string | undefined): string {
  return (addr ?? '').replace(/\s+/g, '').toUpperCase()
}

function isRewardRow(tx: { synthetic?: string; timestamp?: number }): boolean {
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

export interface RewardSpan {
  nim: number
  days: number
}

/** Rewards grouped by paying validator (the reward row's sender), largest total first. */
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
 * (or no active stake) the figure is too thin to print, so null says "no
 * line yet" instead.
 */
export function trailingYield(
  rewardTxs: readonly NimiqTx[],
  activeStakeLuna: number,
  nowMs: number,
  windowDays = 30
): { rate: number; windowDays: number } | null {
  if (!Number.isFinite(activeStakeLuna) || activeStakeLuna <= 0) return null
  const sinceMs = nowMs - windowDays * (24 * 60 * 60 * 1000)
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

// --- Tool argument resolution (pure glue the yield tools share) ---

/** Levenshtein distance, small strings only: names the user may half-remember. */
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/**
 * Names close to what was typed, to offer when nothing matches: a substring
 * hit anywhere in the name, else an edit distance within a third of the
 * longer name's length (at least 2).
 */
export function closeValidatorNames(query: string, validators: ValidatorInfo[], max = 5): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const partial = validators.filter((v) => v.name.toLowerCase().includes(q))
  if (partial.length > 0) return partial.slice(0, max).map((v) => v.name)
  return validators
    .map((v) => ({ name: v.name, d: editDistance(q, v.name.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(Math.max(q.length, x.name.length) / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.name)
}

/**
 * A validator argument, resolved against the list: the pool's address (spaced
 * or flat), its exact name, or a unique case-insensitive substring of it.
 * Null when no query was given at all. Unknown or ambiguous names throw a
 * ToolError naming close matches.
 */
export function matchValidator(query: string | undefined, validators: ValidatorInfo[]): ValidatorInfo | null {
  const q = (query ?? '').trim()
  if (!q) return null
  const fq = flat(q)
  const ql = q.toLowerCase()
  const byAddress = validators.find((v) => flat(v.address) === fq)
  if (byAddress) return byAddress
  const byName = validators.filter((v) => v.name.trim().toLowerCase() === ql)
  if (byName.length === 1) return byName[0]
  const partial = validators.filter((v) => v.name.toLowerCase().includes(ql))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    throw new ToolError(
      `"${q}" matches more than one pool: ${partial.slice(0, 6).map((v) => v.name).join(', ')}. ` +
        `Name one exactly, or pass its NQ address.`
    )
  }
  const close = closeValidatorNames(q, validators)
  throw new ToolError(
    `No pool matches "${q}".` +
      (close.length ? ` Close matches: ${close.join(', ')}.` : ` Run list_validators for the pool names.`)
  )
}

/** Where a project_yield rate came from. */
export interface RateChoice {
  /** The annual rate as a fraction (0.0816 = 8.16% p.a.). */
  rate: number
  rateSource: 'you gave the rate' | string
}

/**
 * Rate resolution for project_yield, in order: an explicit
 * `annualRatePercent` wins; then the named validator's current net yield;
 * then the median of producing pools (`typicalRate`). Throws a ToolError
 * when nothing can produce a rate.
 */
export function chooseRate(opts: {
  annualRatePercent?: number
  validatorQuery?: string
  /** The named validator, already resolved against the list (null = none named or not looked up). */
  named: ValidatorInfo | null
  validators: ValidatorInfo[]
}): RateChoice {
  if (opts.annualRatePercent !== undefined) {
    if (!(opts.annualRatePercent > 0) || !(opts.annualRatePercent <= 100)) {
      throw new ToolError(
        `The annual rate must be more than 0 and at most 100 percent; ` +
          `${String(opts.annualRatePercent)} is not. Leave it out to use the pool's or the network's current rate.`
      )
    }
    return { rate: opts.annualRatePercent / 100, rateSource: 'you gave the rate' }
  }
  if (opts.validatorQuery) {
    const v = opts.named
    if (v) {
      if (v.annualReward !== null && v.annualReward > 0) {
        return { rate: v.annualReward, rateSource: `${v.name}'s current net yield` }
      }
      throw new ToolError(
        `${v.name} does not have a published net yield right now, so a projection from ` +
          `its rate would be fiction. Give annualRatePercent explicitly, or pick a pool ` +
          `that publishes one (see list_validators).`
      )
    }
  }
  const typical = typicalRate(opts.validators)
  if (typical === null) {
    throw new ToolError(
      'No validator list is available to take the typical rate from, and no rate was given. ' +
        'Give annualRatePercent explicitly, or try again when the validators API answers.'
    )
  }
  return { rate: typical, rateSource: 'the median of producing pools' }
}

/**
 * Compound resolution for project_yield, in order: an explicit choice wins;
 * then the named pool's payout type (direct pays out, the rest compound);
 * otherwise true, because most pools restake and the app's estimate assumes
 * compounding too.
 */
export function chooseCompound(explicit: boolean | undefined, named: ValidatorInfo | null): boolean {
  if (explicit !== undefined) return explicit
  if (named) return compoundsFor(named)
  return true
}