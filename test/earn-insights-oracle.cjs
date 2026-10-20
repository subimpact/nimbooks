// Earn insights oracle: bundles src/lib/earnInsights.ts for node and asserts
// the three Earn card retention maths against exact synthetic numbers.
// Usage: node test/earn-insights-oracle.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'earnInsights.ts')
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'earn-insights-'))
const OUT = path.join(OUT_DIR, 'earnInsights.cjs')
const ROLLDOWN = path.join(ROOT, 'node_modules', '.bin', 'rolldown')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

execFileSync(ROLLDOWN, [SRC, '--format', 'cjs', '--platform', 'node', '--file', OUT], { stdio: 'ignore' })
const { rewardsSince, rewardsByValidator, trailingYield, stakeNudge } = require(OUT)

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 21) // 21 Oct 2026, 00:00 UTC
const OWN = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'

// Reward rows: one UTC day per validator, exactly as stakingEvents.ts builds
// them (Luna string values, `synthetic: 'reward'`).
const rewardRow = (daysAgo, nimNim, validator = 'NQ7 1111 0000 0000 0000 0000 0000 0000 0001') => ({
  hash: `restake:${Math.floor((now - daysAgo * DAY) / DAY)}:${validator.replace(/\s+/g, '')}`,
  sender: validator,
  recipient: OWN,
  value: String(Math.round(nimNim * 100000)),
  fee: '0',
  timestamp: now - daysAgo * DAY,
  executionResult: true,
  synthetic: 'reward',
})

// Received payments: real mined txs the caller has already filtered.
const payRow = (hash, daysAgoMs, nimNim, extra = {}) => ({
  hash,
  sender: 'NQ55 SENDER 0000 0000 0000 0000 0000 0000 0000',
  recipient: OWN,
  value: String(Math.round(nimNim * 100000)),
  fee: '0',
  timestamp: now - daysAgoMs,
  executionResult: true,
  ...extra,
})

// --- rewardsSince ---

const cut = now - 5 * DAY
const span = rewardsSince(
  [rewardRow(0, 0.5), rewardRow(2, 0.25), rewardRow(5, 9), rewardRow(6, 9), rewardRow(7, 300)],
  cut
)
check('rewardsSince: sum of rows after the cut-off', close(span.nim, 0.75), span.nim.toFixed(6))
check('rewardsSince: distinct UTC days', span.days === 2, String(span.days))


// --- rewardsByValidator ---

const vA = 'NQ7 1111 0000 0000 0000 0000 0000 0000 0001'
const vB = 'NQ7 2222 0000 0000 0000 0000 0000 0000 0002'
const validatorRows = [
  rewardRow(0, 0.5, vA),
  rewardRow(1, 0.5, vA),
  rewardRow(2, 0.25, vB),
  rewardRow(3, 0.25, vB),
  rewardRow(4, 0.5, vA),
  rewardRow(10, 9, vA),
]
const byValidator = rewardsByValidator(validatorRows)
check('rewardsByValidator: two rows, largest first', byValidator.length === 2 && byValidator[0].address === vA.replace(/\s+/g, '').toUpperCase(), JSON.stringify(byValidator.map((v) => v.address)))
check('rewardsByValidator: totals summed', close(byValidator[0].nim, 10.5) && close(byValidator[1].nim, 0.5), `${byValidator[0].nim} / ${byValidator[1].nim}`)
check('rewardsByValidator: day counts', byValidator[0].days === 4 && byValidator[1].days === 2)
check('rewardsByValidator: window first/last', byValidator[0].firstMs === now - 10 * DAY && byValidator[0].lastMs === now)

const cutExact = now - 5 * DAY
const spanEdge = rewardsSince([rewardRow(5, 9), rewardRow(4, 9)], cutExact)
check('rewardsSince: row exactly at the cut-off excluded', spanEdge.nim === 9 && spanEdge.days === 1, JSON.stringify(spanEdge))
const fromNine = rewardsByValidator(validatorRows, { fromMs: now - 5 * DAY })
check('rewardsByValidator: fromMs cut-off applied', close(fromNine[0].nim, 1.5) && close(fromNine[1].nim, 0.5), `${fromNine[0].nim} / ${fromNine[1].nim}`)

// --- trailingYield ---

// 30 days of 0.25 NIM/day on 1,000 NIM staked = 7.5 / 1000 annualised x 365/30 = 9.125% p.a.
const thirty = Array.from({ length: 30 }, (_, i) => rewardRow(i, 0.25))
const yield30 = trailingYield(thirty, 1000 * 100000, now)
check('trailingYield: 30 days of data = 9.125% p.a.', yield30 !== null && close(yield30.rate, 0.09125), yield30 ? (yield30.rate * 100).toFixed(4) + '%' : 'null')
check('trailingYield: window reported as the days covered', yield30 !== null && yield30.windowDays === 30)

const ten = Array.from({ length: 10 }, (_, i) => rewardRow(i, 0.25))
check('trailingYield: 10 days of data uses 10 as the window', (() => {
  const y = trailingYield(ten, 1000 * 100000, now)
  return y !== null && y.windowDays === 10 && close(y.rate, 0.09125)
})())
check('trailingYield: 30-day window ignores older rewards', (() => {
  const y = trailingYield([...thirty, rewardRow(45, 100)], 1000 * 100000, now)
  return y !== null && close(y.rate, 0.09125)
})())
check('trailingYield: under 7 covered days is null', trailingYield(Array.from({ length: 6 }, (_, i) => rewardRow(i, 0.25)), 1000 * 100000, now) === null)
check('trailingYield: no rows at all is null', trailingYield([], 1000 * 100000, now) === null)
check('trailingYield: zero stake is null', trailingYield(thirty, 0, now) === null)

// --- stakeNudge ---

const nudgeNewest = 'newest-hash'
const nudgeOlder = 'older-hash'
const within = [
  payRow(nudgeOlder, 3 * DAY, 6),
  payRow(nudgeNewest, 2 * DAY, 10),
  payRow('too-old', 8 * DAY, 50),
]

const base = { incomingTxs: within, idleNim: 12, hasStaker: true, minStakeNim: 100, nowMs: now }
const pick = stakeNudge({ ...base, dismissedHashes: [] })
check('nudge: newest payment wins', pick !== null && pick.hash === nudgeNewest && close(pick.nim, 10) && pick.timestamp === now - 2 * DAY, JSON.stringify(pick))
const afterDismiss = stakeNudge({ ...base, dismissedHashes: [nudgeNewest] })
check('nudge: dismissed hash skipped, next newest offered', afterDismiss !== null && afterDismiss.hash === nudgeOlder, JSON.stringify(afterDismiss))
check('nudge: entirely outside the 7-day window is null', stakeNudge({ ...base, incomingTxs: [payRow('x', 8 * DAY, 50)], dismissedHashes: [] }) === null)
const olderThan7 = [...within, payRow('older-still', 7 * DAY + 1, 99)]
check('nudge: payment just past 7 days is skipped', stakeNudge({ ...base, incomingTxs: olderThan7, dismissedHashes: [nudgeNewest, nudgeOlder] }) === null)
check('nudge: non-staker below the minimum is null', stakeNudge({ ...base, hasStaker: false, idleNim: 50, minStakeNim: 100, dismissedHashes: [] }) === null)
check('nudge: non-staker at the minimum qualifies', stakeNudge({ ...base, hasStaker: false, idleNim: 100, minStakeNim: 100, dismissedHashes: [] }) !== null)
check('nudge: staker can be nudged at any idle above 1 NIM', stakeNudge({ ...base, idleNim: 1, dismissedHashes: [] }) !== null && stakeNudge({ ...base, idleNim: 0.5, dismissedHashes: [] }) === null)
check('nudge: nothing to stake is null', stakeNudge({ ...base, idleNim: 0, dismissedHashes: [] }) === null)

fs.rmSync(OUT_DIR, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)