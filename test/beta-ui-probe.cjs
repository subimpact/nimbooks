// Beta UI probe: "New look (beta)" opt-in, the toggle in the changelog window,
// the ported Earn card and the yield calculator drawer.
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
  // The sample wallet offers the tour once it is loaded; dismiss so the page
  // accepts taps again (same as the other demo probes do).
  await dismissTour(page)
}

;(async () => {
  const browser = await firefox.launch()

  // --- Stage 1: classic by default, toggle, ported screens, way back. ---
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await mockValidators(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  // (a) Classic earns card on the demo dashboard, badge exactly the version.
  await demoInto(page)
  check('(a) classic earn card visible', await page.locator('.earn-card').count() === 1)
  check('(a) no ui-beta content in classic', (await page.locator('.ui-beta').count()) === 0)
  const badge0 = await page.locator('.version-badge').first().innerText()
  check(`(a) badge text is exactly ${VERSION} in classic`, badge0.trim() === VERSION, JSON.stringify(badge0))

  // Classic calculator totals for the later beta comparison, same inputs.
  await page.locator('.earn-card button', { hasText: 'See the maths' }).click()
  await page.waitForSelector('.calc-result', { timeout: 20000 })
  await page.locator('#calcAmount').fill('2500')
  await page.waitForTimeout(600)
  const classicTotal = (await page.locator('.calc-result .earn-hero').innerText()).replace(/\s+/g, ' ').trim()
  check('(c) classic calculator total read', /≈/.test(classicTotal), classicTotal)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // (b) The changelog toggle: first control above the bug line.
  await page.locator('.version-badge').first().click()
  await page.waitForSelector('.modal')
  const row = await page.locator('.beta-toggle-row').count()
  check('(b) toggle row present', row === 1)
  const prevClass = await page.evaluate(
    () => document.querySelector('.modal .changelog-feedback')?.previousElementSibling?.className ?? ''
  )
  check('(b) switch row sits directly above the bug line', /beta-toggle-row/.test(prevClass), prevClass)
  await page.evaluate(() => {
    window.__nbProbeMarker = 'kept'
  })
  await page.locator('.beta-toggle-row [role="switch"]').click()
  const ariaOn = await page.locator('.beta-toggle-row [role="switch"]').getAttribute('aria-checked')
  check('(b) switch is on after the tap', ariaOn === 'true')
  const marker = await page.evaluate(() => window.__nbProbeMarker)
  check('(b) no reload on switch', marker === 'kept')
  const bugLine = (await page.locator('.changelog-feedback').first().innerText()).replace(/\s+/g, ' ')
  check('(b) bug line wears the beta wording', /Found something odd in the new look/.test(bugLine), bugLine)
  await page.locator('.modal-head [aria-label="Close"]').click()
  await page.waitForTimeout(600)

  // Ported Earn card, badge says beta.
  await dismissTour(page)
  check('(b) beta earn card rendered', (await page.locator('.ui-beta[data-learn="earn"]').count()) === 1)
  check('(b) classic earn card gone', (await page.locator('.earn-card').count()) === 0)
  const badgeB = await page.locator('.version-badge').first().innerText()
  check(`(b) badge text is ${BETA_BADGE}`, badgeB.trim() === BETA_BADGE, JSON.stringify(badgeB))

  // (c) The beta calculator: a drawer inside .ui-beta, same numbers.
  await dismissTour(page)
  await page.locator('.ui-beta button', { hasText: 'See the maths' }).click()
  await page.waitForSelector('.ui-beta [data-probe="calc-total"]', { timeout: 20000 })
  await page.locator('#betaCalcAmount').fill('2500')
  await page.waitForTimeout(600)
  // The drawer (role dialog) must be a DOM descendant of a .ui-beta host.
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][data-vaul-drawer]')
    return Boolean(dialog && dialog.closest('.ui-beta'))
  })
  check('(c) drawer renders inside .ui-beta', inside)
  const betaTotal = (await page.locator('.ui-beta [data-probe="calc-total"]').innerText())
    .replace(/\s+/g, ' ')
    .trim()
  check('(c) 1-year total equals the classic calculator', betaTotal === classicTotal || close(betaTotal, classicTotal), `beta=${betaTotal} classic=${classicTotal}`)
  const rows1 = await page.locator('[data-probe="calc-table"] tbody tr').count()
  check('(c) 1-year table has one row', rows1 === 1)
  await dismissTour(page)
  await page.locator('.ui-beta button', { hasText: '3 years' }).click()
  await page.waitForTimeout(400)
  const rows3 = await page.locator('[data-probe="calc-table"] tbody tr').count()
  check('(c) horizon 3 shows three rows', rows3 === 3, String(rows3))
  const total3 = num((await page.locator('.ui-beta [data-probe="calc-total"]').innerText()).replace(/\s+/g, ' '))
  check('(c) horizon 3 changes the total', total3 > num(betaTotal))
  await dismissTour(page)
  await page.locator('.ui-beta button', { hasText: '5 years' }).click()
  await page.waitForTimeout(400)
  check('(c) horizon 5 shows five rows', (await page.locator('[data-probe="calc-table"] tbody tr').count()) === 5)

  // (f) At 390x844: no horizontal overflow, buttons at least 44px tall.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check('(f) no horizontal overflow in beta @390', overflow)
  const shortButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.ui-beta button'))
      .filter((b) => b.offsetParent !== null || getComputedStyle(b).position === 'fixed')
      .filter((b) => b.getBoundingClientRect().height < 44)
      .map((b) => (b.textContent || '').trim().slice(0, 30))
  )
  check('(f) every beta button is 44px+ tall', shortButtons.length === 0, JSON.stringify(shortButtons))
  const smallInputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.ui-beta input, .ui-beta select'))
      .filter((el) => el.offsetParent !== null && Number(getComputedStyle(el).fontSize) < 16)
      .map((el) => el.id)
  )
  check('(f) beta inputs are 16px+ (no iOS zoom)', smallInputs.length === 0, JSON.stringify(smallInputs))

  // (d) Way back: the toggle returns the classic look.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await dismissTour(page)
  await page.locator('.version-badge').first().click()
  await page.waitForSelector('.modal')
  const bugLineBeta = (await page.locator('.changelog-feedback').first().innerText()).replace(/\s+/g, ' ')
  check('(d) in beta, bug line still the beta wording', /Found something odd in the new look/.test(bugLineBeta))
  await page.locator('.beta-toggle-row [role="switch"]').click()
  await page.locator('.modal-head [aria-label="Close"]').click()
  await page.waitForTimeout(600)
  check('(d) classic earn card back', (await page.locator('.earn-card').count()) === 1)
  check('(d) beta earn card gone', (await page.locator('.ui-beta').count()) === 0)
  const badgeD = await page.locator('.version-badge').first().innerText()
  check(`(d) badge back to exactly ${VERSION}`, badgeD.trim() === VERSION, JSON.stringify(badgeD))
  check('(d) no page errors through the whole run', errors.length === 0, JSON.stringify(errors.slice(0, 3)))
  await ctx.close()

  // --- Stage 2: URL overrides on fresh contexts. ---
  // (e) A shared link with ?ui=beta starts in beta.
  const ctxBeta = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pb = await ctxBeta.newPage()
  await mockValidators(pb)
  await pb.goto(BASE + '/?ui=beta', { waitUntil: 'domcontentloaded' })
  await pb.waitForTimeout(1500)
  check('(e) ?ui=beta starts beta (landing badge)', (await pb.locator('.version-badge').first().innerText()).trim() === BETA_BADGE)
  await pb.click('button:has-text("Try with a sample wallet")')
  await pb.waitForSelector('.ui-beta[data-learn="earn"]', { timeout: 30000 })
  await dismissTour(pb)
  check('(e) ?ui=beta renders the beta earn card', true)
  await ctxBeta.close()

  // (e) ?ui=classic overrides a stored 'beta' and returns to classic.
  const ctxClassic = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctxClassic.addInitScript(() => {
    localStorage.setItem('nimbooks:ui', 'beta')
  })
  const pc = await ctxClassic.newPage()
  await mockValidators(pc)
  await pc.goto(BASE + '/?ui=classic', { waitUntil: 'domcontentloaded' })
  await pc.waitForTimeout(1500)
  await dismissTour(pc)
  check('(e) ?ui=classic beats a stored beta', (await pc.locator('.version-badge').first().innerText()).trim() === VERSION)

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})