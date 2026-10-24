// Beta UI probe: the "New look (beta)" rebuilt on the house shadcn kit
// (v1.36.0). Covers the shell (sidebar + top bar + bottom tabs), the Overview
// (balance hero, collapsible earn card), the yield calculator drawer, the
// theme switchover and the mode plumbing (?ui= / stored choice).
//
// Runs the app through its demo entry ("Try with a sample wallet") and, for
// determinism, serves a small validators fixture instead of the live API. The
// same fixture feeds the classic and the beta calculator, so the two totals
// must be the same number.
//
// Usage: NODE_PATH=/root/projects/mykopi-my/node_modules node test/beta-ui-probe.cjs <baseUrl>
// Firefox, like the other probes (chromium's compositor crashes here).
const { firefox } = require('playwright')

const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '')
const VERSION = 'v' + require('../package.json').version
const BETA_BADGE = VERSION + ' beta'
// A Pay WebView user agent: the probe browser is not Nimiq Pay itself, but
// with this UA NimBooks restores the demo session after a reload (the same
// trick the other probes use), which the earn-card persistence check needs.
const PAY_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'

const VALIDATOR_FIXTURE = [
  {
    id: 1,
    name: 'Restake Pool',
    address: 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY',
    fee: 0.01,
    balance: 2500000000000000,
    dominanceRatio: 0.05,
    score: { reliability: 0.99 },
    payoutType: 'restake',
    isListed: true,
  },
  {
    id: 2,
    name: 'Direct Pool',
    address: 'NQ62 68D7 RQHN MSTR 1Y0T SY1P HU89 5QJ5 YV05',
    fee: 0.02,
    balance: 2000000000000000,
    dominanceRatio: 0.04,
    score: { reliability: 0.9 },
    payoutType: 'direct',
    isListed: true,
  },
  {
    id: 3,
    name: 'Slow Pool',
    address: 'NQ97 H1NR S3X0 CVFQ VJ9Y 9A0Y FRQN Q6EU D0PL',
    fee: 0.04,
    balance: 1500000000000000,
    dominanceRatio: 0.03,
    score: { reliability: 0.8 },
    isListed: true,
  },
]

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : '  :: ' + info}`)
}

const num = (total) => Number(total.replace(/[^0-9.]/g, ''))
const close = (a, b) => Math.abs(num(a) - num(b)) <= 0.05

// WCAG contrast of "rgb(...)" strings; 1:1 when colours cannot be parsed.
function contrast(fg, bg) {
  const rgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c)
    if (!m) return null
    const parts = m[1].split(',').map((s) => parseFloat(s))
    return parts.slice(0, 3)
  }
  const lin = (v) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  const lum = (t) => {
    if (!t) return null
    const [r, g, b] = t
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const a = lum(rgb(fg))
  const b = lum(rgb(bg))
  if (a === null || b === null) return null
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}


// Computed colours from the kit come back as oklch(); the contrast maths
// needs sRGB. Resolve any CSS colour in the page through a 1x1 canvas, and
// read an element's effective background from the nearest opaque ancestor.
// Without this, contrast() sees oklch, returns null and the check passes
// vacuously (it did, until v1.36.0).
const RESOLVE_COLOURS = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  window.__rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data; return 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')' }
  window.__alpha = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = 'rgba(0,0,0,0)'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return cx.getImageData(0, 0, 1, 1).data[3] }
  window.__bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (window.__alpha(b) > 200) return window.__rgb(b) } return 'rgb(255, 255, 255)' }
})()`

async function mockValidators(page) {
  await page.route('**/validators-api-main.je-cf9.workers.dev/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VALIDATOR_FIXTURE) })
  )
}

// Deterministic market for the sidebar widgets: the NIM price (tier 1 of the
// price chain, prices.nim.sh) and DefiLlama's chart endpoint behind the price
// card's history. The two ranges get different, deliberately signed series so
// a range switch must both change the change line and redraw the sparkline.
const NIM_USD = 0.00039354
// Series ends: +2.31% / -4.10%. The card ends the line at the live price
// (NIM_USD), so its change reads first point -> live: -1.62% / -4.01%.
const HISTORY_CHANGE = { 24: 1.0231, 28: 0.959 }

function historyBody(span) {
  const last = Math.floor(Date.now() / 1000)
  const step = span === 24 ? 3600 : 6 * 3600
  const count = span === 24 ? 24 : 28
  const firstPrice = span === 24 ? 0.0004 : 0.00041
  const lastPrice = firstPrice * HISTORY_CHANGE[span]
  const prices = []
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1)
    const price = i === count - 1 ? lastPrice : firstPrice + (lastPrice - firstPrice) * f
    prices.push({ timestamp: last - (count - 1 - i) * step, price: Number(price.toFixed(8)) })
  }
  return JSON.stringify({
    coins: { 'coingecko:nimiq-2': { symbol: 'NIM', confidence: 0.99, prices } },
  })
}

async function mockMarket(page) {
  const json = (body) => ({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body,
  })
  await page.route('**/prices.nim.sh/**', (route) => {
    const ticker = decodeURIComponent(new URL(route.request().url()).pathname)
      .split('/')
      .filter(Boolean)[1]
    const prices = { NIM: NIM_USD, ETH: 2500, MATIC: 0.0957 }
    return route.fulfill(
      json(
        JSON.stringify({
          currency: ticker,
          time: Math.floor(Date.now() / 1000),
          price: prices[ticker] ?? 1,
        })
      )
    )
  })
  // Chart history, by span: 24h asks for span=24, 7d for span=28.
  await page.route('**/coins.llama.fi/chart/**', (route) => {
    const span = Number(new URL(route.request().url()).searchParams.get('span'))
    return route.fulfill(json(historyBody(span === 28 ? 28 : 24)))
  })
  // The other two price tiers, in case tier 1 is skipped: same price.
  await page.route('**/coins.llama.fi/prices/**', (route) =>
    route.fulfill(
      json(
        JSON.stringify({
          coins: {
            'coingecko:nimiq-2': { price: NIM_USD, symbol: 'NIM', timestamp: Math.floor(Date.now() / 1000) },
            'coingecko:tether': { price: 1, symbol: 'USDT', timestamp: Math.floor(Date.now() / 1000) },
            'coingecko:ethereum': { price: 2500, symbol: 'ETH', timestamp: Math.floor(Date.now() / 1000) },
            'coingecko:polygon-ecosystem-token': { price: 0.0957, symbol: 'POL', timestamp: Math.floor(Date.now() / 1000) },
          },
        })
      )
    )
  )
  await page.route('**/api.coingecko.com/**', (route) =>
    route.fulfill(
      json(
        JSON.stringify({
          'nimiq-2': { usd: NIM_USD },
          tether: { usd: 1 },
          ethereum: { usd: 2500 },
          'matic-network': { usd: 0.0957 },
        })
      )
    )
  )
}

async function dismissTour(page) {
  // The sample wallet offers the tour whenever it is fully loaded and idle,
  // including in the middle of a run, so dismiss on every call.
  for (let i = 0; i < 5; i++) {
    const now = page.locator('.tour-layer button:has-text("Not now")')
    if (!(await now.count())) return
    await now.first().click()
    await page.waitForTimeout(500)
  }
}

async function demoInto(page) {
  const demo = page.locator('button:has-text("Try with a sample wallet")').first()
  await demo.click()
  await page.waitForSelector('.earn-card', { timeout: 30000 })
  await page.waitForTimeout(1500)
  await dismissTour(page)
}

// The demo dashboard, connected on the classic look, as the baseline for the
// beta comparisons (balance hero, calculator total).
async function readClassicBaseline(page) {
  await demoInto(page)
  const badge = (await page.locator('.version-badge').first().innerText()).trim()
  const hero = (await page.locator('.nim-tile .value').first().innerText()).replace(/\s+/g, ' ').trim()
  await page.locator('.earn-card button', { hasText: 'See the maths' }).click()
  await page.waitForSelector('.calc-result', { timeout: 20000 })
  await page.locator('#calcAmount').fill('2500')
  await page.waitForTimeout(600)
  const classicTotal = (await page.locator('.calc-result .earn-hero').innerText()).replace(/\s+/g, ' ').trim()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  return { badge, hero, classicTotal }
}

// Switch the beta on from the changelog window, like a real tester.
async function switchToBeta(page) {
  await page.evaluate(() => {
    window.__nbProbeMarker = 'kept'
  })
  await page.locator('.version-badge').first().click()
  await page.waitForSelector('.modal')
  const hint = (await page.locator('.beta-toggle-hint').innerText()).replace(/\s+/g, ' ')
  check('(b) hint names the redesigned layout', /redesigned layout/.test(hint), hint)
  await page.locator('.beta-toggle-row [role="switch"]').click()
  const marker = await page.evaluate(() => window.__nbProbeMarker)
  check('(b) no reload on switch', marker === 'kept')
  await page.locator('.modal-head [aria-label="Close"]').click()
  await page.waitForSelector('[data-probe="beta-shell"]', { timeout: 30000 })
  await page.waitForTimeout(800)
  await dismissTour(page)
}

// The beta badge lives in the sidebar footer; on a phone that is the
// off-canvas sidebar Sheet, so open it first.
async function readBetaBadge(page) {
  await page.locator('[data-slot="sidebar-trigger"]').first().click()
  await page.waitForSelector('[data-probe="beta-version-badge"]', { timeout: 10000 })
  const text = (await page.locator('[data-probe="beta-version-badge"]').innerText()).replace(/\s+/g, ' ').trim()
  await page.locator('[data-slot="sheet-overlay"]').click({ position: { x: 350, y: 100 } })
  await page.waitForSelector('[data-probe="beta-version-badge"]', { state: 'detached', timeout: 10000 })
  await page.waitForTimeout(500)
  return text
}

;(async () => {
  const browser = await firefox.launch()

  // --- Stage 1 and 2 on a phone (390x844): classic baseline, then beta. ---
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  const page = await ctx.newPage()
  await mockValidators(page)
  await mockMarket(page)
  const errors = []
  page.on('pageerror', (e) => errors.push('390: ' + String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  // Classic baseline for the comparisons.
  const base = await readClassicBaseline(page)
  check('(a) classic by default: classic earn card visible', (await page.locator('.earn-card').count()) === 1)
  check('(a) no beta shell in classic', (await page.locator('.ui-beta').count()) === 0)
  check(`(a) badge is exactly ${VERSION}`, base.badge === VERSION, JSON.stringify(base.badge))

  // (b) Switch on from the changelog, no reload, badge wears " beta".
  await switchToBeta(page)
  const badge = await readBetaBadge(page)
  check(`(b) badge is ${BETA_BADGE} in the sidebar`, badge === BETA_BADGE, JSON.stringify(badge))

  // (c) At 390x844: the bottom tab bar carries the five sections and the
  // classic chrome is gone.
  const tabs = page.locator('[data-probe="beta-tabs"] button')
  const tabCount = await tabs.count()
  check('(c) bottom tab bar has 5 items', tabCount === 5, String(tabCount))
  let shortTab = ''
  let minH = Infinity
  for (let i = 0; i < tabCount; i++) {
    const h = (await tabs.nth(i).boundingBox())?.height ?? 0
    minH = Math.min(minH, h)
    if (h < 44 && !shortTab) shortTab = await tabs.nth(i).innerText()
  }
  check('(c) every tab item is at least 44px tall', minH >= 44, `min=${minH.toFixed(0)} ${shortTab}`)
  check('(c) the classic .tabs dock is absent', (await page.locator('nav.tabs').count()) === 0)
  check('(c) the classic header is absent', (await page.locator('header.topbar').count()) === 0)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check('(c) no horizontal overflow at 390', overflow)

  // (c) Tapping History shows the classic history content inside the shell.
  await tabs.nth(1).click()
  await page.waitForTimeout(800)
  check(
    '(c) History content renders inside the beta shell',
    (await page.locator('[data-probe="beta-shell"] main.classic-in-beta section.history').count()) === 1
  )
  await tabs.nth(0).click()
  await page.waitForTimeout(500)

  // (e) The Overview: the balance hero matches the classic tile text.
  const hero = (await page.locator('[data-probe="balance-hero"]').innerText()).replace(/\s+/g, ' ').trim()
  check('(e) beta balance hero equals the classic NIM tile', hero === base.hero, `beta=${hero} classic=${base.hero}`)

  // (e) The earn card collapses, expands, and the choice survives a reload.
  const earnCollapsible = page.locator('[data-probe="earn-collapsible"]')
  await earnCollapsible.waitFor()
  check('(e) earn card starts expanded', (await page.locator('[data-probe="earn-summary"]').count()) === 0)
  await page.locator('[data-probe="earn-toggle"]').click()
  await page.waitForTimeout(400)
  check('(e) collapsed shows the one-line summary', (await page.locator('[data-probe="earn-summary"]').count()) === 1)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-probe="beta-shell"]', { timeout: 30000 })
  await page.waitForTimeout(1500)
  await dismissTour(page)
  const stored = await page.evaluate(() => localStorage.getItem('nimbooks:earn-collapsed'))
  check("(e) the collapsed choice is stored ('1')", stored === '1', JSON.stringify(stored))
  check('(e) still collapsed after the reload', (await page.locator('[data-probe="earn-summary"]').count()) === 1)
  await page.locator('[data-probe="earn-toggle"]').click()
  await page.locator('[data-probe="earn-since"], [data-probe="earn-year"]').first().waitFor()
  check('(e) expands again', (await page.locator('[data-probe="earn-summary"]').count()) === 0)
  await page.locator('[data-probe="earn-terms-toggle"]').first().click()
  await page.locator('[data-probe="earn-terms"]').first().waitFor()
  const betaTerms = (await page.locator('[data-probe="earn-terms"] dt').allInnerTexts()).map((s) => s.trim())
  check(
    '(e) beta earn card shows the four staking-term labels',
    ['How it works', 'Rate', 'What can go wrong', 'Getting out'].every((l) => betaTerms.includes(l)),
    betaTerms.join(' | ')
  )

  // (f) The calculator: a drawer inside .ui-beta, same numbers as classic.
  await page.locator('[data-probe="earn-maths"]').click()
  await page.waitForSelector('#betaCalcAmount', { timeout: 20000 })
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][data-vaul-drawer]')
    return Boolean(dialog && dialog.closest('.ui-beta'))
  })
  check('(f) the calculator is a drawer inside .ui-beta', inside)
  await page.locator('#betaCalcAmount').fill('2500')
  await page.waitForTimeout(600)
  const betaTotal = (await page.locator('[data-probe="calc-total"]').innerText()).replace(/\s+/g, ' ').trim()
  check('(f) 1-year total equals the classic calculator', close(betaTotal, base.classicTotal), `beta=${betaTotal} classic=${base.classicTotal}`)
  let rows = await page.locator('[data-probe="calc-table"] tbody tr').count()
  check('(f) 1-year table has one row', rows === 1)
  await page.locator('.ui-beta button', { hasText: '3 years' }).click()
  await page.waitForTimeout(400)
  rows = await page.locator('[data-probe="calc-table"] tbody tr').count()
  check('(f) horizon 3 shows three rows', rows === 3, String(rows))
  const total3 = (await page.locator('[data-probe="calc-total"]').innerText()).trim()
  check('(f) horizon 3 changes the total', num(total3) > num(betaTotal))
  await page.locator('.ui-beta button', { hasText: '5 years' }).click()
  await page.waitForTimeout(400)
  rows = await page.locator('[data-probe="calc-table"] tbody tr').count()
  check('(f) horizon 5 shows five rows', rows === 5, String(rows))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // (g) Every gold (default-variant) action renders near-black text on gold:
  // assert the WCAG ratio of each gold button and badge is at least 4.5.
  await page.evaluate(RESOLVE_COLOURS)
  const gold = await page.evaluate(() => {
    const shell = document.querySelector('.ui-beta')
    const out = []
    for (const el of shell.querySelectorAll('button[data-variant="default"], [data-slot="badge"][data-variant="default"]')) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || (el.offsetParent === null && cs.position === 'static')) continue
      out.push({
        text: (el.textContent || '').trim().slice(0, 30),
        bg: window.__rgb(cs.backgroundColor),
        fg: window.__rgb(cs.color),
      })
    }
    return out
  })
  check('(g) at least one gold action exists on Overview', gold.length >= 1, JSON.stringify(gold.slice(0, 3)))
  let worst = Infinity
  let worstText = ''
  for (const g of gold) {
    const r = contrast(g.fg, g.bg)
    if (r === null) worst = 0
    else if (r < worst) {
      worst = r
      worstText = g.text
    }
  }
  check('(g) gold buttons carry near-black text (contrast >= 4.5)', worst >= 4.5, `worst=${worst?.toFixed(2)} "${worstText}"`)

  // (h) Both themes render the shell; the shell background follows the app's
  // own theme attribute (at phone widths the sidebar is the off-canvas Sheet,
  // so the header's background is read instead).
  const shellBg = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-probe="beta-shell"] header')
      return el ? getComputedStyle(el).backgroundColor : null
    })
  // (k) Unported classic sections inside the beta shell keep readable labels.
  // Classic and the kit both define --muted (text vs background); unmapped,
  // the analytics labels drew dark grey on a dark card at 1.6:1.
  const classicLabels = async () => {
    await page.evaluate(RESOLVE_COLOURS)
    return page.evaluate(() => {
      const els = [...document.querySelectorAll('.ui-beta .classic-in-beta .stat .label, .ui-beta .classic-in-beta .muted')]
        .filter((e) => e.offsetParent !== null && (e.textContent || '').trim())
      return els.slice(0, 40).map((e) => ({ t: e.textContent.trim().slice(0, 24), fg: window.__rgb(getComputedStyle(e).color), bg: window.__bgOf(e) }))
    })
  }
  const worstOf = (list) => list.reduce((w, l) => { const r = contrast(l.fg, l.bg) ?? 0; return r < w.r ? { r, t: l.t } : w }, { r: Infinity, t: '' })
  const darkLabels = await classicLabels()
  const dW = worstOf(darkLabels)
  check('(k) dark: classic labels inside beta are readable (>= 4.5)', darkLabels.length > 0 && dW.r >= 4.5, `n=${darkLabels.length} worst=${dW.r.toFixed(2)} "${dW.t}"`)
  const darkBg = await shellBg()
  check('(h) dark shell renders', typeof darkBg === 'string', JSON.stringify(darkBg))
  const modeToggle = '[data-probe="beta-shell"] header button[aria-label*="light mode"], [data-probe="beta-shell"] header button[aria-label*="dark mode"]'
  await page.locator(modeToggle).first().click()
  await page.waitForTimeout(600)
  const lightBg = await shellBg()
  check('(h) switching the theme changes the shell background', lightBg !== null && lightBg !== darkBg, `${darkBg} -> ${lightBg}`)
  const lightLabels = await classicLabels()
  const lW = worstOf(lightLabels)
  check('(k) light: classic labels inside beta are readable (>= 4.5)', lightLabels.length > 0 && lW.r >= 4.5, `n=${lightLabels.length} worst=${lW.r.toFixed(2)} "${lW.t}"`)
  // And back for the last leg.
  await page.locator(modeToggle).first().click()
  await page.waitForTimeout(400)

  // Way back: the badge in the sidebar (on a phone: in the off-canvas Sheet)
  // opens the changelog, the toggle there returns the classic look.
  await page.locator('[data-slot="sidebar-trigger"]').first().click()
  await page.waitForSelector('[data-probe="beta-version-badge"]', { timeout: 10000 })
  await page.locator('[data-probe="beta-version-badge"]').click()
  await page.waitForSelector('.modal')
  await page.locator('.beta-toggle-row [role="switch"]').click()
  await page.locator('.modal-head [aria-label="Close"]').click()
  await page.waitForTimeout(800)
  check('(b) classic earn card back after switching off', (await page.locator('.earn-card').count()) === 1)
  check('(b) no beta shell left', (await page.locator('.ui-beta').count()) === 0)
  check(
    `(a/i) badge back to exactly ${VERSION}`,
    ((await page.locator('.version-badge').first().innerText()).trim()) === VERSION
  )
  check('(j) no page errors on the phone run', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
  await ctx.close()

  // --- Stage 3: desktop (1440x900): sidebar visible, no bottom bar. ---
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: PAY_UA })
  const pd = await ctxD.newPage()
  await mockValidators(pd)
  await mockMarket(pd)
  await ctxD.addInitScript(() => {
    localStorage.setItem('nimbooks:ui', 'beta')
  })
  await pd.goto(BASE, { waitUntil: 'domcontentloaded' })
  await pd.click('button:has-text("Try with a sample wallet")')
  await pd.waitForSelector('[data-probe="beta-shell"]', { timeout: 30000 })
  await pd.waitForTimeout(1500)
  await dismissTour(pd)
  const desktopErrors = []
  pd.on('pageerror', (e) => desktopErrors.push(String(e)))
  const sidebar = pd.locator('[data-probe="beta-shell"] > div [data-slot="sidebar"]').first()
  const sidebarVisible = (await sidebar.count()) === 1 && (await sidebar.isVisible())
  check('(d) the sidebar is visible at 1440', sidebarVisible)
  const items = await pd.locator('[data-slot="sidebar-group-content"] [data-slot="sidebar-menu-button"]').count()
  check('(d) the sidebar lists the 5 sections', items === 5, String(items))
  const bottomBar = pd.locator('[data-probe="beta-tabs"]')
  const bottomHidden = (await bottomBar.count()) === 0 || !(await bottomBar.first().isVisible())
  check('(d) no bottom tab bar at 1440', bottomHidden)
  const badgeD = (await pd.locator('[data-probe="beta-version-badge"]').innerText()).trim()
  check(`(d) desktop badge is ${BETA_BADGE}`, badgeD === BETA_BADGE, JSON.stringify(badgeD))

  // (l) The sidebar widgets: NIM price card, "Where your NIM is" ring and the
  // one action, "Stake idle NIM". Prices come from the stubbed market above.
  const priceCard = pd.locator('[data-probe="beta-price-card"]')
  check('(l) the sidebar shows the NIM price card', (await priceCard.count()) === 1)
  const card24 = (await priceCard.innerText()).replace(/\s+/g, ' ').trim()
  check('(l) the card shows the stubbed NIM price', /\$0\.00039\d+/.test(card24), card24)
  check('(l) the 24h change runs to the live price, signed: -1.62% in 24 hours', /-1\.62% in 24 hours/.test(card24), card24)
  const spark24 = await pd.locator('[data-probe="beta-price-spark"] path').getAttribute('d')
  check('(l) the sparkline draws the 24h series', !!spark24 && spark24.startsWith('M '), String(spark24))

  const chip = pd.locator('[data-probe="beta-price-range"]')
  check('(l) the range chip starts at 24h', (await chip.innerText()).trim() === '24h')
  await chip.click()
  await pd.waitForFunction(
    (prev) => {
      const path = document.querySelector('[data-probe="beta-price-spark"] path')
      return !!path && path.getAttribute('d') !== prev
    },
    spark24,
    { timeout: 15000 }
  )
  check('(l) the range chip toggles to 7d', (await chip.innerText()).trim() === '7d')
  const card7 = (await priceCard.innerText()).replace(/\s+/g, ' ').trim()
  check('(l) the 7d change runs to the live price, signed: -4.01% in 7 days', /-4\.01% in 7 days/.test(card7), card7)
  const spark7 = await pd.locator('[data-probe="beta-price-spark"] path').getAttribute('d')
  check('(l) switching the range redraws the sparkline', !!spark7 && spark7 !== spark24)

  // Balances arrive from the chain after the shell paints: wait for the ring
  // to have its rows (and so for the stake rule to have settled) before
  // reading them.
  const ringRows = pd.locator('[data-probe="beta-ring-row"]')
  await ringRows.first().waitFor({ timeout: 30000 })
  const ringCount = await ringRows.count()
  const ringText = (await ringRows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  check('(l) the ring lists Available and Staked', ringCount >= 2 && ringText.some((t) => t.startsWith('Available')) && ringText.some((t) => t.startsWith('Staked')), ringText.join(' | '))
  check('(l) every ring row carries a 2 decimal NIM amount', ringText.every((t) => /\d+\.\d{2} NIM/.test(t)), ringText.join(' | '))
  const ringPct = ringText.reduce((sum, t) => {
    const m = /([\d.]+)%$/.exec(t)
    return sum + (m ? Number(m[1]) : 0)
  }, 0)
  check('(l) the ring percentages sum to 100.0', Math.abs(ringPct - 100) <= 0.05, ringPct.toFixed(2))
  const arcs = await pd.locator('[data-probe="beta-nim-ring"] svg circle[stroke-dasharray]').count()
  check('(l) one donut arc per legend row', arcs === ringCount, `${arcs}/${ringCount}`)
  const widgetText = await pd.locator('[data-probe="beta-sidebar-widgets"]').innerText()
  check('(l) widget copy has no em or en dash', !/[\u2013\u2014]/.test(widgetText), JSON.stringify(widgetText))

  // Icon-collapsed desktop sidebar: the widgets are hidden, and come back.
  const trigger = pd.locator('[data-slot="sidebar-trigger"]').first()
  await trigger.click()
  await pd.waitForTimeout(600)
  check('(l) collapsing the sidebar to icons hides the widgets', !(await pd.locator('[data-probe="beta-sidebar-widgets"]').first().isVisible()))
  await trigger.click()
  await pd.waitForTimeout(600)
  check('(l) expanding it brings the widgets back', await pd.locator('[data-probe="beta-sidebar-widgets"]').first().isVisible())

  await pd.locator('[data-probe="beta-stake-idle"]').click()
  await pd.waitForSelector('.modal[aria-label="Stake NIM"]', { timeout: 15000 })
  check('(l) Stake idle NIM opens the stake panel', (await pd.locator('.modal[aria-label="Stake NIM"]').count()) === 1)
  await pd.locator('.modal[aria-label="Stake NIM"] .modal-head [aria-label="Close"]').click()
  await pd.waitForSelector('.modal[aria-label="Stake NIM"]', { state: 'detached', timeout: 10000 })

  // Under 520px of viewport height the price card hides (the Nimiq Wallet rule).
  await pd.setViewportSize({ width: 1440, height: 500 })
  await pd.waitForTimeout(600)
  check('(l) under 520px tall the price card is hidden', (await priceCard.count()) === 0)
  check('(l) the ring stays at 500px tall', (await pd.locator('[data-probe="beta-nim-ring"]').count()) === 1)
  const over1440 = await pd.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check('(l) no horizontal overflow at 1440', over1440)
  await pd.setViewportSize({ width: 1440, height: 900 })
  await pd.waitForTimeout(600)
  check('(l) the price card comes back at 900px tall', (await priceCard.count()) === 1)

  check('(d) no page errors at 1440', desktopErrors.length === 0, JSON.stringify(desktopErrors.slice(0, 3)))
  await ctxD.close()

  // --- Stage 4: URL overrides on fresh contexts. ---
  const ctxBeta = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  const pb = await ctxBeta.newPage()
  await mockValidators(pb)
  await pb.goto(BASE + '/?ui=beta', { waitUntil: 'domcontentloaded' })
  await pb.waitForTimeout(1200)
  check('(i) ?ui=beta: landing badge wears " beta"', ((await pb.locator('.version-badge').first().innerText()).trim()) === BETA_BADGE)
  await pb.click('button:has-text("Try with a sample wallet")')
  await pb.waitForSelector('[data-probe="beta-shell"]', { timeout: 30000 })
  await dismissTour(pb)
  check('(i) ?ui=beta renders the beta shell after connecting', true)
  await ctxBeta.close()

  const ctxClassic = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  await ctxClassic.addInitScript(() => {
    localStorage.setItem('nimbooks:ui', 'beta')
  })
  const pc = await ctxClassic.newPage()
  await mockValidators(pc)
  await pc.goto(BASE + '/?ui=classic', { waitUntil: 'domcontentloaded' })
  await pc.waitForTimeout(1200)
  check(`(i) ?ui=classic beats a stored beta (badge ${VERSION})`, ((await pc.locator('.version-badge').first().innerText()).trim()) === VERSION)
  await ctxClassic.close()

  // --- Stage 5: the sidebar widgets on a phone (390x844) and at 360. ---
  const ctxW = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  const pw = await ctxW.newPage()
  await mockValidators(pw)
  await mockMarket(pw)
  const widgetErrors = []
  pw.on('pageerror', (e) => widgetErrors.push(String(e)))
  await pw.goto(BASE + '/?ui=beta', { waitUntil: 'domcontentloaded' })
  await pw.click('button:has-text("Try with a sample wallet")')
  await pw.waitForSelector('[data-probe="beta-shell"]', { timeout: 30000 })
  await pw.waitForTimeout(1500)
  await dismissTour(pw)
  check('(m) the widgets mount only with the phone Sheet', (await pw.locator('[data-probe="beta-sidebar-widgets"]').count()) === 0)
  await pw.locator('[data-slot="sidebar-trigger"]').first().click()
  await pw.waitForSelector('[data-probe="beta-sidebar-widgets"]', { timeout: 15000 })
  // Same chain-read wait as on desktop.
  await pw.locator('[data-probe="beta-ring-row"]').first().waitFor({ timeout: 30000 })
  await pw.locator('[data-probe="beta-stake-idle"]').waitFor({ timeout: 30000 })
  await pw.waitForTimeout(1200)
  const inSheet = await pw.evaluate(() => {
    const widgets = document.querySelector('[data-probe="beta-sidebar-widgets"]')
    return Boolean(widgets && widgets.closest('[data-slot="sidebar"][data-mobile="true"]'))
  })
  check('(m) the widgets render inside the phone Sheet', inSheet)
  check('(m) the price card and the ring are in the Sheet', (await pw.locator('[data-probe="beta-price-card"]').count()) === 1 && (await pw.locator('[data-probe="beta-nim-ring"]').count()) === 1)
  check('(m) the Sheet shows the price and the stake action', /\$0\.00039\d+/.test(await pw.locator('[data-probe="beta-price-card"]').innerText()) && (await pw.locator('[data-probe="beta-stake-idle"]').count()) === 1)
  const sheetOverflow390 = await pw.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check('(m) no horizontal overflow at 390 with the Sheet open', sheetOverflow390)

  // The stake action closes the Sheet, then opens the classic stake panel.
  await pw.locator('[data-probe="beta-stake-idle"]').click()
  await pw.waitForSelector('.modal[aria-label="Stake NIM"]', { timeout: 15000 })
  const sheetGone = pw.locator('[data-slot="sidebar"][data-mobile="true"]')
  await sheetGone.waitFor({ state: 'detached', timeout: 10000 })
  check('(m) Stake idle NIM closes the Sheet', (await sheetGone.count()) === 0)
  check('(m) and opens the stake panel', await pw.locator('.modal[aria-label="Stake NIM"]').isVisible())
  await pw.locator('.modal[aria-label="Stake NIM"] .modal-head [aria-label="Close"]').click()
  await pw.waitForSelector('.modal[aria-label="Stake NIM"]', { state: 'detached', timeout: 10000 })

  await pw.setViewportSize({ width: 360, height: 780 })
  await pw.waitForTimeout(500)
  await pw.locator('[data-slot="sidebar-trigger"]').first().click()
  await pw.waitForSelector('[data-probe="beta-sidebar-widgets"]', { timeout: 15000 })
  await pw.waitForTimeout(600)
  const over360 = await pw.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check('(m) no horizontal overflow at 360', over360)
  const phoneText = await pw.locator('[data-probe="beta-sidebar-widgets"]').innerText()
  check('(m) phone widget copy has no em or en dash', !/[\u2013\u2014]/.test(phoneText), JSON.stringify(phoneText))
  check('(m) no page errors on the widget run', widgetErrors.length === 0, JSON.stringify(widgetErrors.slice(0, 3)))
  await ctxW.close()

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})