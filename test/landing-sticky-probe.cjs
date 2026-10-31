// Landing sticky-column probe (firefox). Desktop only: the left intro column
// must stay on screen while the explorer scrolls, the feature list must pin,
// the sticky column must stay inside its grid row, and the page must never
// scroll sideways. Phones must keep the plain static intro.
//
// (a) is checked while the explorer is on screen AND the intro is pinned. When
// the first grid row ends, the intro is pushed out with the explorer: that is
// the specified "both columns scroll away together" release, not a sticky
// failure, and the same pixels cannot stay both on screen and inside the row.
//
// Usage: NODE_PATH=/root/projects/mykopi-my/node_modules node test/landing-sticky-probe.cjs [baseUrl]
const { firefox } = require('playwright')

const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '')
const DESKTOPS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
]
const PHONE = { width: 390, height: 844 }

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

const load = async (page) => {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.learn-list', { timeout: 20000 })
  await page.waitForTimeout(500)
}

const facts = (page) =>
  page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { top: b.top, bottom: b.bottom, height: b.height }
    }
    const intro = document.querySelector('.landing-intro')
    const explorer = document.querySelector('.learn-explorer')
    const how = document.querySelector('.learn-how')
    const list = document.querySelector('.learn-list')
    const buttons = [...document.querySelectorAll('.connect-panel button')]
      .filter((b) => /continue with nimiq hub|try with a sample wallet/i.test(b.textContent || ''))
      .map(rect)
    return {
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
      docWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      intro: rect(intro),
      introTop: intro ? parseFloat(getComputedStyle(intro).top) : null,
      explorer: rect(explorer),
      how: rect(how),
      list: rect(list),
      buttons,
    }
  })

;(async () => {
  const browser = await firefox.launch()

  console.log('\nDesktop: scroll in 100px steps, explorer on screen')
  console.log('viewport   (a) sign-in  (b) no overlap  (c) no h-scroll  list pinned @700')
  for (const vp of DESKTOPS) {
    const page = await browser.newPage({ viewport: vp })
    await load(page)
    const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    const ys = []
    for (let y = 0; y <= maxScroll; y += 100) ys.push(y)
    if (ys[ys.length - 1] !== maxScroll) ys.push(maxScroll)

    const bad = { signIn: [], overlap: [], width: [], list: [] }
    for (const y of ys) {
      await page.evaluate((top) => window.scrollTo(0, top), y)
      await page.waitForTimeout(20)
      const f = await facts(page)
      const explorerOnScreen = f.explorer && f.explorer.top < f.innerHeight && f.explorer.bottom > 0
      // The intro is pinned until its grid row runs out. Before that point the
      // sticky top is the value Landing.tsx computed; after it the intro is
      // released and travels with the row bottom.
      const expectedTop = Math.min(16, f.innerHeight - f.intro.height - 16)
      const pinned = f.intro.top >= expectedTop - 1
      if (explorerOnScreen && pinned) {
        for (const b of f.buttons) {
          if (!(b.top >= -0.5 && b.bottom <= f.innerHeight + 0.5)) {
            bad.signIn.push(`y=${y} ${Math.round(b.top)}..${Math.round(b.bottom)}`)
          }
        }
      }
      if (f.intro.bottom > f.how.top + 0.5) {
        bad.overlap.push(`y=${y} intro=${Math.round(f.intro.bottom)} how=${Math.round(f.how.top)}`)
      }
      if (f.docWidth !== f.clientWidth) bad.width.push(`y=${y} ${f.docWidth}/${f.clientWidth}`)
    }

    // The list pins exactly at its 16px top once the explorer starts moving.
    await page.evaluate(() => window.scrollTo(0, 700))
    await page.waitForTimeout(20)
    const lf = await facts(page)
    if (!lf.list || Math.abs(lf.list.top - 16) > 1) {
      bad.list.push(`top=${lf.list ? Math.round(lf.list.top) : 'missing'}`)
    }

    check(
      `${vp.width}x${vp.height} (a) sign-in fully visible while explorer is on screen`,
      bad.signIn.length === 0,
      bad.signIn.slice(0, 3).join(' | ')
    )
    check(
      `${vp.width}x${vp.height} (b) intro bottom never past .learn-how top`,
      bad.overlap.length === 0,
      bad.overlap.slice(0, 3).join(' | ')
    )
    check(
      `${vp.width}x${vp.height} (c) document scrollWidth == clientWidth`,
      bad.width.length === 0,
      bad.width.slice(0, 3).join(' | ')
    )
    check(
      `${vp.width}x${vp.height} list pinned at top:16 at scrollY 700`,
      bad.list.length === 0,
      bad.list.join(' | ')
    )
    await page.close()
  }

  // Phone stays exactly as it was: no sticky position at all.
  {
    const page = await browser.newPage({ viewport: PHONE })
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.learn-card', { timeout: 20000 })
    const phone = await page.evaluate(() => {
      const intro = document.querySelector('.landing-intro')
      const cs = getComputedStyle(intro)
      return {
        position: cs.position,
        top: cs.top,
        varSet: intro.style.getPropertyValue('--intro-sticky-top'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    check('390x844 (d) .landing-intro computed position is static', phone.position === 'static', phone.position)
    check('390x844 (d) no intro sticky offset was written', phone.varSet === '', JSON.stringify(phone.varSet))
    check('390x844 no horizontal overflow', phone.overflow <= 0, `overflow=${phone.overflow}`)
    await page.close()
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
