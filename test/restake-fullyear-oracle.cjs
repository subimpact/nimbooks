// Oracle for full-history staking rewards in src/lib/stakingEvents.ts.
// Fixed BEFORE the build; the implementation must make this pass unchanged.
// Run: node test/restake-fullyear-oracle.cjs
//
// Why: reward rows covered only the last 90 days (RESTAKE_WINDOW_DAYS), so a
// tax year or statement older than that undercounted staking income. Nimiq
// Watch v2 holds restake events back to January 2025 (probed live 2026-10-19
// on NQ62 68D7: first group 2025-01-02, 2025 = 1,434 groups / 195 KB, 2026 to
// date = 24,091 groups / 3.2 MB in one 200). The fetch now covers everything
// since proof-of-stake launched, split into calendar chunks so closed periods
// are fetched once and cached, and only the current month refetches every
// 10 minutes.
//
// Contract under test (new exports of stakingEvents.ts):
//   REWARDS_FLOOR_DAY = '2024-11-19'            (PoS mainnet launch, UTC day)
//   restakeChunks(now) -> [{ id, from, to, ttlMs }]   (YYYY-MM-DD, `to` exclusive)
//   getAllRestakeRewardTxs(address, now?) -> Promise<{ txs: NimiqTx[]; complete: boolean }>
const { execSync } = require('child_process')
const path = require('path')
const os = require('os')

const root = path.resolve(__dirname, '..')
const out = path.join(os.tmpdir(), `staking-events-${process.pid}.cjs`)
execSync(`npx rolldown src/lib/stakingEvents.ts --file ${out} --format cjs --platform node`, { cwd: root, stdio: 'pipe' })

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}

// ---------------------------------------------------------------- environment
const HOUR = 3600000
const MIN = 60000
const DAY = 86400000
let NOW = Date.parse('2026-10-19T08:00:00Z')
const realNow = Date.now
Date.now = () => NOW

const store = new Map()
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}
const origWarn = console.warn
console.warn = () => {}

// ---------------------------------------------------------------- fixture API
const ADDR = 'NQ62 68D7 RQHN MSTR 1Y0T SY1P HU89 5QJ5 YV05'
const FLAT = ADDR.replace(/\s+/g, '')
const V1 = 'NQ97 H1NR S3X0 CVFQ VJ9Y 9A0Y FRQN Q6EU D0PL'
const V2 = 'NQ02 31N6 3KM5 T6G5 22TN EPF5 5XPY RLHK RMB3'
const iso = (ms) => new Date(ms).toISOString()
const day = (ms) => iso(ms).slice(0, 10)

// Every 4 hours from 2025-01-02 01:15 to 2026-10-18 21:15. V1 until the end of
// June 2025, V2 from June 2025 (June overlaps: both pay). Integer Luna.
const GROUPS = []
for (let d = Date.parse('2025-01-02T00:00:00Z'), i = 0; d < Date.parse('2026-10-19T00:00:00Z'); d += DAY, i++) {
  for (let h = 1; h < 24; h += 4) {
    const ts = d + h * HOUR + 15 * MIN
    const value = 100000 + i * 7 + h
    if (ts < Date.parse('2025-07-01T00:00:00Z')) GROUPS.push({ sender_address: V1, time_window: iso(ts), aggregated_value: value })
    if (ts >= Date.parse('2025-06-01T00:00:00Z')) GROUPS.push({ sender_address: V2, time_window: iso(ts), aggregated_value: value + 3 })
  }
}
// Windows that sit exactly on chunk boundaries.
GROUPS.push({ sender_address: V2, time_window: '2025-12-31T23:45:00.000Z', aggregated_value: 777777 })
GROUPS.push({ sender_address: V2, time_window: '2026-01-01T00:00:00.000Z', aggregated_value: 888888 })
GROUPS.push({ sender_address: V2, time_window: '2026-09-30T23:45:00.000Z', aggregated_value: 555555 })
GROUPS.push({ sender_address: V2, time_window: '2026-10-01T00:00:00.000Z', aggregated_value: 444444 })

let calls = []
let failFor = null // a `from` value whose request answers HTTP 500
global.fetch = async (url) => {
  const u = new URL(url)
  const from = u.searchParams.get('from')
  const to = u.searchParams.get('to')
  calls.push({ path: u.pathname, from, to })
  if (failFor && from === failFor) return { ok: false, status: 500, json: async () => ({}) }
  if (!from || !to || to <= from || to > day(NOW)) return { ok: false, status: 400, json: async () => ({ error: true }) }
  const lo = Date.parse(from + 'T00:00:00Z')
  const hi = Date.parse(to + 'T00:00:00Z')
  // Leaky edges: the real API's stitched ranges disagreed by a few groups, so
  // this mock also hands back the last window before `from` and the first
  // window at/after `to`. Rows outside [from, to) must not be counted twice.
  const inside = GROUPS.filter((g) => {
    const t = Date.parse(g.time_window)
    return t >= lo && t < hi
  })
  const before = GROUPS.filter((g) => Date.parse(g.time_window) < lo).slice(-1)
  const after = GROUPS.filter((g) => {
    const t = Date.parse(g.time_window)
    return t >= hi && t < NOW
  }).slice(0, 1)
  return { ok: true, status: 200, json: async () => ({ from, to, groups: [...before, ...inside, ...after] }) }
}

const { restakeChunks, getAllRestakeRewardTxs, REWARDS_FLOOR_DAY } = require(out)

// Ground truth straight from the fixture: everything before today (UTC).
function expected(nowMs) {
  const today = day(nowMs)
  const keep = GROUPS.filter((g) => g.time_window.slice(0, 10) < today)
  const total = keep.reduce((s, g) => s + g.aggregated_value, 0)
  const keys = new Set(keep.map((g) => `${g.time_window.slice(0, 10)}|${g.sender_address.replace(/\s+/g, '')}`))
  return { total, rows: keys.size }
}
const lunaSum = (txs) => txs.reduce((s, t) => s + Number(t.value), 0)
const strip = (cs) => cs.map(({ id, from, to }) => ({ id, from, to }))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

;(async () => {
  // 1. Exports
  check('REWARDS_FLOOR_DAY is the PoS launch day', REWARDS_FLOOR_DAY === '2024-11-19', REWARDS_FLOOR_DAY)
  check('restakeChunks exported', typeof restakeChunks === 'function')
  check('getAllRestakeRewardTxs exported', typeof getAllRestakeRewardTxs === 'function')
  if (typeof restakeChunks !== 'function' || typeof getAllRestakeRewardTxs !== 'function') return done()

  // 2. Chunk plan
  const c1 = restakeChunks(Date.parse('2026-10-19T08:00:00Z'))
  check(
    'chunks on 2026-10-19: 2024, 2025, ytd, month',
    same(strip(c1), [
      { id: '2024', from: '2024-11-19', to: '2025-01-01' },
      { id: '2025', from: '2025-01-01', to: '2026-01-01' },
      { id: 'ytd', from: '2026-01-01', to: '2026-10-01' },
      { id: 'month', from: '2026-10-01', to: '2026-10-19' },
    ]),
    JSON.stringify(strip(c1))
  )
  const ttl = Object.fromEntries(c1.map((c) => [c.id, c.ttlMs]))
  check('ttl: closed years 7 days', ttl['2024'] === 7 * DAY && ttl['2025'] === 7 * DAY, JSON.stringify(ttl))
  check('ttl: ytd 24 hours', ttl.ytd === DAY, ttl.ytd)
  check('ttl: month 10 minutes', ttl.month === 10 * MIN, ttl.month)
  check(
    'chunks on the 1st of a month: no empty month chunk',
    same(strip(restakeChunks(Date.parse('2026-10-01T05:00:00Z'))).map((c) => c.id), ['2024', '2025', 'ytd']) &&
      restakeChunks(Date.parse('2026-10-01T05:00:00Z')).find((c) => c.id === 'ytd').to === '2026-10-01',
    JSON.stringify(strip(restakeChunks(Date.parse('2026-10-01T05:00:00Z'))))
  )
  check(
    'chunks on 1 January: only closed years',
    same(strip(restakeChunks(Date.parse('2027-01-01T03:00:00Z'))).map((c) => c.id), ['2024', '2025', '2026']),
    JSON.stringify(strip(restakeChunks(Date.parse('2027-01-01T03:00:00Z'))))
  )
  check(
    'chunks mid-January: no ytd, month from 1 Jan',
    same(strip(restakeChunks(Date.parse('2027-01-15T03:00:00Z'))).slice(-1), [{ id: 'month', from: '2027-01-01', to: '2027-01-15' }]) &&
      !restakeChunks(Date.parse('2027-01-15T03:00:00Z')).some((c) => c.id === 'ytd'),
    JSON.stringify(strip(restakeChunks(Date.parse('2027-01-15T03:00:00Z'))))
  )
  const every = restakeChunks(Date.parse('2026-10-19T08:00:00Z'))
  check('chunks are contiguous and non-empty', every.every((c, i) => c.from < c.to && (i === 0 || every[i - 1].to === c.from)))

  // 3. Cold fetch: every reward since the floor, counted once
  store.clear()
  store.set('nimbooks:restake:' + FLAT, JSON.stringify({ from: 'x', to: 'y', at: 0, txs: [] })) // pre-v1.30 single slot
  calls = []
  const r1 = await getAllRestakeRewardTxs(ADDR)
  const exp1 = expected(NOW)
  check('cold: one request per chunk (4)', calls.length === 4, JSON.stringify(calls.map((c) => c.from + '>' + c.to)))
  check('cold: request path is /api/v2/staker/<flat>/events/restake-grouped', calls.every((c) => c.path === `/api/v2/staker/${FLAT}/events/restake-grouped`), calls[0] && calls[0].path)
  check('cold: complete', r1.complete === true)
  check('cold: Luna total equals every fixture group before today', lunaSum(r1.txs) === exp1.total, `${lunaSum(r1.txs)} vs ${exp1.total}`)
  check('cold: one row per UTC day per validator', r1.txs.length === exp1.rows, `${r1.txs.length} vs ${exp1.rows}`)
  check('cold: no duplicate hashes', new Set(r1.txs.map((t) => t.hash)).size === r1.txs.length)
  check('cold: newest first', r1.txs.every((t, i) => i === 0 || r1.txs[i - 1].timestamp >= t.timestamp))
  check('cold: every row is synthetic reward to the staker', r1.txs.every((t) => t.synthetic === 'reward' && t.recipient === ADDR))
  check('cold: first row is 2025-01-02 (older than 90 days)', day(r1.txs[r1.txs.length - 1].timestamp) === '2025-01-02', day(r1.txs[r1.txs.length - 1].timestamp))
  const nye = r1.txs.filter((t) => t.hash.startsWith('restake:2025-12-31:'))
  const nyd = r1.txs.filter((t) => t.hash.startsWith('restake:2026-01-01:'))
  check('boundary: 23:45 window stays on 31 Dec', nye.reduce((s, t) => s + Number(t.value), 0) === GROUPS.filter((g) => g.time_window.startsWith('2025-12-31')).reduce((s, g) => s + g.aggregated_value, 0))
  check('boundary: 00:00 window counts once, on 1 Jan', nyd.reduce((s, t) => s + Number(t.value), 0) === GROUPS.filter((g) => g.time_window.startsWith('2026-01-01')).reduce((s, g) => s + g.aggregated_value, 0))
  const y2025 = r1.txs.filter((t) => day(t.timestamp).startsWith('2025')).reduce((s, t) => s + Number(t.value), 0)
  check('2025 total exact', y2025 === GROUPS.filter((g) => g.time_window.startsWith('2025')).reduce((s, g) => s + g.aggregated_value, 0), y2025)
  check('legacy single cache slot removed', !store.has('nimbooks:restake:' + FLAT))
  check('cache keys stay under the backup-excluded prefix', [...store.keys()].every((k) => k.startsWith('nimbooks:restake:')), JSON.stringify([...store.keys()]))

  // 4. Warm: nothing refetches inside 10 minutes
  calls = []
  NOW += 5 * MIN
  const r2 = await getAllRestakeRewardTxs(ADDR)
  check('warm (+5 min): zero requests', calls.length === 0, calls.length)
  check('warm: same total', lunaSum(r2.txs) === exp1.total && r2.complete === true)

  // 5. +11 min: only the current month refetches
  calls = []
  NOW += 6 * MIN
  await getAllRestakeRewardTxs(ADDR)
  check('+11 min: one request, the current month', calls.length === 1 && calls[0].from === '2026-10-01', JSON.stringify(calls))

  // 6. Next day: month and ytd refetch, closed years stay cached
  calls = []
  NOW = Date.parse('2026-10-20T09:00:00Z')
  const r3 = await getAllRestakeRewardTxs(ADDR)
  const froms = calls.map((c) => c.from).sort()
  check('next day: month + ytd only', same(froms, ['2026-01-01', '2026-10-01']), JSON.stringify(calls))
  check('next day: yesterday now included', lunaSum(r3.txs) === expected(NOW).total, `${lunaSum(r3.txs)} vs ${expected(NOW).total}`)

  // 7. A failed chunk is not cached, never poses as "no rewards", and stale rows stand in
  store.clear()
  calls = []
  NOW = Date.parse('2026-10-19T08:00:00Z')
  failFor = '2025-01-01'
  const r4 = await getAllRestakeRewardTxs(ADDR)
  check('fail: complete is false', r4.complete === false)
  check('fail: other chunks still returned', lunaSum(r4.txs) === exp1.total - y2025, `${lunaSum(r4.txs)} vs ${exp1.total - y2025}`)
  calls = []
  failFor = null
  NOW += MIN
  const r5 = await getAllRestakeRewardTxs(ADDR)
  check('fail: the failed chunk alone is retried next call', calls.length === 1 && calls[0].from === '2025-01-01', JSON.stringify(calls))
  check('fail: recovered total', lunaSum(r5.txs) === exp1.total && r5.complete === true)
  // Stale fallback: the 2025 chunk expires (8 days on), its refetch fails ->
  // the expired rows are used rather than dropping a year of income.
  NOW += 8 * DAY
  failFor = '2025-01-01'
  const r6 = await getAllRestakeRewardTxs(ADDR)
  const y2025b = r6.txs.filter((t) => day(t.timestamp).startsWith('2025')).reduce((s, t) => s + Number(t.value), 0)
  check('stale fallback: expired 2025 rows used when the refetch fails', y2025b === y2025, `${y2025b} vs ${y2025}`)
  check('stale fallback: still reported incomplete', r6.complete === false)
  failFor = null

  // 8. Non-staker: empty answers are complete, not failures
  const saved = GROUPS.splice(0, GROUPS.length)
  store.clear()
  const r7 = await getAllRestakeRewardTxs('NQ12 3456 7890 ABCD EFGH JKLM NPQR STUV XY00')
  check('non-staker: no rows, complete', r7.txs.length === 0 && r7.complete === true)
  GROUPS.push(...saved)

  done()
})().catch((e) => {
  console.warn = origWarn
  console.error(e)
  process.exit(2)
})

function done() {
  Date.now = realNow
  console.warn = origWarn
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
