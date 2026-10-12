// Oracle for the heartbeat's transaction read in src/lib/chain.ts (refreshTransactionHead).
// The chain, the clock and localStorage are stubbed, so every case is deterministic.
// Fixed before the change: the implementation must make this pass unchanged.
// Run: node test/tx-head-oracle.cjs
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const root = path.resolve(__dirname, '..')
const out = path.join(os.tmpdir(), `chain-head-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/chain.ts --file ${out} --format cjs --platform node --no-codeSplitting`, { cwd: root, stdio: 'pipe' })

// ---- stubs -------------------------------------------------------------------
// localStorage: store entries are enumerable own keys, so Object.keys() sees them
// the way the browser's storage object does.
const ls = {}
const lsMethods = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null),
  setItem: (k, v) => {
    ls[k] = String(v)
  },
  removeItem: (k) => {
    delete ls[k]
  },
}
for (const [name, fn] of Object.entries(lsMethods)) Object.defineProperty(ls, name, { value: fn, enumerable: false })
global.localStorage = ls

// Date.now is driven by the test.
let clock = Date.now()
Date.now = () => clock

// fetch: JSON-RPC over an in-memory chain, newest first per address.
const clean = (a) => String(a).replace(/\s+/g, '').toUpperCase()
const chains = new Map()
const rpcLog = []
let callNo = 0
let failCalls = new Set()
let answer = null // optional override: (method, params) => json | undefined
global.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  callNo++
  rpcLog.push({ method: body.method, params: body.params })
  if (failCalls.has(callNo)) throw new TypeError('network down')
  const respond = (json) => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, ...json }) })
  if (answer) {
    const custom = answer(body.method, body.params)
    if (custom) return respond(custom)
  }
  if (body.method === 'getTransactionsByAddress') {
    const [addr, max, cursor] = body.params
    const rows = chains.get(clean(addr)) || []
    const start = cursor === null ? 0 : rows.findIndex((r) => r.hash === cursor) + 1
    return respond({ result: { data: rows.slice(start, start + max), metadata: null } })
  }
  return respond({ error: { message: 'No staker with address: x' } })
}

const chain = require(out)
const {
  refreshTransactionHead,
  getNimiqTransactionHistory,
  clearTxCache,
  sameTxList,
  sameStakingHolding,
  fetchStakingHolding,
  getStakingHolding,
} = chain

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}

// ---- helpers -----------------------------------------------------------------
const ADDR = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
const ADDR2 = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
let seq = 0
const row = (tag, ts, result = true, value = 100000) => ({
  hash: `${tag}-${seq++}`,
  from: 'NQ05 R770 0Y3C BTQN 1L2Y USGF 8JNA 0VLA PLQJ',
  to: ADDR,
  fromType: 0,
  toType: 0,
  value,
  fee: 0,
  timestamp: ts,
  executionResult: result,
  blockNumber: 1000 + seq,
  proof: 'ab',
  senderData: '',
  recipientData: '',
})
// Adds n new rows on top (newest) of an address's chain and returns the new rows, newest first.
let tsBase = 1_790_000_000_000
const mine = (address, n, tag = 'n') => {
  const rows = chains.get(clean(address)) || []
  const fresh = []
  for (let i = 0; i < n; i++) {
    tsBase += 60_000
    fresh.push(row(tag, tsBase))
  }
  chains.set(clean(address), [...fresh.slice().reverse(), ...rows])
  return fresh
}
const hashes = (list) => list.map((t) => t.hash)
const slot = (address) => JSON.parse(ls[`nimbooks:txs:${clean(address)}`] || 'null')
const calls = (method) => rpcLog.filter((c) => !method || c.method === method).length
const resetLog = () => {
  rpcLog.length = 0
  callNo = 0
}
const sameHashes = (a, b) => a.length === b.length && a.every((t, i) => t.hash === b[i].hash)

;(async () => {
  // 1. Cold start: no slot, so the heartbeat walks the whole history and keeps it.
  mine(ADDR, 120, 'cold')
  for (const k of Object.keys(ls)) if (k.startsWith('nimbooks:txs')) delete ls[k]
  resetLog()
  const cold = await refreshTransactionHead(ADDR)
  check('cold start walks the full history (120 rows)', cold.length === 120, cold.length)
  check('cold start matches the chain order', sameHashes(cold, chains.get(clean(ADDR))))
  check('cold start writes a complete slot', slot(ADDR) && slot(ADDR).partial === undefined && slot(ADDR).txs.length === 120)

  // 2. Warm tick with 3 new payments: one head page, the new rows on top, nothing lost.
  const fresh3 = mine(ADDR, 3, 'new')
  resetLog()
  const warm = await refreshTransactionHead(ADDR)
  check('warm tick reads only the newest page', calls('getTransactionsByAddress') === 1 && calls() === 1, `calls=${calls()}`)
  // mine() returns rows oldest first; the list is newest first, so compare reversed.
  check('warm tick puts the 3 new rows on top', sameHashes(warm.slice(0, 3), [...fresh3].reverse()), warm.slice(0, 3).map((t) => t.hash).join(','))
  check('warm tick keeps all 123 rows in newest-first order', sameHashes(warm, chains.get(clean(ADDR))), warm.length)
  check('warm tick writes the new slot', slot(ADDR).txs.length === 123)

  // 3. A known row whose result moved (reverted) takes the head's copy; the rest is untouched.
  const chainRows = chains.get(clean(ADDR))
  const target = chainRows[10]
  chainRows[10] = { ...target, executionResult: false }
  const before = await refreshTransactionHead(ADDR) // result moved: merged
  check('a changed executionResult replaces the held row', before[10].hash === target.hash && before[10].executionResult === false)
  check('untouched rows keep their values', before.every((t, i) => (i === 10 ? t.executionResult === false : t.executionResult === true)))
  // The new row is now also held: a later no-change tick must report no change at all.
  const prevList = before
  const again = await refreshTransactionHead(ADDR)
  check('no change: same rows, same order', sameTxList(again, prevList) && sameHashes(again, prevList))

  // 4. Nothing new: no rewrite, except the re-stamp once a minute (manual reads keep their 2-minute TTL).
  const stamp0 = slot(ADDR).at
  clock += 30_000
  resetLog()
  await refreshTransactionHead(ADDR)
  check('no change within a minute: slot not rewritten', slot(ADDR).at === stamp0)
  clock += 40_000
  await refreshTransactionHead(ADDR)
  check('no change after a minute: slot re-stamped', slot(ADDR).at > stamp0)

  // 5. The slot's age does not matter to the heartbeat: an hour-old slot is merged, not walked.
  const newer = mine(ADDR, 2, 'late')
  clock += 60 * 60 * 1000
  resetLog()
  const late = await refreshTransactionHead(ADDR)
  check('an hour-old slot still merges (one head read)', calls() === 1, `calls=${calls()}`)
  check('an hour-old slot picks up the new rows', sameHashes(late.slice(0, 2), [...newer].reverse()))

  // 6. A failed head fetch never costs the cache.
  const held = await refreshTransactionHead(ADDR)
  const slotBefore = JSON.stringify(slot(ADDR))
  failCalls = new Set([callNo + 1])
  const failed = await refreshTransactionHead(ADDR)
  failCalls = new Set()
  check('failed head fetch returns the rows on screen', sameHashes(failed, held))
  check('failed head fetch leaves the slot as it was', JSON.stringify(slot(ADDR)) === slotBefore)

  // 7. Gap: the newest page is entirely unknown (more than a page of new rows), so walk.
  mine(ADDR, 60, 'gap')
  resetLog()
  const gap = await refreshTransactionHead(ADDR)
  check('a gap falls back to the full walk', calls('getTransactionsByAddress') > 1, `calls=${calls('getTransactionsByAddress')}`)
  check('a gap ends with the whole chain', sameHashes(gap, chains.get(clean(ADDR))), `${gap.length} vs ${chains.get(clean(ADDR)).length}`)

  // 8. Partial slot (an earlier walk died): the heartbeat walks again and heals it.
  clearTxCache(ADDR)
  failCalls = new Set([callNo + 3]) // third call of the next walk fails: 2 pages survive
  const partialManual = await getNimiqTransactionHistory(ADDR, 1000)
  failCalls = new Set()
  check('a walk that dies partway returns what it has', partialManual.length === 100, partialManual.length)
  check('a partial walk is flagged in the slot', slot(ADDR).partial === true)
  resetLog()
  const healed = await refreshTransactionHead(ADDR)
  check('the heartbeat walks again over a partial slot', calls('getTransactionsByAddress') >= 2)
  check('the healed list is the whole chain', sameHashes(healed, chains.get(clean(ADDR))))
  check('the healed slot is complete', slot(ADDR).partial === undefined)

  // 9. A walk that dies while a complete slot is held keeps the held rows.
  mine(ADDR, 60, 'gap2')
  const heldNow = (await refreshTransactionHead(ADDR)).slice() // complete slot in hand
  mine(ADDR, 60, 'gap3') // a gap again, so the next tick walks
  const slotNow = JSON.stringify(slot(ADDR))
  failCalls = new Set([callNo + 3]) // head ok, page 1 ok, page 2 dies
  const survived = await refreshTransactionHead(ADDR)
  failCalls = new Set()
  check('a walk that dies partway keeps the complete slot', JSON.stringify(slot(ADDR)) === slotNow)
  check('a walk that dies partway returns the held rows', sameHashes(survived, heldNow), `${survived.length} vs ${heldNow.length}`)

  // 10. Cap: the list is held at maxTotal, the oldest rows give way.
  mine(ADDR2, 1000, 'cap')
  const capped = await refreshTransactionHead(ADDR2)
  check('1000 rows are kept as they are', capped.length === 1000, capped.length)
  const fiveNew = mine(ADDR2, 5, 'cap5')
  const overflow = await refreshTransactionHead(ADDR2)
  check('the cap holds at 1000', overflow.length === 1000, overflow.length)
  check('the newest rows survive the cap', sameHashes(overflow.slice(0, 5), [...fiveNew].reverse()))
  check('the oldest rows give way', overflow[999].hash === capped[994].hash, `${overflow[999].hash} vs ${capped[994].hash}`)

  // 11. Manual reads keep their behaviour: within 2 minutes they serve the slot without RPC.
  const manualFresh = await getNimiqTransactionHistory(ADDR, 1000)
  resetLog()
  const manualServed = await getNimiqTransactionHistory(ADDR, 1000)
  check('manual read within the TTL serves the slot without RPC', calls() === 0 && sameHashes(manualServed, manualFresh))
  clock += 3 * 60 * 1000
  resetLog()
  await getNimiqTransactionHistory(ADDR, 1000)
  check('manual read after the TTL walks again', calls('getTransactionsByAddress') >= 1)

  // 12. After a send, clearTxCache leaves nothing to merge onto: the heartbeat walks.
  clearTxCache(ADDR)
  resetLog()
  const afterClear = await refreshTransactionHead(ADDR)
  check('after clearTxCache the heartbeat walks', calls('getTransactionsByAddress') >= 1 && afterClear.length > 0)

  // 13. Pre-HTLC slot (no toType): not trusted, so the heartbeat walks.
  const rows = chains.get(clean(ADDR))
  ls[`nimbooks:txs:${clean(ADDR)}`] = JSON.stringify({ address: ADDR, at: clock, txs: rows.map(({ toType, ...r }) => r) })
  resetLog()
  const legacy = await refreshTransactionHead(ADDR)
  check('a pre-HTLC slot is walked, not merged', calls('getTransactionsByAddress') >= 2 && legacy.every((t) => t.toType !== undefined))

  // 14. sameTxList: content, not identity.
  const a = [row('x', 1), row('y', 2)]
  const b = a.map((t) => ({ ...t }))
  check('sameTxList: equal content, different objects', sameTxList(a, b))
  check('sameTxList: different length', !sameTxList(a, a.slice(1)))
  check('sameTxList: different hash', !sameTxList(a, [a[0], { ...a[1], hash: 'zz' }]))
  check('sameTxList: different result', !sameTxList(a, [a[0], { ...a[1], executionResult: false }]))
  check('sameTxList: different value (rewards accrue under one hash)', !sameTxList(a, [a[0], { ...a[1], value: '5' }]))
  check('sameTxList: two empty lists', sameTxList([], []))

  // 15. Staker record: never-staked is null, a failed lookup throws, and the wrapper maps a failure to null.
  const staking = (over = {}) => ({ address: ADDR, active: '1', inactive: '0', retired: '0', delegation: 'NQ08', inactiveFrom: 0, ...over })
  check('sameStakingHolding: equal fields', sameStakingHolding(staking(), staking()))
  check('sameStakingHolding: null on both sides', sameStakingHolding(null, null))
  check('sameStakingHolding: null against a record', !sameStakingHolding(null, staking()))
  check('sameStakingHolding: different active', !sameStakingHolding(staking(), staking({ active: '2' })))
  answer = (method) => (method === 'getStakerByAddress' ? { error: { message: 'No staker with address: NQ' } } : undefined)
  check('never staked reads as null', (await fetchStakingHolding(ADDR)) === null)
  answer = () => ({ error: { message: 'Internal error', data: 'boom' } })
  let threw = false
  try {
    await fetchStakingHolding(ADDR)
  } catch {
    threw = true
  }
  check('a failed staker lookup throws from fetchStakingHolding', threw)
  check('a failed staker lookup reads as null from getStakingHolding', (await getStakingHolding(ADDR)) === null)
  answer = null

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
