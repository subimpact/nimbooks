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

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})