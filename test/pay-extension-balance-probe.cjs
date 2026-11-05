// Nimiq Pay HTLC extension balance, with every RPC stubbed (firefox).
//
// The reported bug: a Pay user's Overview read 0 NIM although the wallet held
// NIM. Pay keeps the money in one HTLC contract and extends it every few days
// by funding a brand-new contract straight from the old one, then the old one
// is pruned to an empty basic account. A restored Pay session reuses the SAVED
// remote address, which is stale within days, so it reads back as basic with
// balance 0. The app must treat that as unknown, follow the extension from the
// settled contract's history (refund address prefix in the creation data) and
// read the live successor's balance.
//
// Case 1: stale remote, basic -> C1 (settled) -> C2 (live, 123.45 NIM).
// Case 2 (control, no extension): stale remote, basic -> C1 (live, 50 NIM),
// where the balance must come from the plain contract scan as before.
//
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/pay-extension-balance-probe.cjs <baseUrl>
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const PAY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'
const ADDR = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const FLAT = ADDR.replace(/\s+/g, '')
const STALE = 'NQ98 TEYP DYB3 QC0A K5TV 3DS1 J41M 3PG5 MMG2'
const STALE_FLAT = STALE.replace(/\s+/g, '')
const C1 = 'NQ27 QCTR DRNT 1YF1 9E7F XTL1 7Q26 JF96 BENU'
const C1_FLAT = C1.replace(/\s+/g, '')
const C2 = 'NQ37 095H KLEG LTHP 7BNA H31G QSU1 RMR6 TRU7'
const C2_FLAT = C2.replace(/\s+/g, '')
// The contract Pay rotates to through the SDK's accountsChanged event.
const C3 = 'NQ62 68D7 RQHN MSTR 1Y0T SY1P HU89 5QJ5 YV05'
const C3_FLAT = C3.replace(/\s+/g, '')
// Refund address of every Pay HTLC (the 20 byte HTLC sender in the creation
// data), i.e. NQ82's own address bytes.
const OWN_HEX = '343fcb7b9c015b50d4ef06a526904eb72da9ba99'
const LIVE_LUNA = 12345000 // 123.45 NIM
const CONTROL_LUNA = 5000000 // 50 NIM
let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : ' :: ' + info}`)
}
const flat = (a) => a.replace(/\s+/g, '')
const nim = (luna) => luna / 100000

// One row as the index returns it (getNimiqTransactions maps `from`/`to` and
// `recipientData`), with the given recipientData prefix.
const row = (sender, recipient, luna, toType, dataPrefix) => ({
  hash: `stub-${sender}-${recipient}`.replace(/\s+/g, ''),
  from: flat(sender),
  to: flat(recipient),
  value: String(luna),
  fee: '0',
  timestamp: 1790000000000,
  toType,
  executionResult: true,
  ...(dataPrefix ? { recipientData: dataPrefix + '0'.repeat(64) } : {}),
})

async function openCase(browser, { c1Account, c1Rows }) {
  // Mutable chain state for the rotation case: when the host announces the new
  // remote, Pay has moved the money, so C2 settles and its history carries the
  // extension into C3. The route handlers read this object on every request.
  const state = {
    c2Account: { address: C2_FLAT, type: 'htlc', balance: LIVE_LUNA, sender: FLAT, recipient: FLAT, timeout: 0 },
    c2Rows: [],
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  await ctx.addInitScript(
    ([addr, stale]) => {
      localStorage.setItem(
        'nimbooks:session',
        JSON.stringify({ provider: 'pay', nimiqAddress: addr, remoteAddress: stale, view: 'overview' })
      )
      localStorage.setItem('nimbooks:countConsent', 'no')
      window.nimiqPay = {}
      window.nimiq = {
        listAccounts: async () => [addr, stale],
        isConsensusEstablished: async () => true,
        getBlockNumber: async () => 1000000,
        // SDK 0.2.5: the host announces a fresh remote account when Pay
        // extends its HTLC. Captured so the probe can fire it.
        on: (event, cb) => {
          if (event !== 'accountsChanged') return
          window.__payAccountsListeners = window.__payAccountsListeners || []
          window.__payAccountsListeners.push(cb)
        },
      }
    },
    [ADDR, STALE]
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) return route.continue()
    if (!url.includes('rpc.nimiqwatch.com')) {
      // Every other API (rates, validators, rewards) is noise for this probe.
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: 'null',
      })
    }
    let req = {}
    try {
      req = JSON.parse(route.request().postData() || '{}')
    } catch {}
    const reply = (payload) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }),
      })
    const at = String(req.params?.[0] ?? '').replace(/\s+/g, '').toUpperCase()
    if (req.method === 'getAccountByAddress') {
      if (at === FLAT) return reply({ result: { data: { address: FLAT, type: 'basic', balance: 0 } } })
      // The saved remote address: Pay has long since moved on, the contract is
      // pruned and reads back as an empty basic account.
      if (at === STALE_FLAT) return reply({ result: { data: { address: STALE_FLAT, type: 'basic', balance: 0 } } })
      if (at === C1_FLAT) return reply({ result: { data: c1Account } })
      if (at === C2_FLAT) return reply({ result: { data: state.c2Account } })
      if (at === C3_FLAT)
        return reply({
          result: {
            data: { address: C3_FLAT, type: 'htlc', balance: 7700000, sender: FLAT, recipient: FLAT, timeout: 0 },
          },
        })
      return reply({ result: { data: { address: at, type: 'basic', balance: 0 } } })
    }
    if (req.method === 'getTransactionsByAddress') {
      // The walk pages on the oldest hash as the cursor; a non-null startAt is
      // "older than this", and every fixture fits in the first page.
      if (req.params?.[2] != null) return reply({ result: { data: [] } })
      if (at === FLAT)
        return reply({ result: { data: [row(ADDR, C1, 100 * 100000, 2)] } })
      if (at === C1_FLAT) return reply({ result: { data: c1Rows } })
      if (at === C2_FLAT) return reply({ result: { data: state.c2Rows } })
      return reply({ result: { data: [] } })
    }
    if (req.method === 'getStakerByAddress')
      return reply({ error: { code: 1, message: `No staker with address: ${at}` } })
    return reply({ result: { data: null } })
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await page.waitForSelector('.nim-tile .value', { timeout: 30000 })
  return { ctx, page, errors, state }
}

async function readBalance(page) {
  try {
    return (await page.locator('.nim-tile .value').first().innerText()).trim()
  } catch {
    return ''
  }
}

// Poll for `expected` NIM. `stabilityMs` then keeps watching: once the figure
// has landed it must never drop back to a false 0 (the heartbeat re-runs the
// whole archive pass every 10s, so one full tick is observed).
async function waitForBalance(page, expectedNim, { timeoutMs = 30000, stabilityMs = 0 } = {}) {
  const seen = []
  const want = `${expectedNim} NIM`
  const t0 = Date.now()
  const note = (text) => {
    if (!text || seen[seen.length - 1] === text) return
    seen.push(text)
  }
  let landed = false
  while (Date.now() - t0 < timeoutMs) {
    const text = await readBalance(page)
    note(text)
    if (text === want) {
      landed = true
      break
    }
    await page.waitForTimeout(250)
  }
  if (!landed) return { landed, seen, stable: [] }
  const stable = []
  const watchUntil = Date.now() + stabilityMs
  while (Date.now() < watchUntil) {
    const text = await readBalance(page)
    if (text && stable[stable.length - 1] !== text) stable.push(text)
    await page.waitForTimeout(250)
  }
  return { landed, seen, stable }
}

;(async () => {
  const browser = await firefox.launch()

  // --- Case 1: extension chain, stale saved remote ---
  {
    const { ctx, page, errors, state } = await openCase(browser, {
      c1Account: { address: C1_FLAT, type: 'basic', balance: 0 }, // settled (pruned)
      c1Rows: [
        // The extension: C1 funds C2 directly, refund address = the user.
        row(C1, C2, 0, 2, OWN_HEX),
      ],
    })
    const res = await waitForBalance(page, nim(LIVE_LUNA), { stabilityMs: 13000 })
    check('extension: Overview shows 123.45 NIM', res.landed, res.seen.join(' -> ').slice(0, 400))
    check(
      'extension: never settles on 0 NIM',
      !res.stable.some((t) => t === '0 NIM'),
      res.stable.join(' -> ').slice(0, 400)
    )
    check('extension: still 123.45 NIM after a heartbeat', res.stable.every((t) => t === '123.45 NIM'), res.stable.join(' -> '))
    // The discovery ran for real: the settled predecessor is on the shelf.
    const shelf = await page.evaluate(
      (k) => {
        try {
          return JSON.parse(localStorage.getItem(k) || 'null')
        } catch {
          return null
        }
      },
      `nimbooks:htlc-archive:${FLAT}`
    )
    const finals = shelf ? Object.keys(shelf.contracts || {}) : []
    check('extension: settled C1 archived, live C2 only in its balance', finals.includes(C1_FLAT) && !finals.includes(C2_FLAT), finals.join(','))

    // The host rotates the remote account (Pay extended C2 into C3): the SDK's
    // accountsChanged must move the session and the balance with it. C2 settles
    // and hands its money to C3, so its old "live" balance (123.45) must be
    // retired: adding it to the fresh 77 would show 200.45.
    state.c2Account = { address: C2_FLAT, type: 'basic', balance: 0 }
    state.c2Rows = [row(C2, C3, 0, 2, OWN_HEX)]
    const listeners = await page.evaluate(
      ([addr, next]) => {
        const all = window.__payAccountsListeners || []
        for (const cb of all) cb([addr, next])
        return all.length
      },
      [ADDR, C3]
    )
    check('accountsChanged: listener registered once', listeners === 1, String(listeners))
    const rotated = await waitForBalance(page, nim(7700000), { timeoutMs: 25000, stabilityMs: 13000 })
    check(
      'accountsChanged: balance follows the new remote (77 NIM, no double count)',
      rotated.landed && rotated.stable.every((t) => t === '77 NIM'),
      [...rotated.seen, '---', ...rotated.stable].join(' -> ').slice(0, 400)
    )
    const saved = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('nimbooks:session') || 'null')
      } catch {
        return null
      }
    })
    check('accountsChanged: session saved with the new remote', !!saved && saved.remoteAddress === C3, JSON.stringify(saved))
    check('extension: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // --- Case 2 (control): no extension, the plain contract scan still answers ---
  {
    const { ctx, page, errors } = await openCase(browser, {
      c1Account: { address: C1_FLAT, type: 'htlc', balance: CONTROL_LUNA, sender: FLAT, recipient: FLAT },
      c1Rows: [],
    })
    const res = await waitForBalance(page, nim(CONTROL_LUNA), { stabilityMs: 5000 })
    check('control: Overview shows 50 NIM (no regression)', res.landed, res.seen.join(' -> ').slice(0, 400))
    check('control: never settles on 0 NIM', !res.stable.some((t) => t === '0 NIM'), res.stable.join(' -> '))
    check('control: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.log('FAIL harness:', e.message)
  process.exit(1)
})
