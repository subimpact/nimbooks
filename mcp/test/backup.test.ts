// C. Backup parsing.
//
// The backup is a file the user moved by hand: it can be truncated, edited,
// half-restored or years old. One bad row must cost the user that row, not the
// other forty-nine — and the cashlink shelf inside it, which holds the private
// keys of links that may still hold NIM, must never be opened at all.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { listBackupInvoices, parseBackup, readBackupFile } from '../src/backup.ts'
import { invoiceUrl } from '../src/invoice.ts'
import { ToolError } from '../src/chain.ts'

// `npm test` runs from the package root, which is where the fixture lives.
const FIXTURE = resolve('test/fixtures/backup.json')
const OWN = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
const OTHER = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const NOW = 1757721600000 // 2025-09-13T00:00:00Z

const read = (p: string) => readFileSync(p, 'utf8')

test('a real backup file parses', () => {
  const file = readBackupFile(FIXTURE, read)
  assert.equal(file.exportedAt, 1757721600000)
  assert.ok(Object.keys(file.keys).length > 0)
})

test('the cashlink shelf never survives parsing — its secret cannot leak', () => {
  const file = readBackupFile(FIXTURE, read)
  assert.equal(file.keys['nimbooks.cashlinks.v1'], undefined)
  // Belt and braces: the marker must be absent from everything downstream.
  const everything = JSON.stringify(file) + JSON.stringify(listBackupInvoices(file, OWN, invoiceUrl, NOW))
  assert.equal(everything.includes('SECRET-MUST-NEVER-APPEAR-IN-OUTPUT'), false)
  assert.equal(everything.includes('secret'), false)
})

test('good invoices come back, malformed ones are skipped', () => {
  const { invoices, skipped } = listBackupInvoices(readBackupFile(FIXTURE, read), OWN, invoiceUrl, NOW)
  assert.deepEqual(
    invoices.map((i) => i.id),
    ['pend1ng001', 'pa1d000002', 'exp1red003', 'payer00004']
  )
  // no payee, numeric amount, illegal id, over the supply cap, null, a string
  assert.equal(skipped, 6)
})

test('status follows the app rule: paid wins, then expiry', () => {
  const { invoices } = listBackupInvoices(readBackupFile(FIXTURE, read), OWN, invoiceUrl, NOW)
  const byId = Object.fromEntries(invoices.map((i) => [i.id, i]))
  assert.equal(byId['pend1ng001'].status, 'pending')
  assert.equal(byId['pa1d000002'].status, 'paid')
  assert.equal(byId['exp1red003'].status, 'expired')
  assert.equal(byId['pa1d000002'].paidTxHash?.length, 64)
  assert.equal(byId['payer00004'].role, 'payer')
})

test('amounts are reported exactly, in both units', () => {
  const { invoices } = listBackupInvoices(readBackupFile(FIXTURE, read), OWN, invoiceUrl, NOW)
  const byId = Object.fromEntries(invoices.map((i) => [i.id, i]))
  assert.equal(byId['pend1ng001'].amountLuna, '1250000')
  assert.equal(byId['pend1ng001'].amountNim, '12.5')
  assert.equal(byId['exp1red003'].amountNim, '1')
  assert.equal(byId['pend1ng001'].memo, 'September retainer')
  assert.equal(byId['pa1d000002'].memo, 'Kaffee ☕ für Anna')
})

test('each row carries a link that reopens the request in the app', () => {
  const { invoices } = listBackupInvoices(readBackupFile(FIXTURE, read), OWN, invoiceUrl, NOW)
  for (const inv of invoices) assert.match(inv.link, /^https:\/\/nimbooks\.subimpact\.net\/#\/invoice\/[A-Za-z0-9_-]+$/)
})

test('the address decides which slot is read, whatever its spelling', () => {
  const file = readBackupFile(FIXTURE, read)
  for (const spelling of [OWN, OWN.replace(/\s/g, ''), OWN.toLowerCase()]) {
    const { invoices } = listBackupInvoices(file, spelling, invoiceUrl, NOW)
    assert.equal(invoices.length, 4, spelling)
  }
  // Another account's requests stay in that account.
  assert.deepEqual(
    listBackupInvoices(file, OTHER, invoiceUrl, NOW).invoices.map((i) => i.id),
    ['other00009']
  )
  // An account with nothing in the file is empty, not an error.
  const { invoices } = listBackupInvoices(file, 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001', invoiceUrl, NOW)
  assert.equal(invoices.length, 0)
})

test('a slot of unparseable JSON costs that slot and nothing else', () => {
  // The fixture holds one. Reading a third account must still work, and the
  // count of skipped entries must say so rather than the call failing.
  const file = readBackupFile(FIXTURE, read)
  const { invoices, skipped } = listBackupInvoices(
    file,
    'NQ22 5RNP 0CAY 2TXT NJDR CY9L E9RS 8XKB 7NG3',
    invoiceUrl,
    NOW
  )
  assert.equal(invoices.length, 0)
  assert.equal(skipped, 1)
})

test('files that are not NimBooks backups are refused clearly', () => {
  for (const bad of [
    '',
    'not json',
    '[]',
    'null',
    '{"app":"somethingelse","version":1,"keys":{}}',
    '{"app":"nimbooks","version":2,"keys":{}}',
    '{"app":"nimbooks","version":1}',
    '{"app":"nimbooks","version":1,"keys":[]}',
  ]) {
    assert.equal(parseBackup(bad), null, JSON.stringify(bad))
    assert.throws(
      () => readBackupFile('/fake/path.json', () => bad),
      (e: unknown) => e instanceof ToolError && /Backup → Copy/.test((e as Error).message),
      JSON.stringify(bad)
    )
  }
})

test('a missing file is a message, not a crash', () => {
  assert.throws(
    () => readBackupFile('/no/such/backup.json', read),
    (e: unknown) => e instanceof ToolError && /Could not read the backup file/.test((e as Error).message)
  )
})

test('non-string values in keys are dropped rather than trusted', () => {
  const file = parseBackup(
    JSON.stringify({
      app: 'nimbooks',
      version: 1,
      exportedAt: 'not a number',
      keys: { 'nimbooks:theme': 'dark', 'nimbooks:invoices': { not: 'a string' } },
    })
  )
  assert.ok(file)
  assert.equal(file!.exportedAt, 0)
  assert.deepEqual(Object.keys(file!.keys), ['nimbooks:theme'])
})
