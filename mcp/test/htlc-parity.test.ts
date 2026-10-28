// Nimiq Pay netting: the port in src/htlcFlows.ts against the app's REAL
// src/lib/htlcFlows.ts, and get_statement's split against the app's real
// computeStatement with the same split on.
//
// The fixture is the app's own: a real NQ82 relay history captured
// 2026-10-12 (test/fixtures/htlc-relay-nq82.json in the app repo), whose
// expected totals the app's oracle pins (22,926.90086 real / 43,129.56050
// internal each way with no held contracts).

import test from 'node:test'
import assert from 'node:assert/strict'

import { splitHtlcFlows } from '../src/htlcFlows.ts'
import { computeStatement, periodBounds } from '../src/statement.ts'
import type { NimiqTx } from '../src/chain.ts'
import * as appFlows from '../../src/lib/htlcFlows.ts'
import * as appStatement from '../../src/lib/statement.ts'
import fixture from '../../test/fixtures/htlc-relay-nq82.json' with { type: 'json' }

const OWN = fixture.ownAddress as string
const TXS = fixture.txs as NimiqTx[]
const STAKING = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'

const sum = (m: Map<string, { realIn: number; internalIn: number; realOut: number; internalOut: number }>) => {
  const t = { realIn: 0, internalIn: 0, realOut: 0, internalOut: 0 }
  for (const v of m.values()) {
    t.realIn += v.realIn
    t.internalIn += v.internalIn
    t.realOut += v.realOut
    t.internalOut += v.internalOut
  }
  return t
}

// Contracts the fixture's wallet funded, for the held / contract-row vectors.
const funded = [...new Set(TXS.filter((t) => t.sender === OWN && t.toType === 2).map((t) => t.recipient))]

const VECTORS: { name: string; opts?: { heldContracts?: string[]; contractTxs?: NimiqTx[] } }[] = [
  { name: 'no options' },
  { name: 'empty options', opts: {} },
  { name: 'one held contract', opts: { heldContracts: [funded[0]] } },
  { name: 'three held contracts, spaced and lower case', opts: { heldContracts: funded.slice(0, 3).map((a) => a.toLowerCase()) } },
  {
    name: 'a stake made in Pay out of a contract',
    opts: {
      contractTxs: [
        { hash: 'pay-stake-1', sender: funded[1], recipient: STAKING, value: '50000000', fee: '0', timestamp: 1791000000000, toType: 3 },
        // the same row twice through two contract lists: counts once
        { hash: 'pay-stake-1', sender: funded[1], recipient: STAKING, value: '50000000', fee: '0', timestamp: 1791000000000, toType: 3 },
      ],
    },
  },
  {
    name: 'held plus an over-stake (capped at the funding)',
    opts: {
      heldContracts: [funded[2]],
      contractTxs: [{ hash: 'pay-stake-2', sender: funded[3], recipient: STAKING, value: '999999999999', fee: '0', timestamp: 1791000000000, toType: 3 }],
    },
  },
]

test('the fixture still reads as the app oracle pins it', () => {
  const t = sum(splitHtlcFlows(TXS, OWN))
  assert.equal(t.realIn, 2292690086)
  assert.equal(t.realOut, 2292690086)
  assert.equal(t.internalIn, 4312956050)
  assert.equal(t.internalOut, 4312956050)
})

for (const v of VECTORS) {
  test(`same split as the app, tx by tx: ${v.name}`, () => {
    const mine = splitHtlcFlows(TXS, OWN, v.opts)
    const theirs = appFlows.splitHtlcFlows(TXS as any, OWN, v.opts as any)
    assert.equal(mine.size, theirs.size)
    for (const [hash, split] of mine) assert.deepEqual(split, theirs.get(hash), hash)
  })
}

test('the held vector actually moves money from real to internal (the test bites)', () => {
  const plain = sum(splitHtlcFlows(TXS, OWN))
  const held = sum(splitHtlcFlows(TXS, OWN, { heldContracts: funded }))
  assert.ok(held.internalOut > plain.internalOut)
})

test('get_statement with the split: the same numbers as the app, day for day', () => {
  const opts = { heldContracts: [funded[0]] }
  const splits = splitHtlcFlows(TXS, OWN, opts)
  for (const year of [2026]) {
    const mine = computeStatement(TXS, OWN, periodBounds(year), {}, splits)
    const theirs = appStatement.computeStatement(TXS as any, OWN, String(year), {}, opts as any)
    assert.equal(mine.rows.length, theirs.rows.length)
    for (const [i, row] of mine.rows.entries()) {
      const other = theirs.rows[i]
      assert.equal(row.date, other.date)
      assert.equal(row.inNim, other.receivedNim, `in on ${row.date}`)
      assert.equal(row.outNim, other.sentNim, `out on ${row.date}`)
      assert.equal(row.internalInNim, other.internalInNim, `internal in on ${row.date}`)
      assert.equal(row.internalOutNim, other.internalOutNim, `internal out on ${row.date}`)
      assert.equal(row.netNim, other.netNim, `net on ${row.date}`)
    }
    assert.equal(mine.totals.inNim, theirs.totals.receivedNim)
    assert.equal(mine.totals.internalInNim, theirs.totals.internalInNim)
    assert.ok(mine.totals.internalInNim > 0, 'the fixture has internal flow in 2026')
  }
})

test('the split leaves net where the gross figures put it', () => {
  const gross = computeStatement(TXS, OWN, periodBounds(2026), {})
  const split = computeStatement(TXS, OWN, periodBounds(2026), {}, splitHtlcFlows(TXS, OWN))
  assert.ok(Math.abs(gross.totals.netNim - split.totals.netNim) < 1e-6)
  assert.ok(split.totals.inNim < gross.totals.inNim)
})
