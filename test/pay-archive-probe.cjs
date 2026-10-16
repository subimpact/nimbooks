// Nimiq Pay contract archive, against the REAL chain: a Pay session whose saved
// remoteAddress is a long-settled contract (the stale case every returning Pay
// user is in) must still archive every contract the wallet funded, follow the
// live one, and show the stakes made from those contracts in History.
// Wallet: NQ82 public relay wallet (funds a new HTLC every few days; its
// contracts stake into the staking contract, its basic address never does).
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/pay-archive-probe.cjs <baseUrl>
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const PAY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'
const ADDR = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const FLAT = ADDR.replace(/\s+/g, '')
const STALE = 'NQ98 TEYP DYB3 QC0A K5TV 3DS1 J41M 3PG5 MMG2' // settled 2026-10-13
const STAKING = 'NQ7700000000000000000000000000000001'
let pass = 0, fail = 0
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : ' :: ' + info}`) }

;(async () => {
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  await ctx.addInitScript(([addr, stale]) => {
    localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, remoteAddress: stale, view: 'history' }))
    localStorage.setItem('nimbooks:countConsent', 'no')
    window.nimiqPay = {}
    window.nimiq = {
      listAccounts: async () => [addr, stale],
      isConsensusEstablished: async () => true,
      getBlockNumber: async () => 1000000,
    }
  }, [ADDR, STALE])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const t0 = Date.now()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 30000 })

  // Poll the shelf until the sweep has archived the settled contracts (two
  // budgeted passes for ~28 contracts).
  let shelf = null
  for (let i = 0; i < 120; i++) {
    shelf = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }, `nimbooks:htlc-archive:${FLAT}`)
    const n = shelf ? Object.keys(shelf.contracts || {}).length : 0
    if (n >= 25) break
    await page.waitForTimeout(3000)
  }
  const finals = shelf ? Object.keys(shelf.contracts) : []
  console.log(`archived ${finals.length} settled contracts in ${Math.round((Date.now() - t0) / 1000)}s`)
  check('archive: at least 25 settled contracts archived', finals.length >= 25, String(finals.length))
  check('archive: the stale saved remote is archived as settled', finals.includes(STALE.replace(/\s+/g, '')))
  const rows = finals.flatMap((c) => shelf.contracts[c].txs)
  const stakeRows = rows.filter((t) => (t.recipient || '').replace(/\s+/g, '') === STAKING || t.toType === 3)
  check('archive: settled contracts carry stake rows', stakeRows.length > 0, String(stakeRows.length))
  check('archive: every archived contract is one this wallet funded', finals.every((c) => shelf.contracts[c].txs.some((t) => (t.sender || '').replace(/\s+/g, '') === FLAT)))

  // History renders stake rows (the basic list has none, so they can only come
  // from the contract histories).
  await page.waitForTimeout(12000) // next heartbeat picks the archive state up
  const histTab = page.locator('.tab', { hasText: 'History' })
  if (await histTab.count()) await histTab.first().click()
  await page.waitForTimeout(2000)
  const stakeChips = await page.locator('.tx-kind.stake').count()
  check('history: stake rows from Pay contracts are shown', stakeChips > 0, String(stakeChips))

  // A reload serves the settled contracts from the shelf: no history call for them.
  const contractCalls = new Set()
  page.on('request', (r) => {
    if (!r.url().includes('rpc.nimiqwatch.com')) return
    try {
      const b = JSON.parse(r.postData() || '{}')
      const a = String(b.params?.[0] || '').replace(/\s+/g, '')
      if (b.method === 'getTransactionsByAddress' && finals.includes(a)) contractCalls.add(a)
    } catch {}
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await page.waitForTimeout(20000)
  check('reload: zero history calls for archived contracts', contractCalls.size === 0, [...contractCalls].join(','))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.log('FAIL harness:', e.message); process.exit(1) })
