// History filter probe (firefox). Checks the chip row, the reward month
// grouping, the summary arithmetic against the Export tab's statement, and the
// copy gates on the sample wallet.
//
// Usage: NODE_PATH=<dir containing playwright> node test/history-filter-probe.cjs [BASE_URL]
// Firefox only: Chromium's compositor crashes on some kernels (see regression-lite).
const { firefox } = require('playwright')
const {
  statementCard,
  summaryRows,
  rowByLabel,
  num,
} = require('./lib/regression-lite-helpers.cjs')

const BASE = (process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '')
const EM_DASH = '\u2014'
// Environment noise, not page errors: a plain static server has no Pages
// Functions, and CoinGecko rate-limits the sandbox. Uncaught exceptions and any
// other console error still fail the probe.
// The light client (v1.41.2) dials many Nimiq peers; some are always offline,
// and the browser logs each failed WebSocket as a console error.
const ENV_NOISE = /Cross-Origin|CORS|429|404|Failed to load|XML Parsing Error|NS_ERROR|coingecko|status of 404|can.t establish a connection to the server at wss:|connection to wss:.* was interrupted/i

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

// The tour offer can appear (and re-appear) after the sample wallet loads; it
// is never what this probe tests, so dismiss it before reading the DOM.
async function dismissTour(page) {
  for (let i = 0; i < 3; i++) {
    // Scoped to the offer card: the dashboard's stake-this-payment prompt has
    // its own "Not now", and clicking that one leaves the offer up.
    const btn = page.locator('.tour-offer-card button:has-text("Not now")').first()
    if ((await btn.count()) === 0) return
    await btn.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
  }
}

// Chip label plus its row count: "Rewards 214" -> 214.
const chipFacts = (page) =>
  page.locator('.history-filters button').evaluateAll((buttons) =>
    buttons.map((b) => {
      const text = (b.innerText || '').trim().replace(/\s+/g, ' ')
      const m = /^(.*?)\s+(\d+)$/.exec(text)
      return {
        text,
        label: m ? m[1] : text,
        count: m ? Number(m[2]) : null,
        active: b.getAttribute('aria-pressed') === 'true',
        className: b.className,
      }
    })
  )

const chipByLabel = (chips, label) => chips.find((c) => c.label === label)

const clickChip = async (page, label) => {
  const chip = page.locator('.history-filters button').filter({ hasText: new RegExp(`^${label} `) }).first()
  await chip.click()
  await page.waitForTimeout(500)
}

(async () => {
  const browser = await firefox.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  // The count notice must not cover the app mid-probe.
  await ctx.addInitScript(() => {
    localStorage.setItem('nimbooks:connect-count', 'no')
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (!ENV_NOISE.test(m.text())) errors.push('console: ' + m.text())
  })

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const sample = page.locator('button:has-text("sample wallet")').first()
    check('landing offers the sample wallet', (await sample.count()) > 0)
    if ((await sample.count()) > 0) {
      await sample.click()
      await page.waitForSelector('.topbar', { timeout: 60000 })
    }
    // The offer lands after the first refresh, which takes a few seconds on a
    // busy sample wallet: wait for it rather than racing it.
    await page.waitForSelector('.tour-offer-card', { timeout: 20000 }).catch(() => {})
    await dismissTour(page)
    // Let the first history read and the reward chunks land.
    await page.waitForTimeout(6000)
    await dismissTour(page)

    // Open History.
    const historyTab = page.locator('[data-tour="history-tab"]').first()
    check('History tab is in the dock', (await historyTab.count()) > 0)
    await historyTab.click()
    const filters = page.locator('.history-filters')
    await filters.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    check('History renders the filter chip row', (await filters.count()) > 0)
    check(
      'chip row is a labelled group',
      (await page.locator('.history-filters[role="group"][aria-label="Filter transactions"]').count()) > 0
    )

    let chips = await chipFacts(page)
    const allChip = chipByLabel(chips, 'All')
    check('All chip is present and active by default', !!allChip && allChip.active && /active/.test(allChip.className), JSON.stringify(chips))
    check('All chip always shows a count', !!allChip && Number.isInteger(allChip.count) && allChip.count > 0, JSON.stringify(allChip))

    const rewardsChip = chipByLabel(chips, 'Rewards')
    check('Rewards chip has a positive count', !!rewardsChip && rewardsChip.count > 0, JSON.stringify(chips))
    const receivedChip = chipByLabel(chips, 'Received')
    const sentChip = chipByLabel(chips, 'Sent')
    check(
      'All count is at least Received and Sent (the full list holds both)',
      !!allChip && !!receivedChip && !!sentChip && allChip.count >= receivedChip.count && allChip.count >= sentChip.count,
      JSON.stringify(chips)
    )

    // Summary scope line under the chips.
    const scope = await page.locator('.history-scope').innerText().catch(() => '')
    check(
      'summary carries the loaded-history scope line',
      /In the history loaded on this device\./.test(scope),
      JSON.stringify(scope)
    )

    // Rewards: month rows, newest open, collapse and expand.
    await clickChip(page, 'Rewards')
    chips = await chipFacts(page)
    check('Rewards chip is active after the click', !!chipByLabel(chips, 'Rewards')?.active, JSON.stringify(chips))
    const months = page.locator('.reward-month')
    let monthCount = 0
    for (let i = 0; i < 40; i++) {
      monthCount = await months.count()
      if (monthCount > 0) break
      await page.waitForTimeout(250)
    }
    check('Rewards shows one row per month', monthCount > 0, String(monthCount))
    const monthText = monthCount > 0 ? await months.first().innerText() : ''
    check(
      'newest month row reads "Month Year" and "N days · X NIM"',
      /[A-Z][a-z]+ \d{4}/.test(monthText) && /\d+ days? · [\d,]+(\.\d+)? NIM/.test(monthText),
      JSON.stringify(monthText.slice(0, 120))
    )
    const firstHead = months.first().locator('.reward-month-head').first()
    check(
      'newest month is expanded by default',
      (await firstHead.getAttribute('aria-expanded')) === 'true' && (await months.first().locator('.tx').count()) > 0
    )
    if (monthCount > 1) {
      const secondExpanded = (await months.nth(1).locator('.reward-month-head').first().getAttribute('aria-expanded')) === 'true'
      check('older months are collapsed by default', !secondExpanded)
    } else {
      check('older months are collapsed by default', true, 'only one month loaded')
    }

    // Collapse the newest month, then open it again. A collapsed month must
    // render none of its daily rows, and both directions must work.
    await firstHead.click()
    await page.waitForTimeout(300)
    check(
      'collapsing the newest month hides its daily rows',
      (await firstHead.getAttribute('aria-expanded')) === 'false' && (await months.first().locator('.tx').count()) === 0
    )
    await firstHead.click()
    await page.waitForTimeout(300)
    check(
      'expanding it again restores the daily rows',
      (await firstHead.getAttribute('aria-expanded')) === 'true' && (await months.first().locator('.tx').count()) > 0
    )

    const historyRewardsText = await page.locator('.history-summary').innerText().catch(() => '')
    // Read the figure after the separator, not `num(text)`: stripping the
    // whole line would glue the day count to the NIM total ("45 days of
    // rewards · 8.89741 NIM" would parse as 458.89741).
    const historyRewardsMatch = /·\s*([\d,]+(?:\.\d+)?)\s*NIM/.exec(historyRewardsText)
    const historyRewards = historyRewardsMatch ? Number(historyRewardsMatch[1].replace(/,/g, '')) : NaN
    check(
      'Rewards summary names the day count and the total',
      /\d+ days? of rewards · [\d,]+(\.\d+)? NIM/.test(historyRewardsText) && historyRewards > 0,
      JSON.stringify(historyRewardsText)
    )

    // The Export tab's tax-year statement, on All time, must agree with the
    // History summary. Both read the same reward rows; the poll covers the
    // statement rebuild that follows the reward chunks landing, which is a
    // load window rather than a different figure.
    const exportTab = page.locator('.tab').filter({ hasText: /export/i }).first()
    await exportTab.click()
    const stmt = statementCard(page)
    await stmt.locator('.statement-summary').first().waitFor({ timeout: 60000 }).catch(() => {})
    const yearSel = stmt.locator('#statementYear')
    if ((await yearSel.count()) > 0) {
      await yearSel.selectOption('all').catch(() => {})
      await page.waitForTimeout(800)
    }
    let statementRewards = 0
    for (let i = 0; i < 120; i++) {
      const row = rowByLabel(await summaryRows(stmt), 'rewards')
      statementRewards = row ? num(row[1]) : 0
      if (statementRewards > 0 && Math.abs(statementRewards - historyRewards) <= 0.00001) break
      await page.waitForTimeout(500)
    }
    check(
      'statement Rewards (All time) equals the History Rewards total to 5 decimals',
      Math.abs(statementRewards - historyRewards) <= 0.00001,
      `statement=${statementRewards} history=${historyRewards}`
    )

    // Back to History, All restores the full list.
    await historyTab.click()
    await filters.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    await clickChip(page, 'All')
    chips = await chipFacts(page)
    check('switching back to All re-activates the All chip', !!chipByLabel(chips, 'All')?.active, JSON.stringify(chips))
    check(
      'All shows the full list again (no month rows, flat rows present)',
      (await page.locator('.reward-month').count()) === 0 && (await page.locator('.history .tx').count()) > 0,
      String(await page.locator('.history .tx').count())
    )
    check(
      'All summary is a plain transaction count',
      /^\d+ transactions?$/.test((await page.locator('.history-summary').innerText().catch(() => '')).trim()),
      JSON.stringify(await page.locator('.history-summary').innerText().catch(() => ''))
    )

    const historyText = await page.locator('.history').innerText().catch(() => '')
    check('no em dash in History rendered text', !historyText.includes(EM_DASH))
    check('History copy has no em dash on the chips either', !(await filters.innerText()).includes(EM_DASH))
  } catch (e) {
    check('probe completed without throwing', false, String(e).slice(0, 160))
  }

  check('zero console errors (CoinGecko/CORS noise filtered)', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\n${pass} passed, ${fail} failed`)
  await ctx.close()
  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
})()
