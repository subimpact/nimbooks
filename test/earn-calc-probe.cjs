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
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
