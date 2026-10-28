// Demo artifacts probe (firefox): the sample wallet's Receipts and Request tabs
// show the real NQ82 artifacts from src/lib/demoData.ts; the request reads Paid,
// every receipt's verification link verifies on /#/verify, and a reconnect does
// not duplicate anything.
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/demo-artifacts-probe.cjs [BASE_URL] [SHOT_DIR]
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const SHOTS = process.argv[3] || ''
let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

async function enterDemo(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.locator('button:has-text("sample wallet")').first().click()
  await page.waitForSelector('.tour-offer-card', { timeout: 60000 })
  await page.locator('.tour-offer-card button:has-text("Not now")').click()
  await page.waitForTimeout(500)
}

;(async () => {
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript(() => localStorage.setItem('nimbooks:connect-count', 'no'))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await enterDemo(page)

    await page.locator('[data-tour="receipts-tab"]').click()
    await page.waitForSelector('.receipt', { timeout: 15000 })
    const receipts = await page.locator('.receipt').evaluateAll((els) =>
      els.map((e) => ({ main: e.querySelector('.tx-main')?.textContent ?? '', memo: e.querySelector('.tx-memo')?.textContent ?? '' }))
    )
    check('receipts tab lists the four NQ82 receipts', receipts.length === 4, JSON.stringify(receipts))
    check('newest receipt is the 10 NIM Coffee split payment', /^10 NIM/.test(receipts[0]?.main ?? '') && /Coffee split/.test(receipts[0]?.memo ?? ''), JSON.stringify(receipts[0]))
    check('contract receipts name their data instead of printing hex', receipts.filter((r) => r.memo === 'Contract data, no note').length === 2 && receipts.every((r) => !/[0-9a-f]{40}/.test(r.memo)), JSON.stringify(receipts.map((r) => r.memo)))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/demo-receipts.png` })

    await page.locator('[data-tour="request-tab"]').click()
    await page.waitForSelector('.invoice-item', { timeout: 15000 })
    const inv = await page.locator('.invoice-item').evaluateAll((els) =>
      els.map((e) => ({ amount: e.querySelector('.tx-amount')?.textContent ?? '', pill: e.querySelector('.invoice-pill')?.textContent ?? '', memo: e.querySelector('.tx-memo')?.textContent ?? '', text: e.textContent }))
    )
    check('request tab lists the Coffee split request', inv.length === 1 && /Coffee split/.test(inv[0].memo), JSON.stringify(inv))
    check('the request reads 10 NIM and Paid', /^10 NIM/.test(inv[0]?.amount ?? '') && inv[0]?.pill === 'Paid', JSON.stringify(inv[0]))
    check('the request links its paying tx', /3ddfe0c3/.test(inv[0]?.text ?? ''), (inv[0]?.text ?? '').slice(0, 200))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/demo-request.png` })

    // Reconnect: seeding is an idempotent upsert.
    await enterDemo(page)
    await page.locator('[data-tour="receipts-tab"]').click()
    await page.waitForSelector('.receipt', { timeout: 15000 })
    check('reconnecting does not duplicate receipts', (await page.locator('.receipt').count()) === 4)
    const stored = await page.evaluate(() => {
      const k = Object.keys(localStorage)
      const r = k.find((x) => x.startsWith('nimbooks:receipts:'))
      const i = k.find((x) => x.startsWith('nimbooks:invoices:'))
      return { r: r && JSON.parse(localStorage.getItem(r)).map((x) => x.txHash), i: i && JSON.parse(localStorage.getItem(i)).length }
    })
    check('stored once each', stored.r?.length === 4 && new Set(stored.r).size === 4 && stored.i === 1, JSON.stringify(stored))

    // Every receipt verifies on the public verify route.
    const links = await page.evaluate(async () => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('nimbooks:receipts:'))
      return JSON.parse(localStorage.getItem(k)).map((r) => {
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(r)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        return { tx: r.txHash.slice(0, 10), b64 }
      })
    })
    // A public RPC hiccup reads "inconclusive (RPC unavailable)": that is the
    // network, not the receipt, so it gets one retry before it counts.
    for (const l of links) {
      let verdict = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        const p = await ctx.newPage()
        await p.goto(`${BASE}/#/verify/${l.b64}`, { waitUntil: 'domcontentloaded' })
        try {
          await p.waitForFunction(() => /confirmed on the Nimiq blockchain|not authentic|not found|invalid|inconclusive/i.test(document.body.innerText), null, { timeout: 45000 })
        } catch {
          /* read whatever is there */
        }
        verdict = await p.locator('body').innerText()
        await p.close()
        if (!/RPC unavailable/i.test(verdict)) break
        await new Promise((r) => setTimeout(r, 5000))
      }
      check(`receipt ${l.tx} verifies on /#/verify`, /confirmed on the Nimiq blockchain/i.test(verdict), verdict.slice(0, 200).replace(/\s+/g, ' '))
    }
    check('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    check('walk completed without throwing', false, String(e).slice(0, 300))
  } finally {
    await browser.close()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
