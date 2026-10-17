// Statement on a real Nimiq Pay relay wallet: real vs internal split (v1.29 same-day).
// Usage: NODE_PATH=... node test/statement-pay-probe.cjs <baseUrl>
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const ADDR = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const PAY_UA = 'Mozilla/5.0 (Linux; Android 16; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 NimiqPay/2.0.3'
let pass = 0, fail = 0
const check = (n, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok ? '' : '  ' + info}`) }
const num = (s) => Number(String(s).replace(/[^0-9.\-]/g, ''))
;(async () => {
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  await ctx.addInitScript(([addr]) => {
    localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'dashboard' }))
  }, [ADDR])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await page.locator('.tab', { hasText: /export/i }).click()
  await page.waitForSelector('.statement-summary', { timeout: 60000 })
  // 'All time' if offered, so the whole relay history is in
  const sel = page.locator('select').filter({ has: page.locator('option[value="all"]') }).first()
  if (await sel.count()) await sel.selectOption('all')
  // archive sync merges contracts in the background; give it time, then read
  await page.waitForFunction(() => /Nimiq Pay internal transfers/.test(document.querySelector('.statement-summary')?.innerText || ''), null, { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const t = await page.evaluate(() => {
    const out = {}
    for (const r of document.querySelectorAll('.statement-summary .row')) {
      const [k, v] = [...r.querySelectorAll('span')].map((s) => s.innerText)
      out[k] = v
    }
    out.__text = document.querySelector('.statement-summary')?.parentElement?.innerText || ''
    return out
  })
  console.log(JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k]) => k !== '__text'))))
  const sent = num((t['Sent to others'] || '').split('NIM')[0])
  const rec = num((t['Received'] || '').split('NIM')[0])
  const internal = t['Nimiq Pay internal transfers'] || ''
  check('internal row shown', /out .* NIM · back .* NIM/.test(internal), internal)
  check('sent is real spending (> 20k, well under the 66k gross)', sent > 20000 && sent < 40000, sent)
  check('received is real (< 40k)', rec > 0 && rec < 40000, rec)
  check('hint line shown', /never left\s+you/.test(t.__text))
  check('no em-dash', !t.__text.includes('\u2014'))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await page.screenshot({ path: (process.argv[3] || require('os').tmpdir()) + '/statement-pay.png', fullPage: false })
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
