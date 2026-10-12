import { PINNED_VALIDATOR_ADDRESS, type StakingHolding } from './chain'

export const STAKE_GATE_MIN_NIM = 1000

export type StakeGateReason =
  | 'demo'
  | 'granted'
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

// Wallets granted portfolio access regardless of stake. Stored as SHA-256 hex
// digests of the normalised address (spaces removed, uppercased), so the raw
// addresses never appear in source or in the bundle.
const GRANTED_DIGESTS: ReadonlySet<string> = new Set([
  '64172da51a6c1336019b8b3456fa4bacbf2e6e196f10c7b27670b26908f9200b',
  '09c216087db04647c60216189635c6e60b55e6e050438896049d713bc95ce00f',
  'a8d1481b5998b010bfac2f8b56018eda1dbf596ab7c3462ec094020a62ef858c',
])

/**
 * True when the address is on the portfolio access grant list. Any error, or an
 * empty input, counts as not granted.
 */
export async function isGrantedAddress(address: string): Promise<boolean> {
  try {
    const normalised = clean(address ?? '')
    if (!normalised) return false
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised))
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    return GRANTED_DIGESTS.has(hex)
  } catch {
    return false
  }
}

/**
 * Evaluates whether the connected wallet meets the minimum stake threshold
 * (1,000 NIM active stake with the ImpactZero validator) required to unlock
 * portfolio PDF reporting.
 *
 * Rules:
 * - Demo mode is always unlocked.
 * - A wallet on the access grant list is unlocked regardless of stake ('granted').
 * - Missing staker record is locked ('not-staked').
 * - Staker record delegated to any other validator is locked ('other-validator').
 * - Only active stake counts (inactive/cooling and retired do not).
 * - Minimum required is 1,000 NIM (100,000,000 Luna).
 */
export function stakeGateStatus(
  holding: StakingHolding | null,
  isDemo: boolean,
  granted = false
): StakeGateStatus {
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

  if (granted) {
    return {
      unlocked: true,
      reason: 'granted',
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
