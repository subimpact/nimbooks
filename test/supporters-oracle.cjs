// Supporters oracle: what counts as a donation, name privacy, and the paging
// reader. Runs the real lib from functions/_lib/supporters.ts, bundled with
// rolldown (the same path the deploy would take).
//
// Usage: node test/supporters-oracle.cjs
const { execFileSync } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
const BUNDLE = path.join(__dirname, 'tmp', 'supporters-bundle.cjs')

// Bundle from source, exactly as the test contract describes.
fs.mkdirSync(path.dirname(BUNDLE), { recursive: true })
execFileSync('npx', ['rolldown', 'functions/_lib/supporters.ts', '--format', 'cjs', '--platform', 'node', '--file', BUNDLE], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'inherit'],
})
const lib = require(BUNDLE)

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

// ── Facts the summary must mirror ───────────────────────────────────────────
const DONATION = 'NQ39 XC3L JHXL 5GKB K09G J765 X577 PS3A KHFE'
const WOOL_FLAT = 'NQ88QJ5GDQS76YH6J5T5DXVR9YUH6V52SBKU' // never in source or bundle
const POOL_ADDR = 'NQ162SSN82TLSMQSKXT3Q01VCMALNU6F1LJG' // Nimiq.Space payouts
const STAKING = 'NQ770000000000000000000000000000000001' // staking contract

const row = (over) => ({
  hash: over.hash || Math.random().toString(16).slice(2),
  from: over.from,
  to: over.to ?? DONATION,
  fromType: over.fromType ?? 0,
  value: over.value,
  timestamp: over.timestamp ?? Date.now(),
  executionResult: over.executionResult ?? true,
})

// Synthetic history mirroring the chain on 2026-10-14, plus edge cases named in
// the rules: a failed tx, dust, a staking return, a repeat anonymous donor.
const rows = [
  // Wool's real donation: no memo, the morning of 2026-10-13.
  row({ from: 'NQ88 QJ5G DQS7 6YH6 J5T5 DXVR 9YUH 6V52 SBKU', value: 2180929948, timestamp: 1791907083283, hash: '90ba31e965227e2247b8b7542dbee46efce0a99bf962ea26e0e88a9521e0348a' }),
  // Eight mining payouts, under the 1 NIM floor, memo'd by the pool. Not donations.
  ...Array.from({ length: 8 }, (_, i) => row({ from: POOL_ADDR, value: 98975 + i })),
  // A stake deactivated: the staking contract returns the funds.
  row({ from: STAKING, value: 500000000, fromType: 3, executionResult: false }),
  // A payment that never executed.
  row({ from: 'NQ15 0000 0000 0000 0000 0000 0000 0000 0001', value: 777777, executionResult: false }),
  // 0.5 NIM dust below the donation floor.
  row({ from: 'NQ15 0000 0000 0000 0000 0000 0000 0000 0002', value: 50000 }),
  // An unknown donor: 50 NIM, twice. Folds into one "Anonymous supporter" row.
  row({ from: 'NQ40 1111 2222 3333 4444 5555 6666 7777 8888', value: 5000000000 / 1000, timestamp: 1000, hash: 'aaa1' }),
  row({ from: 'NQ40 1111 2222 3333 4444 5555 6666 7777 8888', value: 5000000000 / 1000, timestamp: 2000, hash: 'aaa2' }),
]

check('sha256 of Wool normalised address matches node crypto',
  lib.sha256Hex(WOOL_FLAT) === crypto.createHash('sha256').update(WOOL_FLAT).digest('hex'),
  lib.sha256Hex(WOOL_FLAT))

const s = lib.summariseDonations(rows, DONATION)
check('totalNim is 21,909.29948', Math.abs(s.totalNim - 21909.29948) < 1e-9, s.totalNim)
check('count is 3 donations', s.count === 3, s.count)
check('two supporter rows', s.supporters.length === 2, JSON.stringify(s.supporters))
check('Wool first with 21,809.29948',
  s.supporters[0] && s.supporters[0].name === 'Wool' && Math.abs(s.supporters[0].amountNim - 21809.29948) < 1e-9,
  JSON.stringify(s.supporters[0]))
check('the double donor aggregates as "Anonymous supporter" with 100 NIM',
  s.supporters[1] && s.supporters[1].name === 'Anonymous supporter' && Math.abs(s.supporters[1].amountNim - 100) < 1e-9,
  JSON.stringify(s.supporters[1]))
check('lastAt follows the later donation', s.supporters[1] && s.supporters[1].lastAt === 2000, s.supporters[1] && s.supporters[1].lastAt)
check('supporters sorted by amount desc', s.supporters.every((x, i, all) => i === 0 || all[i - 1].amountNim >= x.amountNim))
// Privacy: the summary must not carry addresses, and the name lookup keys on digests.
check('supporter rows hold no addresses',
  s.supporters.every((x) => !Object.keys(x).some((k) => /addr|from|nq/i.test(k)) && !JSON.stringify(x).includes('NQ')))
check('deny list rules the pool, the staking contract and contracts out of one spot: isDonation',
  !lib.isDonation(row({ from: POOL_ADDR, value: 2000000000 }), DONATION) &&
  !lib.isDonation(row({ from: STAKING, fromType: 0, value: 2000000000 }), DONATION) &&
  !lib.isDonation(row({ from: 'NQ40 0000 0000 0000 0000 0000 0000 0000 0009', value: 2000000000, fromType: 1 }), DONATION) &&
  !lib.isDonation(row({ from: 'NQ40 0000 0000 0000 0000 0000 0000 0000 0009', value: 50000 }), DONATION) &&
  !lib.isDonation(row({ from: 'NQ40 0000 0000 0000 0000 0000 0000 0000 0009', value: 2000000000, to: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000' }), DONATION) &&
  lib.isDonation(row({ from: 'NQ40 0000 0000 0000 0000 0000 0000 0000 0009', value: 2000000000 }), DONATION))

// ── Privacy: the Wool address must not reach source or bundle ───────────────
const srcText = fs.readFileSync(path.join(ROOT, 'functions/_lib/supporters.ts'), 'utf8')
const bundleText = fs.readFileSync(BUNDLE, 'utf8')
for (const place of [['source', srcText], ['bundle', bundleText]]) {
  const [label, text] = place
  check(`${label}: no "NQ88"`, !text.includes('NQ88'))
  check(`${label}: no "QJ5G"`, !text.includes('QJ5G'))
  check(`${label}: no flat Wool address`, !text.includes(WOOL_FLAT))
}
check('source carries Wool by digest', srcText.includes(crypto.createHash('sha256').update(WOOL_FLAT).digest('hex')))

// ── fetchDonationRows: paging against a mock reader ───────────────────────
const PAGE_LIMIT = 500
const mockServer = (requests) => http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const { params } = JSON.parse(body)
    const page = requests.get(params[2] ?? 'start') ?? []
    requests._times.push(Date.now())
    res.setHeader('content-type', 'application/json')
    // A page shorter than the page limit ends the walk.
    res.end(JSON.stringify({ result: { data: page } }))
  })
})

async function pagingTest() {
  const page1 = Array.from({ length: PAGE_LIMIT }, (_, i) => row({ from: 'NQ40 1111 2222 3333 4444 5555 6666 7777 8888', value: 1 + i }))
  const page2 = Array.from({ length: 3 }, (_, i) => row({ from: 'NQ40 1111 2222 3333 4444 5555 6666 7777 8888', value: 2 + i }))
  const cursors = new Map([['start', page1], [page1[page1.length - 1].hash, page2]])
  cursors._times = []
  const server = mockServer(cursors)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  // The lib points at the real reader; the paging test routes that host to the
  // mock. The live-sane step covers the real reader untouched.
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, init) => realFetch(String(url).replace('https://rpc.nimiqwatch.com', `http://127.0.0.1:${port}`), init)
  try {
    const t0 = Date.now()
    const all = await lib.fetchDonationRows()
    const took = Date.now() - t0
    check('fetchDonationRows concatenates full pages and stops at a short one', all.length === PAGE_LIMIT + 3)
    // One ~300 ms pace between page 1 and page 2.
    check('paging waits ~300 ms between full pages', took >= 250, `took=${took}`)
    check('two pages read', cursors._times.length === 2, `requests=${cursors._times.length}`)
  } finally {
    globalThis.fetch = realFetch
    server.close()
  }
}

;(async () => {
  await pagingTest()

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
