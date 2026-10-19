// Shared helpers for test/regression-lite.cjs's statement / tax / load-older
// legs. Pure functions plus tiny Playwright wrappers; no state of its own.
// Pay-session seeding mirrors test/statement-pay-probe.cjs.

const RPC_URL = 'https://rpc.nimiqwatch.com'

// The app's plain 1,000-row history walk (src/lib/chain.ts
// walkTransactionHistory) paces 250ms per page, and the nimiqwatch RPC's
// rate limiter blocks that burst around page 16 of 20 (measured repeatedly:
// "Rate limit exceeded" at ~800 rows, while the same walk at 750ms pacing
// completes all 20 pages). A partial slot makes the app's heartbeat re-walk
// from scratch every 10s, so from this environment the plain loader cannot
// reach the 1,000-row cap on its own. To exercise the cap UI deterministically
// this helper pulls the same window (20 pages x 50, app row mapping) at the
// tolerated pace, so the test can hand the browser exactly the cache slot one
// successful plain walk would have written.
async function fetchTxWindowRows(addr, paceMs = 750) {
  const flat = addr.replace(/\s+/g, '')
  const rpcCall = async (cursor) => {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransactionsByAddress', params: [flat, 50, cursor] }),
    })
    if (!res.ok) throw new Error('RPC HTTP ' + res.status)
    const json = await res.json()
    if (json.error) throw new Error('RPC ' + (json.error.message || 'error') + (json.error.data ? ': ' + JSON.stringify(json.error.data).slice(0, 60) : ''))
    return json.result && json.result.data ? json.result.data : json.result
  }
  let rows = []
  for (let attempt = 1; attempt <= 3; attempt++) {
    rows = []
    let cursor = null
    try {
      for (let i = 0; i < 20; i++) {
        const page = await rpcCall(cursor)
        if (!Array.isArray(page)) break
        rows.push(...page)
        if (!page.length || rows.length >= 1000) break
        const oldest = page[page.length - 1]
        if (!oldest || !oldest.hash || oldest.hash === cursor) break
        cursor = oldest.hash
        if (i < 19) await new Promise((r) => setTimeout(r, paceMs))
      }
      if (rows.length >= 1000) return rows.slice(0, 1000)
      throw new Error('walk reached ' + rows.length + ' rows, not the 1,000 cap')
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise((r) => setTimeout(r, 30000)) // rate limiter cool-down
    }
  }
  throw new Error('unreachable')
}

// Map raw RPC rows to the NimiqTx shape exactly like getNimiqTransactions in
// src/lib/chain.ts, so a seeded slot is what the app itself would have cached.
function mapTxRows(rawRows) {
  return rawRows.map((t) => ({
    hash: t.hash || '',
    sender: t.from || t.fromAddress || '',
    recipient: t.to || t.toAddress || '',
    value: String(t.value || '0'),
    fee: String(t.fee || '0'),
    timestamp: typeof t.timestamp === 'number' && t.timestamp < 1e11 ? Math.round(t.timestamp * 1000) : t.timestamp,
    data: t.recipientData || t.senderData || undefined,
    blockNumber: t.blockNumber || t.blockHeight,
    proof: t.proof || undefined,
    executionResult: t.executionResult,
    toType: t.toType === undefined ? 0 : t.toType,
  }))
}

const PAY_UA =
  'Mozilla/5.0 (Linux; Android 16; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 NimiqPay/2.0.3'

// New context seeded as a Nimiq Pay session for `addr`, on the dashboard with
// the Export tab open and (best effort) the statement rendered. The returned
// page has NO listeners yet, so callers can attach request/pageerror capture
// before any network traffic: use the onNewPage hook for that. `cappedSeed`
// (optional) pre-seeds one tx-cache slot (the value writeTxCache in
// src/lib/chain.ts writes: { address, at, txs }) so the plain loader serves a
// full 1,000-row window without its own walk.
async function openPayExport(browser, base, addr, onNewPage, cappedSeed) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: PAY_UA,
  })
  await ctx.addInitScript(([a, seed]) => {
    localStorage.setItem(
      'nimbooks:session',
      JSON.stringify({ provider: 'pay', nimiqAddress: a, view: 'dashboard' })
    )
    if (seed) {
      try {
        localStorage.setItem(seed.key, JSON.stringify(seed.entry))
      } catch {
        /* seed too large for the slot - the natural walk applies */
      }
    }
  }, [addr, cappedSeed || null])
  const page = await ctx.newPage()
  if (onNewPage) onNewPage(page)
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForSelector('.topbar', { timeout: 30000 })
  const exportTab = page.locator('.tab').filter({ hasText: /export/i }).first()
  await exportTab.click()
  // Statement builds after the first paint; the initial 1,000-row walk on the
  // public chain can take a while, so fail with a message instead of hanging.
  await page
    .waitForSelector('.statement-summary', { timeout: 90000 })
    .catch(() => {
      throw new Error('statement card never rendered its summary for ' + addr)
    })
  return { ctx, page }
}

// The Tax-year statement card as a locator: scoped by its label text, since
// the tax card reuses .statement-summary for its rows.
const statementCard = (page) =>
  page.locator('.card').filter({ hasText: /tax-year statement/i }).first()

const taxCard = (page) => page.locator('.tax-card').first()

// The Load older history button inside the statement card, if present.
const loadOlderButton = (page) =>
  statementCard(page).locator('button').filter({ hasText: /load older history/i })

// Read every .statement-summary .row of a card as [label, value] innerText
// pairs (innerText, so CSS-uppercased labels are compared case-insensitively).
async function summaryRows(card) {
  return card
    .locator('.statement-summary .row')
    .evaluateAll((rows) =>
      rows.map((r) => [...r.querySelectorAll('span')].slice(0, 2).map((s) => s.innerText))
    )
}

// Find a row by label, case-insensitively.
function rowByLabel(rows, label) {
  const wanted = label.toLowerCase()
  return rows.find((r) => String(r[0] || '').trim().toLowerCase() === wanted) || null
}

// Everything non-numeric stripped: "123.45678 NIM" -> 123.45678,
// "$12,345.67" -> 12345.67, "USD -1.23" -> -1.23.
function num(s) {
  return Number(String(s || '').replace(/[^0-9.\-]/g, ''))
}

// Full-year restake reward total (NIM) for `year`, straight from Nimiq Watch
// v2 - the same open data the app reads. Keeps only windows inside the year
// (the API leaks a row past each edge). Returns 0 for a non-staker.
async function restakeYearNim(addr, year) {
  const flat = addr.replace(/\s+/g, '')
  const res = await fetch(
    `https://v2.nimiqwatch.com/api/v2/staker/${flat}/events/restake-grouped` +
      `?from=${year}-01-01&to=${Number(year) + 1}-01-01`
  )
  if (!res.ok) throw new Error('nimiqwatch restake API HTTP ' + res.status)
  const json = await res.json()
  const groups = Array.isArray(json && json.groups) ? json.groups : []
  return (
    groups
      .filter((g) => typeof g.time_window === 'string' && g.time_window.startsWith(String(year)))
      .reduce((s, g) => s + (Number(g.aggregated_value) || 0), 0) / 1e5
  )
}

module.exports = {
  PAY_UA,
  openPayExport,
  statementCard,
  taxCard,
  loadOlderButton,
  summaryRows,
  rowByLabel,
  num,
  restakeYearNim,
  fetchTxWindowRows,
  mapTxRows,
}