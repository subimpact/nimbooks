// E. Live smoke — opt-in, because it talks to the public chain.
//
//   npm run smoke
//
// Everything under `npm test` is offline and deterministic. This one is not:
// it drives the built server against a real address over real RPC, which is
// the only way to catch the failures that only the network produces (an
// endpoint that moved, a response shape that changed, a rate limit).
//
// It asserts shapes and sanity, never exact figures: the demo wallet is a live
// account and its balance moves.

import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const DEMO = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const SERVER = resolve('dist/index.js')

if (!process.env.NIMBOOKS_SMOKE) {
  console.error('Refusing to run: set NIMBOOKS_SMOKE=1 (or use `npm run smoke`). This test uses the network.')
  process.exit(1)
}

const text = (r: any): string => (r.content ?? []).map((c: any) => c.text ?? '').join('\n')

let passed = 0
let failed = 0

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`)
  }
}

const client = new Client({ name: 'nimbooks-mcp-smoke', version: '1.0.0' })
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: [SERVER, '--address', DEMO], stderr: 'ignore' })
)

console.log(`nimbooks-mcp live smoke — ${DEMO}\n`)

let seenInvoiceId: string | null = null
let seenReceivedInvoiceId: string | null = null

await step('get_summary returns a funded account', async () => {
  const res = await client.callTool({ name: 'get_summary', arguments: {} })
  assert.notEqual(res.isError, true, text(res))
  const s = JSON.parse(text(res))
  console.log(
    `       balance ${s.balanceNim} NIM · in ${s.inNim} · out ${s.outNim} · ${s.txCount} txs` +
    (s.staked ? ` · staked ${s.staked.activeNim} NIM` : '')
  )
  assert.equal(s.address, DEMO)
  assert.ok(/^\d+$/.test(s.balanceLuna), 'balance is an integer Luna string')
  // The demo wallet is a live account: its liquid balance moves, and a
  // fully-staked wallet legitimately reads 0 (staked NIM sits in the
  // staking contract, reported separately). Funded-ness is proven by
  // activity, not by a positive liquid figure.
  assert.ok(BigInt(s.balanceLuna) >= 0n, 'balance is a valid integer')
  assert.ok(s.txCount > 0, 'the account has transactions')
  assert.ok(BigInt(s.inLuna) > 0n, 'something came in')
})

await step('get_summary nets Nimiq Pay round trips out of in/out (the app\'s split)', async () => {
  const res = await client.callTool({ name: 'get_summary', arguments: {} })
  assert.notEqual(res.isError, true, text(res))
  const s = JSON.parse(text(res))
  console.log(`       real in ${s.inNim} · real out ${s.outNim} · internal ${s.internalInNim} in / ${s.internalOutNim} out`)
  for (const k of ['internalInLuna', 'internalOutLuna']) assert.ok(/^\d+$/.test(s[k]), `${k}: ${s[k]}`)
  // The sample wallet is a Nimiq Pay wallet: its contract round trips exist.
  assert.ok(BigInt(s.internalInLuna) > 0n, 'internal flow found')
  // Net is unchanged by the split: in + internalIn - out - internalOut - fees.
  const net = BigInt(s.inLuna) + BigInt(s.internalInLuna) - BigInt(s.outLuna) - BigInt(s.internalOutLuna) - BigInt(s.feesPaidLuna)
  assert.equal(net.toString(), s.netLuna)
  assert.equal(s.payContractsNote, undefined, `every open contract was read: ${s.payContractsNote}`)
})

await step('get_summary honours a window', async () => {
  const res = await client.callTool({
    name: 'get_summary',
    arguments: { since: '2020-01-01', until: '2020-12-31' },
  })
  const s = JSON.parse(text(res))
  // Nimiq Albatross launched in November 2024, so 2020 must be empty — proof
  // the window is actually applied rather than ignored. The balance stays
  // live (it is a current-state figure, not a windowed one), zero included.
  assert.equal(s.txCount, 0, 'a pre-genesis window is empty')
  assert.ok(BigInt(s.balanceLuna) >= 0n, 'the balance is still live, not windowed')
})

await step('list_transactions returns classified rows', async () => {
  const res = await client.callTool({ name: 'list_transactions', arguments: { limit: 10 } })
  assert.notEqual(res.isError, true, text(res))
  const { transactions } = JSON.parse(text(res))
  assert.ok(Array.isArray(transactions) && transactions.length > 0, 'rows came back')
  const kinds = new Set<string>()
  for (const row of transactions) {
    assert.ok(/^[0-9a-f]{64}$/.test(row.hash), `hash looks like a hash: ${row.hash}`)
    assert.ok(['sent', 'received'].includes(row.direction), `direction: ${row.direction}`)
    assert.ok(/^NQ[0-9A-Z ]+$/.test(row.counterparty), `counterparty: ${row.counterparty}`)
    assert.ok(/^\d+$/.test(row.amountLuna), `amount: ${row.amountLuna}`)
    assert.ok(row.timestamp === null || !Number.isNaN(Date.parse(row.timestamp)), `timestamp: ${row.timestamp}`)
    kinds.add(row.kind)
    if (row.invoiceId && !seenInvoiceId) seenInvoiceId = row.invoiceId
    // Only a payment landing ON the queried payee can read as paid: a row the
    // wallet *sent* carries the same reference, but check_request_paid for
    // this address must not find it. Prefer a received row for the assert.
    if (row.invoiceId && row.direction === 'received' && !seenReceivedInvoiceId) {
      seenReceivedInvoiceId = row.invoiceId
    }
  }
  console.log(`       ${transactions.length} rows · kinds: ${[...kinds].join(', ')}`)
})

await step('get_statement prices days against CoinGecko closes', async () => {
  const year = new Date().getUTCFullYear()
  const res = await client.callTool({ name: 'get_statement', arguments: { year } })
  assert.notEqual(res.isError, true, text(res))
  const s = JSON.parse(text(res))
  console.log(`       ${s.period}: ${s.rows.length} active days, ${s.totals.txCount} txs`)
  for (const row of s.rows) {
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(row.date.startsWith(String(year)), `row inside the period: ${row.date}`)
    assert.ok(row.closeUsd === null || (row.closeUsd > 0 && row.closeUsd < 0.02), `close: ${row.closeUsd}`)
  }
  if (s.rows.length) {
    const priced = s.rows.filter((r: any) => r.closeUsd !== null).length
    console.log(`       ${priced}/${s.rows.length} days priced`)
  }
})

await step('check_request_paid finds a payment that really was made', async () => {
  // Prefer a reference this wallet actually carries (found above); fall back to
  // a known one from the demo account's history.
  const id = seenReceivedInvoiceId ?? seenInvoiceId ?? 'demo000001'
  const res = await client.callTool({ name: 'check_request_paid', arguments: { id } })
  assert.notEqual(res.isError, true, text(res))
  const r = JSON.parse(text(res))
  console.log(`       ${id}: ${r.paid ? `paid, ${r.tx.amountNim} NIM in ${r.tx.hash.slice(0, 10)}…` : 'not found'}`)
  if (seenReceivedInvoiceId) {
    assert.equal(r.paid, true, `the reference seen in history reads as paid: ${text(res)}`)
    assert.ok(/^[0-9a-f]{64}$/.test(r.tx.hash))
  } else {
    // No tagged payment in this wallet's recent history — then the honest
    // answer is "not found", with a note saying how far it looked.
    assert.equal(r.paid, false)
    assert.match(r.note, /No payment tagged/)
  }
})

await step('check_request_paid says no for a reference nobody has paid', async () => {
  const res = await client.callTool({ name: 'check_request_paid', arguments: { id: 'zzzznotreal' } })
  const r = JSON.parse(text(res))
  assert.equal(r.paid, false)
  assert.ok(r.scanned > 0, 'it actually looked')
})

await step('a bad address fails cleanly against the live endpoint', async () => {
  const res = await client.callTool({
    name: 'get_summary',
    arguments: { address: 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGY' },
  })
  assert.equal(res.isError, true)
  assert.match(text(res), /checksum/i)
})

// --- The 1.1 staking tools ---

await step('get_staking reads the staked position', async () => {
  const res = await client.callTool({ name: 'get_staking', arguments: {} })
  assert.notEqual(res.isError, true, text(res))
  const s = JSON.parse(text(res))
  assert.equal(s.staked, true, 'the demo wallet is staked')
  for (const k of ['activeLuna', 'inactiveLuna', 'retiredLuna', 'stakedLuna']) {
    assert.ok(/^\d+$/.test(s[k]), `${k} is an integer Luna string: ${s[k]}`)
    assert.ok(BigInt(s[k]) >= 0n, `${k} is >= 0`)
  }
  console.log(
    `       active ${s.activeNim} NIM` +
      (s.validator ? ` · ${s.validator.name}${s.validator.buildersPool ? ' (builders pool)' : ''}` : '') +
      (s.estimate ? ` · first-year estimate ${s.estimate.firstYearRewardsNim} NIM` : '')
  )
  // Validity, not shape: if the pool details came back, the yield must be
  // a positive number and ImpactZero must be recognised.
  if (s.validator && s.validator.buildersPool !== null) {
    assert.equal(typeof s.validator.netYieldPercent, 'number')
    assert.equal(s.validator.buildersPool, true, 'the demo wallet stakes to the builders pool')
  }
})

await step('list_validators returns the neutral order and the builders pool', async () => {
  const res = await client.callTool({ name: 'list_validators', arguments: {} })
  assert.notEqual(res.isError, true, text(res))
  const s = JSON.parse(text(res))
  assert.ok(Array.isArray(s.validators) && s.validators.length >= 10, 'at least 10 pools came back')
  // The order obeys the rule: producing first, then descending yield, then
  // non-producing; the name only breaks exact ties, so check the groups.
  const firstNonProducing = s.validators.findIndex((v: any) => !v.producing)
  if (firstNonProducing !== -1) {
    assert.ok(s.validators.slice(0, firstNonProducing).every((v: any) => v.producing), 'producing pools come first')
    const producing = s.validators.slice(0, firstNonProducing)
    for (let i = 1; i < producing.length; i++) {
      const a = producing[i - 1].netYieldPercent ?? -1
      const b = producing[i].netYieldPercent ?? -1
      assert.ok(a >= b, `producing order: ${a} >= ${b} (${producing[i - 1].name} then ${producing[i].name})`)
    }
  }
  const pool = s.validators.find((v: any) => v.buildersPool === true)
  assert.ok(pool, 'ImpactZero is in the list with buildersPool true')
  assert.match(pool.name, /ImpactZero/)
  await client.callTool({ name: 'list_validators', arguments: {} }) // memo path: the server must not refetch per call
  console.log(
    `       ${s.validators.length} pools · typical ${s.typicalYieldPercent}% · builders pool: ${pool.name} at rank ${pool.rank}`
  )
})

await step('project_yield projects with the typical rate, offline-free', async () => {
  const res = await client.callTool({ name: 'project_yield', arguments: { amountNim: '1000', years: 3 } })
  assert.notEqual(res.isError, true, text(res))
  const s = JSON.parse(text(res))
  assert.equal(s.rateSource, 'the median of producing pools')
  assert.ok(s.totals.totalRewardsNim > 0, 'a projection of 1000 NIM earns something')
  assert.equal(s.perYear.length, 3)
  console.log(
    `       1000 NIM, 3 years, rate ${s.ratePercent}% (${s.rateSource}): ${s.totals.totalRewardsNim} NIM`
  )
})

await step('get_rewards sums the year for the demo wallet', async () => {
  const res = await client.callTool({ name: 'get_rewards', arguments: {} })
  assert.notEqual(res.isError, true, text(res))
  const s = JSON.parse(text(res))
  assert.ok(s.rewardDays >= 1, 'at least one reward day: this is the staked demo wallet')
  assert.ok(BigInt(s.totalRewardsLuna) > 0n, 'the year has rewards')
  console.log(
    `       ${s.rewardDays} reward days, ${s.totalRewardsNim} NIM` +
      (s.actualYield?.percent != null ? ` · actual ${s.actualYield.percent}% over ${s.actualYield.windowDays} days` : ` · actual: ${s.actualYield?.reason ?? 'null'}`)
  )
})

await client.close()

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
