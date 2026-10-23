// Earn card + yield calculator: the stake button must never offer NIM that is
// already staking. Restored Nimiq Pay session, staker and balance RPC mocked.
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/earn-calc-probe.cjs <baseUrl> [shotDir]
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8097'
const SHOTS = process.argv[3] || '/tmp'
const PAY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'
const ADDR = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
const FLAT = ADDR.replace(/\s+/g, '')
const IZ = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const NIM = 100000
let pass = 0, fail = 0
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : ' :: ' + info}`) }
const noStaker = { error: { code: 1, message: 'No staker with address: x' } }
const staker = (nim) => ({ result: { data: { address: ADDR, balance: nim * NIM, delegation: IZ, inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 } } })

;(async () => {
  const browser = await firefox.launch()
  const cases = [
    // name, staker result, basic NIM, expected button regex (null = no button), expected note regex
    ['fully-staked', staker(7620.55), 0, null, /already staking, so this is what it earns/],
    ['staked-plus-idle', staker(7620.55), 500, /^Add 500 NIM to your stake$/i, /You have 500 NIM available to stake, on top of the 7,620\.55 NIM already staking/],
    ['new-with-funds', noStaker, 5000, /^Stake 5,000 NIM$/i, null],
    ['new-below-min', noStaker, 50, null, /Staking starts at 100 NIM\. You have 50 NIM available/],
  ]
  for (const [name, stakerRes, basicNim, btnRe, noteRe] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, userAgent: PAY_UA })
    await ctx.addInitScript(([addr]) => {
      localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'overview' }))
      localStorage.setItem('nimbooks:countConsent', 'no')
      window.nimiqPay = {}
    }, [ADDR])
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
      const body = route.request().postData() || ''
      let req = {}
      try { req = JSON.parse(body) } catch {}
      const reply = (payload) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }) })
      if (req.method === 'getStakerByAddress') return reply(stakerRes)
      if (req.method === 'getAccountByAddress' && String(req.params?.[0]).replace(/\s+/g, '') === FLAT)
        return reply({ result: { data: { address: FLAT, balance: basicNim * NIM, type: 'basic' } } })
      if (req.method === 'getTransactionsByAddress') return reply({ result: { data: [] } })
      return route.continue()
    })
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.earn-card', { timeout: 25000 })
    await page.waitForTimeout(4000)
    const card = (await page.locator('.earn-card').innerText()).replace(/\s+/g, ' ')
    if (name === 'fully-staked') check(`${name}: earn card has no stake button`, (await page.locator('.earn-card .btn-primary').count()) === 0, card)
    await page.locator('.earn-card button', { hasText: 'See the maths' }).click()
    try {
      await page.waitForSelector('.calc-form', { timeout: 10000 })
    } catch (e) {
      await page.screenshot({ path: `${SHOTS}/earn-calc-${name}-nosheet.png` })
      console.log('DEBUG body:', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 900))
      throw e
    }
    await page.waitForTimeout(2500)
    const sheet = page.locator('.calc-form').locator('xpath=ancestor::*[contains(@class,"sheet") or contains(@class,"modal")][1]')
    const scope = (await sheet.count()) ? sheet : page.locator('body')
    const txt = (await scope.innerText()).replace(/\s+/g, ' ')
    const btn = scope.locator('button.btn-primary', { hasText: /stake/i })
    const btnCount = await btn.count()
    if (btnRe) {
      const label = btnCount ? (await btn.first().innerText()).trim() : ''
      check(`${name}: button "${label}"`, btnCount === 1 && btnRe.test(label), label)
    } else {
      check(`${name}: no stake button`, btnCount === 0, btnCount ? await btn.first().innerText() : '')
    }
    if (noteRe) check(`${name}: note`, noteRe.test(txt), txt.slice(0, 400))
    check(`${name}: never offers 7,620.55`, !/Stake 7,620\.55 NIM/i.test(txt))
    check(`${name}: no em-dash`, !txt.includes('\u2014'))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${name}: no horizontal overflow @360`, overflow <= 1, `overflow=${overflow}`)
    await page.screenshot({ path: `${SHOTS}/earn-calc-${name}.png` })
    if (btnRe && btnCount) {
      await btn.first().click()
      await page.waitForTimeout(1500)
      const amt = await page.evaluate(() => {
        const i = document.querySelector('#stakeAmountValue') || document.querySelector('#stakeAmount')
        const m = document.querySelector('.modal')
        return i ? i.value : 'NOINPUT:' + (m ? m.innerText.replace(/\s+/g, ' ').slice(0, 500) : 'no modal')
      })
      check(`${name}: stake panel prefilled with the free amount`, amt !== null && Number(String(amt).replace(/,/g, '')) <= basicNim, `amount=${amt}`)
    }
    check(`${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // --- Staking terms + the restake loop (Council Cycle 3) ---
  // Deterministic validator list: the staker's pool pays rewards into the
  // wallet ('direct', with a free-text schedule), and a second pool restakes.
  const RESTAKE = 'NQ62 68D7 RQHN MSTR 1Y0T SY1P HU89 5QJ5 YV05'
  const RESTAKE_FLAT = RESTAKE.replace(/\s+/g, '')
  const FIXTURE = [
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
    {
      id: 2,
      name: 'Moon Pool',
      address: RESTAKE_FLAT,
      fee: 0.01,
      balance: 36000000000000,
      dominanceRatio: 0.04,
      score: { reliability: 0.98 },
      payoutType: 'restake',
      payoutSchedule: '0 */6 * * *',
      isListed: true,
    },
  ]
  const stakerOn = (delegation, nim) => ({
    result: {
      data: { address: ADDR, balance: nim * NIM, delegation, inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 },
    },
  })

  async function openFixture(stakerRes, basicNim) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, userAgent: PAY_UA })
    await ctx.addInitScript(([addr]) => {
      localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'overview' }))
      localStorage.setItem('nimbooks:countConsent', 'no')
      window.nimiqPay = {}
    }, [ADDR])
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.route('**/validators-api-main.je-cf9.workers.dev/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) })
    )
    await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
      const body = route.request().postData() || ''
      let req = {}
      try { req = JSON.parse(body) } catch {}
      const reply = (payload) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }) })
      if (req.method === 'getStakerByAddress') return reply(stakerRes)
      if (req.method === 'getAccountByAddress' && String(req.params?.[0]).replace(/\s+/g, '') === FLAT)
        return reply({ result: { data: { address: FLAT, balance: basicNim * NIM, type: 'basic' } } })
      if (req.method === 'getTransactionsByAddress') return reply({ result: { data: [] } })
      return route.continue()
    })
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.earn-card', { timeout: 25000 })
    await page.waitForTimeout(4000)
    return { ctx, page, errors }
  }

  const TERM_LABELS = ['How it works', 'Rate', 'What can go wrong', 'Getting out']

  // Direct pool: terms, the restake line, the relabelled button, the reminder.
  {
    const { ctx, page, errors } = await openFixture(stakerOn(IZ, 7620.55), 500)
    const card = page.locator('.earn-card')
    const labels = (await card.locator('.earn-terms dt').allInnerTexts()).map((s) => s.trim())
    check('direct: the four staking-term labels', TERM_LABELS.every((l) => labels.includes(l)), labels.join(' | '))
    const text = (await card.innerText()).replace(/\s+/g, ' ')
    check(
      'direct: restake line names the pool and the yearly gain',
      /ImpactZero pays your rewards into your wallet instead of restaking them\. Restaking them adds about [\d,.]+ NIM a year\./.test(text),
      text.slice(0, 500)
    )
    check('direct: terms risk says it pays into the wallet every 12 hours', /pays rewards into your wallet every 12 hours/.test(text), text.slice(0, 600))
    const primary = card.locator('.btn-primary')
    const primaryText = (await primary.count()) ? ((await primary.first().textContent()) || '').trim() : 'none'
    check('direct: primary button relabelled Restake 500 NIM', (await primary.count()) === 1 && primaryText === 'Restake 500 NIM', primaryText)
    const gcal = card.locator('a', { hasText: 'Google Calendar' })
    const href = (await gcal.count()) ? await gcal.first().getAttribute('href') : ''
    check('direct: Google Calendar link', href.startsWith('https://calendar.google.com/calendar/render?'), href)
    check('direct: Pay WebView hides the .ics download', (await card.locator('button', { hasText: 'Download .ics' }).count()) === 0)
    check('direct: Pay WebView offers Copy link', (await card.locator('button', { hasText: 'Copy link' }).count()) === 1)
    check('direct: no em-dash', !text.includes('\u2014'))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('direct: no horizontal overflow @360', overflow <= 1, `overflow=${overflow}`)

    // The stake panel carries the same four rows for the pool it would use.
    await primary.first().click()
    await page.waitForSelector('.modal[aria-label="Stake NIM"]', { timeout: 10000 })
    await page.waitForTimeout(800)
    const modal = (await page.locator('.modal').innerText()).replace(/\s+/g, ' ')
    check('stake panel: Before you stake', /before you stake/i.test(modal), modal.slice(0, 300))
    check('stake panel: Getting out', modal.includes('Getting out'), modal.slice(0, 300))
    check('stake panel: How it works', modal.includes('How it works'), modal.slice(0, 300))
    check('stake panel: describes the pool', /ImpactZero \(2\.5% fee\) produces blocks/.test(modal), modal.slice(0, 500))
    check('direct: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // Restaking pool: terms show, but there is no restake row to add.
  {
    const { ctx, page, errors } = await openFixture(stakerOn(RESTAKE_FLAT, 7620.55), 0)
    const card = page.locator('.earn-card')
    const labels = (await card.locator('.earn-terms dt').allInnerTexts()).map((s) => s.trim())
    check('restake pool: the four staking-term labels', TERM_LABELS.every((l) => labels.includes(l)), labels.join(' | '))
    check('restake pool: no restake row', (await card.locator('[data-probe="earn-restake"]').count()) === 0)
    const text = (await card.innerText()).replace(/\s+/g, ' ')
    check('restake pool: risk says the pool restakes', /Moon Pool adds your rewards to your stake every 6 hours\./.test(text), text.slice(0, 600))
    check('restake pool: no em-dash', !text.includes('\u2014'))
    check('restake pool: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
