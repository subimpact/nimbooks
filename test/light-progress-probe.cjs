// Firefox probe for the light-client history progress line.
//
// Fresh context, 375x812, real network. Clicks the sample wallet, then checks:
//   (a) a [role=status] line naming the Nimiq network or history appears in 3 s;
//   (b) from the click until history rows render, the page never shows "$0.00";
//   (c) history rows render within 45 s;
//   (d) the progress line is gone within 5 s after the rows;
//   (e) a reload brings the cached rows back within 3 s, before consensus.
// It also saves a 360px-wide screenshot while the line is visible.
//
// Usage: NODE_PATH=<playwright dir> node test/light-progress-probe.cjs [BASE_URL] [SHOT_DIR]
//   NODE_PATH=/root/projects/nimbooks/node_modules:/root/projects/mykopi-my/node_modules \
//     node test/light-progress-probe.cjs http://127.0.0.1:8099 /tmp/shots
const { firefox } = require('playwright')
const path = require('path')
const fs = require('fs')

const BASE = (process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '')
const SHOT_DIR = process.argv[3] || path.join(__dirname, 'tmp')
const ACTIVE_TEXT = /Nimiq network|history/i

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

const progressText = async (page) => {
  const line = page.locator('.history-progress').first()
  return (await line.count()) ? ((await line.innerText()) || '').replace(/\s+/g, ' ').trim() : ''
}

const historyRows = (page) => page.locator('section.history .tx')

;(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const browser = await firefox.launch()
  // Fresh context: no localStorage, no sessionStorage, no cache.
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  await ctx.addInitScript(() => {
    // Keep the consent notice out of the way of the progress line.
    try {
      localStorage.setItem('nimbooks:connect-count', 'no')
    } catch {
      /* storage unavailable */
    }
  })
  const page = await ctx.newPage()

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })

  const start = Date.now()
  await page.locator('button:has-text("sample wallet")').first().click()

  let progressSeenAt = 0
  let shotTaken = false
  let historyClicked = false
  let fakeZero = null
  let rowsAt = 0

  // (b) polls every 250 ms. One loop also catches (a), takes the 360px shot and
  // opens History, so nothing is missed between separate waits.
  const deadline = start + 45_000
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText()
    if (text.includes('$0.00')) {
      fakeZero = text.replace(/\s+/g, ' ').slice(0, 240)
      break
    }
    const line = await progressText(page)
    if (line && ACTIVE_TEXT.test(line)) {
      if (!progressSeenAt) progressSeenAt = Date.now()
      if (!shotTaken) {
        // A 360px phone shot while the line is up. The line is above the
        // balance, so this is the first dashboard viewport.
        await page.setViewportSize({ width: 360, height: 812 })
        await page.screenshot({ path: path.join(SHOT_DIR, 'light-progress-360.png') })
        await page.setViewportSize({ width: 375, height: 812 })
        shotTaken = true
      }
      if (!historyClicked) {
        const tab = page.locator('button[data-tour="history-tab"]').first()
        if (await tab.count()) {
          await tab.click()
          historyClicked = true
        }
      }
    }
    if ((await historyRows(page).count()) > 0) {
      rowsAt = Date.now()
      break
    }
    await page.waitForTimeout(250)
  }

  check(
    '(a) progress line appears within 3 s of opening the sample wallet',
    progressSeenAt > 0 && progressSeenAt - start <= 3000,
    `${progressSeenAt ? progressSeenAt - start : 'never'} ms`
  )
  check('(b) the page never shows "$0.00" while history loads', fakeZero === null, fakeZero || '')
  check('(c) history rows render within 45 s', rowsAt > 0 && rowsAt - start <= 45_000, rowsAt ? `${rowsAt - start} ms` : 'none')
  check('(shot) 360px screenshot saved while the line is visible', shotTaken, path.join(SHOT_DIR, 'light-progress-360.png'))
  if (historyClicked) check('(history) History opened and shows rows', rowsAt > 0)
  else check('(history) History tab found during the load', false, 'tab missing or line vanished first')

  // (d) The done line holds for 2 s, then hides. Nothing may outlive it.
  let lineGoneAt = 0
  const goneDeadline = Date.now() + 5000
  while (Date.now() < goneDeadline) {
    if ((await page.locator('.history-progress').count()) === 0) {
      lineGoneAt = Date.now()
      break
    }
    await page.waitForTimeout(100)
  }
  check(
    '(d) progress line is gone within 5 s after the rows',
    rowsAt > 0 && lineGoneAt > 0 && lineGoneAt - rowsAt <= 5000,
    lineGoneAt && rowsAt ? `${lineGoneAt - rowsAt} ms` : 'still visible'
  )

  // (e) Reload in the same tab: the localStorage tx cache must paint before a
  // new consensus round finishes. The saved view was History, so rows should
  // return on the same screen.
  const beforeReloadRows = await historyRows(page).count()
  const reloadAt = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded' })
  let cachedAt = 0
  let cachedRows = 0
  let reloadLine = ''
  const cachedDeadline = reloadAt + 3000
  while (Date.now() < cachedDeadline) {
    cachedRows = await historyRows(page).count()
    if (cachedRows > 0) {
      cachedAt = Date.now()
      reloadLine = await progressText(page)
      break
    }
    await page.waitForTimeout(100)
  }
  check('(e) reload shows cached history within 3 s', cachedRows > 0 && cachedAt - reloadAt <= 3000, cachedAt ? `${cachedAt - reloadAt} ms, ${cachedRows} rows` : 'no rows')
  check(
    '(e) cached rows land before the load reports done (line still downloading or connecting)',
    cachedRows > 0 && ACTIVE_TEXT.test(reloadLine),
    reloadLine || 'no progress line'
  )
  check('(e) the cached list was non-empty before the reload', beforeReloadRows > 0, beforeReloadRows)

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
