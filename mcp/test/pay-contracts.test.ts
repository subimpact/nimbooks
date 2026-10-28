// Which Nimiq Pay contracts get read for the netting, with the RPC mocked:
// only contracts the wallet funded and that have not paid it all back; a
// contract with a balance counts as held; its own rows come back for the
// stakes made inside Pay; a read that fails is named, not hidden; and a
// second answer inside five minutes reuses the reads. No network.

import test from 'node:test'
import assert from 'node:assert/strict'

import { clearPayContractCache, getPayContractContext, type NimiqTx } from '../src/chain.ts'

const OWN = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const OWN_FLAT = OWN.replace(/\s+/g, '')
const SETTLED = 'NQ1100000000000000000000000000000000'
const HELD = 'NQ2200000000000000000000000000000000'
const STAKED_OUT = 'NQ3300000000000000000000000000000000'
const BROKEN = 'NQ4400000000000000000000000000000000'
const STAKING = 'NQ7700000000000000000000000000000001'

const tx = (hash: string, sender: string, recipient: string, value: number, toType = 0): NimiqTx => ({
  hash,
  sender,
  recipient,
  value: String(value),
  fee: '0',
  timestamp: 1791000000000,
  executionResult: true,
  toType,
})

const BASIC: NimiqTx[] = [
  tx('f1', OWN_FLAT, SETTLED, 1000, 2),
  tx('r1', SETTLED, OWN_FLAT, 1000), // fully back: never read
  tx('f2', OWN_FLAT, HELD, 500, 2), // nothing back, still has a balance
  tx('f3', OWN_FLAT, STAKED_OUT, 700, 2), // staked from inside Pay
  tx('f4', OWN_FLAT, BROKEN, 300, 2), // its reads fail
  tx('p1', 'NQ5500000000000000000000000000000000', OWN_FLAT, 42), // an ordinary payment
]

const CONTRACT_ROWS: Record<string, any[]> = {
  // Every contract's own history holds at least its funding row.
  [HELD]: [{ hash: 'f2', from: OWN_FLAT, to: HELD, value: 500, fee: 0, timestamp: 1791000000000, toType: 2, executionResult: true }],
  [STAKED_OUT]: [
    { hash: 's1', from: STAKED_OUT, to: STAKING, value: 700, fee: 0, timestamp: 1791000001000, toType: 3, executionResult: true },
    { hash: 'f3', from: OWN_FLAT, to: STAKED_OUT, value: 700, fee: 0, timestamp: 1791000000000, toType: 2, executionResult: true },
  ],
}
const BALANCES: Record<string, number> = { [HELD]: 500, [STAKED_OUT]: 0 }

const realFetch = globalThis.fetch
let reads: string[] = []

test.before(() => {
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { method, params } = JSON.parse(init.body)
    const addr = params[0] as string
    reads.push(`${method}:${addr}`)
    if (addr === BROKEN) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response
    const data =
      method === 'getAccountByAddress'
        ? { address: addr, balance: BALANCES[addr] ?? 0, type: 'htlc' }
        : method === 'getTransactionsByAddress'
          ? params[2] === null
            ? (CONTRACT_ROWS[addr] ?? [])
            : []
          : null
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { data } }) } as unknown as Response
  }) as unknown as typeof fetch
})

test.after(() => {
  globalThis.fetch = realFetch
})

test('reads only the unsettled contracts, finds the held one and the Pay stake, names the failure', async () => {
  reads = []
  clearPayContractCache()
  const ctx = await getPayContractContext(OWN, BASIC)
  assert.equal(ctx.checked, 3)
  assert.equal(ctx.skipped, 0)
  assert.deepEqual(ctx.heldContracts, [HELD])
  assert.deepEqual(ctx.failed, [BROKEN])
  assert.deepEqual(
    ctx.contractTxs.filter((t) => t.toType === 3).map((t) => [t.hash, t.sender, t.recipient]),
    [['s1', STAKED_OUT, STAKING]]
  )
  assert.ok(!reads.some((r) => r.endsWith(SETTLED)), 'a settled contract is never read')
})

test('a second answer reuses the reads (only the failed one is asked again)', async () => {
  reads = []
  const ctx = await getPayContractContext(OWN, BASIC)
  assert.deepEqual(ctx.heldContracts, [HELD])
  assert.ok(reads.every((r) => r.endsWith(BROKEN)), reads.join(', '))
})

test('the offline gate reads nothing and reports every open contract as unread', async () => {
  reads = []
  clearPayContractCache()
  process.env.NIMBOOKS_MCP_NO_CONTRACTS = '1'
  try {
    const ctx = await getPayContractContext(OWN, BASIC)
    assert.equal(reads.length, 0)
    assert.equal(ctx.failed.length, 3)
  } finally {
    delete process.env.NIMBOOKS_MCP_NO_CONTRACTS
  }
})

test('a wallet that never used Pay contracts costs no reads', async () => {
  reads = []
  const ctx = await getPayContractContext(OWN, [BASIC[5]])
  assert.equal(ctx.checked, 0)
  assert.equal(reads.length, 0)
})

test('a contract whose history comes back empty is named as unread, not treated as settled', async () => {
  reads = []
  clearPayContractCache()
  const saved = CONTRACT_ROWS[HELD]
  CONTRACT_ROWS[HELD] = []
  try {
    const ctx = await getPayContractContext(OWN, BASIC)
    assert.ok(ctx.failed.includes(HELD))
    assert.ok(!ctx.heldContracts.includes(HELD))
  } finally {
    CONTRACT_ROWS[HELD] = saved
  }
})
