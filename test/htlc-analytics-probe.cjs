// End-to-end: Analytics on a real Nimiq Pay relay wallet (live chain data).
// Usage: NODE_PATH=... node test/htlc-analytics-probe.cjs <baseUrl> [shotDir]
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8097'
const SHOTS = process.argv[3] || '/tmp'
const ADDR = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const PAY_UA = 'Mozilla/5.0 (Linux; Android 16; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 NimiqPay/2.0.3'
let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${info}`}`)
}
const num = (s) => Number(String(s).replace(/[^0-9.]/g, ''))
;(async () => {
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, userAgent: PAY_UA })
  await ctx.addInitScript(([addr]) => {
    localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'analytics' }))
  }, [ADDR])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 30000 })
  try { await page.locator('.tab', { hasText: /analytics/i }).click({ timeout: 5000 }) } catch {}
  await page.waitForSelector('.analytics', { timeout: 15000 })
  await page.locator('.period', { hasText: 'All' }).click()
  await page.waitForFunction(() => /internal/.test(document.querySelector('.stat-grid')?.innerText || ''), null, { timeout: 40000 }).catch(() => {})
  const read = () => page.evaluate(() => {
    const stats = [...document.querySelectorAll('.stat-grid .stat')].map((s) => s.innerText)
    return {
      stats,
      toggle: !!document.querySelector('.htlc-toggle'),
      legend: document.querySelector('.flow-legend')?.innerText || '',
      faded: document.querySelectorAll('.chart rect[fill-opacity="0.3"]').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      text: document.querySelector('.analytics').innerText,
    }
  })
  const a = await read()
  const [rec, sent] = a.stats
  console.log('Received card:', rec.replace(/\s+/g, ' '), '| Sent card:', sent.replace(/\s+/g, ' '))
  const recReal = num(rec.split('\n').find((l) => l.startsWith('+') && !/internal/.test(l)))
  const sentReal = num(sent.split('\n').find((l) => l.startsWith('−') && !/internal/.test(l)))
  // Wallet moved 66,056.46 NIM each way since 2026-09-07. The split depends on
  // which of its contracts are still locked (held = internal), so assert the
  // conservation and the floor instead of one frozen figure.
  const recInt = num((rec.split('\n').find((l) => /internal/.test(l)) || '').replace('internal', ''))
  const sentInt = num((sent.split('\n').find((l) => /internal/.test(l)) || '').replace('internal', ''))
  check('Received real + internal = 66,056.46', Math.abs(recReal + recInt - 66056.46) < 0.05, `${recReal}+${recInt}`)
  check('Sent real + internal = 66,056.46', Math.abs(sentReal + sentInt - 66056.46) < 0.05, `${sentReal}+${sentInt}`)
  check('Received real ~22,926.9 (not the inflated 66k)', Math.abs(recReal - 22926.9) < 1, recReal)
  check('Sent real > 20,000 (not 0)', sentReal > 20000 && sentReal <= 22926.91, sentReal)
  check('internal lines present on both cards', recInt > 40000 && sentInt > 40000, `${recInt} ${sentInt}`)
  check('Hide internal toggle shown', a.toggle)
  check('legend shown', /Payments/.test(a.legend) && /Internal HTLC transfers/.test(a.legend), a.legend)
  check('faded internal bars drawn', a.faded > 0, a.faded)
  check('no horizontal overflow @360', a.overflow <= 1, a.overflow)
  check('no em-dash in analytics', !a.text.includes('\u2014'))
  await page.locator('.analytics').screenshot({ path: `${SHOTS}/htlc-analytics-shown.png` })
  await page.locator('.htlc-toggle').click()
  await page.waitForTimeout(400)
  const b = await read()
  check('hidden: no faded bars', b.faded === 0, b.faded)
  check('hidden: no legend', b.legend === '')
  check('hidden: headline unchanged', b.stats[0].split('\n').some((l) => Math.abs(num(l) - 22926.9) < 1 && l.startsWith('+')))
  check('hidden: no internal lines', !/internal/.test(b.stats[0] + b.stats[1]))
  await page.locator('.analytics').screenshot({ path: `${SHOTS}/htlc-analytics-hidden.png` })
  await page.locator('.htlc-toggle').click()
  // Day sheet: tap the tallest faded bar's day
  await page.waitForTimeout(300)
  const hit = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.chart rect[fill-opacity="0.3"]')].sort((x, y) => y.getBBox().height - x.getBBox().height)[0]
    const bb = r.getBoundingClientRect()
    return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }
  })
  await page.mouse.click(hit.x, hit.y)
  await page.waitForTimeout(800)
  const sheet = await page.evaluate(() => (document.querySelector('.modal, .detail-sheet, .day-sheet') || document.body).innerText)
  check('day sheet marks internal legs', /internal/i.test(sheet) && /internal\)/.test(sheet), sheet.slice(0, 600))
  await page.screenshot({ path: `${SHOTS}/htlc-day-sheet.png` })
  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
