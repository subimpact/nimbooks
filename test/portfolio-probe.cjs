// Portfolio report + ImpactZero stake gate probe (firefox, demo + mocked locked states).
// Usage: NODE_PATH=/root/projects/mykopi-my/node_modules node test/portfolio-probe.cjs <baseUrl> <shotDir>
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const SHOTS = process.argv[3] || '/tmp'
const IZ = 'NQ08ACT8T0FEPTG8P5RLH2S3QGXHV15RNVXY'
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

async function openExport(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /sample wallet/i }).first().click()
  await page.waitForSelector('.topbar', { timeout: 20000 })
  // Dismiss the tour offer if it appears.
  try { await page.locator('button:has-text("Not now")').click({ timeout: 8000 }) } catch {}
  await page.locator('.tab', { hasText: 'Export' }).click()
  await page.waitForSelector('.portfolio-card', { timeout: 10000 })
}

;(async () => {
  const browser = await firefox.launch()
  // 1. Demo: unlocked
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openExport(page)
    const card = page.locator('.portfolio-card')
    check('demo: card renders', /portfolio report/i.test(await card.innerText()))
    check('demo: not locked', (await page.locator('.portfolio-card .gate-locked').count()) === 0)
    const save = page.locator('.portfolio-card button', { hasText: 'Save as PDF' })
    check('demo: Save as PDF enabled', await save.isEnabled())
    // add an extra address (ImpactZero validator itself), invalid first
    const inputs = page.locator('.portfolio-add-fields input')
    await inputs.nth(0).fill('NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXZ')
    await page.locator('.portfolio-card button', { hasText: 'Add address' }).click()
    check('demo: bad checksum rejected', (await card.innerText()).includes('valid Nimiq address'))
    await inputs.nth(0).fill('NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY')
    await inputs.nth(1).fill('Validator')
    await page.locator('.portfolio-card button', { hasText: 'Add address' }).click()
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.portfolio-card .portfolio-row')
      return rows.length === 2 && !/\n…|^…$/m.test(rows[1].querySelector('.portfolio-row-stats')?.innerText || '…')
    }, null, { timeout: 15000 }).catch(() => {})
    const rowText = await page.locator('.portfolio-card .portfolio-row').nth(1).innerText()
    const statsText = await page.locator('.portfolio-card .portfolio-row').nth(1).locator('.portfolio-row-stats').innerText()
    check('demo: extra address row loaded', /Validator/.test(rowText) && /\d NIM/.test(statsText) && !/^…$/m.test(statsText), rowText.replace(/\s+/g, ' ').slice(0, 140))
    const stored = await page.evaluate(() => localStorage.getItem('nimbooks:portfolio:addresses'))
    check('demo: saved to localStorage', !!stored && stored.includes('NVXY'))
    // overflow check at 390px
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('demo: no horizontal overflow', overflow <= 1, `overflow=${overflow}`)
    await card.screenshot({ path: `${SHOTS}/portfolio-demo.png` })
    // print emulation
    await page.evaluate(() => document.body.classList.add('printing-portfolio'))
    await page.emulateMedia({ media: 'print' })
    const vis = await page.evaluate(() => {
      const rep = document.querySelector('.portfolio-report')
      const app = document.getElementById('root')
      return { rep: rep && getComputedStyle(rep).display, app: app && getComputedStyle(app).display, text: rep ? rep.innerText : '' }
    })
    check('print: report visible, app hidden', vis.rep === 'block' && vis.app === 'none', JSON.stringify({ rep: vis.rep, app: vis.app }))
    check('print: report has grand total + url + timestamp', /Grand total/.test(vis.text) && /nimbooks\.subimpact\.net/.test(vis.text) && /Generated/.test(vis.text))
    check('print: no em-dash in report', !vis.text.includes('\u2014'))
    await page.screenshot({ path: `${SHOTS}/portfolio-print.png`, fullPage: true })
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => document.body.classList.remove('printing-portfolio'))
    // receipt print rules untouched when class absent
    await page.emulateMedia({ media: 'print' })
    const repHidden = await page.evaluate(() => getComputedStyle(document.querySelector('.portfolio-report')).display)
    check('print w/o class: report stays hidden', repHidden === 'none')
    check('demo: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 2. Real (non-demo) session via a restored Nimiq Pay session record, staker RPC mocked.
  const PAY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'
  const ADDR = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
  const staker = (balance, delegation) => ({ result: { data: { address: ADDR, balance, delegation, inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 } } })
  for (const [name, result, copyRe, btnRe, unlocked, addr = ADDR] of [
    ['not-staked', { error: { code: 1, message: 'No staker with address: x' } }, /stake 1,000 NIM or more with ImpactZero/, /Stake with ImpactZero/, false],
    ['below-min', staker(50000000, 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'), /You have 500 NIM staked with ImpactZero\. Add 500 NIM more/, /Stake with ImpactZero/, false],
    ['other-validator', staker(900000000, 'NQ29 FBVT 0000 0000 0000 0000 0000 0000 0000'), /other validators don't unlock this\. Only ImpactZero does/, /Open Stake panel/, false],
    ['staked-1000', staker(100000000, 'NQ08ACT8T0FEPTG8P5RLH2S3QGXHV15RNVXY'), /Unlocked by your ImpactZero stake/, null, true],
    // Access grant list: not staked, but this wallet is granted, so unlocked.
    ['granted-not-staked', { error: { code: 1, message: 'No staker with address: x' } }, /Unlocked for this wallet/, null, true, 'NQ67 ACSR 3GFL HN98 93PR 9PG8 UTU0 9QXV 09UH'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, userAgent: PAY_UA })
    await ctx.addInitScript(([addr]) => {
      localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'export' }))
    }, [addr])
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
      const body = route.request().postData() || ''
      if (body.includes('getStakerByAddress')) {
        const id = JSON.parse(body).id
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id, ...result }) })
      }
      return route.continue()
    })
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.topbar', { timeout: 20000 })
    try { await page.locator('.tab', { hasText: 'Export' }).click({ timeout: 5000 }) } catch {}
    await page.waitForSelector('.portfolio-card', { timeout: 10000 })
    await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('.portfolio-card').innerText), copyRe.source, { timeout: 20000 }).catch(() => {})
    const txt = await page.locator('.portfolio-card').innerText()
    const lockedCount = await page.locator('.portfolio-card .gate-locked').count()
    check(`${name}: copy`, copyRe.test(txt), txt.replace(/\s+/g, ' ').slice(0, 220))
    check(`${name}: locked=${!unlocked}`, (lockedCount > 0) === !unlocked)
    check(`${name}: no em-dash`, !txt.includes('\u2014'))
    if (!unlocked) {
      const blur = await page.evaluate(() => getComputedStyle(document.querySelector('.gate-locked')).filter)
      check(`${name}: blurred`, /blur/.test(blur), blur)
      const inertOk = await page.evaluate(() => document.querySelector('.gate-locked').inert === true)
      check(`${name}: inert`, inertOk)
      const btn = page.locator('.gate-overlay button')
      const btnTxt = await btn.innerText()
      check(`${name}: CTA label`, btnRe.test(btnTxt) || new RegExp(btnRe.source, 'i').test(btnTxt), btnTxt)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check(`${name}: no horizontal overflow @360`, overflow <= 1, `overflow=${overflow}`)
      await page.locator('.portfolio-card').screenshot({ path: `${SHOTS}/portfolio-${name}.png` })
      await btn.click()
      await page.waitForSelector('.modal', { timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(1500)
      const stakeOpen = await page.evaluate(() => { const m = document.querySelector('.modal'); return !!m && /stake/i.test(m.innerText) })
      check(`${name}: CTA opens stake panel`, stakeOpen)
    }
    // No provider injected here, so isInNimiqPay() is false: the Save button shows and
    // must be disabled exactly when locked (belt and braces under the overlay).
    const saveBtn = page.locator('.portfolio-card button', { hasText: /save as pdf/i })
    check(`${name}: Save disabled=${!unlocked}`, (await saveBtn.count()) === 1 && (await saveBtn.isEnabled()) === unlocked)
    check(`${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
  // 3. Inside Nimiq Pay (provider injected), unlocked: Save as PDF works through
  // the phone's print screen. window.print() is replaced with the behaviour
  // measured in Pay on Android 16: returns at once, beforeprint/afterprint
  // ~0.3 s later, then the print screen hides the page and returns later.
  // A second mode models a phone with no print screen at all.
  for (const mode of ['android', 'none']) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, userAgent: PAY_UA })
    await ctx.addInitScript(([addr, mode]) => {
      localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'export' }))
      window.nimiqPay = {}
      let vis = 'visible'
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis })
      const setVis = (v) => { vis = v; document.dispatchEvent(new Event('visibilitychange')) }
      window.__printCalls = 0
      window.print = () => {
        window.__printCalls++
        if (mode !== 'android') return
        setTimeout(() => window.dispatchEvent(new Event('beforeprint')), 300)
        setTimeout(() => window.dispatchEvent(new Event('afterprint')), 340)
        setTimeout(() => setVis('hidden'), 3000)
        setTimeout(() => setVis('visible'), 5000)
      }
    }, [ADDR, mode])
    const page = await ctx.newPage()
    await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
      const body = route.request().postData() || ''
      if (body.includes('getStakerByAddress')) {
        const id = JSON.parse(body).id
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id, ...staker(100000000, 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY') }) })
      }
      return route.continue()
    })
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.topbar', { timeout: 20000 })
    try { await page.locator('.tab', { hasText: 'Export' }).click({ timeout: 5000 }) } catch {}
    await page.waitForSelector('.portfolio-card', { timeout: 10000 })
    await page.waitForFunction(() => /Unlocked by your ImpactZero stake/.test(document.querySelector('.portfolio-card').innerText), null, { timeout: 20000 }).catch(() => {})
    const txt = await page.locator('.portfolio-card').innerText()
    const save = page.locator('.portfolio-card button', { hasText: /save as pdf/i })
    const has = (c) => page.evaluate((c) => document.body.classList.contains(c), c)
    if (mode === 'android') {
      check('pay: no "needs a browser" copy', !/needs a browser|connect the same wallet/i.test(txt))
      check('pay: print-screen hint shown', /Opens your phone's print screen/.test(txt), txt.replace(/\s+/g, ' ').slice(-200))
      check('pay: wallet row says incl. Nimiq Pay balance', /incl\. Nimiq Pay balance/i.test(txt))
      check('pay: Save as PDF enabled', (await save.count()) === 1 && await save.isEnabled())
      await save.click()
      await page.waitForTimeout(1200)
      check('pay/android: report mode kept after afterprint', await has('printing-portfolio'))
      await page.waitForTimeout(2600)
      check('pay/android: report mode kept while print screen is up', await has('printing-portfolio'))
      check('pay/android: no fallback hint', !(await page.locator('.portfolio-card').innerText()).includes('did not open a print screen'))
      await page.waitForTimeout(1800)
      check('pay/android: report mode cleared on return', !(await has('printing-portfolio')))
      check('pay/android: print called once', (await page.evaluate(() => window.__printCalls)) === 1)
    } else {
      await save.click()
      await page.waitForTimeout(3200)
      const after = await page.locator('.portfolio-card').innerText()
      check('pay/no-print: fallback hint shown', /did not open a print screen here\. Take a screenshot/.test(after), after.replace(/\s+/g, ' ').slice(-200))
      check('pay/no-print: report mode cleared', !(await has('printing-portfolio')))
      check('pay/no-print: no em-dash', !after.includes('\u2014'))
    }
    await ctx.close()
  }
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
