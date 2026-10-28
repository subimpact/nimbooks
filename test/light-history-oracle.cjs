// Oracle for the light-client-first history read in src/lib/chain.ts.
//
// The chain, the clock, localStorage, the RPC fetch and the light client's
// network call are all stubbed, so every case is deterministic and offline.
// The light path is chosen by defining a minimal window (as the browser does)
// and driving lightHistory's test seam with raw PlainTransactionDetails rows,
// so the production mapping runs exactly as it does in the app.
//
// Run: node test/light-history-oracle.cjs
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const root = path.resolve(__dirname, '..')
const out = path.join(os.tmpdir(), `chain-light-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/chain.ts --file ${out} --format cjs --platform node --no-codeSplitting`, {
  cwd: root,
  stdio: 'pipe',
})

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

// The browser has a window; that is what selects the light path by default.
global.window = {}

// Date.now is driven by the test.
let clock = 1_790_000_000_000
Date.now = () => clock

const clean = (a) => String(a).replace(/\s+/g, '').toUpperCase()

// JSON-RPC over in-memory chains, newest first per address, cursor exclusive.
let rpcChains = new Map()
let rpcLog = []
let failTxRpc = false
global.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  const respond = (json) => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, ...json }) })
  rpcLog.push({ method: body.method, params: body.params })
  if (body.method === 'getTransactionsByAddress') {
    if (failTxRpc) throw new TypeError('rpc down')
    const [addr, max, cursor] = body.params
    const rows = rpcChains.get(clean(addr)) || []
    const start = cursor === null ? 0 : rows.findIndex((r) => r.hash === cursor) + 1
    return respond({ result: { data: rows.slice(start, start + max), metadata: null } })
  }
  return respond({ result: { data: [] } })
}

const chain = require(out)
const { setLightFetcherForTests, getNimiqTransactionHistory } = chain

// The seam replaces client.getTransactionsByAddress: it returns the raw rows
// the network would, and the page mapping under test runs on them.
let lightRows = []
let lightCalls = []
let lightFailsAt = 0
setLightFetcherForTests(async (_address, max, startAt) => {
  const call = { max, startAt, returned: 0 }
  lightCalls.push(call)
  if (lightFailsAt && lightCalls.length === lightFailsAt) throw new Error('light client down')
  const start = startAt === null ? 0 : lightRows.findIndex((r) => r.transactionHash === startAt) + 1
  const page = lightRows.slice(start, start + max)
  call.returned = page.length
  return page
})

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}

// ---- fixtures ----------------------------------------------------------------
const ADDR = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
const SENDER = 'NQ05 R770 0Y3C BTQN 1L2Y USGF 8JNA 0VLA PLQJ'
const TX_TYPES = ['basic', 'vesting', 'htlc', 'staking']
let seq = 0
let tsBase = 1_700_000_000_000

// Newest first, one minute apart, so sorting is unambiguous.
const makeRows = (n, tag) => {
  const list = []
  for (let i = 0; i < n; i++) {
    tsBase += 60_000
    seq++
    list.push({ hash: `${tag}-${seq}`, ts: tsBase, blockNumber: 3_400_000 + seq })
  }
  return list.reverse()
}

const toRpc = (r) => ({
  hash: r.hash,
  from: SENDER,
  to: ADDR,
  fromType: 0,
  toType: r.toType ?? 0,
  value: r.value ?? 100000,
  fee: 0,
  timestamp: r.ts,
  executionResult: r.executionResult ?? true,
  blockNumber: r.blockHeight === null ? undefined : (r.blockHeight ?? r.blockNumber ?? 1),
  proof: 'ab',
  senderData: r.senderData ?? '',
  recipientData: r.data ?? '',
})

const toLight = (r) => ({
  transactionHash: r.hash,
  format: 'extended',
  sender: SENDER,
  senderType: 'basic',
  recipient: ADDR,
  recipientType: TX_TYPES[r.toType ?? 0],
  value: r.value ?? 100000,
  fee: 0,
  feePerByte: 0,
  validityStartHeight: 1,
  network: 'main',
  flags: 0,
  data: { type: 'raw', raw: r.data ?? '' },
  ...(r.senderData ? { senderData: { type: 'raw', raw: r.senderData } } : {}),
  proof: { type: 'raw', raw: 'ab' },
  size: 100,
  state: r.blockHeight === null ? 'pending' : 'confirmed',
  executionResult: r.executionResult ?? true,
  ...(r.blockHeight === null ? {} : { blockHeight: r.blockHeight ?? r.blockNumber ?? 1 }),
  timestamp: r.ts,
})

const reset = () => {
  for (const k of Object.keys(ls)) if (k.startsWith('nimbooks:txs')) delete ls[k]
  delete ls['nimbooks:historySource']
  rpcChains = new Map()
  rpcLog.length = 0
  lightCalls.length = 0
  lightRows = []
  lightFailsAt = 0
  failTxRpc = false
}

const txCalls = () => rpcLog.filter((c) => c.method === 'getTransactionsByAddress')
const hashes = (list) => list.map((t) => t.hash)
const sameHashes = (a, b) => a.length === b.length && a.every((t, i) => t.hash === b[i].hash)
const isNewestFirst = (list) => list.every((t, i) => i === 0 || (list[i - 1].timestamp ?? 0) >= (t.timestamp ?? 0))
const noDuplicates = (list) => new Set(hashes(list)).size === list.length
const slot = (address) => JSON.parse(ls[`nimbooks:txs:${clean(address)}`] || 'null')

;(async () => {
  // (a) Light only: 120 light rows, the one RPC continuation finds nothing.
  reset()
  const a = makeRows(120, 'a')
  lightRows = a.map(toLight)
  const aGot = await getNimiqTransactionHistory(ADDR, 1000)
  check('(a) light only: 120 rows returned', aGot.length === 120, aGot.length)
  check('(a) light only: newest first', isNewestFirst(aGot) && aGot[0].hash === a[0].hash)
  check('(a) light only: one light call from the top', lightCalls.length === 1 && lightCalls[0].startAt === null, JSON.stringify(lightCalls))
  check('(a) light only: exactly one RPC continuation', txCalls().length === 1, JSON.stringify(txCalls()))
  check(
    '(a) continuation asks for the rest from the oldest light hash',
    txCalls()[0]?.params[1] === 880 && txCalls()[0]?.params[2] === a[119].hash,
    JSON.stringify(txCalls()[0]?.params)
  )

  // (b) 600 light rows: pages of 500 + 100, then the RPC continuation.
  reset()
  const b = makeRows(600, 'b')
  lightRows = b.map(toLight)
  const bGot = await getNimiqTransactionHistory(ADDR, 1000)
  check('(b) 600 rows: two light pages', lightCalls.length === 2, JSON.stringify(lightCalls))
  check(
    '(b) 600 rows: the first page is full, the second is short',
    lightCalls[0]?.returned === 500 && lightCalls[1]?.returned === 100,
    JSON.stringify(lightCalls)
  )
  check('(b) 600 rows: one RPC continuation', txCalls().length === 1, JSON.stringify(txCalls()))
  check('(b) continuation asks for 400 more from the oldest light hash', txCalls()[0]?.params[1] === 400 && txCalls()[0]?.params[2] === b[599].hash, JSON.stringify(txCalls()[0]?.params))
  check('(b) 600 rows kept, newest first, no duplicates', bGot.length === 600 && isNewestFirst(bGot) && noDuplicates(bGot))

  // (c) Pre-PoS: 50 light rows plus 30 older RPC rows, merged once.
  reset()
  const c = makeRows(80, 'c')
  lightRows = c.slice(0, 50).map(toLight)
  rpcChains.set(clean(ADDR), c.map(toRpc))
  const cGot = await getNimiqTransactionHistory(ADDR, 1000)
  check('(c) pre-PoS: 80 rows after the continuation', cGot.length === 80, cGot.length)
  check('(c) pre-PoS: merged rows match the chain, newest first', sameHashes(cGot, c), hashes(cGot).join(','))
  check('(c) pre-PoS: no duplicate at the seam', noDuplicates(cGot))
  check('(c) pre-PoS: continuation starts at the oldest light hash', txCalls().length === 1 && txCalls()[0].params[2] === c[49].hash, JSON.stringify(txCalls()[0]?.params))

  // (d) Truncated busy address: light stops at 46, the RPC fills 954 more to the cap.
  reset()
  const d = makeRows(1000, 'd')
  lightRows = d.slice(0, 46).map(toLight)
  rpcChains.set(clean(ADDR), d.map(toRpc))
  const dGot = await getNimiqTransactionHistory(ADDR, 1000)
  check('(d) truncated: capped at 1000 rows', dGot.length === 1000, dGot.length)
  check('(d) truncated: the whole chain, newest first, no duplicates', sameHashes(dGot, d) && noDuplicates(dGot))
  check('(d) truncated: one continuation asking for 954 more', txCalls().length === 1 && txCalls()[0].params[1] === 954, JSON.stringify(txCalls()[0]?.params))

  // (e) The RPC continuation dies: light rows stand, the slot is not partial.
  reset()
  const e = makeRows(120, 'e')
  lightRows = e.map(toLight)
  failTxRpc = true
  const eGot = await getNimiqTransactionHistory(ADDR, 1000)
  const eSlot = slot(ADDR)
  check('(e) RPC continuation throws: light rows returned', eGot.length === 120 && sameHashes(eGot, e), eGot.length)
  check('(e) RPC continuation throws: the continuation was attempted once', txCalls().length === 1, JSON.stringify(txCalls()))
  check('(e) RPC continuation throws: the slot is not marked partial', eSlot && eSlot.partial === undefined && eSlot.txs.length === 120, JSON.stringify(eSlot && eSlot.partial))

  // (f) Light throws on its first call: the whole history comes from the RPC.
  reset()
  const f = makeRows(120, 'f')
  rpcChains.set(clean(ADDR), f.map(toRpc))
  lightFailsAt = 1
  const fGot = await getNimiqTransactionHistory(ADDR, 1000)
  const fSlot = slot(ADDR)
  check('(f) light down: the full RPC walk supplies the rows', fGot.length === 120 && sameHashes(fGot, f), fGot.length)
  check('(f) light down: the light client was tried once', lightCalls.length === 1, JSON.stringify(lightCalls))
  check('(f) light down: the RPC walk ran (page plus end cursor)', txCalls().length === 2, txCalls().length)
  check('(f) light down: a complete RPC walk is not partial', fSlot && fSlot.partial === undefined)

  // (g) The support switch pins the old RPC path, light is never called.
  reset()
  const g = makeRows(120, 'g')
  rpcChains.set(clean(ADDR), g.map(toRpc))
  lightRows = makeRows(10, 'gl').map(toLight)
  ls['nimbooks:historySource'] = 'rpc'
  const gGot = await getNimiqTransactionHistory(ADDR, 1000)
  check('(g) historySource = rpc: the RPC walk supplies the rows', gGot.length === 120 && sameHashes(gGot, g), gGot.length)
  check('(g) historySource = rpc: zero light calls', lightCalls.length === 0, lightCalls.length)

  // (h) Mapping of raw client rows to NimiqTx.
  reset()
  const hts = 1_760_000_000_000
  lightRows = [
    {
      transactionHash: 'hx-htlc',
      format: 'extended',
      sender: SENDER,
      senderType: 'basic',
      recipient: ADDR,
      recipientType: 'htlc',
      value: 42,
      fee: 7,
      feePerByte: 0,
      validityStartHeight: 1,
      network: 'main',
      flags: 0,
      data: { type: 'raw', raw: 'deadbeef' },
      proof: { type: 'raw', raw: 'c0ffee' },
      size: 100,
      state: 'confirmed',
      executionResult: false,
      blockHeight: 3_456_789,
      timestamp: hts,
    },
    {
      transactionHash: 'hx-staking',
      format: 'extended',
      sender: SENDER,
      senderType: 'basic',
      recipient: ADDR,
      recipientType: 'staking',
      value: 1,
      fee: 0,
      feePerByte: 0,
      validityStartHeight: 1,
      network: 'main',
      flags: 0,
      data: { type: 'raw', raw: '' },
      senderData: { type: 'raw', raw: 'cafe' },
      proof: { type: 'raw', raw: 'ab' },
      size: 100,
      state: 'confirmed',
      executionResult: true,
      blockHeight: 3_456_790,
      timestamp: hts - 60_000,
    },
    {
      transactionHash: 'hx-basic',
      format: 'basic',
      sender: SENDER,
      senderType: 'basic',
      recipient: ADDR,
      recipientType: 'basic',
      value: 5,
      fee: 0,
      feePerByte: 0,
      validityStartHeight: 1,
      network: 'main',
      flags: 0,
      data: { type: 'raw', raw: '' },
      proof: { type: 'raw', raw: 'ab' },
      size: 100,
      state: 'confirmed',
      executionResult: true,
      blockHeight: 3_456_791,
      timestamp: hts - 120_000,
    },
    {
      transactionHash: 'hx-unmined',
      format: 'basic',
      sender: SENDER,
      senderType: 'basic',
      recipient: ADDR,
      recipientType: 'basic',
      value: 9,
      fee: 0,
      feePerByte: 0,
      validityStartHeight: 1,
      network: 'main',
      flags: 0,
      data: { type: 'raw', raw: '' },
      proof: { type: 'raw', raw: 'ab' },
      size: 100,
      state: 'pending',
      timestamp: hts - 180_000,
    },
  ]
  const hGot = await getNimiqTransactionHistory(ADDR, 1000)
  const htlc = hGot.find((t) => t.hash === 'hx-htlc')
  const staking = hGot.find((t) => t.hash === 'hx-staking')
  const basic = hGot.find((t) => t.hash === 'hx-basic')
  check('(h) mapping: unmined row dropped', hGot.length === 3 && !hGot.some((t) => t.hash === 'hx-unmined'), hGot.length)
  check(
    '(h) mapping: htlc is toType 2, blockHeight -> blockNumber, data.raw kept as hex',
    htlc && htlc.toType === 2 && htlc.blockNumber === 3_456_789 && htlc.data === 'deadbeef',
    JSON.stringify(htlc)
  )
  check(
    '(h) mapping: luna values are strings, timestamp in ms, proof from raw',
    htlc && htlc.value === '42' && htlc.fee === '7' && htlc.timestamp === hts && htlc.proof === 'c0ffee' && htlc.executionResult === false,
    JSON.stringify(htlc)
  )
  check(
    '(h) mapping: staking is toType 3, empty recipient data falls back to senderData',
    staking && staking.toType === 3 && staking.data === 'cafe',
    JSON.stringify(staking)
  )
  check('(h) mapping: empty data on both sides is undefined, basic is toType 0', basic && basic.data === undefined && basic.toType === 0, JSON.stringify(basic))

  // (i) An address with only pre-PoS history: light returns nothing, and the
  // single continuation still asks the RPC from the top.
  reset()
  const i = makeRows(30, 'i')
  rpcChains.set(clean(ADDR), i.map(toRpc))
  const iGot = await getNimiqTransactionHistory(ADDR, 1000)
  check(
    '(i) light empty: one continuation with startAt null',
    lightCalls.length === 1 && txCalls().length === 1 && txCalls()[0].params[2] === null,
    JSON.stringify(txCalls()[0]?.params)
  )
  check('(i) light empty: the pre-PoS rows are returned', iGot.length === 30 && sameHashes(iGot, i), iGot.length)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
