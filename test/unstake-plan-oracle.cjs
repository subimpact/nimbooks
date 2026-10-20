// Unstake plan oracle: bundles src/lib/unstakePlan.ts for node and asserts the
// partial-unstake maths the submit handler and the panel's inline explainer
// share: what actually deactivates, when the 100 NIM minimum forces a snap,
// and when only a full unstake is legal.
// Usage: node test/unstake-plan-oracle.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'unstakePlan.ts')
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'unstake-plan-oracle-'))
const OUT = path.join(OUT_DIR, 'unstakePlan.cjs')
const ROLLDOWN = path.join(ROOT, 'node_modules', '.bin', 'rolldown')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

execFileSync(ROLLDOWN, [SRC, '--format', 'cjs', '--platform', 'node', '--file', OUT], { stdio: 'ignore' })
const { planUnstake } = require(OUT)

const L = (nim) => nim * 100000
const MIN = L(100)

const run = (requestedNim, activeNim, inactiveNim = 0, retiredNim = 0) => planUnstake({
  requestedLuna: L(requestedNim),
  retiredLuna: L(retiredNim),
  retireableLuna: L(activeNim),
  inactiveLuna: L(inactiveNim),
  minStakeLuna: MIN,
})

// 1. A plain partial unstake with a comfortable remainder: no snap, the
//    requested amount deactivates as-is.
{
  const p = run(200, 500)
  check('no snap: request deactivates as asked',
    p.deactivateLuna === L(200) && p.remainderLuna === L(300) && !p.snapped && !p.fullOnly,
    JSON.stringify(p))
  check('no snap: nothing is covered by cooling stake', p.inactiveCoveredLuna === 0)
  check('no snap: no snap amount recorded', p.askedDeactivateLuna === null)
}

// 2. Same order as the submit handler: the whole retired balance is withdrawn
//    first, then active stake is deactivated for what is still owed, and only
//    what is left after that counts as already cooling down.
{
  const p = run(200, 500, 50)
  check('active stake is deactivated before cooling stake is counted',
    p.deactivateLuna === L(200) && p.inactiveCoveredLuna === 0 && p.remainderLuna === L(300),
    JSON.stringify(p))
  const r = run(200, 500, 0, 200)
  check('a request met by the retired balance deactivates nothing (no double count)',
    r.retiredCoveredLuna === L(200) && r.deactivateLuna === 0 && !r.snapped && !r.fullOnly,
    JSON.stringify(r))
  const r2 = run(300, 500, 0, 120)
  check('retired first, then the rest from active stake',
    r2.retiredCoveredLuna === L(120) && r2.deactivateLuna === L(180) && r2.remainderLuna === L(320),
    JSON.stringify(r2))
  const left = run(560, 500, 80)
  check('beyond the active stake, the rest is met by cooling stake',
    left.deactivateLuna === L(500) && left.inactiveCoveredLuna === L(60),
    JSON.stringify(left))
}

// 3. A snap that leaves exactly the minimum: 250 NIM active, 160 requested -
//    the asked-for 160 would leave 90 NIM under-staked, so the deactivation
//    grows to 150 NIM and exactly 100 NIM stays staked.
{
  const p = run(160, 250)
  check('snap enlarges the deactivation to leave exactly 100 NIM',
    p.snapped && p.deactivateLuna === L(150) && p.remainderLuna === MIN && p.askedDeactivateLuna === L(160) && !p.fullOnly,
    JSON.stringify(p))
}

// 4. Active stake at or under the minimum: no partial amount is legal, only a
//    full unstake (which closes the record rather than shrinking it).
{
  const p = run(100, 260)
  check('no snap needed when the remainder stays above the minimum',
    !p.snapped && p.deactivateLuna === L(100) && p.remainderLuna === L(160),
    JSON.stringify(p))
  const under = run(60, 90)
  check('full-unstake-only below the minimum', under.fullOnly && under.deactivateLuna === 0 && !under.snapped, JSON.stringify(under))
  const exact = run(40, 100)
  check('full-unstake-only at exactly the minimum', exact.fullOnly && exact.deactivateLuna === 0, JSON.stringify(exact))
  const whole = run(100, 100)
  check('a full request at the minimum closes the record, no snap',
    !whole.snapped && !whole.fullOnly && whole.deactivateLuna === L(100) && whole.remainderLuna === 0,
    JSON.stringify(whole))
}

// 5. Edges: empty and oversized inputs must stay inside the balances asked for.
{
  check('a zero request deactivates nothing', run(0, 500).deactivateLuna === 0)
  check('a request beyond the active stake clamps to it', run(1000, 300).deactivateLuna === L(300))
  check('a NaN request deactivates nothing',
    planUnstake({ requestedLuna: NaN, retiredLuna: 0, inactiveLuna: 0, retireableLuna: L(500), minStakeLuna: MIN }).deactivateLuna === 0)
  check('negative inputs are treated as zero',
    planUnstake({ requestedLuna: -5, retiredLuna: -3, inactiveLuna: -10, retireableLuna: L(500), minStakeLuna: MIN }).deactivateLuna === 0)
  const snapEdge = run(150.5, 249.5)
  check('fractional Luna request still snaps to the exact minimum',
    snapEdge.snapped && snapEdge.deactivateLuna === L(149.5) && snapEdge.remainderLuna === MIN,
    JSON.stringify(snapEdge))
}

fs.rmSync(OUT_DIR, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)