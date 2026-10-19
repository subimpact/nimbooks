// Oracle for the DefiLlama price walk in src/lib/tax.ts (getAllDailyNimPrices).
// Fixed BEFORE the fix; the implementation must make this pass unchanged.
// Run: node test/tax-prices-oracle.cjs
//
// Why: the walk pages DefiLlama backwards, but each step moved back only the
// 10-day overlap instead of a whole page (`start = earliestTs - 10 days`), so
// 8 pages reached ~80 days behind the 500-day anchor and stopped. Live on
// 2026-10-19 the tax price map began 2025-03-28 (verified in a Pay session on
// NQ62 68D7: llama requests stepped 10 days apart), so every day before that
// had no price: the tax card read "73 days had no historical price" and
// xFratta's 2025 staking income showed $1,294.15 where DefiLlama's own daily
// closes give ~$1,794 (344 of 345 reward days priced). DefiLlama carries NIM
// (coingecko:nimiq-2) from 2018-07-27.
const { execSync } = require('child_process')
const path = require('path')
const os = require('os')
const root = path.resolve(__dirname, '..')
const out = path.join(os.tmpdir(), `tax-prices-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/tax.ts --file ${out} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}

const DAY = 86400
const NOW_MS = Date.parse('2026-10-19T08:00:00Z')
const realNow = Date.now
Date.now = () => NOW_MS
const store = new Map()
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
const origWarn = console.warn
console.warn = () => {}

const FIRST = Date.parse('2018-07-27T00:00:00Z') / 1000
const NOW_S = Math.floor(NOW_MS / 1000)
const dayOf = (s) => new Date(s * 1000).toISOString().slice(0, 10)
const priceOf = (s) => 0.0005 + ((Math.floor(s / DAY) % 97) / 97) * 0.002 // < 2 cents, deterministic

let llamaCalls = []
let llamaDown = false
global.fetch = async (url) => {
  const u = new URL(url)
  if (u.hostname === 'api.coingecko.com') {
    const prices = []
    for (let s = NOW_S - 365 * DAY; s <= NOW_S; s += DAY) prices.push([s * 1000, priceOf(s)])
    return { ok: true, status: 200, json: async () => ({ prices }) }
  }
  if (u.hostname === 'coins.llama.fi') {
    const start = Number(u.searchParams.get('start'))
    const span = Number(u.searchParams.get('span'))
    llamaCalls.push(start)
    if (llamaDown) return { ok: false, status: 502, json: async () => ({}) }
    // Like the real endpoint: `span` daily points forward from `start`,
    // clipped to the coin's listing and to now.
    const prices = []
    for (let i = 0, s = start; i < span; i++, s += DAY) {
      if (s < FIRST || s > NOW_S) continue
      prices.push({ timestamp: s, price: priceOf(s) })
    }
    return { ok: true, status: 200, json: async () => ({ coins: { 'coingecko:nimiq-2': { prices } } }) }
  }
  return { ok: false, status: 404, json: async () => ({}) }
}

const { getAllDailyNimPrices } = require(out)

;(async () => {
  // 1. Cold walk reaches the listing day
  store.clear()
  llamaCalls = []
  const p = await getAllDailyNimPrices()
  const days = Object.keys(p).sort()
  check('walk reaches 2018-07-27 (DefiLlama listing)', days[0] === '2018-07-27', days[0])
  check('at most 8 llama pages', llamaCalls.length <= 8, llamaCalls.length)
  const steps = llamaCalls.slice(1).map((s, i) => (llamaCalls[i] - s) / DAY)
  check('pages step back by most of a span (>= 400 days), not by the overlap', steps.length > 0 && steps.slice(0, -1).every((d) => d >= 400), JSON.stringify(steps))
  let gaps = 0
  for (let s = FIRST; s < NOW_S - DAY; s += DAY) if (!(dayOf(s) in p)) gaps++
  check('no gap from listing day to yesterday', gaps === 0, `${gaps} missing days`)
  check('2025-01-02 priced (first xFratta reward day)', typeof p['2025-01-02'] === 'number')
  check('2024-11-19 priced (PoS launch)', typeof p['2024-11-19'] === 'number')
  check('prices cached under nimbooks:pricestax', store.has('nimbooks:pricestax'))

  // 2. Warm: a full cache answers without a single request
  llamaCalls = []
  await getAllDailyNimPrices()
  check('warm: zero llama requests', llamaCalls.length === 0, llamaCalls.length)

  // 3. A cache written by the old 10-day-step walk (starts 2025-03-28) is not
  // trusted: it refetches instead of serving a year of missing prices for 24 h.
  const truncated = {}
  for (const d of days) if (d >= '2025-03-28') truncated[d] = p[d]
  store.set('nimbooks:pricestax', JSON.stringify({ at: NOW_MS - 60000, prices: truncated }))
  llamaCalls = []
  const p2 = await getAllDailyNimPrices()
  check('truncated cache refetched', llamaCalls.length > 0, llamaCalls.length)
  check('truncated cache replaced by full history', Object.keys(p2).sort()[0] === '2018-07-27', Object.keys(p2).sort()[0])

  // 4. Llama down: CoinGecko's 365 days still come back, no throw
  store.clear()
  llamaDown = true
  const p3 = await getAllDailyNimPrices()
  check('llama down: CoinGecko 365 days returned', Object.keys(p3).length >= 365, Object.keys(p3).length)
  llamaDown = false

  Date.now = realNow
  console.warn = origWarn
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.warn = origWarn
  console.error(e)
  process.exit(2)
})
