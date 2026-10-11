import { PINNED_VALIDATOR_ADDRESS, type StakingHolding } from './chain'

export const STAKE_GATE_MIN_NIM = 1000

export type StakeGateReason =
  | 'demo'
  | 'staked'
  | 'not-staked'
  | 'other-validator'
  | 'below-min'

export interface StakeGateStatus {
  unlocked: boolean
  reason: StakeGateReason
  activeNim: number
  missingNim: number
}

function clean(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/**
 * Evaluates whether the connected wallet meets the minimum stake threshold
 * (1,000 NIM active stake with the ImpactZero validator) required to unlock
 * portfolio PDF reporting.
 *
 * Rules:
 * - Demo mode is always unlocked.
 * - Missing staker record is locked ('not-staked').
 * - Staker record delegated to any other validator is locked ('other-validator').
 * - Only active stake counts (inactive/cooling and retired do not).
 * - Minimum required is 1,000 NIM (100,000,000 Luna).
 */
export function stakeGateStatus(holding: StakingHolding | null, isDemo: boolean): StakeGateStatus {
  const rawLuna = holding ? Number(holding.active) : 0
  const activeLuna = Number.isFinite(rawLuna) && rawLuna > 0 ? Math.floor(rawLuna) : 0
  const activeNim = activeLuna / 100000

  if (isDemo) {
    return {
      unlocked: true,
      reason: 'demo',
      activeNim,
      missingNim: 0,
    }
  }

  if (!holding) {
    return {
      unlocked: false,
      reason: 'not-staked',
      activeNim: 0,
      missingNim: STAKE_GATE_MIN_NIM,
    }
  }

  if (clean(holding.delegation) !== clean(PINNED_VALIDATOR_ADDRESS)) {
    return {
      unlocked: false,
      reason: 'other-validator',
      activeNim,
      missingNim: STAKE_GATE_MIN_NIM,
    }
  }

  const minLuna = STAKE_GATE_MIN_NIM * 100000 // 100,000,000 Luna
  if (activeLuna >= minLuna) {
    return {
      unlocked: true,
      reason: 'staked',
      activeNim,
      missingNim: 0,
    }
  }

  return {
    unlocked: false,
    reason: 'below-min',
    activeNim,
    missingNim: (100000000 - activeLuna) / 100000,
  }
}
