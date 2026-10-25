// Analytics' Hide internal switch and History's must agree in BOTH directions
// (Analytics lives on Overview and writes the shared key; History must pick it
// up on entry). Real Nimiq Pay relay wallet NQ82, live chain data.
// Usage: NODE_PATH=... node test/history-internal-sync-probe.cjs <baseUrl>
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const ADDR = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const PAY_UA = 'Mozilla/5.0 (Linux; Android 16; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 NimiqPay/2.0.3'
let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}
;(async () => {
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  await ctx.addInitScript(([addr]) => {
    if (!sessionStorage.getItem('probe-init')) {
      sessionStorage.setItem('probe-init', '1')
      localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'dashboard' }))
      localStorage.setItem('nimbooks:analytics:filterHtlc', 'false')
      localStorage.setItem('nimbooks:countConsent', 'no')
      localStorage.setItem('nimbooks:connect-count', 'no')
    }
  }, [ADDR])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 30000 })
  const tab = (re) => page.locator('.tab', { hasText: re }).first().click()
  const histState = async () => {
    await tab(/history/i)
    await page.waitForSelector('.history-internal-toggle', { timeout: 60000 })
    await page.waitForTimeout(300)
    return page.evaluate(() => ({
      pressed: document.querySelector('.history-internal-toggle')?.getAttribute('aria-pressed'),
      hidden: !!document.querySelector('.history-hidden'),
      allChip: [...document.querySelectorAll('.history-filters button')].find((b) => /^All/.test(b.innerText))?.innerText,
    }))
  }
  const a0 = await histState()
  check('History starts with the switch off', a0.pressed === 'false', JSON.stringify(a0))
  // Flip it in Analytics (Overview).
  await tab(/overview|home/i)
  await page.waitForSelector('.htlc-toggle', { timeout: 60000 })
  const before = await page.locator('.htlc-toggle').getAttribute('aria-pressed')
  await page.locator('.htlc-toggle').click()
  await page.waitForTimeout(300)
  const after = await page.locator('.htlc-toggle').getAttribute('aria-pressed')
  check('Analytics switch flipped on', before === 'false' && after === 'true', `${before} -> ${after}`)
  const a1 = await histState()
  check('History picks up the Analytics switch (on)', a1.pressed === 'true', JSON.stringify(a1))
  check('History shows the hidden line and a smaller All count', a1.hidden && a1.allChip !== a0.allChip, JSON.stringify([a0, a1]))
  // And back the other way: off in History, Analytics follows.
  await page.locator('.history-internal-toggle').click()
  await page.waitForTimeout(300)
  await tab(/overview|home/i)
  await page.waitForSelector('.htlc-toggle', { timeout: 60000 })
  check('Analytics follows History (off)', (await page.locator('.htlc-toggle').getAttribute('aria-pressed')) === 'false')
  check('no page errors', errors.length === 0, errors.join(' | '))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
