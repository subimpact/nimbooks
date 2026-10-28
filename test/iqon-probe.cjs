// Iqon probe: every rendered Iqon must carry its parts (face/top/side/bottom),
// and opening the sample wallet must log no XML parse error.
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const SHOT = process.argv[3]
;(async () => {
  const b = await firefox.launch()
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByText(/sample wallet/i).first().click()
  await page.waitForSelector('img[alt^="Iqon for"]', { timeout: 30000 })
  await page.waitForTimeout(3000)
  const iqons = await page.evaluate(() =>
    [...document.querySelectorAll('img[alt^="Iqon for"]')].map((i) => {
      const svg = atob(i.src.split(',')[1] || '')
      return { alt: i.alt.slice(9, 20), len: svg.length, paths: (svg.match(/<path/g) || []).length }
    })
  )
  const xml = errors.filter((e) => /XML Parsing/.test(e))
  console.log(JSON.stringify({ count: iqons.length, sample: iqons.slice(0, 3), xmlErrors: xml.length }))
  if (SHOT) {
    const el = page.locator('img[alt^="Iqon for"]').first()
    await el.screenshot({ path: SHOT }).catch(() => {})
  }
  const ok = iqons.length > 0 && iqons.every((i) => i.paths > 3) && xml.length === 0
  console.log(ok ? 'IQON_OK' : 'IQON_BROKEN')
  await b.close()
  process.exit(ok ? 0 : 1)
})()
