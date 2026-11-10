// Dock clearance probe (firefox): on every tab, the last line of content must
// scroll clear of the floating tab bar, with no inset and with a phone that
// reports a 50px nav-bar inset (simulated by re-declaring the BUILT .tabs and
// .app rules with env(safe-area-inset-bottom) replaced by 50px, so the shipped
// formula is what gets tested).
//
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/dock-clearance-probe.cjs <baseUrl>
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' :: ' + info : ''}`)
}

const SIMULATE_INSET = (px) => `(() => {
  const css = []
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (const r of rules) {
      if (!r.selectorText || !/safe-area-inset-bottom/.test(r.cssText)) continue
      if (r.selectorText !== '.tabs' && r.selectorText !== '.app') continue
      css.push(r.cssText.replace(/env\\(safe-area-inset-bottom(,\\s*0px)?\\)/g, '${px}px'))
    }
  }
  const s = document.createElement('style')
  s.id = 'sim-inset'
  s.textContent = css.join('\\n')
  document.head.appendChild(s)
  return css.length
})()`

const MEASURE = `(() => {
  window.scrollTo(0, document.scrollingElement.scrollHeight)
  const tabs = document.querySelector('.tabs')
  if (!tabs) return null
  const dockTop = tabs.getBoundingClientRect().top
  let maxBottom = 0
  let lastText = ''
  const walker = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const n = walker.currentNode
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (!el || el.closest('.tabs') || el.closest('.modal-overlay')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const rect = range.getBoundingClientRect()
    if (rect.height === 0) continue
    if (rect.bottom > maxBottom) { maxBottom = rect.bottom; lastText = n.textContent.trim().slice(0, 40) }
  }
  return { dockTop: Math.round(dockTop), lastBottom: Math.round(maxBottom), lastText }
})()`

;(async () => {
  const browser = await firefox.launch()
  for (const inset of [0, 50]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByText('Try with a sample wallet').first().click()
    await page.waitForSelector('.tabs', { timeout: 30000 })
    await page.waitForTimeout(12000) // let the sample wallet's books load
    if (inset) {
      const n = await page.evaluate(SIMULATE_INSET(inset))
      check(`inset ${inset}: built .tabs and .app rules found and re-declared`, n === 2, `rules=${n}`)
    }
    const tabNames = await page.locator('.tabs .tab').allInnerTexts()
    for (let i = 0; i < tabNames.length; i++) {
      await page.locator('.tabs .tab').nth(i).click()
      await page.waitForTimeout(1500)
      const m = await page.evaluate(MEASURE)
      await page.waitForTimeout(300)
      const m2 = await page.evaluate(MEASURE)
      const r = m2 || m
      check(
        `inset ${inset}: ${tabNames[i].trim()} last line clears the dock`,
        !!r && r.lastBottom <= r.dockTop,
        r ? `last "${r.lastText}" bottom ${r.lastBottom} vs dock top ${r.dockTop}` : 'no dock'
      )
    }
    await ctx.close()
  }
  await browser.close()
  console.log(`${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
