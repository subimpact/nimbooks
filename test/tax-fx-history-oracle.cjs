// Oracle for historical daily FX (src/lib/fxHistory.ts) and the per-day rate
// path through computeFifoGains (src/lib/tax.ts).
// Run: node test/tax-fx-history-oracle.cjs
//
// Why: a 2025 EUR report used today's EUR/USD for every historical close, so
// the whole year was off by the 2025 move (about 12%). Each row must carry its
// own day's rate, weekends must use the prior business day, failures must fall
// back to today's rate with a visible count, USD must make no request, and a
// closed year must stay cached.
const { execSync } = require('child_process')
const path = require('path')
const os = require('os')

const root = path.resolve(__dirname, '..')
const fxOut = path.join(os.tmpdir(), `tax-fx-history-${process.pid}.cjs`)
const taxOut = path.join(os.tmpdir(), `tax-fx-engine-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/fxHistory.ts --file ${fxOut} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })
execSync(`npx rolldown src/lib/tax.ts --file ${taxOut} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}
const near = (a, b, tol = 1e-12) => typeof a === 'number' && Math.abs(a - b) <= tol

const NOW_MS = Date.parse('2026-11-12T08:00:00Z')
const realNow = Date.now
Date.now = () => NOW_MS

const store = new Map()
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const FRANK_EUR = {
  '2025-01-02': { EUR: 0.96256 },
  '2025-01-03': { EUR: 0.95111 },
  '2025-12-31': { EUR: 0.85106 },
}
const FRANK_EUR_2024 = { '2024-12-31': { EUR: 0.96256 } }
const NGN_RATE = 1543.9
let frankCalls = []
let cdnCalls = []
let failFrankSymbols = new Set()

global.fetch = async (url) => {
  const u = new URL(url)
  if (u.hostname === 'api.frankfurter.dev') {
    const year = (u.pathname.match(/\/v1\/(\d{4})-/) || [])[1]
    const symbol = u.searchParams.get('symbols') || ''
    frankCalls.push({ year, symbol })
    if (failFrankSymbols.has(symbol)) return { ok: false, status: 500, json: async () => ({}) }
    if (symbol === 'EUR' && year === '2025') {
      return { ok: true, status: 200, json: async () => ({ rates: FRANK_EUR }) }
    }
    if (symbol === 'EUR' && year === '2024') {
      return { ok: true, status: 200, json: async () => ({ rates: FRANK_EUR_2024 }) }
    }
    return { ok: true, status: 200, json: async () => ({ rates: {} }) }
  }
  if (u.hostname === 'cdn.jsdelivr.net') {
    const day = (u.pathname.match(/currency-api@(\d{4}-\d{2}-\d{2})/) || [])[1]
    cdnCalls.push(day)
    return {
      ok: true,
      status: 200,
      json: async () => ({ date: day, usd: { ngn: NGN_RATE } }),
    }
  }
  return { ok: false, status: 404, json: async () => ({}) }
}

const { getDailyFx, FRANKFURTER_SOURCE, CURRENCY_API_SOURCE, USD_FX_SOURCE } = require(fxOut)
const { computeFifoGains, USD_FX_SOURCE: TAX_USD_SOURCE } = require(taxOut)

const OWN = 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const OTHER = 'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB'
let n = 0
const tx = (day, time, nim) => ({
  hash: `h${++n}`,
  sender: OTHER,
  recipient: OWN,
  value: String(nim * 1e5),
  fee: '0',
  timestamp: Date.parse(`${day}T${time}Z`),
  toType: 0,
  executionResult: true,
})

;(async () => {
  // 1. Each 2025 row uses that day's own EUR rate.
  const eur = await getDailyFx('eur', ['2025-01-02', '2025-01-04', '2025-12-31'])
  // A day in the first week of January also pulls the previous year, because
  // 1 January is an ECB holiday and needs 31 December's rate.
  check('Frankfurter asked once per year: 2025 plus 2024 for early January', frankCalls.length === 2 && frankCalls.some((c) => c.year === '2024') && frankCalls.some((c) => c.year === '2025'), JSON.stringify(frankCalls))
  const newYear = await getDailyFx('eur', ['2025-01-01'])
  check('1 January (ECB holiday) uses 31 December of the previous year', near(newYear.rateFor('2025-01-01'), 0.96256) && newYear.fallbackDays === 0, newYear.rateFor('2025-01-01'))
  check('2025-01-02 gets its own rate', near(eur.rateFor('2025-01-02'), 0.96256), eur.rateFor('2025-01-02'))
  check('2025-12-31 gets its own rate', near(eur.rateFor('2025-12-31'), 0.85106), eur.rateFor('2025-12-31'))
  check('Saturday 2025-01-04 uses Friday 2025-01-03', near(eur.rateFor('2025-01-04'), 0.95111), eur.rateFor('2025-01-04'))
  check('no fallback days when every requested day resolves', eur.fallbackDays === 0, eur.fallbackDays)
  check('source names Frankfurter', eur.source === FRANKFURTER_SOURCE, eur.source)

  const prices = { '2025-01-02': 0.001, '2025-12-31': 0.002 }
  const report = computeFifoGains(
    [tx('2025-01-02', '10:00:00', 100), tx('2025-12-31', '23:30:00', 200)],
    OWN,
    prices,
    'eur',
    eur.rateFor
  )
  const jan = report.rows.find((r) => r.date === '2025-01-02')
  const dec = report.rows.find((r) => r.date === '2025-12-31')
  check('January row uses 0.96256, not today', near(jan.costBasisUsd, 100 * 0.001 * 0.96256), jan.costBasisUsd)
  check('December row uses 0.85106, not today', near(dec.costBasisUsd, 200 * 0.002 * 0.85106), dec.costBasisUsd)
  check('report says Frankfurter was the FX source', report.fxSource === FRANKFURTER_SOURCE, report.fxSource)
  check('report counts no FX fallback', report.fxFallbackDays === 0, report.fxFallbackDays)

  // 2. A failed fetch leaves the day null and the report falls back, visibly.
  failFrankSymbols.add('GBP')
  const gbp = await getDailyFx('gbp', ['2025-06-01'])
  check('failed Frankfurter fetch leaves the day null', gbp.rateFor('2025-06-01') === null)
  check('getDailyFx counts the failed day', gbp.fallbackDays === 1, gbp.fallbackDays)
  const gbpRate = (day) => gbp.rateFor(day)
  gbpRate.todayRate = 1.25
  gbpRate.source = gbp.source
  const fallbackReport = computeFifoGains(
    [tx('2025-06-01', '12:00:00', 100)],
    OWN,
    { '2025-06-01': 0.001 },
    'gbp',
    gbpRate
  )
  check('failed day prices at today’s rate', near(fallbackReport.rows[0].costBasisUsd, 100 * 0.001 * 1.25), fallbackReport.rows[0].costBasisUsd)
  check('computeFifoGains counts the fallback day', fallbackReport.fxFallbackDays === 1, fallbackReport.fxFallbackDays)

  // 3. USD is identity and makes no request.
  const beforeUsd = frankCalls.length + cdnCalls.length
  const usd = await getDailyFx('usd', ['2025-01-02'])
  check('USD rate is 1', usd.rateFor('2025-01-02') === 1 && usd.rateFor('2030-01-01') === 1)
  check('USD source is none (USD)', usd.source === USD_FX_SOURCE && TAX_USD_SOURCE === USD_FX_SOURCE, usd.source)
  check('USD makes no FX request', frankCalls.length + cdnCalls.length === beforeUsd)
  const usdReport = computeFifoGains([tx('2025-01-02', '10:00:00', 100)], OWN, prices, 'usd', 1)
  check('USD report has no FX fallback', usdReport.fxFallbackDays === 0 && usdReport.fxSource === USD_FX_SOURCE)

  // 4. A currency Frankfurter lacks goes through dated currency-api snapshots.
  const ngn = await getDailyFx('ngn', ['2025-06-15'])
  check('NGN uses currency-api', ngn.source === CURRENCY_API_SOURCE && cdnCalls[0] === '2025-06-15', `${ngn.source} ${cdnCalls}`)
  check('NGN daily snapshot rate', near(ngn.rateFor('2025-06-15'), NGN_RATE), ngn.rateFor('2025-06-15'))

  // 5. Closed years are immutable: a second call makes no network request.
  const beforeWarm = frankCalls.length
  const warm = await getDailyFx('eur', ['2025-01-02', '2025-12-31'])
  check('closed-year cache answers without a fetch', frankCalls.length === beforeWarm, frankCalls.length - beforeWarm)
  check('closed-year cache keeps both rates', near(warm.rateFor('2025-01-02'), 0.96256) && near(warm.rateFor('2025-12-31'), 0.85106))

  Date.now = realNow
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  Date.now = realNow
  console.error(e)
  process.exit(2)
})
