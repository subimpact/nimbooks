// Oracle for src/lib/historyFilter.ts (History's filters, totals and reward
// months). Synthetic rows pin the precedence and the arithmetic; the real
// fixture pins the netting parity with Analytics.
//
// Run: node test/history-filter-oracle.cjs
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'test/tmp/historyFilter.cjs')
fs.mkdirSync(path.dirname(out), { recursive: true })
execSync(`npx rolldown src/lib/historyFilter.ts --file ${out} --format cjs --platform node`, {
  cwd: root,
  stdio: 'pipe',
})
// The netting map is Analytics' own module, bundled the same way: the parity
// check below must use exactly what Analytics feeds the filter in App.tsx.
const flowsOut = path.join(os.tmpdir(), `htlcFlows-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/htlcFlows.ts --file ${flowsOut} --format cjs --platform node`, {
  cwd: root,
  stdio: 'pipe',
})
const {
  HISTORY_FILTERS,
  filterHistory,
  groupRewardsByMonth,
  hasInternalTransfers,
  historyCategory,
  historyCounts,
  historyDirection,
  historySummary,
} = require(out)
const { splitHtlcFlows } = require(flowsOut)

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}

// --- Synthetic wallet -------------------------------------------------------
const OWN = 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const REMOTE = 'NQ22 RRRR RRRR RRRR RRRR RRRR RRRR RRRR RRRR'
const C1 = 'NQ33 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCC1'
const MERCHANT = 'NQ44 MMMM MMMM MMMM MMMM MMMM MMMM MMMM MMMM'
const VALIDATOR = 'NQ81 C01N BASE 0000 0000 0000 0000 0000 0000'
const STAKE_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
const LUNA = 100000
// Cashlink funding tag, as lib/cashlink stores it (hex of [0,130,128,146,135]).
const CASH_TAG = '0082809287'

let n = 0
const tx = (sender, recipient, nim, extra = {}) => ({
  hash: `h${++n}`,
  sender,
  recipient,
  value: String(Math.round(nim * LUNA)),
  fee: '0',
  timestamp: Date.UTC(2026, 9, 20, 12, 0) + n * 60000,
  executionResult: true,
  toType: 0,
  ...extra,
})

// One row per category, in the precedence order the module documents.
const rewardSynthetic = tx(VALIDATOR, OWN, 1.25, { synthetic: 'reward' })
const rewardFromAddress = tx(VALIDATOR, OWN, 2.5)
const stakingSynthetic = tx(OWN, STAKE_CONTRACT, 100, { synthetic: 'deactivate' })
const stakeDeposit = tx(OWN, STAKE_CONTRACT, 50, { toType: 3 })
const unstakePayout = tx(STAKE_CONTRACT, OWN, 40)
const cashlinkSend = tx(OWN, MERCHANT, 3, { data: CASH_TAG })
const paySwap = tx(OWN, C1, 10, { toType: 2 })
const remoteHtlc = tx('NQ55 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX', REMOTE, 7, {
  remote: true,
})
const remoteOut = tx(REMOTE, MERCHANT, 4, { remote: true })
const plainIn = tx(MERCHANT, OWN, 5)
const plainOut = tx(OWN, MERCHANT, 6)
const failedIn = tx(MERCHANT, OWN, 9, { executionResult: false })

const rows = [
  rewardSynthetic,
  rewardFromAddress,
  stakingSynthetic,
  stakeDeposit,
  unstakePayout,
  cashlinkSend,
  paySwap,
  remoteHtlc,
  remoteOut,
  plainIn,
  plainOut,
  failedIn,
]

const ctx = { own: OWN, remote: REMOTE, hideInternal: false }
const cat = (t) => historyCategory(t, ctx)
const dir = (t) => historyDirection(t, ctx)

// 1. Precedence
check('reward: synthetic rollup is reward', cat(rewardSynthetic) === 'reward')
check('reward: validator-address payout is reward', cat(rewardFromAddress) === 'reward')
check('staking: synthetic action is staking', cat(stakingSynthetic) === 'staking')
check('staking: toType 3 deposit is staking', cat(stakeDeposit) === 'staking')
check('staking: staking-contract payout is staking', cat(unstakePayout) === 'staking')
check('cashlink: tagged send is cashlink, not a plain payment', cat(cashlinkSend) === 'cashlink')
check('pay: toType 2 swap is pay', cat(paySwap) === 'pay')
check('pay: remote relay hop is pay', cat(remoteHtlc) === 'pay')
check('payment: plain receive is payment', cat(plainIn) === 'payment')
check('reward beats direction: validator payout is not a payment', cat(rewardFromAddress) !== 'payment')

// 2. Direction, including remote rows and address spelling
check('direction: sender own is out', dir(plainOut) === 'out')
check('direction: sender other is in', dir(plainIn) === 'in')
check(
  'direction: remote row sent from the relay is out',
  dir(remoteOut) === 'out',
  JSON.stringify(dir(remoteOut))
)
check(
  'direction: remote row sent to the relay is in',
  dir(remoteHtlc) === 'in',
  JSON.stringify(dir(remoteHtlc))
)
check(
  'direction: spacing and case do not change the answer',
  historyDirection(
    { ...plainOut, sender: OWN.replace(/ /g, '').toLowerCase() },
    ctx
  ) === 'out'
)
check(
  'direction: a non-remote row from the relay address is in',
  historyDirection({ ...remoteOut, remote: false }, ctx) === 'in'
)

// 3. Filter lists (Sent includes the cashlink send: Sent = out minus staking)
const list = (f) => filterHistory(rows, f, ctx)
const hashes = (f) => list(f).map((t) => t.hash)
check(
  'cashlink send appears in Cashlinks and in Sent',
  hashes('cashlinks').includes(cashlinkSend.hash) && hashes('sent').includes(cashlinkSend.hash)
)
check('cashlink send is not in Received', !hashes('received').includes(cashlinkSend.hash))
check('reward rows only in Rewards', hashes('rewards').includes(rewardFromAddress.hash) && !hashes('sent').includes(rewardFromAddress.hash) && !hashes('received').includes(rewardFromAddress.hash))
check(
  'staking rows are in Staking only (not Received or Sent)',
  hashes('staking').length === 3 &&
    hashes('staking').every((h) => !hashes('sent').includes(h) && !hashes('received').includes(h))
)
check(
  'Pay transfers holds both swap and remote hops',
  hashes('pay').includes(paySwap.hash) && hashes('pay').includes(remoteHtlc.hash)
)
check('All holds every row', list('all').length === rows.length)
check('failed row is still listed under its filter', hashes('received').includes(failedIn.hash))

// 4. Counts per filter
const counts = historyCounts(rows, ctx)
check('counts: All is every row', counts.all === 12, String(counts.all))
check('counts: Rewards is 2', counts.rewards === 2, String(counts.rewards))
check('counts: Staking is 3', counts.staking === 3, String(counts.staking))
check('counts: Cashlinks is 1', counts.cashlinks === 1, String(counts.cashlinks))
check('counts: Pay is 3 (two remote hops and the swap)', counts.pay === 3, String(counts.pay))
check(
  'counts: Received is in minus reward and staking',
  counts.received === 3,
  String(counts.received)
)
check(
  'counts: Sent is out minus staking',
  counts.sent === 4,
  String(counts.sent)
)
check(
  'counts: every filter covers its own list',
  HISTORY_FILTERS.every((f) => counts[f] === filterHistory(rows, f, ctx).length)
)

// 5. Summary totals, exact to the luna, failed rows excluded
const received = historySummary(rows, 'received', ctx)
const sent = historySummary(rows, 'sent', ctx)
const rewards = historySummary(rows, 'rewards', ctx)
const all = historySummary(rows, 'all', ctx)
check('summary: Received count includes the failed row', received.count === 3, String(received.count))
check(
  'summary: Received total excludes the failed 9 NIM (7 + 5 only)',
  received.totalLuna === String(Math.round((7 + 5) * LUNA)),
  received.totalLuna
)
check(
  'summary: Sent total is the outgoing payments',
  sent.totalLuna === String(Math.round((3 + 10 + 4 + 6) * LUNA)),
  sent.totalLuna
)
check(
  'summary: Rewards total is exact to the luna',
  rewards.totalLuna === String(1.25 * LUNA + 2.5 * LUNA),
  rewards.totalLuna
)
check('summary: Rewards counts distinct UTC days', rewards.days === 1, String(rewards.days))
check('summary: All shows a count and no NIM total', all.totalLuna === '' && all.count === 12)
check('summary: nothing hidden while the switch is off', received.hiddenLuna === '0')

// 6. Internal transfers: switch off, then on
const C2 = 'NQ66 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCC2'
const flowRows = [
  tx(OWN, C1, 100, { toType: 2 }), // funding: fully internal round trip
  tx(C1, OWN, 100), // return: fully internal
  tx(OWN, C2, 30, { toType: 2 }), // funding: 10 real out, 20 internal
  tx(C2, OWN, 20), // return: fully internal
  tx(MERCHANT, OWN, 8), // plain receive: real
]
const flowMap = splitHtlcFlows(flowRows, OWN)
const offCtx = { own: OWN, remote: REMOTE, flows: flowMap, hideInternal: false }
const onCtx = { own: OWN, remote: REMOTE, flows: flowMap, hideInternal: true }
const offReceived = historySummary(flowRows, 'received', offCtx)
const onReceived = historySummary(flowRows, 'received', onCtx)
const onSent = historySummary(flowRows, 'sent', onCtx)
const onAll = historySummary(flowRows, 'all', onCtx)
check(
  'internal off: Received counts full values (plain sums)',
  offReceived.totalLuna === String(Math.round((100 + 20 + 8) * LUNA)),
  offReceived.totalLuna
)
check(
  'internal on: Received keeps only real parts (plain 8)',
  onReceived.totalLuna === String(8 * LUNA),
  onReceived.totalLuna
)
check(
  'internal on: Sent keeps only the 10 real out',
  onSent.totalLuna === String(10 * LUNA),
  onSent.totalLuna
)
check(
  'internal on: hidden lines report the internal parts actually removed',
  onReceived.hiddenLuna === String(120 * LUNA) && onSent.hiddenLuna === String(100 * LUNA),
  `${onReceived.hiddenLuna} / ${onSent.hiddenLuna}`
)
check(
  'internal on: fully internal rows drop out of All',
  onAll.count === 2 && onAll.hiddenLuna === String(220 * LUNA),
  `${onAll.count} / ${onAll.hiddenLuna}`
)
check(
  'internal: rewards and cashlink filters never hide round trips',
  filterHistory(flowRows, 'rewards', onCtx).length === 0 &&
    filterHistory(flowRows, 'cashlinks', onCtx).length === 0
)
check('internal: wallet with round trips offers the switch', hasInternalTransfers(flowRows, onCtx))
check(
  'internal: wallet without round trips offers no switch',
  !hasInternalTransfers([tx(MERCHANT, OWN, 1)], onCtx)
)

// 7. Reward months: UTC boundaries, distinct days, newest first
const sep = tx(VALIDATOR, OWN, 1, {
  synthetic: 'reward',
  timestamp: Date.UTC(2026, 8, 30, 23, 30),
})
const octEarly = tx(VALIDATOR, OWN, 2, {
  synthetic: 'reward',
  timestamp: Date.UTC(2026, 9, 1, 0, 30),
})
const octDay = tx(VALIDATOR, OWN, 3, {
  synthetic: 'reward',
  timestamp: Date.UTC(2026, 9, 2, 10, 0),
})
const octSameDay = tx(VALIDATOR, OWN, 4, {
  synthetic: 'reward',
  timestamp: Date.UTC(2026, 9, 2, 20, 0),
})
const octLate = tx(VALIDATOR, OWN, 5, {
  synthetic: 'reward',
  timestamp: Date.UTC(2026, 9, 20, 12, 0),
})
const months = groupRewardsByMonth([octLate, octSameDay, octDay, octEarly, sep])
check('months: newest month first', months.map((m) => m.key).join(',') === '2026-10,2026-09', JSON.stringify(months.map((m) => m.key)))
check('months: October label', months[0].label === 'October 2026', months[0].label)
check('months: September label', months[1].label === 'September 2026', months[1].label)
check(
  'months: 23:30 UTC on 30 September stays in September',
  months[1].rows.length === 1 && months[1].rows[0].hash === sep.hash,
  JSON.stringify(months[1].rows.map((r) => r.hash))
)
check('months: October has 3 distinct days', months[0].days === 3, String(months[0].days))
check(
  'months: October total is exact',
  months[0].totalLuna === String((2 + 3 + 4 + 5) * LUNA),
  months[0].totalLuna
)
check(
  'months: a month total matches its rows summary',
  months[0].totalLuna === historySummary(months[0].rows, 'rewards', ctx).totalLuna
)
check('months: empty input gives no months', groupRewardsByMonth([]).length === 0)

// 8. Real-data parity with Analytics (test/fixtures/htlc-relay-nq82.json).
// The same number Analytics' Received/Sent stats show for this wallet, with
// its netting inputs: the fixture has no held contracts and no contract rows,
// so splitHtlcFlows(txs, own) is exactly what Analytics computes.
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/htlc-relay-nq82.json'), 'utf8'))
const fxFlows = splitHtlcFlows(fx.txs, fx.ownAddress)
const fxCtx = { own: fx.ownAddress, remote: null, flows: fxFlows, hideInternal: true }
const fxTotals = { realIn: 0, internalIn: 0, realOut: 0, internalOut: 0 }
for (const s of fxFlows.values()) for (const k of Object.keys(fxTotals)) fxTotals[k] += s[k]
check('fixture: real-in matches the HTLC oracle (22,926.90086 NIM)', fxTotals.realIn === 2292690086, String(fxTotals.realIn))
check('fixture: real-out matches the HTLC oracle (22,926.90086 NIM)', fxTotals.realOut === 2292690086, String(fxTotals.realOut))

// The fixture's real-in includes two payouts from the staking contract
// (51.01 and 10 NIM). History's Received filter excludes staking by
// definition, so Received equals Analytics' real-in only when those rows are
// taken out. The sum Received + staking inflow is the Analytics figure, and
// that relationship is what this wallet can prove; Sent is identical because
// none of its outgoing rows is staking.
const flat = (a) => (a || '').replace(/\s+/g, '').toUpperCase()
let stakingInLuna = 0
for (const t of fx.txs) {
  if (historyCategory(t, fxCtx) !== 'staking' || historyDirection(t, fxCtx) !== 'in') continue
  const sp = fxFlows.get(t.hash)
  if (sp) stakingInLuna += sp.realIn
}
const fxSent = historySummary(fx.txs, 'sent', fxCtx)
const fxReceived = historySummary(fx.txs, 'received', fxCtx)
check(
  'fixture: Sent total equals Analytics real-out exactly',
  fxSent.totalLuna === String(fxTotals.realOut),
  `${fxSent.totalLuna} vs ${fxTotals.realOut}`
)
check(
  'fixture: Received + staking inflow equals Analytics real-in exactly',
  Number(fxReceived.totalLuna) + stakingInLuna === fxTotals.realIn,
  `${fxReceived.totalLuna} + ${stakingInLuna} vs ${fxTotals.realIn}`
)
check(
  'fixture: Received is real-in minus the staking payouts',
  fxReceived.totalLuna === String(fxTotals.realIn - 51010000 - 10000000),
  fxReceived.totalLuna
)
let hiddenInLuna = 0
let hiddenOutLuna = 0
for (const t of fx.txs) {
  const sp = fxFlows.get(t.hash)
  if (!sp) continue
  const d = historyDirection(t, fxCtx)
  if (d === 'in' && sp.realIn === 0 && sp.internalIn > 0) hiddenInLuna += sp.internalIn
  if (d === 'out' && sp.realOut === 0 && sp.internalOut > 0) hiddenOutLuna += sp.internalOut
}
check(
  'fixture: hidden line reports exactly the fully internal parts removed',
  fxReceived.hiddenLuna === String(hiddenInLuna) && fxSent.hiddenLuna === String(hiddenOutLuna),
  `${fxReceived.hiddenLuna}/${fxSent.hiddenLuna} vs ${hiddenInLuna}/${hiddenOutLuna}`
)
check(
  'fixture: something really is hidden',
  hiddenInLuna > 0 && hiddenOutLuna > 0,
  `${hiddenInLuna}/${hiddenOutLuna}`
)
// Removing the two staking payouts from the list leaves Received at exactly
// the removed amount lower: the staking category is the only difference
// between History's Received and Analytics' real-in on this wallet.
const noStakeRows = fx.txs.filter((t) => historyCategory(t, fxCtx) !== 'staking')
const noStakeFlows = splitHtlcFlows(noStakeRows, fx.ownAddress)
const noStakeCtx = { own: fx.ownAddress, remote: null, flows: noStakeFlows, hideInternal: true }
const noStakeReceived = historySummary(noStakeRows, 'received', noStakeCtx)
const noStakeSent = historySummary(noStakeRows, 'sent', noStakeCtx)
check(
  'fixture without staking rows: Received equals real-in minus the staking payouts',
  noStakeReceived.totalLuna === String(fxTotals.realIn - stakingInLuna),
  noStakeReceived.totalLuna
)
check(
  'fixture without staking rows: Sent still equals real-out',
  noStakeSent.totalLuna === '2292690086',
  noStakeSent.totalLuna
)
check(
  'fixture: every row lands in one of payment, pay and staking',
  fx.txs.every((t) => historyCategory(t, fxCtx) !== undefined) &&
    new Set(fx.txs.map((t) => historyCategory(t, fxCtx))).size === 3
)
check(
  'fixture: switch on hides rows, switch off lists them all',
  filterHistory(fx.txs, 'all', fxCtx).length < filterHistory(fx.txs, 'all', { ...fxCtx, hideInternal: false }).length
)

fs.unlinkSync(flowsOut)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
