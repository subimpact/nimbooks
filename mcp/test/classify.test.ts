// B. Classification fixtures.
//
// Every row this server hands an assistant carries a `kind`, and that kind is
// what an accountant reads. It has to mean the same thing it means in the app:
// a stake is not a payment, a validator payout is not income from a customer,
// and a cashlink's protocol tag is not a note someone wrote.
//
// The expectations are pinned twice: against a hand-written table (so a change
// in both files can't quietly agree on something wrong), and against the app's
// own `src/lib/chain.ts`, imported here.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyTx,
  decodeMemo,
  isCashlinkMemo,
  memoForRow,
  normalizeAddress,
  rollUpRestakeRewards,
  spacedAddress,
  txLabel,
  type NimiqTx,
} from '../src/chain.ts'
import * as app from '../../src/lib/chain.ts'
import { parseInvoiceMemo } from '../src/invoice.ts'

const OWN = 'NQ43Y1RHP1K7JH78LRTS95RYGAUUUBDKFFGX'
const OTHER = 'NQ08ACT8T0FEPTG8P5RLH2S3QGXHV15RNVXY'
const STAKING = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
const VALIDATOR_PAYOUT = 'NQ81 C01N BASE 0000 0000 0000 0000 0000 0000'

// Hex of the memos the chain actually carries.
const hex = (s: string) =>
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const CASHLINK_FUNDING_HEX = '0082809287' // 'CASH' in Nimiq's extra-data encoding
const CASHLINK_CLAIMING_HEX = '008b888d8a' // 'LINK'

function tx(partial: Partial<NimiqTx>): NimiqTx {
  return {
    hash: 'f'.repeat(64),
    sender: OTHER,
    recipient: OWN,
    value: '100000',
    fee: '0',
    timestamp: 1757721600000,
    toType: 0,
    ...partial,
  }
}

const CASES: { name: string; tx: NimiqTx; kind: string }[] = [
  { name: 'received payment', tx: tx({}), kind: 'payment' },
  { name: 'sent payment', tx: tx({ sender: OWN, recipient: OTHER }), kind: 'payment' },
  {
    name: 'staking deposit (toType 3 to the staking contract)',
    tx: tx({ sender: OWN, recipient: STAKING, toType: 3 }),
    kind: 'stake',
  },
  {
    name: 'unstake (from the staking contract, toType 3)',
    tx: tx({ sender: STAKING, recipient: OWN, toType: 3 }),
    kind: 'unstake',
  },
  {
    name: 'withdrawal from the staking contract to a basic account',
    tx: tx({ sender: STAKING, recipient: OWN, toType: 0 }),
    kind: 'unstake',
  },
  {
    name: 'validator reward payout',
    tx: tx({ sender: VALIDATOR_PAYOUT, recipient: OWN }),
    kind: 'reward',
  },
  { name: 'HTLC funding (Nimiq Pay swap)', tx: tx({ sender: OWN, recipient: OTHER, toType: 2 }), kind: 'swap' },
  { name: 'vesting contract creation', tx: tx({ sender: OWN, recipient: OTHER, toType: 1 }), kind: 'vesting' },
  {
    name: 'a transaction involving neither side of this account',
    tx: tx({ sender: OTHER, recipient: VALIDATOR_PAYOUT }),
    kind: 'unknown',
  },
  {
    name: 'cashlink funding is still a payment by kind',
    tx: tx({ sender: OWN, recipient: OTHER, data: CASHLINK_FUNDING_HEX }),
    kind: 'payment',
  },
  {
    name: 'invoice-tagged payment is a payment',
    tx: tx({ data: hex('nimbooks:invoice:a1b2c3d4e5') }),
    kind: 'payment',
  },
]

test('kinds match the expected table', () => {
  for (const c of CASES) assert.equal(txLabel(c.tx, OWN), c.kind, c.name)
})

test('kinds match the app, row for row', () => {
  for (const c of CASES) {
    assert.equal(txLabel(c.tx, OWN), app.txLabel(c.tx, OWN), `txLabel: ${c.name}`)
    assert.equal(classifyTx(c.tx, OWN), app.classifyTx(c.tx, OWN), `classifyTx: ${c.name}`)
  }
})

test('address spelling never changes the kind', () => {
  // The index hands addresses back spaced; links and hex hand them back flat.
  const spaced = spacedAddress(OWN)
  for (const c of CASES) {
    assert.equal(txLabel(c.tx, spaced), txLabel(c.tx, OWN), c.name)
    const respelled = { ...c.tx, sender: spacedAddress(c.tx.sender), recipient: spacedAddress(c.tx.recipient) }
    assert.equal(txLabel(respelled, OWN), txLabel(c.tx, OWN), `${c.name} (spaced tx)`)
  }
})

test('cashlink tags are named, not printed', () => {
  for (const tag of [CASHLINK_FUNDING_HEX, CASHLINK_CLAIMING_HEX]) {
    assert.equal(isCashlinkMemo(decodeMemo(tag)), true, tag)
    // The tag bytes are not printable text, so decodeMemo hands back the hex —
    // which is exactly what the row must not show.
    assert.equal(decodeMemo(tag), tag)
    const row = memoForRow(tx({ sender: OWN, recipient: OTHER, data: tag }), 'payment')
    assert.equal(row, 'Cashlink')
  }
  // Nimiq Pay's rail sends the word rather than the bytes.
  assert.equal(memoForRow(tx({ data: hex('Cashlink') }), 'payment'), 'Cashlink')
  // A note that merely mentions the word is a note.
  assert.equal(memoForRow(tx({ data: hex('Cashlink for Ana') }), 'payment'), 'Cashlink for Ana')
})

test('staking payloads never reach the memo column', () => {
  // The data field of a staking transaction is a signalling payload, not a note.
  const staked = tx({ sender: OWN, recipient: STAKING, toType: 3, data: '0700' + 'ab'.repeat(20) })
  assert.equal(memoForRow(staked, txLabel(staked, OWN)), '')
})

test('memos decode exactly as the app decodes them', () => {
  const vectors = [
    hex('Invoice 0042 — September retainer'),
    hex('Kaffee ☕ für Anna 🇩🇪'),
    hex('nimbooks:invoice:a1b2c3d4e5'),
    hex(hex('hex of hex, as older builds sent')), // the double-encoded case
    CASHLINK_FUNDING_HEX,
    CASHLINK_CLAIMING_HEX,
    'deadbeef', // valid hex that is not text
    '0x' + hex('with an 0x prefix'),
    'nothexatall!!',
    '',
  ]
  for (const v of vectors) assert.equal(decodeMemo(v), app.decodeMemo(v), JSON.stringify(v))
})

test('the invoice reference is recovered from a real-shaped transaction', () => {
  const paid = tx({
    hash: '3f7a1c8e9b2d4a6f5c0e8d7b3a9f1e2c4d6b8a0f5e3c7d9b1a2f4e6c8d0b3a5f',
    sender: OTHER,
    recipient: OWN,
    value: '1250000',
    fee: '138',
    data: hex('nimbooks:invoice:a1b2c3d4e5'),
  })
  assert.equal(parseInvoiceMemo(decodeMemo(paid.data)), 'a1b2c3d4e5')
  assert.equal(txLabel(paid, OWN), 'payment')
  // The row still shows the reference — it is how a human ties the two together.
  assert.equal(memoForRow(paid, 'payment'), 'nimbooks:invoice:a1b2c3d4e5')
})

test('failed transactions are recognisable so callers can exclude them', () => {
  const failed = tx({ executionResult: false })
  assert.equal(failed.executionResult, false)
  // Classification does not change — the exclusion is the caller's, as in the app.
  assert.equal(txLabel(failed, OWN), 'payment')
})

// --- Restaking rewards (synthesized rows) ---

// The tx index never returns staking activity: reward rows are built from the
// v2 restake API with `synthetic: 'reward'`, and only that marker can classify
// them — the validator's real address also sends ordinary payments it must not
// be confused with. This mirrors the app's classifier exactly.
test('a synthesized reward row reads as income, never as counterparty money', () => {
  const reward = tx({ sender: VALIDATOR_PAYOUT, recipient: OWN, synthetic: 'reward' })
  assert.equal(txLabel(reward, OWN), 'reward')
  assert.equal(classifyTx(reward, OWN), app.classifyTx(reward, OWN))
})

test('a validator’s ordinary payment is a payment — only the marker says reward', () => {
  // The NQ81 C01N BASE prefix is the classic reward sender: the address rule
  // alone already reads it as a reward, in both implementations.
  const classic = tx({ sender: VALIDATOR_PAYOUT, recipient: OWN })
  assert.equal(txLabel(classic, OWN), 'reward')
  assert.equal(classifyTx(classic, OWN), app.classifyTx(classic, OWN))
  // Restaking rewards arrive from the validator’s *own* address (e.g.
  // NQ29 …), which also sends ordinary payments — only the synthetic marker
  // tells the two apart, exactly as in the app.
  const validator = 'NQ29 FBVT B4GM S27H UBP4 1MTC GNKQ VPBT 099M'
  const ordinary = tx({ sender: validator, recipient: OWN })
  assert.equal(txLabel(ordinary, OWN), 'payment')
  assert.equal(classifyTx(ordinary, OWN), app.classifyTx(ordinary, OWN))
  const rewarded = tx({ sender: validator, recipient: OWN, synthetic: 'reward' })
  assert.equal(txLabel(rewarded, OWN), 'reward')
  assert.equal(classifyTx(rewarded, OWN), app.classifyTx(rewarded, OWN))
})

test('restaking reward rows collapse one day per validator, like the app', () => {
  const own = OWN
  const groups = [
    { sender_address: VALIDATOR_PAYOUT, time_window: '2026-09-09T08:00:00.000Z', aggregated_value: 174 },
    { sender_address: VALIDATOR_PAYOUT, time_window: '2026-09-09T12:00:00.000Z', aggregated_value: 2928 },
    { sender_address: VALIDATOR_PAYOUT, time_window: '2026-09-10T04:15:00.000Z', aggregated_value: 1000 },
    { sender_address: 'NQ29 FBVT B4GM S27H UBP4 1MTC GNKQ VPBT 099M', time_window: '2026-09-09T08:00:00.000Z', aggregated_value: 500 },
    // Invalid rows are dropped, never summed.
    { sender_address: VALIDATOR_PAYOUT, time_window: 'not-a-date', aggregated_value: 999 },
    { sender_address: VALIDATOR_PAYOUT, time_window: '2026-09-11T00:00:00.000Z', aggregated_value: -5 },
  ] as any
  const rows = rollUpRestakeRewards(groups, own) as NimiqTx[]
  assert.equal(rows.length, 3, 'three valid day/validator buckets')
  for (const r of rows) {
    assert.equal(r.synthetic, 'reward')
    assert.equal(txLabel(r, own), 'reward')
    assert.equal(r.recipient, own)
  }
  const day1 = rows.find((r) => r.hash.includes('2026-09-09') && r.sender === VALIDATOR_PAYOUT)
  assert.ok(day1, 'the two 09/09 windows collapse into one row')
  assert.equal(day1!.value, '3102', '174 + 2928')
  assert.ok(rows.every((r) => r.fee === '0'))
})

// --- Address handling ---

test('addresses are accepted the way people write them', () => {
  const spaced = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
  assert.equal(normalizeAddress(spaced), OWN)
  assert.equal(normalizeAddress(spaced.toLowerCase()), OWN)
  assert.equal(normalizeAddress(OWN), OWN)
  assert.equal(normalizeAddress(`  ${spaced}  `), OWN)
  assert.equal(spacedAddress(OWN), spaced)
})

test('hex addresses convert to the same account', () => {
  // The staking contract is 19 zero bytes and a 1 — a hex form with a known
  // user-friendly spelling, so the conversion is checkable by eye.
  assert.equal(normalizeAddress('00'.repeat(19) + '01'), STAKING.replace(/\s/g, ''))
  assert.equal(normalizeAddress('0x' + '00'.repeat(19) + '01'), STAKING.replace(/\s/g, ''))
})

test('a mistyped address is refused, not silently looked up', () => {
  const cases: [string, RegExp][] = [
    ['NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGY', /checksum/i], // last char wrong
    ['NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFG', /not a Nimiq address/i], // too short
    ['NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGO', /never use/i], // O is not in the alphabet
    ['', /No address given/i],
    ['0xdeadbeef', /not a Nimiq address/i],
    ['just some text', /not a Nimiq address/i],
  ]
  for (const [input, pattern] of cases) {
    assert.throws(() => normalizeAddress(input), pattern, input)
  }
})
