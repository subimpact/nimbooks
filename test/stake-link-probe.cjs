// Stake-link probe (firefox): a #/stake link opens the existing stake panel,
// keeps a visible "Opened from a link" notice, and clears the hash. The sample
// wallet is used, with its RPC and validator list stubbed so the run is exact.
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/stake-link-probe.cjs [BASE_URL]
const { firefox } = require('playwright')
const BASE = process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8099'
const ADDR = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
const FLAT = ADDR.replace(/\s+/g, '')
const IZ = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const IZ_FLAT = IZ.replace(/\s+/g, '')
const BAD = 'NQ00 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const NIM = 100000
let pass = 0, fail = 0
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : ' :: ' + info}`) }

const VALIDATORS = [
  {
    id: 1,
    name: 'ImpactZero',
    address: IZ,
    fee: 0.025,
    balance: 45000000000000,
    dominanceRatio: 0.05,
    score: { reliability: 0.99 },
    payoutType: 'direct',
    payoutSchedule: 'Every 12 hours',
    isListed: true,
  },
]

const noStaker = { error: { code: 1, message: 'No staker with address: x' } }
const stakerOnIz = {
  result: {
    data: {
      address: ADDR,
      balance: 1000 * NIM,
      delegation: IZ,
      inactiveBalance: 0,
      inactiveFrom: null,
      retiredBalance: 0,
    },
  },
}

async function openCase(browser, hash, stakerRes, basicNim) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript(() => {
    localStorage.setItem('nimbooks:countConsent', 'no')
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    // Known baseline: the sample wallet's identicon path makes Firefox log this
    // once, with or without a stake link (it is not an uncaught app error).
    if (/Failed to load resource|net::ERR|status of 4\d\d|status of 5\d\d|XML Parsing Error/i.test(text)) return
    errors.push('console: ' + text)
  })
  await page.route('**/validators-api-main.je-cf9.workers.dev/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VALIDATORS) })
  )
  await page.route('**/v2.nimiqwatch.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ groups: [] }) })
  )
  await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
    const body = route.request().postData() || ''
    let req = {}
    try { req = JSON.parse(body) } catch {}
    const reply = (payload) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }),
    })
    if (req.method === 'getStakerByAddress') return reply(stakerRes)
    if (req.method === 'getAccountByAddress' && String(req.params?.[0]).replace(/\s+/g, '') === FLAT)
      return reply({ result: { data: { address: FLAT, balance: basicNim * NIM, type: 'basic' } } })
    if (req.method === 'getTransactionsByAddress') return reply({ result: { data: [] } })
    if (req.method === 'getBlockNumber') return reply({ result: { data: 123456 } })
    return reply({ result: { data: null } })
  })
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  const sample = page.locator('.connect-panel button', { hasText: 'Try with a sample wallet' })
  await sample.waitFor({ timeout: 20000 })
  await page.waitForSelector('.stake-link-waiting', { timeout: 5000 })
  const waiting = (await page.locator('.stake-link-waiting').innerText()).trim()
  await sample.click()
  await page.waitForSelector('.modal[aria-label="Stake NIM"]', { timeout: 30000 })
  await page.waitForTimeout(800)
  return { ctx, page, errors, waiting }
}

;(async () => {
  const browser = await firefox.launch()

  // (a) Amount + validator link: panel opens, notice names both, hash gone.
  {
    const { ctx, page, errors, waiting } = await openCase(browser, `#/stake?amount=5&validator=${encodeURIComponent(IZ)}`, stakerOnIz, 500)
    const banner = (await page.locator('.stake-link-banner').innerText()).replace(/\s+/g, ' ')
    check('a: connect screen says a stake link is waiting', waiting === 'A stake link is waiting. Connect a wallet to open it.', waiting)
    check('a: stake panel opens from the link', await page.locator('.modal[aria-label="Stake NIM"]').count() === 1)
    check('a: link notice is present', /Opened from a link:/.test(banner), banner)
    check('a: notice names the amount and validator', /5 NIM/.test(banner) && /ImpactZero/.test(banner), banner)
    check('a: hash is cleared', (await page.evaluate(() => window.location.hash)) === '', await page.evaluate(() => window.location.href))
    check('a: stored intent is cleared once consumed', (await page.evaluate(() => sessionStorage.getItem('nimbooks:stakeIntent'))) === null)
    check('a: amount is prefilled', (await page.locator('#stakeAmount').inputValue()) === '5', await page.locator('#stakeAmount').inputValue())
    check('a: no em-dash or en-dash in the notice', !/[\u2013\u2014]/.test(banner), banner)
    await page.waitForTimeout(2500)
    check('a: tour offer does not cover the link-opened panel', (await page.locator('button:has-text("Let\'s go")').count()) === 0)
    check('a: no console errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // (b) Bare route: panel opens, nothing preselected.
  {
    const { ctx, page, errors } = await openCase(browser, '#/stake', noStaker, 1000)
    check('b: bare #/stake opens the panel', await page.locator('.modal[aria-label="Stake NIM"]').count() === 1)
    check('b: bare route still shows the link notice', /Opened from a link/.test(await page.locator('.stake-link-banner').innerText()))
    check('b: no validator is selected', await page.locator('.option-row[aria-checked="true"]').count() === 0)
    check('b: hash is cleared', (await page.evaluate(() => window.location.hash)) === '')
    check('b: no console errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // (c) Bad validator: dropped with a warning, nothing selected.
  {
    const { ctx, page, errors } = await openCase(browser, `#/stake?amount=150&validator=${BAD}`, noStaker, 1000)
    const banner = (await page.locator('.stake-link-banner').innerText()).replace(/\s+/g, ' ')
    check('c: bad validator shows a warning', /validator address in this link is not valid/i.test(banner), banner)
    check('c: bad validator selects nothing', await page.locator('.option-row[aria-checked="true"]').count() === 0)
    check('c: valid amount still prefilled', (await page.locator('#stakeAmount').inputValue()) === '150', await page.locator('#stakeAmount').inputValue())
    check('c: no console errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
