// Live refresh probe (firefox): the 10 s heartbeat keeps the books, the statement,
// the crypto tax and the portfolio current without flicker, and pauses while hidden.
// Usage: NODE_PATH=/root/projects/mykopi-my/node_modules node test/live-refresh-probe.cjs [baseUrl] [shotDir]
//
// Real RPC is used throughout. Two things are injected about 12 s in, the way a real
// payment would show up: one extra incoming 12,345 NIM transaction on the newest page
// of getTransactionsByAddress, and the same amount added to the demo wallet's balance
// in getAccountByAddress. The portfolio section also fails one extra-address read on
// purpose, to check that the last good figures stay on screen, marked stale.
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const SHOTS = process.argv[3] || '/tmp'

const DEMO = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
// ImpactZero, the validator that keeps NimBooks running: a valid extra address.
const EXTRA = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const SYNTH_HASH = 'c0ffee'.repeat(10) + 'beef'
const SYNTH_SENDER = 'NQ05 R770 0Y3C BTQN 1L2Y USGF 8JNA 0VLA PLQJ'
const SYNTH_LUNA = 1234500000 // 12,345 NIM
const PAY_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'

const clean = (a) => String(a || '').replace(/\s+/g, '').toUpperCase()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${stamp()}] ${name}${extra ? ' :: ' + extra : ''}`)
}
const note = (msg) => console.log(`     [${stamp()}] ${msg}`)

// What the books say on screen right now.
async function readView(page) {
  return page.evaluate(() => {
    const parseNim = (s) => {
      const m = String(s || '').match(/(-?[\d,]*\.?\d+)\s*NIM/)
      return m ? Number(m[1].replace(/,/g, '')) : null
    }
    const card = document.querySelector('.statement-card')
    const row = (label) => {
      const r = [...(card?.querySelectorAll('.statement-summary .row') || [])].find(
        (x) => x.querySelector('span')?.textContent.trim() === label
      )
      return r ? r.querySelectorAll('span')[1]?.textContent ?? null : null
    }
    const wallet = document.querySelector('.portfolio-card .portfolio-row')
    const liquid = wallet
      ? [...wallet.querySelectorAll('.portfolio-stat')].find(
          (s) => s.querySelector('.stat-label')?.textContent === 'Liquid'
        )?.querySelector('.stat-value')?.textContent
      : null
    // Button labels are uppercased by CSS, so read textContent rather than innerText.
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent).join(' ')
    const m = labels.match(/\((\d+) transactions\)/)
    return {
      received: parseNim(row('Received')),
      closing: parseNim(row('Current balance') ?? row('Closing balance (Dec 31)')),
      count: m ? Number(m[1]) : null,
      walletLiquid: parseNim(liquid),
    }
  })
}

// Extra-address row (second portfolio row): its Liquid text, its stale flag and its error state.
async function readExtra(page) {
  return page.evaluate(() => {
    const row = document.querySelectorAll('.portfolio-card .portfolio-row')[1]
    if (!row) return null
    const liquid = [...row.querySelectorAll('.portfolio-stat')].find(
      (s) => s.querySelector('.stat-label')?.textContent === 'Liquid'
    )?.querySelector('.stat-value')?.textContent
    return {
      liquid: liquid ?? null,
      stale: /Could not refresh/.test(row.innerText),
      error: /Could not load/.test(row.innerText),
      hint: /could not be refreshed/.test(document.querySelector('.portfolio-card')?.innerText || ''),
    }
  })
}

const synthRow = (timestamp) => ({
  hash: SYNTH_HASH,
  blockNumber: 63999000,
  timestamp,
  confirmations: 1,
  size: 139,
  relatedAddresses: [SYNTH_SENDER, DEMO],
  from: SYNTH_SENDER,
  fromType: 0,
  to: DEMO,
  toType: 0,
  value: SYNTH_LUNA,
  fee: 0,
  senderData: '',
  recipientData: '',
  flags: 0,
  validityStartHeight: 63998999,
  proof: 'ab'.repeat(100),
  networkId: 24,
  executionResult: true,
})

;(async () => {
  const browser = await firefox.launch()
  const watchdog = setTimeout(() => {
    console.error('watchdog: probe ran too long')
    process.exit(3)
  }, 14 * 60 * 1000)

  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, userAgent: PAY_UA })
  // A restored Nimiq Pay session on the demo address, plus one extra portfolio address.
  // Visibility is overridable so the probe can hide and show the page.
  await ctx.addInitScript(
    ([addr, extra]) => {
      localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'export' }))
      localStorage.setItem('nimbooks:portfolio:addresses', JSON.stringify([{ address: extra, label: 'ImpactZero' }]))
      let vis = 'visible'
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis })
      window.__setVis = (v) => {
        vis = v
        document.dispatchEvent(new Event('visibilitychange'))
      }
    },
    [DEMO, EXTRA]
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const rpc = [] // every JSON-RPC call the page makes
  const external = [] // price and rate hosts
  const inject = { on: false, failExtra: false, ts: 0 }
  page.on('request', (req) => {
    if (/coingecko|llama\.fi/.test(req.url())) external.push({ t: Date.now(), url: req.url() })
  })
  await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
    const req = route.request()
    let body = null
    try {
      body = JSON.parse(req.postData() || 'null')
    } catch {
      /* not JSON-RPC */
    }
    if (!body || !body.method) return route.continue()
    const method = body.method
    const addr = clean(body.params?.[0])
    const rec = { t: Date.now(), method, addr, status: 200 }
    rpc.push(rec)
    const cors = { 'access-control-allow-origin': '*' }
    if (inject.failExtra && addr === clean(EXTRA) && (method === 'getAccountByAddress' || method === 'getStakerByAddress')) {
      rec.status = 500
      return route.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: '{"error":"injected failure"}' })
    }
    const wantTx = inject.on && method === 'getTransactionsByAddress' && body.params?.[2] === null
    const wantBal = inject.on && method === 'getAccountByAddress' && addr === clean(DEMO)
    if (!wantTx && !wantBal) return route.continue()
    let res
    try {
      res = await route.fetch()
    } catch {
      return route.abort()
    }
    const json = await res.json()
    if (wantTx && Array.isArray(json.result?.data)) json.result.data = [synthRow(inject.ts), ...json.result.data]
    if (wantBal && json.result?.data) json.result.data.balance = Number(json.result.data.balance) + SYNTH_LUNA
    rec.status = res.status()
    return route.fulfill({ response: res, json })
  })

  const count = (from, to, method, addr) =>
    rpc.filter((r) => r.t >= from && r.t < to && r.method === method && (addr === undefined || r.addr === clean(addr))).length
  const lastRpcAt = () => (rpc.length ? rpc[rpc.length - 1].t : 0)

  // ---- 1. Load the Export view and let the books settle ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 20000 })
  await page.locator('.tab', { hasText: 'Export' }).click({ timeout: 8000 })
  await page.waitForSelector('.portfolio-card', { timeout: 10000 })
  await page.waitForSelector('.statement-card .statement-summary', { timeout: 60000 })
  await page.waitForFunction(() => {
    const c = document.querySelector('.tax-card')
    return !!c && !/Computing gains/.test(c.innerText) && !!c.querySelector('.statement-summary')
  }, null, { timeout: 60000 })
  await page.waitForFunction(() => {
    const row = document.querySelectorAll('.portfolio-card .portfolio-row')[1]
    return !!row && !/…/.test(row.querySelector('.portfolio-row-stats')?.innerText || '…')
  }, null, { timeout: 60000 })
  const tBase = Date.now()
  const base = await readView(page)
  const baseExtra = await readExtra(page)
  note(`baseline: received ${base.received} NIM, closing ${base.closing}, history ${base.count}, wallet liquid ${base.walletLiquid}`)
  check('baseline: books loaded', base.received !== null && base.closing !== null && base.count !== null)
  if (SHOTS) await page.locator('.statement-card').screenshot({ path: `${SHOTS}/live-statement-before.png` }).catch(() => {})

  // Flicker watch: a spinner after the first build is a fail. Armed from here on.
  await page.evaluate(() => {
    window.__flicker = { statement: 0, tax: 0 }
    new MutationObserver(() => {
      if (/Building statement/.test(document.querySelector('.statement-card')?.textContent || '')) window.__flicker.statement++
      if (/Computing gains/.test(document.querySelector('.tax-card')?.textContent || '')) window.__flicker.tax++
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })

  // ---- 2. A payment lands ~12 s in: the next heartbeat must show it ----
  await sleep(Math.max(0, 12000 - (Date.now() - tBase)))
  inject.ts = Date.now()
  inject.on = true
  note('injecting one incoming 12,345 NIM payment and the matching balance')
  const deadline = inject.ts + 25000
  const seen = { received: null, count: null, closing: null, wallet: null }
  let after = null
  while (Date.now() < deadline) {
    after = await readView(page)
    const at = (Date.now() - inject.ts) / 1000
    if (!seen.received && after.received !== null && base.received !== null && Math.abs(after.received - base.received - 12345) < 0.001) seen.received = at
    if (!seen.count && after.count === base.count + 1) seen.count = at
    if (!seen.closing && after.closing !== null && base.closing !== null && Math.abs(after.closing - base.closing - 12345) < 0.001) seen.closing = at
    if (!seen.wallet && after.walletLiquid !== null && base.walletLiquid !== null && Math.abs(after.walletLiquid - base.walletLiquid - 12345) < 0.001) seen.wallet = at
    if (seen.received && seen.count && seen.closing && seen.wallet) break
    await sleep(500)
  }
  check(
    'statement received total grows by 12,345 NIM within 25 s (all-time)',
    seen.received !== null,
    seen.received !== null ? `after ${seen.received.toFixed(1)}s, ${base.received} -> ${after.received}` : `${base.received} -> ${after?.received}`
  )
  check(
    'history count grows by 1 within 25 s',
    seen.count !== null,
    seen.count !== null ? `after ${seen.count.toFixed(1)}s, ${base.count} -> ${after.count}` : `${base.count} -> ${after?.count}`
  )
  check(
    'statement closing balance follows the live balance within 25 s',
    seen.closing !== null,
    seen.closing !== null ? `after ${seen.closing.toFixed(1)}s, ${base.closing} -> ${after.closing}` : `${base.closing} -> ${after?.closing}`
  )
  check(
    'portfolio wallet row updates live within 25 s',
    seen.wallet !== null,
    seen.wallet !== null ? `after ${seen.wallet.toFixed(1)}s` : `${base.walletLiquid} -> ${after?.walletLiquid}`
  )
  const tax = await page.evaluate(() => {
    const c = document.querySelector('.tax-card')
    return {
      rendered: !!c && !!c.querySelector('.statement-summary'),
      computing: /Computing gains/.test(c?.innerText || ''),
      ledger: [...(c?.querySelectorAll('button') || [])].some((b) => /Download tax ledger/.test(b.textContent) && !b.disabled),
    }
  })
  check('crypto tax card still rendered, no spinner stuck, ledger enabled', tax.rendered && !tax.computing && tax.ledger, JSON.stringify(tax))
  if (SHOTS) await page.locator('.statement-card').screenshot({ path: `${SHOTS}/live-statement-after.png` }).catch(() => {})

  // ---- 3. Nothing changed: 30 s of heartbeats must not re-read the balances per tick ----
  await sleep(3000)
  const w0 = Date.now()
  await sleep(30000)
  const w1 = Date.now()
  const ticks = count(w0, w1, 'getBlockNumber')
  const perTickTotal = rpc.filter((r) => r.t >= w0 && r.t < w1).length
  note(`no-change window: ${ticks} heartbeats, ${perTickTotal} RPC calls in total`)
  check('no-change window: heartbeat ran', ticks >= 2, `ticks=${ticks}`)
  check(
    'no-change window: statement adds no getAccountByAddress (demo) calls',
    count(w0, w1, 'getAccountByAddress', DEMO) <= ticks,
    `getAccountByAddress=${count(w0, w1, 'getAccountByAddress', DEMO)} ticks=${ticks}`
  )
  check(
    'no-change window: statement adds no getStakerByAddress (demo) calls',
    count(w0, w1, 'getStakerByAddress', DEMO) <= ticks,
    `getStakerByAddress=${count(w0, w1, 'getStakerByAddress', DEMO)} ticks=${ticks}`
  )
  check(
    'no-change window: one history head per tick',
    count(w0, w1, 'getTransactionsByAddress', DEMO) <= ticks,
    `getTransactionsByAddress=${count(w0, w1, 'getTransactionsByAddress', DEMO)} ticks=${ticks}`
  )
  const extNet = external.filter((x) => x.t >= w0 && x.t < w1).length
  check('no-change window: prices not fetched from the network', extNet === 0, `price/rate requests=${extNet}`)
  const flick1 = await page.evaluate(() => window.__flicker)
  check('no flicker: no spinner on the statement or the tax card', flick1.statement === 0 && flick1.tax === 0, JSON.stringify(flick1))

  // ---- 4. Portfolio: the extra address is re-read every 6th heartbeat (~60 s) ----
  const extraReads = () => rpc.filter((r) => r.method === 'getAccountByAddress' && r.addr === clean(EXTRA)).map((r) => r)
  const waitForRead = async (afterT, timeoutMs) => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      const hit = extraReads().find((r) => r.t > afterT)
      if (hit) return hit
      await sleep(500)
    }
    return null
  }
  const passOne = await waitForRead(w1, 75000)
  check('portfolio: extra address re-read in the background', passOne !== null, passOne ? `at ${((passOne.t - t0) / 1000).toFixed(1)}s` : 'no read in 75 s')
  if (passOne) {
    // The read that follows must fail: the card keeps the last good figures, marked stale.
    inject.failExtra = true
    const beforeFailLiquid = (await readExtra(page))?.liquid
    const failRead = await waitForRead(passOne.t, 75000)
    await sleep(2000)
    const stale = await readExtra(page)
    inject.failExtra = false
    check('portfolio: failed re-read keeps the last figures on screen', failRead?.status === 500 && stale?.liquid === beforeFailLiquid && !stale.error, `liquid ${beforeFailLiquid} -> ${stale?.liquid}`)
    check('portfolio: failed re-read marks the address stale, not blank', !!stale?.stale && !!stale?.hint && !stale?.error)
    // Recovery: the next read succeeds and the stale mark clears.
    const recover = await waitForRead(failRead?.t ?? passOne.t, 75000)
    await sleep(2000)
    const fresh = await readExtra(page)
    check('portfolio: next good re-read clears the stale mark', !!recover && recover.status !== 500 && !fresh?.stale, `stale=${fresh?.stale}`)
    const passTimes = []
    for (const r of extraReads()) if (!passTimes.length || r.t - passTimes[passTimes.length - 1] > 5000) passTimes.push(r.t)
    const cadence = passTimes.slice(1).map((t, i) => (t - passTimes[i]) / 1000)
    check(
      'portfolio: passes come about every 60 s',
      cadence.length > 0 && cadence.every((s) => s > 50 && s < 75),
      cadence.map((s) => s.toFixed(1) + 's').join(', ') || 'single pass'
    )
  }
  if (SHOTS) await page.locator('.portfolio-card').screenshot({ path: `${SHOTS}/live-portfolio.png` }).catch(() => {})

  // ---- 5. Hidden: no RPC traffic for 15 s; shown again: a refresh within 2 s ----
  while (Date.now() - lastRpcAt() < 4000) await sleep(500)
  const h0 = Date.now()
  await page.evaluate(() => window.__setVis('hidden'))
  await sleep(15000)
  const h1 = Date.now()
  const hiddenCalls = rpc.filter((r) => r.t >= h0 && r.t < h1).length
  check('hidden: no RPC traffic for 15 s', hiddenCalls === 0, `calls while hidden=${hiddenCalls}`)
  await page.evaluate(() => window.__setVis('visible'))
  const shown = await (async () => {
    const end = Date.now() + 2000
    while (Date.now() < end) {
      if (rpc.some((r) => r.t >= h1 && r.method === 'getBlockNumber')) return rpc.find((r) => r.t >= h1 && r.method === 'getBlockNumber').t
      await sleep(100)
    }
    return null
  })()
  check('visible again: refresh starts within 2 s', shown !== null, shown ? `after ${((shown - h1) / 1000).toFixed(2)}s` : 'no refresh in 2 s')

  // ---- 6. Errors ----
  check('no page errors', errors.length === 0, errors.join(' | '))

  clearTimeout(watchdog)
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
