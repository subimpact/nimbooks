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
const { ownFundedContracts, syncContractArchive, ownHtlcSuccessors, addressToHex } = require(out)

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

  // --- HTLC extensions (Nimiq Pay's contract -> contract chain) ---
  // Real mainnet addresses: NQ82 funded NQ27 from its basic address, then NQ27
  // extended into NQ37. NQ82's own history never shows NQ37 being created, so
  // the successor has to be discovered from NQ27's history plus the refund
  // address in the creation data. NQ43 is some other wallet's HTLC.
  const OWN82 = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
  const OWN82_HEX = '343fcb7b9c015b50d4ef06a526904eb72da9ba99'
  const EXT1 = 'NQ27 QCTR DRNT 1YF1 9E7F XTL1 7Q26 JF96 BENU'
  const EXT2 = 'NQ37 095H KLEG LTHP 7BNA H31G QSU1 RMR6 TRU7'
  const EXT3 = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
  const EXT4 = 'NQ62 68D7 RQHN MSTR 1Y0T SY1P HU89 5QJ5 YV05'
  const EXT3_HEX = addressToHex(EXT3)
  const key82 = `nimbooks:htlc-archive:${flat(OWN82)}`
  // An HTLC creation payload: 20 byte sender (refund address) + hash root and
  // the rest. Extensions carry an all zero hash root, which is why ownership
  // must key on the sender and not on the root.
  const extData = (hex) => hex + '0'.repeat(64)

  check('addressToHex: NQ82 decodes to its 20 bytes', addressToHex(OWN82) === OWN82_HEX, String(addressToHex(OWN82)))
  check('addressToHex: every fixture decodes',
    [EXT1, EXT2, EXT3, EXT4].every((a) => typeof addressToHex(a) === 'string' && addressToHex(a).length === 40))
  check('addressToHex: malformed -> null',
    addressToHex('NQ82 6GYU') === null && addressToHex('hello') === null && addressToHex('') === null &&
    addressToHex('NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELI') === null,
    String(addressToHex('NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELI')))

  // ownHtlcSuccessors: newest first, deduped, only HTLC creations by the
  // contract that refund to the user.
  const extTo2a = tx(EXT1, EXT2, 0, 2, { data: extData(OWN82_HEX) })
  const extTo4 = tx(EXT1, EXT4, 0, 2, { data: extData(OWN82_HEX) })
  const extTo2b = tx(EXT1, EXT2, 0, 2, { data: extData(OWN82_HEX) })
  const extForeign = tx(EXT1, EXT3, 0, 2, { data: extData(EXT3_HEX) })
  const extFailed = tx(EXT1, EXT4, 0, 2, { data: extData(OWN82_HEX), executionResult: false })
  const notHtlc = tx(EXT1, EXT4, 5, 0, { data: extData(OWN82_HEX) })
  const extByOther = tx(EXT2, EXT4, 0, 2, { data: extData(OWN82_HEX) })
  const succ = ownHtlcSuccessors(EXT1, [extTo2a, extForeign, extTo2b, extTo4, extFailed, notHtlc, extByOther], OWN82)
  check('ownHtlcSuccessors: own extensions only, newest first, deduped',
    JSON.stringify(succ.map(flat)) === JSON.stringify([flat(EXT2), flat(EXT4)]), JSON.stringify(succ))
  check('ownHtlcSuccessors: foreign refund address is not followed',
    ownHtlcSuccessors(EXT1, [extForeign], OWN82).length === 0)
  check('ownHtlcSuccessors: no data never matches',
    ownHtlcSuccessors(EXT1, [tx(EXT1, EXT2, 0, 2)], OWN82).length === 0)

  // Main chain: basic -> C1 (settled) -> C2 (live, 123.45 NIM). C1 also funded
  // a foreign HTLC (C3), which must never be looked up.
  const funding1 = tx(OWN82, EXT1, 100, 2)
  const c1Rows = [
    tx(EXT1, EXT2, 0, 2, { data: extData(OWN82_HEX) }),
    tx(EXT1, EXT3, 0, 2, { data: extData(EXT3_HEX) }),
    tx(EXT1, 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001', 5, 3),
  ]
  const chainAccounts = {
    [flat(EXT1)]: { type: 'basic', balance: 0 },
    [flat(EXT2)]: { type: 'htlc', balance: 12345000 },
  }
  const chainHistories = { [flat(EXT1)]: c1Rows }

  backing.delete(key82)
  const de = makeDeps(chainAccounts, chainHistories)
  const re = await syncContractArchive(OWN82, ownFundedContracts([funding1], OWN82), de.deps, { maxFetches: 10, delayMs: 0 })
  check('extension: C1 settles, C2 is found as live',
    re.finals.has(flat(EXT1)) && re.live.map(flat).includes(flat(EXT2)) && re.complete === true,
    JSON.stringify({ finals: [...re.finals], live: re.live, complete: re.complete }))
  check('extension: liveBalances carries C2\'s luna',
    re.liveBalances[flat(EXT2)] === 12345000, JSON.stringify(re.liveBalances))
  check('extension: C2 was looked up once (successor of a settled C1)',
    (de.accountCalls.get(flat(EXT2)) ?? 0) === 1 && (de.txCalls.get(flat(EXT2)) ?? 0) === 0,
    JSON.stringify([...de.accountCalls, ...de.txCalls]))
  check('extension: foreign-successor C3 is never looked up',
    (de.accountCalls.get(flat(EXT3)) ?? 0) === 0 && (de.txCalls.get(flat(EXT3)) ?? 0) === 0,
    JSON.stringify([...de.accountCalls, ...de.txCalls]))
  check('extension: C1 rows ride in finalTxs',
    re.finalTxs.length === c1Rows.length && c1Rows.every((t) => re.finalTxs.some((f) => f.hash === t.hash)))

  // Two-hop chain C1 -> C2 (settled) -> C4 (live), budget-limited: the first
  // pass settles C1 and C2, the second serves both from the shelf (zero history
  // fetches) and reaches C4.
  backing.delete(key82)
  const fundingX = tx(OWN82, EXT1, 100, 2)
  const twoHopRows = {
    [flat(EXT1)]: [tx(EXT1, EXT2, 0, 2, { data: extData(OWN82_HEX) })],
    [flat(EXT2)]: [tx(EXT2, EXT4, 0, 2, { data: extData(OWN82_HEX) })],
  }
  const twoHopAccounts = {
    [flat(EXT1)]: { type: 'basic', balance: 0 },
    [flat(EXT2)]: { type: 'basic', balance: 0 },
    [flat(EXT4)]: { type: 'htlc', balance: 7770000 },
  }
  const dh1 = makeDeps(twoHopAccounts, twoHopRows)
  const rh1 = await syncContractArchive(OWN82, ownFundedContracts([fundingX], OWN82), dh1.deps, { maxFetches: 4, delayMs: 0 })
  check('two-hop pass 1: C1 and C2 settled, budget spent',
    rh1.finals.has(flat(EXT1)) && rh1.finals.has(flat(EXT2)) && rh1.finals.size === 2 && rh1.complete === false && rh1.live.length === 0,
    JSON.stringify({ finals: [...rh1.finals], live: rh1.live, complete: rh1.complete }))
  const dh2 = makeDeps(twoHopAccounts, twoHopRows)
  const rh2 = await syncContractArchive(OWN82, [EXT1], dh2.deps, { maxFetches: 4, delayMs: 0 })
  check('two-hop pass 2: C4 found live, complete',
    rh2.live.map(flat).includes(flat(EXT4)) && rh2.complete === true && rh2.finals.size === 2,
    JSON.stringify({ finals: [...rh2.finals], live: rh2.live, complete: rh2.complete }))
  check('two-hop pass 2: cached C1 + C2 cost zero RPC',
    dh2.totalTx() === 0 && (dh2.accountCalls.get(flat(EXT1)) ?? 0) === 0 && (dh2.accountCalls.get(flat(EXT2)) ?? 0) === 0,
    JSON.stringify([...dh2.accountCalls, ...dh2.txCalls]))
  check('two-hop pass 2: C4 looked up once, balance carried',
    (dh2.accountCalls.get(flat(EXT4)) ?? 0) === 1 && rh2.liveBalances[flat(EXT4)] === 7770000,
    JSON.stringify([...dh2.accountCalls, rh2.liveBalances]))

  // A cached final whose successor is new: only C1 was archived by the first
  // (budget-cut) pass, so the next pass fetches C2 without refetching C1.
  backing.delete(key82)
  const fundingY = tx(OWN82, EXT1, 100, 2)
  const cutRows = {
    [flat(EXT1)]: [tx(EXT1, EXT2, 0, 2, { data: extData(OWN82_HEX) })],
  }
  const cutAccounts = {
    [flat(EXT1)]: { type: 'basic', balance: 0 },
    [flat(EXT2)]: { type: 'htlc', balance: 5000000 },
  }
  const dc1 = makeDeps(cutAccounts, cutRows)
  const rcut = await syncContractArchive(OWN82, ownFundedContracts([fundingY], OWN82), dc1.deps, { maxFetches: 2, delayMs: 0 })
  check('cached-final chain: first pass archives C1 only, stops on budget',
    rcut.finals.size === 1 && rcut.finals.has(flat(EXT1)) && rcut.complete === false && rcut.live.length === 0,
    JSON.stringify({ finals: [...rcut.finals], live: rcut.live }))
  const dc2 = makeDeps(cutAccounts, cutRows)
  const rnew = await syncContractArchive(OWN82, [EXT1], dc2.deps, { maxFetches: 4, delayMs: 0 })
  check('cached-final chain: new successor fetched, cached C1 not refetched',
    rnew.live.map(flat).includes(flat(EXT2)) &&
      (dc2.accountCalls.get(flat(EXT2)) ?? 0) === 1 &&
      (dc2.accountCalls.get(flat(EXT1)) ?? 0) === 0 &&
      (dc2.txCalls.get(flat(EXT1)) ?? 0) === 0 &&
      dc2.totalTx() === 0,
    JSON.stringify([...dc2.accountCalls, ...dc2.txCalls]))
  check('cached-final chain: balance of the new live contract',
    rnew.liveBalances[flat(EXT2)] === 5000000, JSON.stringify(rnew.liveBalances))
  backing.delete(key82)

  // A stopped pass (failed lookup here) still serves the cached finals and still
  // expands their successors from the cached history, with zero RPC, and only
  // then stops: the successor is queued but not fetched in that pass.
  backing.delete(key82)
  const fundingZ = tx(OWN82, EXT1, 100, 2)
  const stopRows = {
    [flat(EXT1)]: [tx(EXT1, EXT2, 0, 2, { data: extData(OWN82_HEX) })],
  }
  const stopAccounts = {
    [flat(EXT1)]: { type: 'basic', balance: 0 },
    [flat(EXT2)]: { type: 'htlc', balance: 4200000 },
    [flat(EXT4)]: 'throw',
  }
  await syncContractArchive(OWN82, ownFundedContracts([fundingZ], OWN82), makeDeps(stopAccounts, stopRows).deps, { maxFetches: 4, delayMs: 0 })
  const ds = makeDeps(stopAccounts, stopRows)
  const rstop = await syncContractArchive(OWN82, [EXT4, EXT1], ds.deps, { maxFetches: 10, delayMs: 0 })
  check('stop: failed lookup stops the pass, cached final still served',
    rstop.failed === true && rstop.complete === false && rstop.finals.has(flat(EXT1)),
    JSON.stringify({ failed: rstop.failed, complete: rstop.complete, finals: [...rstop.finals] }))
  check('stop: successor of the cached final is not fetched in the stopped pass',
    (ds.accountCalls.get(flat(EXT2)) ?? 0) === 0 && ds.totalTx() === 0 && ds.totalAccount() === 1,
    JSON.stringify([...ds.accountCalls, ...ds.txCalls]))
  // The next pass picks the queued successor up from the cache with zero history.
  const ds2 = makeDeps(stopAccounts, stopRows)
  const rstop2 = await syncContractArchive(OWN82, [EXT1], ds2.deps, { maxFetches: 2, delayMs: 0 })
  check('stop: next pass reaches the cached final\'s successor',
    rstop2.live.map(flat).includes(flat(EXT2)) && rstop2.complete === true && ds2.totalTx() === 0 &&
      (ds2.accountCalls.get(flat(EXT2)) ?? 0) === 1 && rstop2.liveBalances[flat(EXT2)] === 4200000,
    JSON.stringify({ live: rstop2.live, complete: rstop2.complete, calls: [...ds2.accountCalls, ...ds2.txCalls] }))
  backing.delete(key82)

  fs.unlinkSync(out)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})