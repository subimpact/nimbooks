// NIM price history oracle: bundles src/lib/priceHistory.ts for node and
// asserts the parsers and the maths the beta sidebar price card and NIM ring
// draw with, plus the cache and stale-on-failure behaviour of the one fetch.
// Usage: node test/price-history-oracle.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src', 'lib', 'priceHistory.ts')
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'price-history-'))
const OUT = path.join(OUT_DIR, 'priceHistory.cjs')
const ROLLDOWN = path.join(ROOT, 'node_modules', '.bin', 'rolldown')

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`)
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

execFileSync(ROLLDOWN, [SRC, '--format', 'cjs', '--platform', 'node', '--file', OUT], { stdio: 'ignore' })
const {
  HISTORY_URLS,
  RING_CIRCUMFERENCE,
  changePct,
  getNimPriceHistory,
  parseLlamaChart,
  ringSegments,
  sparklinePath,
} = require(OUT)

// --- parseLlamaChart ---

// DefiLlama's real body shape, with junk rows mixed in: unsorted, a zero
// price, a string timestamp, a string price, a null row and a null price.
const BODY = {
  coins: {
    'coingecko:nimiq-2': {
      symbol: 'NIM',
      confidence: 0.99,
      prices: [
        { timestamp: 1761350400, price: 0.000325 },
        { timestamp: 1761264000, price: 0.000312 },
        { timestamp: 1761177600, price: 0.000301 },
        { timestamp: 1761436800, price: 0 },
        { timestamp: 'nope', price: 0.0004 },
        { timestamp: 1761523200, price: '0.0004' },
        { timestamp: 1761609600, price: null },
        null,
      ],
    },
  },
}

const parsed = parseLlamaChart(BODY)
check('parseLlamaChart: only the three usable rows survive', parsed.length === 3, String(parsed.length))
check(
  'parseLlamaChart: unix seconds become ms',
  parsed.length === 3 && parsed[0].t === 1761177600000 && parsed[2].t === 1761350400000,
  JSON.stringify(parsed.map((p) => p.t))
)
check(
  'parseLlamaChart: sorted ascending by time',
  parsed.every((p, i) => i === 0 || parsed[i - 1].t < p.t)
)
check(
  'parseLlamaChart: prices untouched',
  parsed.length === 3 && parsed[0].usd === 0.000301 && parsed[2].usd === 0.000325
)

for (const [name, body] of [
  ['null', null],
  ['a string', 'rate limited'],
  ['an empty object', {}],
  ['no coins', { prices: [] }],
  ['no coin entry', { coins: { 'coingecko:ethereum': { prices: [{ timestamp: 1, price: 2 }] } } }],
  ['prices not an array', { coins: { 'coingecko:nimiq-2': { prices: 'nope' } } }],
  ['an empty prices list', { coins: { 'coingecko:nimiq-2': { prices: [] } } }],
]) {
  const out = parseLlamaChart(body)
  check(`parseLlamaChart: ${name} gives []`, Array.isArray(out) && out.length === 0, JSON.stringify(out))
}

// --- changePct ---

const at = (usd, t = 0) => ({ t, usd })
check('changePct: +33% is exactly 1/3', changePct([at(300), at(400)]) === 1 / 3)
check('changePct: -25% is exactly -0.25', changePct([at(400), at(300)]) === -0.25)
check('changePct: flat is 0', changePct([at(5), at(5)]) === 0)
check('changePct: one point is null', changePct([at(300)]) === null)
check('changePct: no points is null', changePct([]) === null)
check('changePct: uses first and last, not the extremes', changePct([at(100), at(500), at(200)]) === 1)

// --- sparklinePath ---

const coords = (d) => {
  const out = []
  const re = /([ML])\s(-?[\d.]+)\s(-?[\d.]+)/g
  let m
  while ((m = re.exec(d))) out.push({ cmd: m[1], x: Number(m[2]), y: Number(m[3]) })
  return out
}

const rising = [at(100), at(150), at(200), at(250)]
const risingPath = sparklinePath(rising, 160, 40)
const risingPts = coords(risingPath)
check('sparklinePath: starts with M', risingPath.startsWith('M '), risingPath.slice(0, 12))
check('sparklinePath: no NaN', !/NaN|Infinity|undefined/.test(risingPath), risingPath)
check('sparklinePath: one point per input', risingPts.length === rising.length, String(risingPts.length))
check(
  'sparklinePath: spans the padded width',
  risingPts[0].x === 2 && risingPts[3].x === 158,
  `${risingPts[0]?.x} .. ${risingPts[3]?.x}`
)
check(
  'sparklinePath: rising data goes bottom to top',
  risingPts[0].y === 38 && risingPts[3].y === 2,
  `${risingPts[0]?.y} .. ${risingPts[3]?.y}`
)
check(
  'sparklinePath: x is evenly spaced',
  risingPts.slice(1).every((p, i) => close(p.x - risingPts[i].x, (160 - 4) / 3, 0.02))
)

const flatPath = sparklinePath([at(7), at(7), at(7)], 160, 40)
const flatPts = coords(flatPath)
check(
  'sparklinePath: flat data is a horizontal line through the middle',
  flatPts.length === 3 && flatPts.every((p) => p.y === 20),
  flatPath
)
check('sparklinePath: single point draws a flat line, no NaN', (() => {
  const d = sparklinePath([at(7)], 160, 40)
  const pts = coords(d)
  return d.startsWith('M') && !/NaN/.test(d) && pts.length === 2 && pts.every((p) => p.y === 20)
})())
check('sparklinePath: empty points give an empty path', sparklinePath([], 160, 40) === '')
check('sparklinePath: junk rows dropped, two points left', coords(
  sparklinePath([at(1), { t: 1, usd: NaN }, at(2)], 160, 40)
).length === 2)
check('sparklinePath: zero-height box does not divide by zero', (() => {
  const d = sparklinePath(rising, 160, 0)
  return d === '' || !/NaN/.test(d)
})())

// --- ringSegments ---

const pctSum = (segs) => segs.reduce((sum, s) => sum + s.pct, 0)
const pctExact = (segs) => Math.round(pctSum(segs) * 10) === 1000

const thirds = ringSegments([
  { key: 'a', luna: 1 },
  { key: 'b', luna: 1 },
  { key: 'c', luna: 1 },
])
check('ringSegments: three equal parts stay three', thirds.length === 3, String(thirds.length))
check('ringSegments: 1/1/1 percentages sum to 100.0', pctExact(thirds) && close(pctSum(thirds), 100), JSON.stringify(thirds.map((s) => s.pct)))
check('ringSegments: 1/1/1 is 33.3/33.3/33.4 in some order', (() => {
  const pcts = thirds.map((s) => s.pct).sort((a, b) => a - b)
  return pcts[0] === 33.3 && pcts[1] === 33.3 && pcts[2] === 33.4
})(), JSON.stringify(thirds.map((s) => s.pct)))

const awkward = ringSegments([
  { key: 'available', luna: 890.79 },
  { key: 'staked', luna: 12 },
  { key: 'vested', luna: 0.5 },
])
check('ringSegments: 890.79/12/0.5 sums to 100.0', pctExact(awkward) && close(pctSum(awkward), 100, 1e-9), JSON.stringify(awkward.map((s) => s.pct)))
check(
  'ringSegments: every percentage is a tenth',
  awkward.every((s) => close(Math.round(s.pct * 10) / 10, s.pct))
)
check(
  'ringSegments: dash lengths add up to the circumference',
  close(awkward.reduce((sum, s) => sum + Number(s.dash.split(' ')[0]), 0), RING_CIRCUMFERENCE, 1e-6),
  String(awkward.reduce((sum, s) => sum + Number(s.dash.split(' ')[0]), 0))
)
check(
  'ringSegments: dash = [length, gap]',
  awkward.every((s) => close(Number(s.dash.split(' ')[0]) + Number(s.dash.split(' ')[1]), RING_CIRCUMFERENCE, 1e-6))
)
check('ringSegments: offsets walk the circle', (() => {
  let cursor = 0
  for (const s of awkward) {
    if (Math.abs(s.offset + cursor) > 1e-9) return false
    cursor += Number(s.dash.split(' ')[0])
  }
  return Math.abs(cursor - RING_CIRCUMFERENCE) < 1e-6
})(), JSON.stringify(awkward.map((s) => s.offset)))

check(
  'ringSegments: zero and negative parts are dropped',
  ringSegments([
    { key: 'a', luna: 0 },
    { key: 'b', luna: 100 },
    { key: 'c', luna: -5 },
  ]).map((s) => s.key).join(',') === 'b'
)
check('ringSegments: nothing to draw gives []', ringSegments([{ key: 'a', luna: 0 }, { key: 'b', luna: 0 }]).length === 0)
check('ringSegments: no parts gives []', ringSegments([]).length === 0)
const only = ringSegments([{ key: 'staked', luna: 42 }])
check(
  'ringSegments: a single part is a full ring',
  only.length === 1 && only[0].pct === 100 && close(Number(only[0].dash.split(' ')[0]), RING_CIRCUMFERENCE, 1e-9)
)
check('ringSegments: input order is kept', ringSegments([{ key: 'z', luna: 1 }, { key: 'a', luna: 2 }]).map((s) => s.key).join(',') === 'z,a')

// --- getNimPriceHistory: cache + stale-on-failure ---

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0)
const MIN = 60 * 1000
const store = new Map()
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
const CACHE_24 = 'nimbooks:nim-history:24h'
const CACHE_7 = 'nimbooks:nim-history:7d'
const cachedPoints = [
  { t: NOW - 2 * 60 * MIN, usd: 0.0004 },
  { t: NOW, usd: 0.00042 },
]
const seed = (key, fetchedAt) =>
  store.set(key, JSON.stringify({ fetchedAt, points: cachedPoints }))

const fixture = (usdBase) => ({
  coins: {
    'coingecko:nimiq-2': {
      symbol: 'NIM',
      prices: [
        { timestamp: (NOW - 3 * 60 * MIN) / 1000, price: usdBase },
        { timestamp: NOW / 1000, price: usdBase + 0.00002 },
      ],
    },
  },
})
const okFetch = (usdBase, calls) => async (url) => {
  calls.push(url)
  return { ok: true, json: async () => fixture(usdBase) }
}
const failFetch = (calls) => async (url) => {
  calls.push(url)
  throw new Error('offline')
}

;(async () => {
  check('getNimPriceHistory: the 24h URL is one hour points over 24h', /span=24&period=1h$/.test(HISTORY_URLS['24h']), HISTORY_URLS['24h'])
  check('getNimPriceHistory: the 7d URL is six hour points over 28', /span=28&period=6h$/.test(HISTORY_URLS['7d']), HISTORY_URLS['7d'])

  // A cache entry under 10 minutes old answers without a request.
  store.clear()
  seed(CACHE_24, NOW - 5 * MIN)
  let calls = []
  let hit = await getNimPriceHistory('24h', { fetchImpl: failFetch(calls), now: () => NOW })
  check('cache: a fresh entry makes no request', calls.length === 0, String(calls.length))
  check('cache: and returns the cached points', hit !== null && hit.points.length === 2 && hit.points[1].usd === 0.00042, JSON.stringify(hit))

  // Stale: the request happens and the cache is rewritten.
  store.clear()
  seed(CACHE_24, NOW - 11 * MIN)
  calls = []
  hit = await getNimPriceHistory('24h', { fetchImpl: okFetch(0.0005, calls), now: () => NOW })
  check('cache: an 11 minute old entry refetches', calls.length === 1, String(calls.length))
  check('cache: the fresh points win', hit !== null && hit.points[0].usd === 0.0005, JSON.stringify(hit?.points))
  check('cache: the entry is rewritten', hit !== null && hit.fetchedAt === NOW)
  const rewritten = JSON.parse(store.get(CACHE_24))
  check('cache: localStorage holds the new points and time', rewritten.fetchedAt === NOW && rewritten.points.length === 2)

  // Failure: the stale entry is served at any age.
  store.clear()
  seed(CACHE_24, NOW - 3 * 24 * 60 * MIN)
  calls = []
  hit = await getNimPriceHistory('24h', { fetchImpl: failFetch(calls), now: () => NOW })
  check('stale-on-failure: the request was attempted', calls.length === 1)
  check('stale-on-failure: a three day old entry is still served', hit !== null && hit.points[1].usd === 0.00042, JSON.stringify(hit))

  // Failure with nothing cached: null, never a throw.
  store.clear()
  hit = await getNimPriceHistory('7d', { fetchImpl: failFetch([]), now: () => NOW })
  check('stale-on-failure: no cache and no network gives null', hit === null)

  // A 200 with a body we cannot read is a failure, not an empty chart.
  store.clear()
  hit = await getNimPriceHistory(
    '7d',
    { fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'rate limited' }) }), now: () => NOW },
  )
  check('a junk body gives null', hit === null)

  // A non-200 is a failure too, and falls back to the cache.
  store.clear()
  seed(CACHE_7, NOW - 60 * MIN)
  hit = await getNimPriceHistory(
    '7d',
    { fetchImpl: async () => ({ ok: false, json: async () => ({}) }), now: () => NOW },
  )
  check('a 4xx/5xx falls back to the cache', hit !== null && hit.points.length === 2)

  // Corrupt cache JSON is ignored, not fatal.
  store.clear()
  store.set(CACHE_24, '{not json')
  hit = await getNimPriceHistory('24h', { fetchImpl: failFetch([]), now: () => NOW })
  check('corrupt cache JSON gives null', hit === null)

  // The 7d range asks for the 7d URL.
  store.clear()
  calls = []
  await getNimPriceHistory('7d', { fetchImpl: okFetch(0.0004, calls), now: () => NOW })
  check('the 7d fetch uses the 7d URL', calls.length === 1 && /span=28&period=6h$/.test(calls[0]), String(calls[0]))

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  delete global.localStorage
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
