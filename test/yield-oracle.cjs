// Yield projection oracle: bundles src/lib/yieldCalc.ts for node and asserts the
// Earn card / calculator maths against the protocol's emission curve.
// Usage: node test/yield-oracle.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'yieldCalc.ts')
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yield-oracle-'))
const OUT = path.join(OUT_DIR, 'yieldCalc.cjs')
const ROLLDOWN = path.join(ROOT, 'node_modules', '.bin', 'rolldown')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

execFileSync(ROLLDOWN, [SRC, '--format', 'cjs', '--platform', 'node', '--file', OUT], { stdio: 'ignore' })
const { projectStake, typicalRate, compoundsFor } = require(OUT)

const now = Date.UTC(2026, 9, 15)
const rate = 0.0816
const run = (principalNim, months, compound) => projectStake({ principalNim, annualRateNow: rate, months, compound, now })

const simple = run(1000, 12, false)
const comp = run(1000, 12, true)
// The rate is defined over the next twelve months of emission, so simple first-year rewards equal it exactly.
check('simple first year = principal × rate', Math.abs(simple.rewardsNim - 81.6) < 1e-6, simple.rewardsNim.toFixed(6))
check('compounding earns more than simple', comp.rewardsNim > simple.rewardsNim, comp.rewardsNim.toFixed(3))
check('compounding stays under continuous compounding', comp.rewardsNim < 1000 * (Math.exp(rate) - 1))
check('13 monthly points including today', comp.points.length === 13 && comp.points[0].balanceNim === 1000)

const five = run(1000, 60, false)
const y1 = five.points[12].rewardsNim
const y5 = five.points[60].rewardsNim - five.points[48].rewardsNim
check('issuance decline: year 5 earns less than year 1', y5 < y1, `${y1.toFixed(2)} vs ${y5.toFixed(2)}`)
// The supply curve decays about 11.8 % a year, so year 5 ≈ year 1 × 0.882^4.
check('year 5 ≈ 0.605 × year 1', Math.abs(y5 / y1 - 0.605) < 0.01, (y5 / y1).toFixed(3))
check('firstYearNim matches month 12', run(1000, 60, true).firstYearNim === run(1000, 60, true).points[12].rewardsNim)

check('zero principal earns nothing', run(0, 12, true).rewardsNim === 0)
check('a NaN rate earns nothing', projectStake({ principalNim: 100, annualRateNow: NaN, months: 12, compound: true, now }).rewardsNim === 0)

const v = (r, rel) => ({ annualReward: r, reliability: rel })
check('typical rate: median of producing pools', typicalRate([v(0.08, 0.9), v(0.07, 0.9), v(0.09, 0.9), v(0.5, null), v(null, 0.9)]) === 0.08)
check('typical rate: even count averages the middle two', Math.abs(typicalRate([v(0.08, 0.9), v(0.06, 0.9)]) - 0.07) < 1e-12)
check('typical rate: none without data', typicalRate([]) === null)
check('direct payout does not compound', compoundsFor({ payoutType: 'direct' }) === false)
check('restake (and unknown) compounds', compoundsFor({ payoutType: 'restake' }) === true && compoundsFor(null) === true)

fs.rmSync(OUT_DIR, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
