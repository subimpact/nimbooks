// A2. Staking parity: the maths this release rides on.
//
// The four staking tools answer with the app's own numbers, so this test
// imports the app's REAL modules (no copies) and pins the ports to them:
//
//   src/staking.ts  <->  ../../src/lib/yieldCalc.ts
//                        ../../src/lib/chain.ts
//                        ../../src/lib/earnInsights.ts
//
// The app modules are browser code, but every function compared here reaches
// localStorage/fetch/Date.now only at runtime, and those are stubbed per test
// with the originals restored in a finally. Everything runs offline: the only
// network seen is the stubbed one.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as mine from '../src/staking.ts'
import * as appYield from '../../src/lib/yieldCalc.ts'
import * as appChain from '../../src/lib/chain.ts'
import * as appInsights from '../../src/lib/earnInsights.ts'

const NOW = Date.parse('2026-10-21T12:00:00Z')

interface RewardRow {
  hash: string
  sender: string
  recipient: string
  value: string
  fee: string
  timestamp: number
  synthetic: 'reward'
}

/** Run a test body with stubs installed; every stub is popped afterwards. */
async function withStubs<T>(install: () => Array<() => void>, body: () => Promise<T>): Promise<T> {
  const undo = install()
  try {
    return await body()
  } finally {
    for (const u of undo.reverse()) u()
  }
}

function stubVal(target: Record<string, unknown>, key: string, value: unknown): Array<() => void> {
  const original = target[key]
  target[key] = value
  return [() => void (target[key] = original)]
}

function mapLocalStorage(): unknown {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  }
}

const fixture = JSON.parse(readFileSync(resolve('test/fixtures/validators.json'), 'utf8'))

/** The app's own getValidators against the fixture, under stubs, pinned clock. */
async function appValidators(): Promise<import('../../src/lib/chain.ts').ValidatorInfo[]> {
  return withStubs(
    () => [
      ...stubVal(globalThis as unknown as Record<string, unknown>, 'localStorage', mapLocalStorage()),
      ...stubVal(globalThis as unknown as Record<string, unknown>, 'fetch', async () =>
        new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } })
      ),
      ...stubVal(Date, 'now', () => NOW),
    ],
    () => appChain.getValidators({ force: true })
  )
}

// --- (a) projectStake: 74 vectors, deepEqual on every point ---

const PRINCIPALS = [0.00001, 1, 1000, 1e7]
const RATES = [0.01, 0.0816, 0.2]
const MONTHS_SHORT = [1, 12, 36]

function projectVectors(project: typeof mine.projectStake): Array<{ r: ReturnType<typeof mine.projectStake>; p: number; rate: number; m: number; c: boolean }> {
  const out: Array<{ r: ReturnType<typeof mine.projectStake>; p: number; rate: number; m: number; c: boolean }> = []
  for (const p of PRINCIPALS) {
    for (const rate of RATES) {
      for (const m of MONTHS_SHORT) {
        for (const c of [true, false]) {
          out.push({ r: project({ principalNim: p, annualRateNow: rate, months: m, compound: c, now: NOW }), p, rate, m, c })
        }
      }
    }
  }
  // Two more, long horizons, one per compounding mode.
  out.push({ r: project({ principalNim: 1000, annualRateNow: 0.0816, months: 60, compound: true, now: NOW }), p: 1000, rate: 0.0816, m: 60, c: true })
  out.push({ r: project({ principalNim: 1e7, annualRateNow: 0.2, months: 120, compound: false, now: NOW }), p: 1e7, rate: 0.2, m: 120, c: false })
  return out
}

test('projectStake matches the app module point for point (74 vectors)', () => {
  const appVec = projectVectors(appYield.projectStake)
  const mineVec = projectVectors(mine.projectStake)
  assert.equal(appVec.length, mineVec.length)
  assert.ok(appVec.length >= 12, 'at least 12 vectors are compared')
  for (let i = 0; i < appVec.length; i++) {
    assert.deepEqual(
      { points: mineVec[i].r.points, rewardsNim: mineVec[i].r.rewardsNim, firstYearNim: mineVec[i].r.firstYearNim },
      { points: appVec[i].r.points, rewardsNim: appVec[i].r.rewardsNim, firstYearNim: appVec[i].r.firstYearNim },
      `principal=${mineVec[i].p} rate=${mineVec[i].rate} months=${mineVec[i].m} compound=${mineVec[i].c}`
    )
  }
})

test('a one-year simple projection is the rate applied exactly, the app too', () => {
  // The app's own oracle: twelve monthly emission ratios telescope to the
  // one-year ratio, so a simple 1-year total is principal x rate, exactly.
  const app = appYield.projectStake({ principalNim: 1000, annualRateNow: 0.0816, months: 12, compound: false, now: NOW })
  const m = mine.projectStake({ principalNim: 1000, annualRateNow: 0.0816, months: 12, compound: false, now: NOW })
  assert.equal(Number(app.rewardsNim.toFixed(5)), 81.6)
  assert.equal(m.rewardsNim, app.rewardsNim)
})

// --- (b) supplyAtTime at six instants ---

test('supplyAtTime matches the app at six instants', () => {
  const instants = [
    Date.UTC(2024, 10, 19, 16, 0, 0), // genesis
    Date.UTC(2025, 0, 1),
    Date.UTC(2025, 10, 19, 16, 0, 0), // one year in
    NOW,
    Date.UTC(2027, 5, 15),
    Date.UTC(2044, 0, 1),
  ]
  for (const t of instants) {
    assert.equal(mine.supplyAtTime(t), appChain.supplyAtTime(t), new Date(t).toISOString())
  }
})

// --- (c) annualRewardFor with the clock pinned ---

test('annualRewardFor matches the app with Date.now pinned', () => {
  const undo = stubVal(Date, 'now', () => NOW)
  try {
    const fees: Array<number | null> = [0, 0.01, 0.05, 0.1234, null]
    const stakes = [1.2e14, 5e14, 1.05e15, 21e14]
    for (const fee of fees) {
      for (const stake of stakes) {
        assert.equal(
          mine.annualRewardFor(fee, stake, NOW),
          appChain.annualRewardFor(fee, stake),
          `fee=${fee} stake=${stake}`
        )
      }
    }
  } finally {
    undo[0]()
  }
})

// --- (d) validator parsing and neutral order, against the app's own fetch ---

test('validator parsing and order match the app getValidators on the fixture', async () => {
  const appList = await appValidators()
  const mineList = mine.parseValidators(fixture, NOW)

  assert.equal(mineList.length, appList.length, 'same number of pools')
  assert.equal(mineList.length, 21, 'the fixture has 21 pools')
  for (let i = 0; i < mineList.length; i++) {
    const a = appList[i]
    const m = mineList[i]
    assert.equal(m.address, a.address, `row ${i}: same order (address mismatch: ${m.name} vs ${a.name})`)
    assert.equal(m.name, a.name, `row ${i}: name`)
    assert.equal(m.fee, a.fee, `row ${i}: fee (${m.name})`)
    assert.equal(m.reliability, a.reliability, `row ${i}: reliability (${m.name})`)
    assert.equal(m.payoutType, a.payoutType, `row ${i}: payoutType (${m.name})`)
    assert.equal(m.balance, a.balance, `row ${i}: balance (${m.name})`)
    assert.equal(m.annualReward, a.annualReward, `row ${i}: net yield (${m.name})`)
    assert.equal(m.isListed, a.isListed, `row ${i}: isListed (${m.name})`)
    // Third-party images never ride in the server's list.
    assert.equal('logo' in m, false, `row ${i}: no logo (${m.name})`)
  }
  // The fixture's documented oddities survive the parse on both sides.
  const whalidatorMine = mineList.find((v) => v.name === 'Private Whalidator')
  const whalidatorApp = appList.find((v) => v.name === 'Private Whalidator')
  assert.ok(whalidatorMine && whalidatorApp)
  assert.equal(whalidatorMine.fee, null, 'an unpublished fee stays null')
  assert.equal(whalidatorApp.fee, null)
  assert.equal(whalidatorMine.annualReward, whalidatorApp.annualReward)
  assert.equal(whalidatorMine.annualReward, null, 'no fee means no published yield')
  const baseMine = mineList.find((v) => v.name === 'Nimiq Base Staking')
  const baseApp = appList.find((v) => v.name === 'Nimiq Base Staking')
  assert.ok(baseMine && baseApp)
  assert.equal(baseMine.reliability, null, 'a missing reliability stays null')
  // The builder's pool is recognisable in ours by its address.
  const flat = (s: string): string => s.replace(/\s+/g, '').toUpperCase()
  const impactZero = mineList.find((v) => flat(v.address) === flat(mine.PINNED_VALIDATOR_ADDRESS))
  assert.ok(impactZero, 'ImpactZero is in the list')
  assert.equal(mine.isBuildersPool(impactZero!.address), true)
  // The sort is total: a reversed list comes back to the same order.
  assert.deepEqual(
    mine.sortValidators([...mineList].reverse()).map((v) => v.address),
    mineList.map((v) => v.address)
  )
  // Network stake inference: the mean back-out, recomputed independently here.
  const back = fixture
    .map((v: { balance?: number; dominanceRatio?: number }) => ({
      bal: Number(v.balance) || 0,
      dom: Number(v.dominanceRatio) || 0,
    }))
    .filter((x: { bal: number; dom: number }) => x.bal > 0 && x.dom > 0)
    .map((x: { bal: number; dom: number }) => x.bal / x.dom)
  const manual = back.reduce((a: number, b: number) => a + b, 0) / back.length
  assert.equal(mine.networkStakeLunaFrom(fixture), manual)
  assert.ok(manual > 1e14, 'the inferred network stake is billions of NIM, not a per-pool figure')
})

// --- (e) typicalRate and compoundsFor ---

test('typicalRate matches the app on the fixture list', async () => {
  const appList = await appValidators()
  const mineList = mine.parseValidators(fixture, NOW)
  assert.equal(mine.typicalRate(mineList), appYield.typicalRate(appList), 'typical (median) rate')
  // Both null without data.
  assert.equal(mine.typicalRate([]), appYield.typicalRate([]))
})

test('compoundsFor matches the app for none, restake, direct and undefined', () => {
  for (const payoutType of ['none', 'restake', 'direct', undefined, '']) {
    assert.equal(
      mine.compoundsFor({ payoutType } as { payoutType?: string }),
      appYield.compoundsFor({ payoutType } as { payoutType?: string }),
      `payoutType=${String(payoutType)}`
    )
  }
  assert.equal(mine.compoundsFor(null), appYield.compoundsFor(null))
  // The convention itself: direct is the only non-compounding type.
  assert.equal(mine.compoundsFor({ payoutType: 'direct' }), false)
  assert.equal(mine.compoundsFor({ payoutType: 'restake' }), true)
  assert.equal(mine.compoundsFor({}), true)
})

// --- (f) rewardsByValidator and trailingYield on a synthetic reward set ---

const V_A = 'NQ97 H1NR S3X0 CVFQ VJ9Y 9A0Y FRQN Q6EU D0PL'
const V_B = 'NQ15 HNAH YRVH DFVM YHAG BSXG 0QHK KA0Q XDR7'

function rewardRow(sender: string, iso: string, luna: number): RewardRow {
  return {
    hash: `synthetic:${iso}:${sender.slice(0, 8)}`,
    sender,
    recipient: 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX',
    value: String(luna),
    fee: '0',
    timestamp: Date.parse(iso),
    synthetic: 'reward',
  }
}

const SYNTHETIC = [
  rewardRow(V_A, '2026-09-01T08:00:00Z', 120_000),
  rewardRow(V_A, '2026-09-02T08:00:00Z', 120_000),
  rewardRow(V_B, '2026-09-02T10:00:00Z', 45_000),
  rewardRow(V_A, '2026-09-10T08:00:00Z', 130_000), // a 7-day gap after this
  rewardRow(V_A, '2026-09-27T08:00:00Z', 140_000),
  rewardRow(V_A, '2026-09-28T08:00:00Z', 140_000),
  rewardRow(V_B, '2026-09-28T09:00:00Z', 50_000),
  rewardRow(V_A, '2026-09-29T08:00:00Z', 140_000),
  rewardRow(V_A, '2026-09-30T08:00:00Z', 140_000),
  rewardRow(V_A, '2026-10-01T08:00:00Z', 140_000),
  rewardRow(V_A, '2026-10-02T08:00:00Z', 140_000),
  rewardRow(V_A, '2026-10-03T08:00:00Z', 140_000),
]

test('rewardsByValidator matches the app on a synthetic reward set', () => {
  assert.deepEqual(mine.rewardsByValidator(SYNTHETIC as never), appInsights.rewardsByValidator(SYNTHETIC as never))
  // The synthetic set has what it should: two validators, largest first.
  const rows = mine.rewardsByValidator(SYNTHETIC as never)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].days, 10)
  assert.equal(rows[1].days, 2)
  // The fromMs cut is honoured on both sides.
  const cut = Date.parse('2026-09-28T00:00:00Z')
  assert.deepEqual(
    mine.rewardsByValidator(SYNTHETIC as never, { fromMs: cut }),
    appInsights.rewardsByValidator(SYNTHETIC as never, { fromMs: cut })
  )
  // Non-reward rows are ignored by both.
  const noise = [
    ...SYNTHETIC,
    { hash: 'x', sender: V_A, recipient: 'x', value: '9999', fee: '0', timestamp: Date.parse('2026-10-05T00:00:00Z') },
  ]
  assert.deepEqual(mine.rewardsByValidator(noise as never), appInsights.rewardsByValidator(noise as never))
})

test('trailingYield matches the app, including the under-7-days null', () => {
  const nowT = Date.parse('2026-10-03T12:00:00Z')
  const stake = 10_000_000 // 100 NIM, in Luna
  const vectors: Array<[RewardRow[], number, number, number]> = [
    [SYNTHETIC, stake, nowT, 30], // 6 covered days in the trailing window: null
    [SYNTHETIC, stake, Date.parse('2026-10-04T00:00:00Z'), 30],
    [SYNTHETIC, 0, nowT, 30], // no stake: null
    [SYNTHETIC, 500_000_000, Date.parse('2026-10-05T00:00:00Z'), 90], // wider window
  ]
  for (const [rows, s, wEnd, win] of vectors) {
    assert.deepEqual(
      mine.trailingYield(rows as never, s, wEnd, win),
      appInsights.trailingYield(rows as never, s, wEnd, win),
      `stake=${s} now=${wEnd} window=${win}`
    )
  }
  // Exactly at the threshold: 7 covered days yields a number, 6 nulls, both sides.
  const seven = Array.from({ length: 7 }, (_, i) =>
    rewardRow(V_A, new Date(Date.parse('2026-10-01T08:00:00Z') + i * 86_400_000).toISOString(), 100_000)
  )
  assert.ok(mine.trailingYield(seven as never, stake, Date.parse('2026-10-08T00:00:00Z'), 30) !== null)
  assert.deepEqual(
    mine.trailingYield(seven as never, stake, Date.parse('2026-10-08T00:00:00Z'), 30),
    appInsights.trailingYield(seven as never, stake, Date.parse('2026-10-08T00:00:00Z'), 30)
  )
  const six = seven.slice(0, 6)
  assert.equal(mine.trailingYield(six as never, stake, Date.parse('2026-10-08T00:00:00Z'), 30), null)
  assert.equal(appInsights.trailingYield(six as never, stake, Date.parse('2026-10-08T00:00:00Z'), 30), null)
})