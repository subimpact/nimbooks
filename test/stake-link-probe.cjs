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

async function openCase(browser, hash, stakerRes, basicNim, opts = {}) {
  const paySession = opts.paySession === true
  const validatorDelayMs = Number(opts.validatorDelayMs) || 0
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(paySession ? { userAgent: 'Mozilla/5.0 (Linux; Android 16) NimiqPay/1.0 Mobile' } : {}),
  })
  await ctx.addInitScript(({ paySession, addr }) => {
    localStorage.setItem('nimbooks:countConsent', 'no')
    if (paySession) {
      localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'dashboard' }))
      window.nimiqPay = {}
    }
  }, { paySession, addr: ADDR })
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
  await page.route('**/validators-api-main.je-cf9.workers.dev/**', async (route) => {
    if (validatorDelayMs > 0) await new Promise((r) => setTimeout(r, validatorDelayMs))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VALIDATORS) })
  })
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
  if (paySession) {
    // A restored Pay session goes straight to the dashboard, then the link
    // opens its own panel without the connect screen in the way.
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await page.waitForSelector('.modal[aria-label="Stake NIM"]', { timeout: 30000 })
    await page.waitForTimeout(800)
    return { ctx, page, errors, waiting: null, payHref: null }
  }
  const sample = page.locator('.connect-panel button', { hasText: 'Try with a sample wallet' })
  await sample.waitFor({ timeout: 20000 })
  await page.waitForSelector('.stake-link-waiting', { timeout: 5000 })
  const waiting = (await page.locator('.stake-link-waiting').innerText()).trim()
  // Phone browser: Open in Nimiq Pay must carry the link through nimiqpay://
  const payHref = await page.locator('a:has-text("Open in Nimiq Pay")').first().getAttribute('href').catch(() => null)
  await sample.click()
  await page.waitForSelector('.modal[aria-label="Stake NIM"]', { timeout: 30000 })
  await page.waitForTimeout(800)
  return { ctx, page, errors, waiting, payHref }
}

;(async () => {
  const browser = await firefox.launch()

  // (a) Amount + validator link: panel opens, notice names both, hash gone.
  {
    const { ctx, page, errors, waiting, payHref } = await openCase(browser, `#/stake?amount=5&validator=${encodeURIComponent(IZ)}`, stakerOnIz, 500)
    const handoff = payHref ? decodeURIComponent(payHref.replace('nimiqpay://miniapp?url=', '')) : ''
    check('a: Open in Nimiq Pay carries the stake link', payHref?.startsWith('nimiqpay://miniapp?url=') && handoff === `https://nimbooks.subimpact.net/#/stake?amount=5&validator=${IZ_FLAT}`, payHref)
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

  // (d) Pay-session link: the panel opens before the delayed validator list,
  // then the named validator is applied when the list lands.
  {
    const { ctx, page, errors } = await openCase(
      browser,
      `#/stake?amount=10&validator=${encodeURIComponent(IZ)}`,
      noStaker,
      1000,
      { paySession: true, validatorDelayMs: 5000 }
    )
    const early = (await page.locator('.stake-link-banner').innerText()).replace(/\s+/g, ' ')
    check('d: Pay-session panel opens before the validator list', await page.locator('.modal[aria-label="Stake NIM"]').count() === 1)
    check('d: pending notice shows the short validator address', /Opened from a link: 10 NIM with NQ08 ACT8 \.\.\. NVXY\./.test(early) && !/ImpactZero/.test(early), early)
    check('d: no validator is selected while the list is pending', await page.locator('.option-row[aria-checked="true"]').count() === 0)
    await page.locator('.stake-link-banner', { hasText: 'ImpactZero' }).waitFor({ timeout: 20000 })
    const late = (await page.locator('.stake-link-banner').innerText()).replace(/\s+/g, ' ')
    check('d: notice names the validator once the list lands', /Opened from a link: 10 NIM with ImpactZero \(NQ08 ACT8 \.\.\. NVXY\)\./.test(late), late)
    check('d: validator is selected once the list lands', await page.locator('.option-row[aria-checked="true"]').count() === 1)
    check('d: no console errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // (e) The link's own staker lookup fails: the panel still opens with the
  // amount, selects nothing, and says why.
  {
    const stakerError = { error: { code: -32603, message: 'RPC unavailable' } }
    const { ctx, page, errors } = await openCase(browser, `#/stake?amount=10&validator=${encodeURIComponent(IZ)}`, stakerError, 1000)
    const banner = (await page.locator('.stake-link-banner').innerText()).replace(/\s+/g, ' ')
    check('e: panel opens when the staker lookup fails', await page.locator('.modal[aria-label="Stake NIM"]').count() === 1)
    check('e: no validator is selected when the staker lookup fails', await page.locator('.option-row[aria-checked="true"]').count() === 0)
    check('e: could-not-check note is shown', /Your stake could not be checked right now, so no validator was selected\./.test(banner), banner)
    check('e: amount is still prefilled', (await page.locator('#stakeAmount').inputValue()) === '10', await page.locator('#stakeAmount').inputValue())
    check('e: no console errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
