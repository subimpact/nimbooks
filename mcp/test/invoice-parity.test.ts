// A. Invoice parity — the fence that matters.
//
// A link this server mints must be the *same bytes* the app would have minted,
// and must decode in the app's own decoder to the same fields. So this test
// imports both: `src/invoice.ts` from this package, and the app's real
// `src/lib/invoice.ts` from outside it. If the two ever drift, a request
// drafted through an assistant stops opening in NimBooks, and that is the
// whole product.
//
// The app module is browser code (`btoa`, `escape`), which Node provides as
// globals — nothing is stubbed or shimmed here, so what is compared is the
// genuine article.

import test from 'node:test'
import assert from 'node:assert/strict'

import * as mcp from '../src/invoice.ts'
import * as app from '../../src/lib/invoice.ts'

const PAYEE = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
const PAYER = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const ID = 'a1b2c3d4e5' // injected, so the comparison is deterministic
const CREATED_AT = 1757721600000 // 2025-09-13T00:00:00Z — fixed, same reason

const AMOUNTS = ['1', '0.5', '12.5', '100000', '0.000001']
const MEMOS: Record<string, string | undefined> = {
  ascii: 'Invoice 0042 — September retainer',
  unicode: 'Kaffee ☕ für Anna 🇩🇪 — 日本語も',
  empty: undefined,
}
const EXPIRIES: Record<string, number | undefined> = {
  none: undefined,
  set: CREATED_AT + 7 * 24 * 60 * 60 * 1000,
}

test('parseNimToLuna agrees with the app, including what it refuses', () => {
  for (const amount of AMOUNTS) {
    assert.equal(
      mcp.parseNimToLuna(amount),
      app.parseNimToLuna(amount),
      `parseNimToLuna("${amount}")`
    )
  }
  // 0.000001 NIM is a tenth of a Luna: both sides must refuse it rather than
  // round it into existence.
  assert.equal(mcp.parseNimToLuna('0.000001'), null)
  assert.equal(app.parseNimToLuna('0.000001'), null)
})

test('encoded links are byte-identical to the app across every vector', () => {
  let compared = 0
  for (const amount of AMOUNTS) {
    const luna = mcp.parseNimToLuna(amount)
    if (luna === null) continue // refused by both (asserted above)
    for (const [memoName, memo] of Object.entries(MEMOS)) {
      for (const [expiryName, expiresAt] of Object.entries(EXPIRIES)) {
        for (const payer of [undefined, PAYER]) {
          const payload = {
            app: 'nimbooks' as const,
            v: 1 as const,
            id: ID,
            payee: PAYEE,
            amountNim: luna,
            createdAt: CREATED_AT,
            ...(payer ? { payer } : {}),
            ...(memo ? { memo } : {}),
            ...(expiresAt ? { expiresAt } : {}),
          }
          const mine = mcp.encodeInvoice(payload)
          const theirs = app.encodeInvoice(payload)
          assert.equal(
            mine,
            theirs,
            `amount=${amount} memo=${memoName} expiry=${expiryName} payer=${payer ? 'set' : 'none'}`
          )
          compared++
        }
      }
    }
  }
  assert.equal(compared, 4 * 3 * 2 * 2, 'every vector combination was compared')
})

test('the app decodes what this server encodes, field for field', () => {
  for (const amount of AMOUNTS) {
    const luna = mcp.parseNimToLuna(amount)
    if (luna === null) continue
    for (const [, memo] of Object.entries(MEMOS)) {
      for (const [, expiresAt] of Object.entries(EXPIRIES)) {
        const payload = {
          app: 'nimbooks' as const,
          v: 1 as const,
          id: ID,
          payee: PAYEE,
          amountNim: luna,
          createdAt: CREATED_AT,
          ...(memo ? { memo } : {}),
          ...(expiresAt ? { expiresAt } : {}),
        }
        const encoded = mcp.encodeInvoice(payload)
        const decodedByApp = app.decodeInvoice(encoded)
        assert.ok(decodedByApp, `app decoded ${amount}/${memo ?? 'no memo'}`)
        // The payee is normalised (spaces stripped, upper-cased) on the way in;
        // everything else must survive untouched.
        assert.deepEqual(decodedByApp, {
          app: 'nimbooks',
          v: 1,
          id: ID,
          payee: PAYEE.replace(/\s+/g, '').toUpperCase(),
          amountNim: luna,
          createdAt: CREATED_AT,
          ...(memo ? { memo } : {}),
          ...(expiresAt ? { expiresAt } : {}),
        })
        // …and the round trip closes on this side too.
        assert.deepEqual(mcp.decodeInvoice(encoded), decodedByApp)
      }
    }
  }
})

test('this server decodes what the app encodes', () => {
  const payload = {
    app: 'nimbooks' as const,
    v: 1 as const,
    id: ID,
    payee: PAYEE,
    amountNim: '1250000',
    createdAt: CREATED_AT,
    memo: 'Round trip 🔁',
    expiresAt: CREATED_AT + 3600000,
  }
  const encodedByApp = app.encodeInvoice(payload)
  assert.deepEqual(mcp.decodeInvoice(encodedByApp), app.decodeInvoice(encodedByApp))
})

test('the share route is the app route, so the link opens in the app', () => {
  const payload = {
    app: 'nimbooks' as const,
    v: 1 as const,
    id: ID,
    payee: PAYEE,
    amountNim: '100000',
    createdAt: CREATED_AT,
  }
  assert.equal(mcp.invoiceRoute(payload), app.invoiceRoute(payload))
  assert.equal(
    mcp.invoiceUrl(payload),
    `https://nimbooks.subimpact.net/${app.invoiceRoute(payload)}`
  )
})

test('the on-chain reference and its parser match the app', () => {
  for (const id of [ID, 'short', '0a-1b-2c']) {
    assert.equal(mcp.invoiceMemo(id), app.invoiceMemo(id))
    assert.equal(mcp.parseInvoiceMemo(mcp.invoiceMemo(id)), id)
    assert.equal(app.parseInvoiceMemo(mcp.invoiceMemo(id)), id)
  }
  // A memo that is not a reference must not be read as one, on either side.
  for (const notARef of ['Coffee ☕', 'nimbooks:receipt:abc', '', 'nimbooks:invoice:'])
    assert.equal(mcp.parseInvoiceMemo(notARef), app.parseInvoiceMemo(notARef), notARef)
})

test('validation refuses the same payloads the app refuses', () => {
  const base = {
    app: 'nimbooks',
    v: 1,
    id: ID,
    payee: PAYEE.replace(/\s+/g, ''),
    amountNim: '100000',
    createdAt: CREATED_AT,
  }
  const bad: unknown[] = [
    { ...base, id: 'not a valid id!' }, // the id becomes on-chain data
    { ...base, id: 'x'.repeat(25) },
    { ...base, payee: 'NQ43 NOT AN ADDRESS' },
    { ...base, amountNim: '0' },
    { ...base, amountNim: '-1' },
    { ...base, amountNim: '200000000000001' }, // over the supply cap
    { ...base, amountNim: 100000 }, // number, not a string
    { ...base, createdAt: 'yesterday' },
    { ...base, v: 2 },
    { ...base, app: 'notnimbooks' },
    null,
    'nope',
  ]
  for (const x of bad) {
    assert.equal(mcp.isValidInvoice(x), false, JSON.stringify(x))
    assert.equal(app.isValidInvoice(x), false, JSON.stringify(x))
  }
  assert.equal(mcp.isValidInvoice(base), true)
  assert.equal(app.isValidInvoice(base), true)
})

test('formatLunaExact matches the app (no float drift, no trailing zeros)', () => {
  for (const luna of ['1', '50000', '100000', '1250000', '10000000000', '0', '200000000000000'])
    assert.equal(mcp.formatLunaExact(luna), app.formatLunaExact(luna), luna)
})

test('generated ids are the shape the app generates and accepts', () => {
  for (let i = 0; i < 50; i++) {
    const id = mcp.newInvoiceId()
    assert.match(id, /^[0-9a-z]{1,10}$/)
    assert.equal(app.isValidInvoice({ app: 'nimbooks', v: 1, id, payee: PAYEE, amountNim: '1', createdAt: 1 }), true)
  }
})
