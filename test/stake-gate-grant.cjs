// Portfolio access grant check: bundles src/lib/stakeGate.ts for node and asserts
// the SHA-256 grant list, the normalisation, and the 'granted' gate reason.
// Usage: node test/stake-gate-grant.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'stakeGate.ts')
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stake-gate-grant-'))
const OUT = path.join(OUT_DIR, 'stakeGate.cjs')
const ROLLDOWN = path.join(ROOT, 'node_modules', '.bin', 'rolldown')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

const GRANTED = [
  'NQ82 T0JU J6F1 3Y0Y EA84 2238 B0T5 KGT5 EETB',
  'NQ88 QJ5G DQS7 6YH6 J5T5 DXVR 9YUH 6V52 SBKU',
  'NQ67 ACSR 3GFL HN98 93PR 9PG8 UTU0 9QXV 09UH',
]
const NOT_GRANTED = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'

// Raw addresses must never appear in the source or the bundle.
const srcText = fs.readFileSync(SRC, 'utf8')
const raw = [...GRANTED, NOT_GRANTED].flatMap((a) => [a, a.replace(/\s+/g, '')])

;(async () => {
  execFileSync(ROLLDOWN, [SRC, '--format', 'cjs', '--platform', 'node', '--file', OUT], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const bundle = fs.readFileSync(OUT, 'utf8')
  check('source has no raw grant address', raw.every((a) => !srcText.includes(a)))
  check('bundle has no raw grant address', raw.every((a) => !bundle.includes(a)))

  const mod = require(OUT)
  const { isGrantedAddress, stakeGateStatus } = mod

  for (const addr of GRANTED) {
    check(`granted: ${addr}`, (await isGrantedAddress(addr)) === true)
    const lower = addr.replace(/\s+/g, '').toLowerCase()
    check(`granted (lowercase, no spaces): ${lower}`, (await isGrantedAddress(lower)) === true)
    check(`granted (no spaces): ${addr.replace(/\s+/g, '')}`, (await isGrantedAddress(addr.replace(/\s+/g, ''))) === true)
  }
  check(`not granted: ${NOT_GRANTED}`, (await isGrantedAddress(NOT_GRANTED)) === false)
  check('empty input is not granted', (await isGrantedAddress('')) === false)
  check('whitespace-only input is not granted', (await isGrantedAddress('   ')) === false)

  const g = stakeGateStatus(null, false, true)
  check("stakeGateStatus(null, false, true).reason === 'granted'", g.reason === 'granted', JSON.stringify(g))
  check('granted unlocked, missingNim 0', g.unlocked === true && g.missingNim === 0)
  const d = stakeGateStatus(null, true, false)
  check("demo still reports 'demo' with granted off", d.reason === 'demo' && d.unlocked === true)
  const n = stakeGateStatus(null, false)
  check("default granted=false keeps 'not-staked'", n.reason === 'not-staked' && n.unlocked === false)

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
