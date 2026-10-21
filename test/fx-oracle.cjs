// FX oracle (node, live network): the price chain's NIM x FX figure against
// CoinGecko's own per-currency NIM price, directly. Both sides read the
// market at the same moment, so every pair has to agree within 0.5%.
// Currencies: EUR, GBP, MYR, JPY, BRL.
// If CoinGecko answers 429, print SKIP and exit 0.
const { execSync } = require('child_process')
const path = require('path')
const os = require('os')

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}

;(async () => {
  const out = path.join(os.tmpdir(), `fx-oracle-${process.pid}.cjs`)
  execSync(`npx rolldown src/lib/prices.ts --file ${out} --format cjs --platform node`, {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe',
  })
  // The bundle reads localStorage for its caches; give it a scratch one so a
  // cold run does not inherit a browser's five-minute cache.
  const store = new Map()
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  const { getAllFiatRatesImpl } = require(out)

  const CURRENCIES = ['eur', 'gbp', 'myr', 'jpy', 'brl']
  const cgRes = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=${CURRENCIES.join(',')}`
  )
  if (cgRes.status === 429) {
    console.log('SKIP: CoinGecko answered 429')
    process.exit(0)
  }
  if (!cgRes.ok) {
    console.log('SKIP: CoinGecko answered HTTP ' + cgRes.status)
    process.exit(0)
  }
  const cg = (await cgRes.json())['nimiq-2']

  let sawSource = null
  for (const code of CURRENCIES) {
    const r = await getAllFiatRatesImpl(code)
    const ours = r.nim[code]
    const theirs = cg[code] // CoinGecko keys the vs-currencies lowercase
    sawSource = sawSource ?? `${r.priceSource} + ${r.fxSource}`
    if (!Number.isFinite(ours) || !Number.isFinite(theirs) || theirs <= 0) {
      check(`${code}: both sides priced`, false, `ours ${ours} cg ${theirs}`)
      continue
    }
    const diff = Math.abs(ours - theirs) / theirs
    check(
      `${code}: chain ${Number(ours).toPrecision(6)} vs CoinGecko ${theirs} within 0.5%`,
      diff <= 0.005,
      `diff ${(diff * 100).toFixed(3)}% (source ${r.priceSource}/${r.fxSource})`
    )
  }
  console.log(`sources: ${sawSource}`)
  console.log(`${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})