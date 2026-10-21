// Price chain probe (firefox): how the app behaves when each price or FX
// source is down, when every source is down, and where the numbers end up.
// Demo entry: click the button matching /sample wallet/i, wait for .topbar.
// Usage: NODE_PATH=/root/projects/mykopi-my/node_modules node test/price-chain-probe.cjs <baseUrl>
const { firefox } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '')

const PRICE_HOSTS = ['prices.nim.sh', 'coins.llama.fi', 'api.coingecko.com']
const FX_HOSTS = ['firestore.googleapis.com', 'cdn.jsdelivr.net', 'open.er-api.com']
const ALL_HOSTS = [...PRICE_HOSTS, ...FX_HOSTS]

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

// The vetted 148 codes, read straight from the source list so the stubs stay
// in step with the app without a second copy of the truth.
const CODES = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'lib', 'currencyData.ts'), 'utf8')
  .match(/code: "([a-z]+)"/g)
  .map((s) => s.match(/"([a-z]+)"/)[1])
if (CODES.length !== 148) {
  console.error(`expected 148 codes from currencyData.ts, got ${CODES.length}`)
  process.exit(1)
}

const nimShBody = (nim, eth, pol) => JSON.stringify({ currency: 'NIM', time: Math.floor(Date.now() / 1000), price: nim })
// ETH and POL get their own endpoints; this helper returns a body per ticker.
const nimShFor = {
  NIM: nimShBody(0.00039354),
  ETH: nimShBody(2500),
  MATIC: nimShBody(0.0957),
  USDT: JSON.stringify({ currency: 'USD', time: Math.floor(Date.now() / 1000), price: 1 }),
}

const llamaBody = (nimUsd) =>
  JSON.stringify({
    coins: {
      'coingecko:nimiq-2': { price: nimUsd, timestamp: Math.floor(Date.now() / 1000), symbol: 'NIM', decimals: 18 },
      'coingecko:ethereum': { price: 2500, timestamp: Math.floor(Date.now() / 1000), symbol: 'ETH', decimals: 18 },
      'coingecko:tether': { price: 1, timestamp: Math.floor(Date.now() / 1000), symbol: 'USDT', decimals: 6 },
      'coingecko:polygon-ecosystem-token': { price: 0.0957, timestamp: Math.floor(Date.now() / 1000), symbol: 'POL', decimals: 18 },
    },
  })

const cgBody = (nimUsd) =>
  JSON.stringify({
    'nimiq-2': { usd: nimUsd },
    tether: { usd: 1 },
    ethereum: { usd: 2500 },
    'matic-network': { usd: 0.0957 },
  })

// Firestore table: NIMIQ_RATE per code; MYRIE (when given) travels as an
// integerValue STRING, like 14 real codes in the live table do.
const firestoreBody = (rate, myrInt) => {
  const fields = {}
  for (const code of CODES) fields[code.toUpperCase()] = code === 'usd' ? { doubleValue: 1 } : { doubleValue: rate }
  if (myrInt) {
    fields.MYR = { integerValue: myrInt }
  }
  return JSON.stringify({
    name: 'projects/checkout-service/databases/(default)/documents/exchangerates/rates',
    fields: { rates: { mapValue: { fields } }, timestamp: { integerValue: String(Date.now()) } },
    updateTime: new Date().toISOString(),
  })
}

const jsDelivrBody = (rate) => {
  const usd = { usd: 1 }
  for (const code of CODES) if (code !== 'usd') usd[code] = rate
  return JSON.stringify({ date: new Date().toISOString().slice(0, 10), usd })
}

const erApiBody = (rate) => {
  const rates = { USD: 1 }
  for (const code of CODES) if (code !== 'usd') rates[code.toUpperCase()] = rate
  return JSON.stringify({ result: 'ok', time_last_update_unix: Math.floor(Date.now() / 1000), rates })
}

const jsonOk = (body) => ({
  status: 200,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body,
})

const RPC_DEMO = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
const RPC_DEMO_FLAT = RPC_DEMO.replace(/\s+/g, '')
const rpcOk = (body) => ({
  status: 200,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
})
// Deterministic demo wallet: 12 NIM basic + 890.19007 NIM staked = 902.19007.
// Same address and numbers the app's demo banner describes; RPC reads are
// stubbed so no scenario depends on a live balance read.
const rpcJson = (method) =>
  method === 'getBlockNumber'
    ? rpcOk({ result: { data: 64819776, metadata: null } })
    : method === 'getAccountByAddress'
      ? rpcOk({ result: { data: { address: RPC_DEMO_FLAT, balance: 1200000, type: 'basic' }, metadata: null } })
      : method === 'getStakerByAddress'
        ? rpcOk({ result: { data: { address: RPC_DEMO_FLAT, balance: 89019007, delegation: 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY', inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 }, metadata: null } })
        : method === 'getTransactionsByAddress'
          ? rpcOk({ result: { data: [], metadata: null } })
          : null

// Install route stubs + host recording. The record is on 'requestfinished',
// so aborted hosts are never counted as "used".
async function setupHosts(page, opts) {
  const hosts = []
  const isPriceHost = (u) => ALL_HOSTS.some((h) => u.hostname === h)
  // Record the full URL, not just the host: CoinGecko also serves the daily
  // closes (statement.ts market_chart), which is not part of the price chain
  // the scenarios are about.
  page.on('requestfinished', (req) => {
    try {
      const u = new URL(req.url())
      if (isPriceHost(u) && !hosts.includes(u.href)) hosts.push(u.href)
    } catch {
      /* about:blank & co */
    }
  })
  for (const host of PRICE_HOSTS) {
    await page.route(`**/${host}/**`, (route) => {
      const url = new URL(route.request().url())
      if (opts.aborted.includes(host)) return route.abort()
      if (host === 'prices.nim.sh') {
        const ticker = decodeURIComponent(url.pathname).split('/').filter(Boolean)[1]
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: opts.nimSh ? opts.nimSh(ticker) : nimShFor[ticker] ?? JSON.stringify({ error: 'unknown' }) })
      }
      if (host === 'coins.llama.fi') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: llamaBody(opts.nimUsd ?? 0.00039354) })
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: cgBody(opts.nimUsd ?? 0.000385) })
    })
  }
  for (const host of FX_HOSTS) {
    await page.route(`**/${host}/**`, (route) => {
      if (opts.aborted.includes(host)) return route.abort()
      if (host === 'firestore.googleapis.com') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: firestoreBody(opts.fxRate ?? 1, opts.myrInt) })
      if (host === 'cdn.jsdelivr.net') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: jsDelivrBody(opts.fxRate2 ?? 1) })
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: erApiBody(opts.fxRate3 ?? 1) })
    })
  }
  // Demo wallet RPC, so no scenario waits on a live balance read.
  await page.route('**/rpc.nimiqwatch.com/**', (route) => {
    let body = null
    try { body = JSON.parse(route.request().postData() || 'null') } catch {}
    if (!body?.method) return route.continue()
    const reply = rpcJson(body.method)
    if (reply) return route.fulfill(reply)
    return route.continue()
  })
  return hosts
}

;(async () => {
  const browser = await firefox.launch()

  // Demo entry shared by every scenario.
  async function demoPage(opts) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } })
    if (opts.seed) {
      await ctx.addInitScript((seed) => {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v)
      }, opts.seed)
    }
    const page = await ctx.newPage()
    const hosts = await setupHosts(page, opts)
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.locator('button:has-text("sample wallet")').first().click({ timeout: 20000 })
    await page.waitForSelector('.topbar', { timeout: 30000 })
    // The tour offer appears once the sample wallet is idle; it overlays but
    // the tile stays readable. Dismiss it so later taps (Export tab, picker)
    // are not eaten.
    for (let i = 0; i < 6; i++) {
      const notNow = page.locator('.tour-layer button:has-text("Not now")')
      if (!(await notNow.count())) break
      await notNow.first().click().catch(() => {})
      await page.waitForTimeout(400)
    }
    return { ctx, page, hosts }
  }

  const totalValue = async (page) =>
    (await page.locator('[data-learn="total"] .value').innerText().catch(() => '')).trim()

  // Wait until the Total value text settles on something the scenario expects.
  // "Settled" first: the NIM tile carries a number (the balance has landed)
  // and the Total value tile is either "Price unavailable" or a non-zero
  // dollar figure - a bare "old" $0.00 is the pre-settle render, not a
  // price answer.
  const settled = (page) =>
    page.waitForFunction(
      () => {
        const nim = (document.querySelector('.nim-tile .value') || {}).textContent || ''
        const v = (document.querySelector('[data-learn="total"] .value') || {}).textContent || ''
        return /\d/.test(nim) && (/Price unavailable/.test(v) || (/^\$/.test(v) && v !== '$0.00'))
      },
      null,
      { timeout: 90000 }
    )
  const waitTotal = async (page, re, timeout = 30000) => {
    await page.waitForFunction(
      (reSrc) => new RegExp(reSrc).test((document.querySelector('[data-learn="total"] .value') || {}).textContent || ''),
      re.source,
      { timeout }
    ).catch(() => {})
    return totalValue(page)
  }

  const NIM_TILE = '.nim-tile .value'
  const nimAmount = async (page) => {
    const t = await page.locator(NIM_TILE).first().innerText()
    const m = t.match(/([\d,]+(?:\.\d+)?)\s*NIM/)
    return m ? Number(m[1].replace(/,/g, '')) : null
  }

  // Tier names for the assertions: a host that only appeared for the daily
  // closes (statement.ts) is not a chain visit.
  const chainHost = (frag) => {
    const host = frag.hostname
    if (host === 'api.coingecko.com' && !frag.href.includes('simple/price')) return null
    return host
  }

  // ---- a. all sources OK: nim.sh + Firestore used, no CoinGecko -----------
  {
    const { ctx, page, hosts } = await demoPage({ aborted: [] })
    await settled(page)
    const value = await waitTotal(page, /^\$/)
    check('a: Total value is a dollar figure', /^\$[\d,]*\.\d\d$/.test(value), value)
    const uniqHosts = [...new Set(
      hosts
        .map((h) => {
          try { return chainHost(new URL(h)) } catch { return null }
        })
        .filter((h) => h !== null && h !== undefined)
    )]
    check('a: prices.nim.sh used', uniqHosts.includes('prices.nim.sh'), hosts.join(','))
    check('a: Firestore used', uniqHosts.includes('firestore.googleapis.com'), hosts.join(','))
    check('a: no CoinGecko simple/price request', !uniqHosts.includes('api.coingecko.com'), hosts.join(','))
    check('a: no later crypto/FX tier used', !uniqHosts.includes('coins.llama.fi') && !uniqHosts.includes('open.er-api.com'), hosts.join(','))
    await ctx.close()
  }

  // ---- b. prices.nim.sh aborted -> DefiLlama ------------------------------
  {
    const { ctx, page, hosts } = await demoPage({ aborted: ['prices.nim.sh'] })
    await settled(page)
    const value = await waitTotal(page, /^\$/)
    check('b: Total value is a dollar figure (nim.sh down)', /^\$[\d,]*\.\d\d$/.test(value), value)
    check('b: DefiLlama used', hosts.some((h) => h.includes('coins.llama.fi')), hosts.join(','))
    check('b: CoinGecko not used', !hosts.some((h) => h.includes('simple/price')), hosts.join(','))
    await ctx.close()
  }

  // ---- c. nim.sh + llama aborted -> CoinGecko ------------------------------
  {
    const NIM_USD = 0.000385
    const { ctx, page, hosts } = await demoPage({ aborted: ['prices.nim.sh', 'coins.llama.fi'], nimUsd: NIM_USD })
    await settled(page)
    const value = await waitTotal(page, /^\$/)
    const nim = await nimAmount(page)
    // The implied price proves which tier the figure came from: CoinGecko's
    // stubbed 0.000385 vs the nim.sh rate 0.00039354 are ~2% apart.
    const implied = Number(String(value).replace(/[$,]/g, '')) / nim
    check('c: Total value is a dollar figure (nim.sh+llama down)', /^\$/.test(value), value)
    check('c: CoinGecko used', hosts.some((h) => h.includes('simple/price')), hosts.join(','))
    check('c: value follows the CoinGecko stub, not the nim.sh rate', Math.abs(implied - NIM_USD) / NIM_USD < 0.02, `${implied} (nim ${nim})`)
    await ctx.close()
  }

  // ---- d. Firestore aborted -> jsDelivr ----------------------------------
  {
    const { ctx, page, hosts } = await demoPage({ aborted: ['firestore.googleapis.com'], fxRate2: 1 })
    await settled(page)
    const value = await waitTotal(page, /^\$/)
    check('d: Total value is a dollar figure (Firestore down)', /^\$/.test(value), value)
    check('d: jsDelivr used for FX', hosts.some((h) => h.includes('cdn.jsdelivr.net')), hosts.join(','))
    check('d: er-api not used', !hosts.some((h) => h.includes('open.er-api.com')), hosts.join(','))
    await ctx.close()
  }

  // ---- e. Firestore + jsDelivr aborted -> er-api ---------------------------
  {
    const { ctx, page, hosts } = await demoPage({ aborted: ['firestore.googleapis.com', 'cdn.jsdelivr.net'] })
    await settled(page)
    const value = await waitTotal(page, /^\$/)
    check('e: Total value is a dollar figure (Firestore+jsDelivr down)', /^\$/.test(value), value)
    check('e: er-api used for FX', hosts.some((h) => h.includes('open.er-api.com')), hosts.join(','))
    await ctx.close()
  }

  // ---- f. everything down, cold storage -> Price unavailable --------------
  {
    const { ctx, page } = await demoPage({ aborted: [...ALL_HOSTS] })
    await settled(page)
    const value = (await page.locator('[data-learn="total"] .value').innerText()).trim()
    const nim = await nimAmount(page)
    check('f: Total value says Price unavailable with every host down', /Price unavailable/.test(value), value)
    check('f: the sample balance is genuinely loaded and non-zero (no $0.00 excuse)', nim !== null && nim > 0, `nim ${nim}`)
    const body = await page.locator('body').innerText()
    check('f: zero "$0.00"/"RM0.00"/"EUR0.00" strings on the page', !/\$0\.00|RM0\.00|EUR0\.00/.test(body), '/')
    check('f: fiat sub-line hides or says Price unavailable, never 0.00', !/≈\s*\$0\.00/.test(body), '')
    await ctx.close()
  }

  // ---- g. everything down, 2-hour-old cached price -> value + "as of" -----
  {
    const oldAt = Date.now() - 2 * 60 * 60 * 1000
    const { ctx, page } = await demoPage({
      aborted: [...ALL_HOSTS],
      seed: { 'nimbooks:rates': JSON.stringify({ nim: { rates: { usd: 0.0004 }, at: oldAt } }) },
    })
    await settled(page)
    const value = await waitTotal(page, /^\$/)
    check('g: Total value shows the cached price', /^\$[\d,]*\.\d\d$/.test(value), value)
    const note = (await page.locator('[data-probe="price-asof"]').innerText().catch(() => '')).trim()
    check('g: "as of HH:MM" note next to Total value', /^as of \d{2}:\d{2}/i.test(note), note)
    await ctx.close()
  }

  // ---- h. nim.sh answers NIM 0.05 -> rejected, DefiLlama used --------------
  {
    const LLAMA_NIM = 0.00039
    const { ctx, page, hosts } = await demoPage({
      aborted: [],
      nimSh: (ticker) => (ticker === 'NIM' ? nimShBody(0.05) : nimShFor[ticker] ?? JSON.stringify({ error: 'x' })),
      nimUsd: LLAMA_NIM,
    })
    await settled(page)
    const value = await waitTotal(page, /^\$/)
    const nim = await nimAmount(page)
    check('h: sample balance loaded', nim !== null && nim > 0, `nim ${nim}`)
    const implied = Number(String(value).replace(/[$,]/g, '')) / nim
    check('h: Total value is a dollar figure (bad nim.sh answer)', /^\$/.test(value), value)
    check('h: DefiLlama used after the rejected answer', hosts.some((h) => h.includes('coins.llama.fi')), hosts.join(','))
    check('h: value follows the DefiLlama stub, not the bad 0.05', Math.abs(implied - LLAMA_NIM) / LLAMA_NIM < 0.02, `${implied} (nim ${nim})`)
    await ctx.close()
  }

  // ---- i. Firestore MYR as an integerValue string --------------------------
  {
    const { ctx, page, hosts } = await demoPage({ aborted: ['cdn.jsdelivr.net'], fxRate: 1, myrInt: '4' })
    await settled(page)
    const usd = await waitTotal(page, /^\$/)
    check('i: USD baseline is a real figure, not $0.00', Number(usd.replace(/[$,]/g, '')) > 0.004, usd)
    // Open the picker, pick MYR from the Popular section.
    await page.locator('.currency-chip').first().click()
    await page.waitForSelector('.currency-scroll', { timeout: 5000 })
    await page.locator('.currency-tile:has-text("MYR")').first().click()
    await page.waitForSelector('.currency-scroll', { state: 'detached', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(600)
    const myr = await totalValue(page)
    check('i: MYR chosen; Total value in RM', /^RM[\d,]/.test(myr), myr)
    const nim = await nimAmount(page)
    const impliedMyr = Number(String(myr).replace(/[RM,]/g, '')) / nim
    const impliedUsd = Number(String(usd).replace(/[$,]/g, '')) / nim
    const ratio = impliedMyr / impliedUsd
    check('i: MYR = 4 x USD (the integerValue string was parsed)', Math.abs(ratio - 4) / 4 < 0.02, `ratio ${ratio}`)
    check('i: MYR never shows RM0.00', !/^RM0\.00$/.test(myr), myr)
    await ctx.close()
  }

  // ---- j. picker: search "peso" finds MXN and PHP; KES in picker, USD tax note
  {
    const { ctx, page } = await demoPage({ aborted: [] })
    await settled(page)
    await waitTotal(page, /^\$/)
    await page.locator('.currency-chip').first().click()
    await page.waitForSelector('.currency-search')
    await page.locator('.currency-search').fill('peso')
    await page.waitForTimeout(300)
    const labels = await page.locator('.currency-tile .currency-code').evaluateAll((els) => els.map((e) => e.textContent.trim()))
    check('j: search "peso" finds MXN', labels.includes('MXN'), labels.join(','))
    check('j: search "peso" finds PHP', labels.includes('PHP'), labels.join(','))
    check('j: tiles show the currency name', (await page.locator('.currency-tile .currency-name').count()) > 0)
    check('j: search results keep radio semantics', (await page.locator('[role="radiogroup"]').count()) > 0 && (await page.locator('[role="radio"]').count()) > 0)
    await page.locator('.currency-search').fill('kes')
    await page.waitForTimeout(300)
    await page.locator('.currency-tile:has-text("KES")').first().click()
    await page.waitForSelector('.currency-scroll', { state: 'detached', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(600)
    const kesValue = await totalValue(page)
    check('j: KES selected; Total value in KES', /^KES\s?[\d,]/.test(kesValue), kesValue)
    // The tax card: the USD note shows for KES.
    await page.locator('.tab', { hasText: 'Export' }).first().click({ timeout: 8000 })
    await page.waitForSelector('.tax-card', { timeout: 20000 })
    await page.waitForSelector('[data-probe="tax-usd-note"]', { timeout: 40000 })
    const note = (await page.locator('[data-probe="tax-usd-note"]').innerText()).trim()
    check('j: tax card notes USD for KES', /Tax reports use USD for KES until historical exchange rates are added/.test(note), note)
    // The chip only exists on the Overview tab; go back before picking EUR.
    await page.locator('.tab', { hasText: 'Overview' }).first().click({ timeout: 8000 })
    await page.locator('.currency-chip').first().click()
    await page.waitForSelector('.currency-search')
    await page.locator('.currency-search').fill('eur')
    await page.waitForTimeout(200)
    await page.locator('.currency-tile:has-text("EUR")').first().click()
    await page.waitForSelector('.currency-scroll', { state: 'detached', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1200)
    check('j: no USD note for EUR', (await page.locator('[data-probe="tax-usd-note"]').count()) === 0)
    await ctx.close()
  }

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})