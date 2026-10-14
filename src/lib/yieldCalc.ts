// Staking yield projection: what a stake earns over time.
//
// The starting rate is a validator's net yield today (annualRewardFor in
// chain.ts: one year of emission ÷ network stake × (1 − fee)). Two things move
// it after that, and both are modelled:
//   - emission falls every block along the protocol's supply curve, so each
//     month pays a little less than the one before;
//   - a "restake" pool adds rewards to the stake, so later months earn on a
//     bigger balance (compounding). A "direct" pool pays them out instead.
// One thing is held fixed and said so in the UI: the network's total stake.
// More NIM staked network-wide would lower everyone's rate, less would raise it.

import { supplyAtTime, type ValidatorInfo } from './chain'

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
 * Month-by-month projection of a stake.
 *
 * @param principalNim   amount staked today
 * @param annualRateNow  net yield today as a fraction (0.0816 = 8.16 % p.a.)
 * @param months         horizon
 * @param compound       rewards are restaked (a "restake" pool)
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
 * A neutral "what staking pays" figure for someone not yet staking: the median
 * net yield of the pools producing blocks this epoch. Null without data.
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
