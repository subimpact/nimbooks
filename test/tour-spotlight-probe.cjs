// Tour spotlight probe (firefox): walks all 9 steps on the sample wallet at
// phone viewports and asserts the ring sits on its target, inside the
// visible area, and for in-page targets clear of the floating dock.
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/tour-spotlight-probe.cjs [BASE_URL]
const { firefox } = require('playwright')
const BASE = process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8099'
const DOCK_IDS = new Set(['request-tab', 'history-tab', 'receipts-tab', 'export-tab'])
const STEP_TARGETS = ['balance', 'earn', 'quick-send', 'quick-receive', 'request-tab', 'history-tab', 'receipts-tab', 'export-tab', null]
let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

async function run(viewport) {
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => localStorage.setItem('nimbooks:connect-count', 'no'))
  const page = await ctx.newPage()
  const tag = `${viewport.width}x${viewport.height}`
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await page.locator('button:has-text("sample wallet")').first().click()
    await page.waitForSelector('.tour-offer-card', { timeout: 60000 })
    await page.locator('.tour-offer-card button:has-text("Let\'s go")').click()
    for (let i = 0; i < STEP_TARGETS.length; i++) {
      await page.waitForSelector('.tour-coach-card', { timeout: 10000 })
      await page.waitForTimeout(700)
      const id = STEP_TARGETS[i]
      const counter = await page.locator('.tour-coach-step').innerText()
      check(`${tag} step ${i + 1}: counter`, counter.replace(/\s+/g, '') === `${i + 1}/9`, counter)
      if (id) {
        const f = await page.evaluate((id) => {
          const el = document.querySelector(`[data-tour="${id}"]`)
          const cut = document.querySelector('.tour-cutout')
          const dock = document.querySelector('.dock, nav.tabs, .tabbar') || document.querySelector('[data-tour="history-tab"]')?.closest('nav,div')
          const r = (e) => (e ? e.getBoundingClientRect().toJSON() : null)
          return { el: r(el), cut: r(cut), dock: r(dock), coach: r(document.querySelector('.tour-coach-card')), vh: window.innerHeight }
        }, id)
        const near = (a, b) => Math.abs(a - b) <= 3
        // Dock tabs: TourHost lifts the ring up to 44px clear of the screen's
        // bottom edge on purpose (edge-to-edge WebViews hide the dock behind
        // the gesture bar), so allow that shift there and nowhere else.
        const dy = DOCK_IDS.has(id) ? 44 : 3
        const onTarget =
          f.el && f.cut && Math.abs(f.el.top - f.cut.top) <= dy && near(f.el.left, f.cut.left) && near(f.el.height, f.cut.height)
        check(`${tag} step ${i + 1} (${id}): ring sits on its target`, !!onTarget, JSON.stringify({ el: f.el && [f.el.top, f.el.bottom], cut: f.cut && [f.cut.top, f.cut.bottom] }))
        // A target taller than the room above the coach card cannot be shown
        // whole: TourHost then keeps its bottom (the buttons) in view and lets
        // the top edge go. Anything else must sit wholly on screen.
        const tooTall = !!f.cut && !!f.coach && f.coach.top > f.vh / 2 && f.cut.height > f.coach.top - 12
        const inView = !!f.cut && (tooTall ? f.cut.bottom > 0 && f.cut.bottom <= f.coach.top + 1 : f.cut.top >= -1) && f.cut.bottom <= f.vh + 1
        check(`${tag} step ${i + 1} (${id}): ring inside the viewport${tooTall ? ' (tall: bottom kept above the card)' : ''}`, inView, JSON.stringify(f.cut))
        if (!DOCK_IDS.has(id)) {
          // The step text talks about the target's buttons: none of them may
          // sit under the coach card (360x640 had the Earn card's covered).
          const covered = await page.evaluate((id) => {
            const card = document.querySelector('.tour-coach-card')?.getBoundingClientRect()
            if (!card) return []
            return [...document.querySelectorAll(`[data-tour="${id}"] button`)]
              .map((b) => ({ t: (b.textContent || '').trim().slice(0, 24), r: b.getBoundingClientRect() }))
              .filter(({ r }) => r.height > 0 && r.bottom > card.top + 1 && r.top < card.bottom - 1)
              .map(({ t }) => t)
          }, id)
          check(`${tag} step ${i + 1} (${id}): no button of the target under the coach card`, covered.length === 0, covered.join(', '))
        }
        if (!DOCK_IDS.has(id) && f.dock && f.cut && f.cut.height < f.vh * 0.55) {
          check(`${tag} step ${i + 1} (${id}): ring clear of the dock`, f.cut.bottom <= f.dock.top + 2, JSON.stringify({ cutBottom: f.cut.bottom, dockTop: f.dock.top }))
        }
      }
      await page.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/tour-${tag}-${i + 1}.png` }).catch(() => {})
      const next = page.locator('.tour-coach-card .btn-primary').first()
      await next.click()
    }
    await page.waitForTimeout(500)
    check(`${tag} tour closes after Done`, (await page.locator('.tour-coach-card').count()) === 0)
  } catch (e) {
    check(`${tag} walk completed without throwing`, false, String(e).slice(0, 300))
  } finally {
    await browser.close()
  }
}

;(async () => {
  for (const vp of [{ width: 390, height: 844 }, { width: 412, height: 780 }, { width: 360, height: 640 }]) await run(vp)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
