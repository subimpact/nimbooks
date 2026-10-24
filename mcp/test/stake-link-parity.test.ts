// A. Stake-link parity: the link this server mints must be the app's link.
//
// A `draft_stake` link is only useful if it opens the app's stake panel with
// the same values the app itself would have put there. So this test imports
// both: `src/stakeLink.ts` from this package, and the app's real
// `src/lib/stakeLink.ts` from outside it. The app module is browser code, but
// the functions under test touch only URLSearchParams and the checksum, which
// Node provides.
//
// Every vector is compared as bytes, then round-tripped through the app's own
// parser, which must see exactly what this port's parser sees.

import test from 'node:test'
import assert from 'node:assert/strict'

import * as mcp from '../src/stakeLink.ts'
import * as app from '../../src/lib/stakeLink.ts'

const VALIDATOR = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const BAD_CHECKSUM = 'NQ00 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'

interface Vector {
  name: string
  params: { amountNim?: number | string | null; validator?: string | null }
}

const VECTORS: Vector[] = [
  { name: 'bare', params: {} },
  { name: 'amount only', params: { amountNim: '5' } },
  { name: 'validator only, spaced', params: { validator: VALIDATOR } },
  { name: 'validator only, flat', params: { validator: VALIDATOR.replace(/\s+/g, '') } },
  { name: 'validator only, lowercase', params: { validator: VALIDATOR.toLowerCase() } },
  { name: 'both', params: { amountNim: 12.5, validator: ` ${VALIDATOR.toLowerCase()} ` } },
  { name: 'five-decimal amount', params: { amountNim: '12.34567' } },
  { name: 'invalid amount dropped', params: { amountNim: '0.000001' } },
  { name: 'bad checksum dropped', params: { validator: BAD_CHECKSUM } },
]

test('built stake links are byte-identical to the app', () => {
  for (const vector of VECTORS) {
    assert.equal(
      mcp.buildStakeLink(vector.params),
      app.buildStakeLink(vector.params),
      `${vector.name}: ${mcp.buildStakeLink(vector.params)}`
    )
  }
})

test('each port-built link parses with the app parser to the same values', () => {
  for (const vector of VECTORS) {
    const link = mcp.buildStakeLink(vector.params)
    assert.match(link, /^https:\/\/nimbooks\.subimpact\.net\/#\/stake/)
    const hash = link.slice(link.indexOf('#'))
    const mine = mcp.parseStakeLink(hash)
    const theirs = app.parseStakeLink(hash)
    assert.ok(mine, `${vector.name}: this port parses its own link`)
    assert.ok(theirs, `${vector.name}: the app parses the port's link`)
    assert.deepEqual(mine, theirs, `${vector.name}: parser values`)
  }
})

test('the vectors reach the values they claim, on both parsers', () => {
  const amount = mcp.parseStakeLink('#/stake?amount=12.34567')
  assert.equal(amount?.amountLuna, 1_234_567)
  assert.deepEqual(amount, app.parseStakeLink('#/stake?amount=12.34567'))

  const spaced = mcp.parseStakeLink(`#/stake?validator=${encodeURIComponent(VALIDATOR)}`)
  assert.equal(spaced?.validator, VALIDATOR.replace(/\s+/g, ''))
  assert.deepEqual(spaced, app.parseStakeLink(`#/stake?validator=${encodeURIComponent(VALIDATOR)}`))

  const badAmount = mcp.parseStakeLink('#/stake?amount=0.000001')
  assert.equal(badAmount?.amountLuna, null)
  assert.equal(badAmount?.warnings.length, 1)
  assert.deepEqual(badAmount, app.parseStakeLink('#/stake?amount=0.000001'))

  const badValidator = mcp.parseStakeLink(`#/stake?validator=${encodeURIComponent(BAD_CHECKSUM)}`)
  assert.equal(badValidator?.validator, null)
  assert.equal(badValidator?.warnings.length, 1)
  assert.deepEqual(badValidator, app.parseStakeLink(`#/stake?validator=${encodeURIComponent(BAD_CHECKSUM)}`))

  // Every non-stake route stays outside this parser, on both sides.
  for (const hash of ['#/verify/abc', '#/invoice/abc', '', '#/stake/', '#/staking']) {
    assert.equal(mcp.parseStakeLink(hash), app.parseStakeLink(hash), hash)
    assert.equal(mcp.parseStakeLink(hash), null, hash)
  }
})
