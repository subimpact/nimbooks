// B2. Pure unit tests for the new staking-tool logic: rate resolution order,
// compound resolution, the validator matcher (including the unknown-name
// error with its close matches), and the parser's shape guards. All offline.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BLOCKS_PER_EPOCH,
  MIN_STAKE_NIM,
  chooseCompound,
  chooseRate,
  closeValidatorNames,
  compoundsFor,
  isBuildersPool,
  matchValidator,
  networkStakeLunaFrom,
  parseValidators,
  sortValidators,
  type ValidatorInfo,
} from '../src/staking.ts'
import { ToolError } from '../src/chain.ts'

const NOW = Date.parse('2026-10-21T12:00:00Z')

const POOLS: ValidatorInfo[] = [
  { id: 1, name: 'Alpha Pool', address: 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA', fee: 0, reliability: 0.99, isListed: true, balance: 1e12, annualReward: 0.09 },
  { id: 2, name: 'Garuda Pool', address: 'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB', fee: 0.05, reliability: 0.98, isListed: true, balance: 2e12, annualReward: 0.08, payoutType: 'restake' },
  { id: 3, name: 'ImpactZero stake', address: 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY', fee: 0, reliability: 0.98, isListed: true, balance: 3e12, annualReward: 0.0831, payoutType: 'restake' },
  { id: 4, name: 'Direct Payer', address: 'NQ44 DDDD DDDD DDDD DDDD DDDD DDDD DDDD DDDD', fee: 0.02, reliability: 0.97, isListed: true, balance: 4e12, annualReward: 0.075, payoutType: 'direct' },
  { id: 5, name: 'Sleepy Node', address: 'NQ55 EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE', fee: 0.03, reliability: null, isListed: true, balance: 5e12, annualReward: 0.075 },
]
// Alphabet order is not the neutral order; sortValidators fixes it.
const SORTED = sortValidators(POOLS)

// --- rate resolution order ---

test('an explicit annualRatePercent always wins, and bounds are enforced', () => {
  const c = chooseRate({ annualRatePercent: 8.16, named: SORTED[0], validators: SORTED })
  assert.equal(c.rate, 0.0816)
  assert.equal(c.rateSource, 'you gave the rate')
  assert.equal(chooseRate({ annualRatePercent: 0.5, named: null, validators: [] }).rateSource, 'you gave the rate')
  assert.throws(() => chooseRate({ annualRatePercent: 0, named: null, validators: SORTED }), ToolError)
  assert.throws(() => chooseRate({ annualRatePercent: -1, named: null, validators: SORTED }), ToolError)
  assert.throws(() => chooseRate({ annualRatePercent: 100.01, named: null, validators: SORTED }), ToolError)
  assert.equal(chooseRate({ annualRatePercent: 100, named: null, validators: SORTED }).rate, 1)
})

test('a named validator\'s net yield beats the typical rate', () => {
  const garuda = SORTED.find((v) => v.name === 'Garuda Pool')!
  const c = chooseRate({ validatorQuery: 'garuda', named: garuda, validators: SORTED })
  assert.equal(c.rate, garuda.annualReward)
  assert.equal(c.rateSource, "Garuda Pool's current net yield")
})

test('without a rate or a pool, the median of producing pools answers', () => {
  const c = chooseRate({ named: null, validators: SORTED })
  // Producing pools with a positive yield: 0.075, 0.08, 0.0831, 0.09. The
  // even-count median is the mean of the two middle rates (Sleepy Node has
  // no reliability, so it is excluded on both sides).
  assert.ok(Math.abs(c.rate - (0.08 + 0.0831) / 2) < 1e-12)
  assert.equal(c.rateSource, 'the median of producing pools')
})

test('nothing resolvable is an explicit, actionable error', () => {
  assert.throws(() => chooseRate({ named: null, validators: [] }), ToolError)
  const sleepy = { ...SORTED.find((v) => v.name === 'Sleepy Node')!, annualReward: null }
  try {
    chooseRate({ validatorQuery: 'Sleepy', named: sleepy, validators: [] })
    assert.fail('should have thrown')
  } catch (e) {
    assert.ok(e instanceof ToolError)
    assert.match((e as Error).message, /annualRatePercent/)
  }
})

// --- compound resolution ---

test('compound resolution: explicit choice, then the pool, then true', () => {
  const direct = POOLS.find((v) => v.name === 'Direct Payer')!
  const restake = POOLS.find((v) => v.name === 'Garuda Pool')!
  assert.equal(chooseCompound(true, direct), true)
  assert.equal(chooseCompound(false, restake), false)
  assert.equal(chooseCompound(undefined, direct), false, 'a direct pool pays out')
  assert.equal(chooseCompound(undefined, restake), true, 'a restake pool compounds')
  assert.equal(chooseCompound(undefined, null), true, 'the default compounds')
  assert.equal(compoundsFor({ payoutType: 'direct' }), false)
})

// --- the validator matcher ---

test('matchValidator: by address (spaced or flat), exact name, unique part', () => {
  assert.equal(matchValidator('NQ22BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', SORTED)?.name, 'Garuda Pool')
  assert.equal(matchValidator('ImpactZero stake', SORTED)?.name, 'ImpactZero stake')
  assert.equal(matchValidator('impactzero', SORTED)?.name, 'ImpactZero stake')
  assert.equal(matchValidator('garuda', SORTED)?.name, 'Garuda Pool')
  assert.equal(matchValidator(undefined, SORTED), null)
})

test('an unknown validator lists close matches instead of failing silently', () => {
  try {
    matchValidator('impact zero staking', SORTED)
    assert.fail('should have thrown')
  } catch (e) {
    assert.ok(e instanceof ToolError)
    assert.match((e as Error).message, /ImpactZero/)
    assert.match((e as Error).message, /Close matches/)
  }
  assert.throws(() => matchValidator('nonexistent-pool-xyz', SORTED), ToolError)
  // Close matches are offered for near-misses too.
  try {
    matchValidator('Alphya Pool', SORTED)
    assert.fail()
  } catch (e) {
    assert.match((e as Error).message, /Alpha Pool/)
  }
  // And an ambiguous substring names the candidates.
  try {
    matchValidator('pool', SORTED)
    assert.fail()
  } catch (e) {
    assert.match((e as Error).message, /more than one pool/)
  }
})

test('closeValidatorNames offers substring and typo matches, capped at five', () => {
  assert.ok(closeValidatorNames('impact', SORTED).includes('ImpactZero stake'))
  assert.equal(closeValidatorNames('zzzz', SORTED).length, 0)
  assert.ok(closeValidatorNames('', SORTED).length === 0)
  const many = Array.from({ length: 8 }, (_, i) => ({ id: i, name: `Impact Fan Club ${i}`, address: `NQ${i}`, fee: 0, reliability: 1, isListed: true, balance: 0, annualReward: 0.08 } as ValidatorInfo))
  assert.equal(closeValidatorNames('impact', many).length, 5)
})

// --- parser and constants guards ---

test('parseValidators rejects a non-list and an address-free payload', () => {
  assert.throws(() => parseValidators({ nope: true }), /no list/)
  assert.throws(() => parseValidators([]), /no validators/)
  assert.throws(() => parseValidators([{}]), /no validators/)
})

test('parseValidators never carries a logo, even when the API sends one', () => {
  const out = parseValidators(
    [{ id: 9, name: 'X', address: 'NQ99 XXXX', fee: 0, score: { reliability: 1 }, balance: 1, dominanceRatio: 0.5, logo: 'data:image/png;base64,iVBOR', accentColor: '#fff' }],
    NOW
  )
  assert.equal(out.length, 1)
  assert.equal('logo' in out[0], false)
  assert.equal('accentColor' in out[0], false)
})

test('the constants the tools quote are the app\'s', () => {
  assert.equal(BLOCKS_PER_EPOCH, 43_200)
  assert.equal(MIN_STAKE_NIM, 100)
  assert.equal(isBuildersPool('NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'), true)
  assert.equal(isBuildersPool('NQ08ACT8T0FEPTG8P5RLH2S3QGXHV15RNVXY'), true)
  assert.equal(isBuildersPool('NQ55 EEEE'), false)
})

test('networkStakeLunaFrom is zero when no row carries both fields', () => {
  assert.equal(networkStakeLunaFrom([{ balance: 1 }]), 0)
  assert.equal(networkStakeLunaFrom([{ dominanceRatio: 1 }]), 0)
  assert.equal(networkStakeLunaFrom([]), 0)
  assert.equal(networkStakeLunaFrom([{ balance: 2, dominanceRatio: 0.5 }]), 4)
})
