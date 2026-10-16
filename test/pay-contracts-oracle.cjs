// Oracle for src/lib/payContracts.ts (Nimiq Pay contract archive). Fixed before
// the build; the implementation must make this pass unchanged.
// Run: node test/pay-contracts-oracle.cjs
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const root = path.resolve(__dirname, '..')
const out = path.join(os.tmpdir(), `payContracts-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/payContracts.ts --file ${out} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })
const { ownFundedContracts, syncContractArchive } = require(out)

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}

// Fake localStorage: a per-key store with the real two-method surface. The
// module catches closed/missing storage on its own, but the shelf tests need a
// working one.
const backing = new Map()
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => {
    backing.set(k, String(v))
  },
  removeItem: (k) => {
    backing.delete(k)
  },
}

const STAKE_ADDR = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
const flat = (a) => a.replace(/\s+/g, '').toUpperCase()

let n = 0
const tx = (sender, recipient, nim, toType = 0, extra = {}) => ({
  hash: `h${++n}`, sender, recipient, value: String(nim * 1e5), fee: '0',
  timestamp: 1790000000000 + n * 1000, toType, executionResult: true, ...extra,
})

async function main() {
  const OWN = 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
  const key = `nimbooks:htlc-archive:${flat(OWN)}`
  // Distinct contract addresses (ownFundedContracts compares them flat).
  const c = (i) => `NQ${String(i).padStart(2, '0')} 1111 2222 3333 4444 5555 6666 7777 8888`

  // --- ownFundedContracts ---
  const fundedTxs = [
    tx(OWN, c(1), 100, 2), // newest
    tx(OWN, c(2), 50, 2),
    tx(OWN, c(3), 50, 2),
    tx(flat(OWN).toLowerCase().replace(/(.{4})(?=.)/g, '$1 '), c(4), 25, 2), // lowercase own
    tx(c(2), OWN, 50), // return leg, not a funding
    tx(OWN, c(1), 15, 2), // top-up of C1 -> deduped
    tx(OWN, c(5), 10, 2, { executionResult: false }), // failed -> skipped
    tx('NQ90 9999 9999 9999 9999 9999 9999 9999 9999', c(6), 30, 2), // foreign sender -> skipped
  ]
  const order = ownFundedContracts(fundedTxs, OWN)
  check('ownFundedContracts: newest first + dedupe + skips',
    JSON.stringify(order.map(flat)) === JSON.stringify([flat(c(1)), flat(c(4)), flat(c(3)), flat(c(2))]),
    JSON.stringify(order))
  const capped = ownFundedContracts(fundedTxs, OWN, 2)
  check('ownFundedContracts: limit respected', capped.length === 2 && flat(capped[0]) === flat(c(1)), JSON.stringify(capped))
  // Case-folded own address must match the lowercase funding tx above.
  check('ownFundedContracts: case-insensitive own matching', ownFundedContracts(fundedTxs, flat(OWN).toLowerCase()).length === 4)

  // --- syncContractArchive: fetchers with per-address call counters ---
  const makeDeps = (accounts, txHistories) => {
    const accountCalls = new Map()
    const txCalls = new Map()
    const total = (m) => [...m.values()].reduce((a, b) => a + b, 0)
    return {
      deps: {
        fetchAccount: async (addr) => {
          accountCalls.set(flat(addr), (accountCalls.get(flat(addr)) ?? 0) + 1)
          const a = accounts[flat(addr)]
          if (a === 'throw') throw new Error('account fetch failed')
          return a
        },
        fetchTxs: async (addr) => {
          txCalls.set(flat(addr), (txCalls.get(flat(addr)) ?? 0) + 1)
          const h = txHistories[flat(addr)]
          if (!h) throw new Error('tx fetch failed')
          return h
        },
      },
      accountCalls, txCalls,
      totalAccount: () => total(accountCalls), totalTx: () => total(txCalls),
    }
  }
  const opts = { maxFetches: 40, delayMs: 0 }

  // Five contracts: three settled (pruned to basic, balance 0), one live htlc,
  // one that always throws. Cost: 4 account + 3 history calls.
  const C = (i) => `NQ5${i} 5555 5555 5555 5555 5555 5555 5555 555$${i}`
  const hist = (i) => [tx(C(i), OWN, 10), tx(C(i), STAKE_ADDR, 5, 3)]
  const accounts = {
    [flat(C(1))]: { type: 'basic', balance: 0 },
    [flat(C(2))]: { type: 'basic', balance: 0 },
    [flat(C(3))]: { type: 'basic', balance: 0 },
    [flat(C(4))]: { type: 'htlc', balance: 42000000 },
    [flat(C(5))]: 'throw',
  }
  const txHistories = { [flat(C(1))]: hist(1), [flat(C(2))]: hist(2), [flat(C(3))]: hist(3) }
  const five = [C(1), C(2), C(3), C(4), C(5)]

  backing.delete(key) // clean shelf
  const d1 = makeDeps(accounts, txHistories)
  const r1 = await syncContractArchive(OWN, five, d1.deps, opts)
  check('first sync: finals 3', r1.finals.size === 3, JSON.stringify([...r1.finals]))
  check('first sync: live 1, spaced form kept', r1.live.length === 1 && r1.live[0] === C(4), JSON.stringify(r1.live))
  check('first sync: complete false (one lookup failed)', r1.complete === false)
  check('first sync: 5 account + 3 history fetches (failed call spends budget too)',
    d1.totalAccount() === 5 && d1.totalTx() === 3,
    JSON.stringify([...d1.accountCalls, ...d1.txCalls]))
  check('first sync: finalTxs deduped, all rows present', r1.finalTxs.length === 6, `${r1.finalTxs.length}`)

  // Second sync: the three finals must be served from storage with zero fetches.
  const d2 = makeDeps(accounts, txHistories)
  const r2 = await syncContractArchive(OWN, five, d2.deps, opts)
  const finalsRefetched = [...d2.accountCalls.entries()].filter(([addr, count]) => r1.finals.has(addr) && count !== 0)
  check('second sync: zero fetches for the 3 finals', finalsRefetched.length === 0, JSON.stringify(finalsRefetched))
  check('second sync: finals still 3', r2.finals.size === 3)
  check('second sync: complete still false (throwing contract)', r2.complete === false)

  // The shelf holds exactly the three finals, under only the own-address key.
  const stored = JSON.parse(backing.get(key) || '{}')
  const storedKeys = Object.keys(stored.contracts ?? {}).sort()
  check('shelf holds exactly the 3 finals',
    JSON.stringify(storedKeys) === JSON.stringify([flat(C(1)), flat(C(2)), flat(C(3))].sort()), JSON.stringify(storedKeys))
  check('live contract not stored', !storedKeys.includes(flat(C(4))))

  // Budget cut: maxFetches 2 = exactly one account + one history call, so the
  // newest contract settles and the rest are left for the next pass. No
  // thrower in this list, so the second pass can come out complete.
  backing.delete(key)
  const four = [C(1), C(2), C(3), C(4)]
  const db1 = makeDeps(accounts, txHistories)
  const rb1 = await syncContractArchive(OWN, four, db1.deps, { maxFetches: 2, delayMs: 0 })
  check('budget cut: complete false', rb1.complete === false)
  check('budget cut: exactly the newest contract settled',
    rb1.finals.size === 1 && rb1.finals.has(flat(C(1))), JSON.stringify([...rb1.finals]))
  check('budget cut: 1 account + 1 history fetch (budget spent exactly)',
    db1.totalAccount() === 1 && db1.totalTx() === 1,
    JSON.stringify([...db1.accountCalls, ...db1.txCalls]))
  const db2 = makeDeps(accounts, txHistories)
  const rb2 = await syncContractArchive(OWN, four, db2.deps, opts)
  check('budget cut second pass: complete', rb2.complete === true)
  check('budget cut second pass: settled contracts served from cache',
    (db2.txCalls.get(flat(C(1))) ?? 0) === 0 && db2.totalAccount() === 3 && db2.totalTx() === 2, JSON.stringify([...db2.txCalls]))

  // Malformed shelf reads as empty, nothing throws, contracts are reprocessed.
  backing.set(key, '{"v":1,"contracts":')
  const dm = makeDeps(accounts, txHistories)
  const rm = await syncContractArchive(OWN, [C(1), C(2), C(3)], dm.deps, opts)
  check('malformed shelf: treated as empty (all re-fetched)',
    rm.finalTxs.length === 6 && dm.totalTx() === 3, JSON.stringify([...dm.txCalls]))
  // A wrong archive version reads as empty too.
  backing.set(key, JSON.stringify({ v: 2, contracts: { [flat(C(1))]: { final: true, txs: hist(1), at: 1 } } }))
  const dv = makeDeps(accounts, txHistories)
  await syncContractArchive(OWN, [C(1), C(2), C(3)], dv.deps, opts)
  check('wrong-version shelf: treated as empty', dv.totalTx() === 3, JSON.stringify([...dv.txCalls]))
  // (that pass rewrote the shelf with C1..C3 as finals — clean it again)
  backing.delete(key)

  // A pruned contract that later received NIM (basic with balance) is still
  // settled: archived, so it can never keep the sweep re-running.
  backing.delete(key)
  const fb = makeDeps({ ...accounts, [flat(C(1))]: { type: 'basic', balance: 123000000 } }, txHistories)
  const rf = await syncContractArchive(OWN, [C(1), C(4)], fb.deps, opts)
  check('basic with balance: final', rf.finals.has(flat(C(1))), JSON.stringify([...rf.finals]))
  check('basic with balance: history fetched once', (fb.txCalls.get(flat(C(1))) ?? 0) === 1, JSON.stringify([...fb.txCalls]))
  check('basic with balance: complete true', rf.complete === true)
  // An account type that is neither htlc nor basic is skipped, not retried forever.
  backing.delete(key)
  const fo = makeDeps({ ...accounts, [flat(C(1))]: { type: 'vesting', balance: 5 } }, txHistories)
  const ro = await syncContractArchive(OWN, [C(1)], fo.deps, opts)
  check('odd account type: not final, not live, complete', !ro.finals.has(flat(C(1))) && ro.live.length === 0 && ro.complete === true, JSON.stringify(ro))
  backing.delete(key)

  // A failed lookup stops fetching for the pass (no hammering a 429ing RPC),
  // flags `failed`, and still serves every cached final after it.
  backing.delete(key)
  const warm = makeDeps(accounts, txHistories)
  await syncContractArchive(OWN, [C(3)], warm.deps, opts) // C3 now cached final
  const fs1 = makeDeps(accounts, txHistories)
  const rs = await syncContractArchive(OWN, [C(5), C(1), C(2), C(3)], fs1.deps, opts)
  check('failure: stops fetching after the failed lookup', fs1.totalAccount() === 1 && fs1.totalTx() === 0, JSON.stringify([...fs1.accountCalls, ...fs1.txCalls]))
  check('failure: failed flag set, complete false', rs.failed === true && rs.complete === false)
  check('failure: cached final after the failure still served', rs.finals.has(flat(C(3))) && rs.finalTxs.length === 2, JSON.stringify([...rs.finals]))
  // Budget cut is not a failure, and cached finals past the cut still ride along.
  backing.delete(key)
  await syncContractArchive(OWN, [C(3)], makeDeps(accounts, txHistories).deps, opts)
  const fb2 = makeDeps(accounts, txHistories)
  const rb = await syncContractArchive(OWN, [C(1), C(2), C(3)], fb2.deps, { maxFetches: 2, delayMs: 0 })
  check('budget: not failed, incomplete', rb.failed === false && rb.complete === false)
  check('budget: cached final past the cut still served', rb.finals.has(flat(C(3))) && rb.finals.has(flat(C(1))) && !rb.finals.has(flat(C(2))), JSON.stringify([...rb.finals]))
  backing.delete(key)

  // Cached finals still reported with the chain unreachable (zero RPC).
  let deadCalls = 0
  const deadDeps = {
    fetchAccount: async () => {
      deadCalls++
      throw new Error('down')
    },
    fetchTxs: async () => {
      deadCalls++
      throw new Error('down')
    },
  }
  // Seed the shelf first (this pass settles C1..C3 against working fetchers).
  const dseed = makeDeps(accounts, txHistories)
  await syncContractArchive(OWN, [C(1), C(2), C(3)], dseed.deps, opts)
  const rc = await syncContractArchive(OWN, [C(1), C(2), C(3)], deadDeps, opts)
  check('cached finals survive an outage (zero RPC)', rc.finals.size === 3 && rc.complete === true && deadCalls === 0, `${deadCalls} ${JSON.stringify([...rc.finals])}`)

  fs.unlinkSync(out)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})