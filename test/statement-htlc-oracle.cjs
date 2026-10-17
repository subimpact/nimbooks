// Oracle for the Nimiq Pay HTLC split in src/lib/statement.ts (computeStatement).
// Fixed BEFORE the build; the implementation must make this pass unchanged.
// Run: node test/statement-htlc-oracle.cjs
//
// Why: Nimiq Pay pays out of HTLC contracts the wallet funds itself. The
// statement counted every funding leg as "Sent", so the NQ82 relay wallet read
// 66,056.46 NIM sent when its real spending was 22,926.90 NIM (Analytics has
// split this since v1.23 via splitHtlcFlows). The statement must show the same
// real figures, carry the internal part in its own columns, and leave the
// balance maths (net, opening, closing) exactly as before.
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const root = path.resolve(__dirname, '..')
const out = path.join(require('os').tmpdir(), `statement-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/statement.ts --file ${out} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })
const { computeStatement, buildStatementCsv } = require(out)

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}
const near = (a, b, tol = 0.00002) => typeof a === 'number' && Math.abs(a - b) <= tol

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/htlc-relay-nq82.json'), 'utf8'))
const own = fx.ownAddress

// 1. No opts: byte-for-byte the pre-change behaviour (snapshot of 2d36325).
const base = computeStatement(fx.txs, own, 'all', {})
const b = base.totals
check('no opts: received 65,446.36136', near(b.receivedNim, 65446.36136, 0.0001), b.receivedNim)
check('no opts: sent 66,056.46136 (legacy gross)', near(b.sentNim, 66056.46136, 0.0001), b.sentNim)
check('no opts: net -610.1', near(b.netNim, -610.1, 0.0001), b.netNim)
check('no opts: unstaked 610.1', near(b.unstakedNim, 610.1, 0.0001), b.unstakedNim)
check('no opts: 156 txs over 24 days', b.txCount === 156 && b.daysActive === 24 && base.rows.length === 24, `${b.txCount}/${b.daysActive}/${base.rows.length}`)
check('no opts: internal totals are zero', (b.internalInNim ?? 0) === 0 && (b.internalOutNim ?? 0) === 0, `${b.internalInNim} ${b.internalOutNim}`)

// 2. Pay split on (opts given, even empty): real figures match Analytics.
const split = computeStatement(fx.txs, own, 'all', {}, {})
const s = split.totals
check('split: sent = real 22,926.90086', near(s.sentNim, 22926.90086), s.sentNim)
// Analytics' realIn is also 22,926.90086, but 610.1 of it is the two unstake
// payouts, which the statement keeps in its own unstaked column.
check('split: received = real 22,316.80086 (unstakes stay in unstaked)', near(s.receivedNim, 22316.80086), s.receivedNim)
check('split: internalOut 43,129.5605 (= gross - real)', near(s.internalOutNim, 43129.5605), s.internalOutNim)
check('split: internalIn 43,129.5605 (= gross - real)', near(s.internalInNim, 43129.5605), s.internalInNim)
check('split: net unchanged', near(s.netNim, b.netNim, 0.00001), `${s.netNim} vs ${b.netNim}`)
check('split: closing unchanged', near(s.closingBalanceNim, b.closingBalanceNim, 0.00001), `${s.closingBalanceNim}`)
check('split: fee, staked, unstaked unchanged', near(s.feeNim, b.feeNim) && near(s.stakedNim, b.stakedNim) && near(s.unstakedNim, b.unstakedNim))
check('split: same rows and tx count', split.rows.length === base.rows.length && s.txCount === b.txCount)
let rowsOk = true
let rowSum = { sent: 0, rec: 0, io: 0, ii: 0 }
split.rows.forEach((r, i) => {
  const o = base.rows[i]
  if (r.date !== o.date || !near(r.netNim, o.netNim, 0.00001)) rowsOk = false
  // every row reconciles: real + internal = the legacy gross figure
  if (!near(r.sentNim + r.internalOutNim, o.sentNim, 0.00001)) rowsOk = false
  if (!near(r.receivedNim + r.internalInNim, o.receivedNim, 0.00001)) rowsOk = false
  rowSum.sent += r.sentNim; rowSum.rec += r.receivedNim; rowSum.io += r.internalOutNim; rowSum.ii += r.internalInNim
})
check('split: every row reconciles to legacy gross and keeps its net', rowsOk)
check('split: totals = sum of rows', near(rowSum.sent, s.sentNim, 0.0001) && near(rowSum.io, s.internalOutNim, 0.0001) && near(rowSum.ii, s.internalInNim, 0.0001))

// 3. USD follows the real figure, not the gross.
const day = split.rows.find((r) => r.sentNim > 0)
const prices = {}
for (const r of split.rows) prices[r.date] = 0.001
const priced = computeStatement(fx.txs, own, 'all', prices, {})
const pr = priced.rows.find((r) => r.date === day.date)
check('USD: sentUsd = real sent x close', near(pr.sentUsd, pr.sentNim * 0.001, 1e-9), `${pr.sentUsd} vs ${pr.sentNim * 0.001}`)
check('USD: netUsd = net x close (unchanged maths)', near(pr.netUsd, pr.netNim * 0.001, 1e-9))

// 4. A wallet with no contracts: split on = split off.
const OWN = 'NQ11 1111 1111 1111 1111 1111 1111 1111 1111'
const OTHER = 'NQ22 2222 2222 2222 2222 2222 2222 2222 2222'
const plain = [
  { hash: 'p1', sender: OTHER, recipient: OWN, value: 500000000, fee: 0, timestamp: Date.parse('2026-03-01T10:00:00Z'), toType: 0, executionResult: true },
  { hash: 'p2', sender: OWN, recipient: OTHER, value: 120000000, fee: 0, timestamp: Date.parse('2026-03-02T10:00:00Z'), toType: 0, executionResult: true },
]
const p0 = computeStatement(plain, OWN, '2026', {}).totals
const p1 = computeStatement(plain, OWN, '2026', {}, {}).totals
check('plain wallet: split changes nothing', near(p0.sentNim, p1.sentNim) && near(p0.receivedNim, p1.receivedNim) && near(p0.netNim, p1.netNim) && p1.internalOutNim === 0 && p1.internalInNim === 0, JSON.stringify(p1))

// 5. Held contract: funded, nothing back yet, still holds the NIM -> all internal.
const C = 'NQ33 3333 3333 3333 3333 3333 3333 3333 3333'
const held = [
  { hash: 'h1', sender: OWN, recipient: C, value: 1000000000, fee: 0, timestamp: Date.parse('2026-04-01T10:00:00Z'), toType: 2, executionResult: true },
]
const h0 = computeStatement(held, OWN, '2026', {}, {}).totals
const h1 = computeStatement(held, OWN, '2026', {}, { heldContracts: [C] }).totals
check('held: without heldContracts the unreturned funding is real spending', near(h0.sentNim, 10000) && near(h0.internalOutNim, 0), JSON.stringify(h0))
check('held: with heldContracts it is internal, sent 0', near(h1.sentNim, 0) && near(h1.internalOutNim, 10000), JSON.stringify(h1))
check('held: net still -10,000 (balance replay of this address unchanged)', near(h1.netNim, -10000))

// 6. Staked from the contract in Pay (contract row -> staking contract) is internal.
const STAKING = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
const stk = computeStatement(held, OWN, '2026', {}, {
  contractTxs: [{ hash: 'c1', sender: C, recipient: STAKING, value: 400000000, fee: 0, timestamp: Date.parse('2026-04-02T10:00:00Z'), toType: 3, executionResult: true }],
}).totals
check('pay stake: 4,000 staked from the contract is internal, 6,000 real', near(stk.internalOutNim, 4000) && near(stk.sentNim, 6000), JSON.stringify(stk))

// 7. Period filter: netting runs over the whole list, the year filter only picks rows.
const span = [
  { hash: 'y1', sender: OWN, recipient: C, value: 1000000000, fee: 0, timestamp: Date.parse('2025-12-31T23:00:00Z'), toType: 2, executionResult: true },
  { hash: 'y2', sender: C, recipient: OWN, value: 1000000000, fee: 0, timestamp: Date.parse('2026-01-01T01:00:00Z'), toType: 0, executionResult: true },
]
const y25 = computeStatement(span, OWN, '2025', {}, {}).totals
const y26 = computeStatement(span, OWN, '2026', {}, {}).totals
check('year split: 2025 funding is internal (refunded in 2026)', near(y25.sentNim, 0) && near(y25.internalOutNim, 10000), JSON.stringify(y25))
check('year split: 2026 refund is internal, not income', near(y26.receivedNim, 0) && near(y26.internalInNim, 10000), JSON.stringify(y26))

// 8. CSV: the two internal columns are appended (existing columns untouched).
const csv = buildStatementCsv(split, own).split(/\r?\n/)
const unq = (l) => l.replace(/"/g, '').trim()
const head = unq(csv.find((l) => /sentNIM/.test(l)) || '')
const LEGACY_HEAD = 'date,receivedNIM,sentNIM,rewardsNIM,feeNIM,stakedNIM,unstakedNIM,netNIM,closeUSD,receivedUSD,sentUSD,feeUSD,netUSD,txCount'
check('CSV: header keeps every legacy column in order, then internalInNIM,internalOutNIM', head === LEGACY_HEAD + ',internalInNIM,internalOutNIM', head)
check('CSV: same line count as the legacy export plus nothing else', csv.length === buildStatementCsv(base, own).split(/\r?\n/).length)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
