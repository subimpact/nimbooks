// Validator order oracle: bundles src/lib/chain.ts for node and asserts the
// picker's sort is neutral: yield first, then reliability, then name - with
// nothing pinned and the builder's pool ranking like any other.
// Usage: node test/validator-order-oracle.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'chain.ts')
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-order-oracle-'))
const OUT = path.join(OUT_DIR, 'chain.cjs')
const ROLLDOWN = path.join(ROOT, 'node_modules', '.bin', 'rolldown')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

execFileSync(ROLLDOWN, [SRC, '--format', 'cjs', '--platform', 'node', '--file', OUT, '--no-codeSplitting'], { stdio: 'ignore' })
const { sortValidators, compareValidators, isPinnedValidator, PINNED_VALIDATOR_ADDRESS } = require(OUT)

const BUILDER = PINNED_VALIDATOR_ADDRESS
const v = (name, { annualReward = null, reliability = null, address = `NQ${name}` } = {}) => ({
  id: 0, name, address, fee: null, reliability, isListed: true, balance: 0, annualReward,
})
const impactZero = (o = {}) => v('ImpactZero', { address: BUILDER, ...o })
const names = (list) => list.map((x) => x.name)

// 1. The builder's pool leads only when it earns the most: same shape, higher
//    yield than every other pool means first place comes from the yield.
check('highest yield sorts first, whoever runs it', names(sortValidators([
  v('Alba', { annualReward: 0.07, reliability: 0.9 }),
  impactZero({ annualReward: 0.09, reliability: 0.95 }),
  v('Borealis', { annualReward: 0.08, reliability: 0.9 }),
]))[0] === 'ImpactZero', names(sortValidators([
  v('Alba', { annualReward: 0.07, reliability: 0.9 }),
  impactZero({ annualReward: 0.09, reliability: 0.95 }),
  v('Borealis', { annualReward: 0.08, reliability: 0.9 }),
])).join(', '))

// 2. A lower yield loses its old pinned front row: better-paying pools are
//    above it whatever its name or address.
{
  const sorted = names(sortValidators([
    impactZero({ annualReward: 0.05, reliability: 0.99 }),
    v('Borealis', { annualReward: 0.08, reliability: 0.9 }),
    v('Alba', { annualReward: 0.07, reliability: 0.9 }),
  ]))
  check('lower-yield builder pool sorts below better pools', sorted[0] === 'Borealis' && sorted[1] === 'Alba' && sorted[2] === 'ImpactZero', sorted.join(', '))
}

// 3. Yield ordering, nulls last: producing pools with no published yield sit
//    under scored yields; a pool with a yield but no production sits last.
{
  const sorted = names(sortValidators([
    v('NoScore', { annualReward: 0.09, reliability: null }),
    v('NoYield', { annualReward: null, reliability: 0.9 }),
    v('Scored', { annualReward: 0.03, reliability: 0.9 }),
  ]))
  check('yield desc, no-yield pools after scored ones', sorted[0] === 'Scored' && sorted[1] === 'NoYield', sorted.join(', '))
  check('not-producing pool ranks last despite top yield', sorted[2] === 'NoScore', sorted.join(', '))
}

// 4. Reliability breaks yield ties; null reliability is always last group.
{
  const sorted = names(sortValidators([
    v('Gamma', { annualReward: 0.06, reliability: 0.80 }),
    v('Alpha', { annualReward: 0.06, reliability: 0.95 }),
  ]))
  check('equal yield: reliability desc', sorted[0] === 'Alpha', sorted.join(', '))

  const withNull = names(sortValidators([
    v('Steady', { annualReward: null, reliability: null }),
    v('Quiet', { annualReward: 0.02, reliability: null }),
    v('Loud', { annualReward: null, reliability: 0.5 }),
  ]))
  check('producing before non-producing, yield among idle ignored', withNull[0] === 'Loud' && withNull[1] === 'Quiet' && withNull[2] === 'Steady', withNull.join(', '))
}

// 5. Stable name tie-break: identical scores keep alphabetical order, and the
//    comparator is a pure function of the two rows.
{
  const sorted = names(sortValidators([
    v('zeta', { annualReward: 0.04, reliability: 0.9 }),
    v('Beta', { annualReward: 0.04, reliability: 0.9 }),
    v('alpha', { annualReward: 0.04, reliability: 0.9 }),
  ]))
  check('name tie-break is alphabetical (case-insensitive) and stable', sorted.join(',') === 'alpha,Beta,zeta', sorted.join(', '))
  check('comparator sees equal rows as equal', compareValidators(
    v('Same', { annualReward: 0.05, reliability: 0.9 }),
    v('Same', { annualReward: 0.05, reliability: 0.9 })
  ) === 0)
}

// 6. Nothing is pinned: the builder's pool with no score and no yield sorts
//    below every producing pool, exactly like any other unproven pool.
{
  const sorted = names(sortValidators([
    impactZero({ annualReward: null, reliability: null }),
    v('Alba', { annualReward: 0.02, reliability: 0.5 }),
    v('Borealis', { annualReward: 0.01, reliability: 0.4 }),
  ]))
  check('unproven builder pool sorts last, never first', sorted[2] === 'ImpactZero' && sorted[0] === 'Alba', sorted.join(', '))
}

// 7. The sort never mutates the caller's list, and the gate marker still works.
{
  const list = [impactZero({ annualReward: 0.05, reliability: 0.9 }), v('Alba', { annualReward: 0.08, reliability: 0.9 })]
  sortValidators(list)
  check('sortValidators returns a copy', list[0].name === 'ImpactZero')
  check('gate marker still recognises the builder pool', isPinnedValidator(BUILDER) && !isPinnedValidator('NQ9 ALBA 0000 0000 0000 0000 0000 0000 0000'))
}

fs.rmSync(OUT_DIR, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)