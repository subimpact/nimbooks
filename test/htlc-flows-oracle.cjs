// Oracle for src/lib/htlcFlows.ts (Analytics HTLC netting). Fixed before the
// build; the implementation must make this pass unchanged.
// Run: node test/htlc-flows-oracle.cjs
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const root = path.resolve(__dirname, '..')
const out = path.join(require('os').tmpdir(), `htlcFlows-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/htlcFlows.ts --file ${out} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })
const { splitHtlcFlows } = require(out)

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}
const sum = (m) => {
  const t = { realIn: 0, internalIn: 0, realOut: 0, internalOut: 0 }
  for (const s of m.values()) for (const k of Object.keys(t)) t[k] += s[k]
  return t
}
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol // luna, rounding slack

// 1. Real Nimiq Pay relay wallet (public chain data, 156 txs, balance 0 now)
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/htlc-relay-nq82.json'), 'utf8'))
const t1 = sum(splitHtlcFlows(fx.txs, fx.ownAddress))
check('relay: realIn 22,926.90086 NIM', near(t1.realIn, 2292690086), t1.realIn)
check('relay: realOut 22,926.90086 NIM', near(t1.realOut, 2292690086), t1.realOut)
check('relay: internalIn 43,129.56050 NIM', near(t1.internalIn, 4312956050), t1.internalIn)
check('relay: internalOut 43,129.56050 NIM', near(t1.internalOut, 4312956050), t1.internalOut)
const allVals = fx.txs.reduce((s, t) => s + Number(t.value), 0)
check('relay: every luna classified once', near(t1.realIn + t1.internalIn + t1.realOut + t1.internalOut, allVals, 20), `${allVals}`)

// Synthetic wallet
const OWN = 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const C1 = 'NQ22 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCC1'
const C2 = 'NQ33 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCC2'
const C3 = 'NQ44 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCC3'
const X = 'NQ55 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX'
let n = 0
const tx = (sender, recipient, nim, toType = 0, extra = {}) => ({
  hash: `h${++n}`, sender, recipient, value: String(nim * 1e5), fee: '0', timestamp: 1790000000000 + n * 1000, toType, executionResult: true, ...extra,
})
const txs = [
  tx(OWN, C1, 1000, 2), // h1 fund C1
  tx(C1, OWN, 1000), // h2 full return -> round trip
  tx(OWN, C2, 500, 2), // h3 fund C2
  tx(C2, OWN, 200), // h4 partial return: 300 went elsewhere
  tx(C3, OWN, 50), // h5 HTLC funded by someone else pays us -> real in
  tx(X, OWN, 70), // h6 plain receive
  tx(OWN, X, 30), // h7 plain send
  tx(OWN, OWN, 9), // h8 self transfer -> nothing
  tx(OWN.replace(/ /g, '').toLowerCase(), C3, 5, 2, { executionResult: false }), // h9 failed -> nothing
]
const m = splitHtlcFlows(txs, OWN)
const g = (h) => m.get(h) || { realIn: 0, internalIn: 0, realOut: 0, internalOut: 0 }
check('round trip: funding fully internal', g('h1').internalOut === 1000e5 && g('h1').realOut === 0, JSON.stringify(g('h1')))
check('round trip: return fully internal', g('h2').internalIn === 1000e5 && g('h2').realIn === 0, JSON.stringify(g('h2')))
check('partial: 200 internal + 300 real out', near(g('h3').internalOut, 200e5) && near(g('h3').realOut, 300e5), JSON.stringify(g('h3')))
check('partial: return internal', near(g('h4').internalIn, 200e5) && g('h4').realIn === 0, JSON.stringify(g('h4')))
check('foreign HTLC pays us: real in', g('h5').realIn === 50e5 && g('h5').internalIn === 0, JSON.stringify(g('h5')))
check('plain receive real', g('h6').realIn === 70e5)
check('plain send real', g('h7').realOut === 30e5)
const z = (s) => s.realIn + s.internalIn + s.realOut + s.internalOut === 0
check('self transfer: no flow', z(g('h8')))
check('failed tx: no flow', z(g('h9')))

// Held contract (still locked = still the user's money) counts fully internal
const m2 = splitHtlcFlows(txs, OWN, { heldContracts: [C2.replace(/ /g, '')] })
check('held contract: whole funding internal', near(m2.get('h3').internalOut, 500e5) && m2.get('h3').realOut === 0, JSON.stringify(m2.get('h3')))

// Returned more than funded (contract topped up by someone else): excess is real in
const m3 = splitHtlcFlows([tx(OWN, C1, 100, 2), tx(C1, OWN, 160)], OWN)
const last = [...m3.values()]
check('over-return: 100 internal + 60 real in', near(last[1].internalIn, 100e5) && near(last[1].realIn, 60e5), JSON.stringify(last[1]))

// Netting is computed over the whole list, independent of order
const m4 = splitHtlcFlows([...txs].reverse(), OWN)
check('order independent', JSON.stringify(sum(m4)) === JSON.stringify(sum(m)))

fs.unlinkSync(out)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
