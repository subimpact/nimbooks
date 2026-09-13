// Statement aggregation.
//
// `get_statement` is the tool an accountant would actually lean on, so its
// arithmetic is pinned against the app's own `computeStatement`: same day
// buckets, same exclusions, same sender-pays-fee rule, same rewards split.
// Only the window differs — the app reports a whole year at a time, this takes
// a month too — so the comparison runs over a period both can express.

import test from 'node:test'
import assert from 'node:assert/strict'

import { computeStatement, periodBounds, priceCoverageNote } from '../src/statement.ts'
import { ToolError, type NimiqTx } from '../src/chain.ts'
import * as app from '../../src/lib/statement.ts'

const OWN = 'NQ43Y1RHP1K7JH78LRTS95RYGAUUUBDKFFGX'
const OTHER = 'NQ08ACT8T0FEPTG8P5RLH2S3QGXHV15RNVXY'
const STAKING = 'NQ770000000000000000000000000000000001'
const VALIDATOR = 'NQ81C01NBASE00000000000000000000000000'

const day = (d: string, h = 12) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`)

const TXS: NimiqTx[] = [
  // 2026-03-02: one in, one out with a fee
  { hash: 'a', sender: OTHER, recipient: OWN, value: '1000000', fee: '0', timestamp: day('2026-03-02', 9), toType: 0 },
  { hash: 'b', sender: OWN, recipient: OTHER, value: '250000', fee: '138', timestamp: day('2026-03-02', 18), toType: 0 },
  // 2026-03-05: a validator reward (income, but split out)
  { hash: 'c', sender: VALIDATOR, recipient: OWN, value: '4321', fee: '0', timestamp: day('2026-03-05'), toType: 0 },
  // 2026-03-05: a stake (money out of the basic account, into the contract)
  { hash: 'd', sender: OWN, recipient: STAKING, value: '5000000', fee: '0', timestamp: day('2026-03-05'), toType: 3 },
  // 2026-03-09: a failed transaction — excluded from every figure
  {
    hash: 'e',
    sender: OTHER,
    recipient: OWN,
    value: '9900000',
    fee: '0',
    timestamp: day('2026-03-09'),
    toType: 0,
    executionResult: false,
  },
  // 2026-04-01: outside a March window, inside the year
  { hash: 'f', sender: OTHER, recipient: OWN, value: '700000', fee: '0', timestamp: day('2026-04-01'), toType: 0 },
  // no timestamp at all — must not land in any day bucket
  { hash: 'g', sender: OTHER, recipient: OWN, value: '100000', fee: '0', toType: 0 },
]

const PRICES = { '2026-03-02': 0.0004, '2026-03-05': 0.00041, '2026-04-01': 0.00039 }

test('days, amounts and counts are what the fixtures say', () => {
  const s = computeStatement(TXS, OWN, periodBounds(2026, 3), PRICES)
  assert.deepEqual(
    s.rows.map((r) => r.date),
    ['2026-03-02', '2026-03-05']
  )
  const [first, second] = s.rows
  assert.equal(first.inNim, 10)
  assert.equal(first.outNim, 2.5)
  assert.equal(first.feeNim, 0.00138)
  assert.equal(first.txCount, 2)
  // A reward is received income, and also reported separately for stakers.
  assert.equal(second.inNim, 0.04321)
  assert.equal(second.rewardsNim, 0.04321)
  // A stake is money leaving the basic account.
  assert.equal(second.outNim, 50)
  assert.equal(s.totals.txCount, 4, 'the failed and undated transactions are excluded')
})

test('USD follows each day’s own close', () => {
  const s = computeStatement(TXS, OWN, periodBounds(2026, 3), PRICES)
  assert.equal(s.rows[0].closeUsd, 0.0004)
  assert.equal(s.rows[0].inUsd, 10 * 0.0004)
  assert.equal(s.rows[1].closeUsd, 0.00041)
})

test('a single missing close withholds the USD totals rather than summing a partial period', () => {
  const s = computeStatement(TXS, OWN, periodBounds(2026, 3), { '2026-03-02': 0.0004 })
  assert.equal(s.pricesMissing, 1)
  assert.equal(s.totals.inUsd, null)
  assert.equal(s.totals.outUsd, null)
  // The priced day still carries its own figure — the gap is in the totals.
  assert.equal(s.rows[0].inUsd, 10 * 0.0004)
  assert.equal(s.rows[1].inUsd, null)
})

test('the same numbers as the app, day for day', () => {
  const mine = computeStatement(TXS, OWN, periodBounds(2026), PRICES)
  const theirs = app.computeStatement(TXS as any, OWN, '2026', PRICES)
  assert.equal(mine.rows.length, theirs.rows.length)
  for (const [i, row] of mine.rows.entries()) {
    const other = theirs.rows[i]
    assert.equal(row.date, other.date)
    assert.equal(row.inNim, other.receivedNim, `in on ${row.date}`)
    assert.equal(row.outNim, other.sentNim, `out on ${row.date}`)
    assert.equal(row.feeNim, other.feeNim, `fee on ${row.date}`)
    assert.equal(row.rewardsNim, other.rewardsNim, `rewards on ${row.date}`)
    assert.equal(row.netNim, other.netNim, `net on ${row.date}`)
    assert.equal(row.closeUsd, other.closeUsd, `close on ${row.date}`)
    assert.equal(row.txCount, other.txCount, `count on ${row.date}`)
  }
  assert.equal(mine.totals.inNim, theirs.totals.receivedNim)
  assert.equal(mine.totals.outNim, theirs.totals.sentNim)
  assert.equal(mine.totals.feeNim, theirs.totals.feeNim)
  assert.equal(mine.totals.txCount, theirs.totals.txCount)
  assert.equal(mine.totals.daysActive, theirs.totals.daysActive)
})

test('period bounds are UTC and refuse the impossible', () => {
  assert.equal(periodBounds(2026, 2).from, Date.UTC(2026, 1, 1))
  assert.equal(periodBounds(2026, 2).to, Date.UTC(2026, 2, 1) - 1) // 2026 is not a leap year
  assert.equal(periodBounds(2026).label, '2026')
  assert.equal(periodBounds(2026, 9).label, '2026-09')
  for (const bad of [1999, 2200, 2026.5]) assert.throws(() => periodBounds(bad), ToolError, String(bad))
  for (const bad of [0, 13, 2.5]) assert.throws(() => periodBounds(2026, bad), ToolError, String(bad))
})

test('a period older than the free price history says so', () => {
  const now = Date.parse('2026-09-13T00:00:00Z')
  assert.equal(priceCoverageNote(periodBounds(2026).from, now), null)
  const old = priceCoverageNote(periodBounds(2024).from, now)
  assert.match(old!, /only serves the last 365 days/)
  assert.match(old!, /NIM figures are exact/)
})
