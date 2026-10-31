// Validator health probe (firefox): the Earn card's line about the user's own
// validator, driven by the chain record the app reads (`getValidatorByAddress`).
// A restored Nimiq Pay session on the sample wallet's address (it delegates to
// ImpactZero), with the RPC mocked so each health state is served in turn:
// ok, inactive, jailed, retired, and a failed read (which must never read as ok).
//
// Usage: NODE_PATH=/root/projects/mykopi-my/node_modules node test/validator-health-probe.cjs <baseUrl> [shotDir]
// Firefox only: Chromium's compositor crashes on some kernels (see regression-lite).
const { firefox } = require('playwright')

const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '')
const SHOTS = process.argv[3] || ''
const PAY_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'
// The sample wallet: a live Nimiq Pay wallet staking with ImpactZero.
const ADDR = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const FLAT = ADDR.replace(/\s+/g, '')
const IZ = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const NIM = 100000
const HEAD = 65_632_474
const EM_DASH = /[\u2013\u2014]/

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

const stakerReply = () => ({
  result: {
    data: {
      address: FLAT,
      balance: 7620.55 * NIM,
      delegation: IZ,
      inactiveBalance: 0,
      inactiveFrom: null,
      retiredBalance: 0,
    },
  },
})

// The validator record per health state. `null` means the RPC errors, the way
// it does for a failed read.
const RECORDS = {
  ok: { inactivityFlag: null, retired: false, jailedFrom: null },
  inactive: { inactivityFlag: HEAD - 5000, retired: false, jailedFrom: null },
  jailed: { inactivityFlag: null, retired: false, jailedFrom: HEAD - 10_000 },
  retired: { inactivityFlag: null, retired: true, jailedFrom: HEAD - 10_000 },
}

const VALIDATORS_FIXTURE = [
  {
    id: 1,
    name: 'ImpactZero',
    address: IZ,
    fee: 0.025,
    balance: 45000000000000,
    dominanceRatio: 0.05,
    score: { reliability: 0.99 },
    payoutType: 'restake',
    payoutSchedule: '0 */6 * * *',
    isListed: true,
  },
]

/** The one line under "X NIM staked with ImpactZero", as the DOM has it. */
async function healthLine(page) {
  const el = page.locator('.earn-card [data-probe="earn-health"]')
  if ((await el.count()) === 0) return { text: null, status: null, tone: null, tick: false, buttons: [] }
  const span = el.locator('.earn-health-text')
  return {
    text: (await span.count()) ? (await span.innerText()).replace(/\s+/g, ' ').trim() : null,
    status: await el.getAttribute('data-health'),
    tone: /earn-health--warn/.test((await el.getAttribute('class')) || '') ? 'warn' : 'ok',
    tick: (await page.locator('.earn-card .earn-health-tick').count()) > 0,
    // The InfoIcon is a button with no label; only the line's own actions count.
    buttons: (await el.locator('button').allInnerTexts()).map((t) => t.trim()).filter(Boolean),
  }
}

;(async () => {
  const browser = await firefox.launch()

  // One context per run of the states, so each starts from a clean storage.
  const open = async (mode) => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, userAgent: PAY_UA })
    await ctx.addInitScript(
      ([addr]) => {
        localStorage.setItem(
          'nimbooks:session',
          JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'overview' })
        )
        localStorage.setItem('nimbooks:countConsent', 'no')
        window.nimiqPay = {}
      },
      [ADDR]
    )
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Cross-Origin|CORS|429|404|Failed to load/i.test(m.text())) {
        errors.push('console: ' + m.text())
      }
    })
    // Live RPC only for the methods this probe does not pin; everything the
    // app needs to draw the Earn card is answered from the fixtures above.
    await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
      const body = route.request().postData() || ''
      let req = {}
      try {
        req = JSON.parse(body)
      } catch {
        /* not JSON: pass it on */
      }
      const reply = (payload) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }),
        })
      if (req.method === 'getStakerByAddress') return reply(stakerReply())
      if (req.method === 'getBlockNumber') return reply({ result: { data: HEAD } })
      if (req.method === 'getAccountByAddress')
        return reply({ result: { data: { address: FLAT, balance: 0, type: 'basic' } } })
      if (req.method === 'getTransactionsByAddress') return reply({ result: { data: [] } })
      if (req.method === 'getValidatorByAddress') {
        const record = RECORDS[mode]
        if (!record) return reply({ error: { code: 1, message: 'Internal error', data: 'rpc exploded' } })
        return reply({ result: { data: { address: IZ, balance: 1, ...record }, metadata: { blockNumber: HEAD } } })
      }
      return route.continue()
    })
    await page.route('**/api/v1/validators/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(VALIDATORS_FIXTURE),
      })
    )
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.earn-card', { timeout: 30000 })
    return { ctx, page, errors }
  }

  // 1. A healthy pool: the ok line, muted, with a check mark.
  {
    const { ctx, page, errors } = await open('ok')
    let line = null
    for (let i = 0; i < 40 && !line?.text; i++) {
      await page.waitForTimeout(500)
      line = await healthLine(page)
    }
    check('ok: the Earn card shows the health line', !!line.text, JSON.stringify(line))
    check('ok: "Validator is active and not jailed."', line.text === 'Validator is active and not jailed.', line.text)
    check('ok: marked ok, muted tone, with a check mark', line.status === 'ok' && line.tone === 'ok' && line.tick, JSON.stringify(line))
    check('ok: the line sits under "NIM staked with ImpactZero"', /NIM staked with ImpactZero/.test((await page.locator('.earn-card').innerText()).replace(/\s+/g, ' ')))
    // The InfoIcon explainer is on the line.
    const info = page.locator('.earn-card .earn-health .info-btn')
    check('ok: the line carries the InfoIcon explainer', (await info.count()) === 1)
    await info.click()
    const explainer = (await page.locator('.earn-card .earn-health .info-text').innerText()).replace(/\s+/g, ' ')
    check('ok: the explainer says where the answer comes from',
      /reads your validator's record on the Nimiq chain/.test(explainer) && /jailed or inactive validator earns nothing/.test(explainer), explainer)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('ok: no horizontal overflow at 360px', overflow <= 1, `overflow=${overflow}`)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vh-ok.png` })
    check('ok: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // 2. Deactivated: warns, and says the NIM is safe.
  {
    const { ctx, page, errors } = await open('inactive')
    let line = null
    for (let i = 0; i < 40 && line?.status !== 'inactive'; i++) {
      await page.waitForTimeout(500)
      line = await healthLine(page)
    }
    check('inactive: names the pool and warns',
      line.text === 'ImpactZero is inactive, so your stake earns nothing until it comes back. Your NIM is safe.', line.text)
    check('inactive: warn tone, no check mark, no button', line.tone === 'warn' && !line.tick && line.buttons.length === 0, JSON.stringify(line))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('inactive: no horizontal overflow at 360px', overflow <= 1, `overflow=${overflow}`)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vh-inactive.png` })
    check('inactive: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // 3. Jailed: hours or days left, and the wait on unstaking.
  {
    const { ctx, page, errors } = await open('jailed')
    let line = null
    for (let i = 0; i < 40 && line?.status !== 'jailed'; i++) {
      await page.waitForTimeout(500)
      line = await healthLine(page)
    }
    // jailedFrom 10,000 blocks ago: 8 epochs (345,600) + 1 - 10,000 = 335,601
    // blocks left at ~1 s = ~93 h, so the copy counts days.
    check('jailed: says about 4 more days', /ImpactZero is jailed for about 4 more days, /.test(line.text), line.text)
    check('jailed: says the stake earns nothing and unstaking waits',
      /so your stake earns nothing and unstaking waits until the jail ends\. Your NIM is safe\.$/.test(line.text), line.text)
    check('jailed: warn tone, no button', line.tone === 'warn' && line.buttons.length === 0, JSON.stringify(line))
    check('jailed: no em dash in the line', !EM_DASH.test(line.text), line.text)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vh-jailed.png` })
    check('jailed: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // 4. Retired: no more earnings, and a way out.
  {
    const { ctx, page, errors } = await open('retired')
    let line = null
    for (let i = 0; i < 40 && line?.status !== 'retired'; i++) {
      await page.waitForTimeout(500)
      line = await healthLine(page)
    }
    check('retired: says it has retired and offers to unstake',
      line.text === 'ImpactZero has retired, so your stake no longer earns. Unstake to move it.', line.text)
    check('retired: warn tone', line.tone === 'warn', JSON.stringify(line))
    check('retired: the way out is a button on the line',
      line.buttons.some((b) => /^unstake$/i.test(b)), JSON.stringify(line.buttons))
    check('retired: the line is not the ok line', !/active and not jailed/.test(line.text), line.text)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vh-retired.png` })
    check('retired: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // 5. A failed validator read: never the ok line. With a previous answer on
  //    screen it says the check failed; with nothing behind it, it says nothing.
  {
    const { ctx, page, errors } = await open('ok')
    let line = null
    for (let i = 0; i < 40 && !line?.text; i++) {
      await page.waitForTimeout(500)
      line = await healthLine(page)
    }
    check('failed read: the ok line is there before the failure', line.text === 'Validator is active and not jailed.', line.text)
    // A manual refresh re-reads the record; from now on the RPC errors.
    await page.unroute('**/rpc.nimiqwatch.com/**')
    await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
      const body = route.request().postData() || ''
      let req = {}
      try {
        req = JSON.parse(body)
      } catch {
        /* not JSON */
      }
      const reply = (payload) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }),
        })
      if (req.method === 'getStakerByAddress') return reply(stakerReply())
      if (req.method === 'getBlockNumber') return reply({ result: { data: HEAD } })
      if (req.method === 'getAccountByAddress')
        return reply({ result: { data: { address: FLAT, balance: 0, type: 'basic' } } })
      if (req.method === 'getTransactionsByAddress') return reply({ result: { data: [] } })
      if (req.method === 'getValidatorByAddress')
        return reply({ error: { code: 1, message: 'Internal error', data: 'rpc exploded' } })
      return route.continue()
    })
    await page.locator('.refresh-btn').click()
    let after = line
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500)
      after = await healthLine(page)
      if (after.text && !/active and not jailed/.test(after.text)) break
    }
    check('failed read: the ok line is gone', !/active and not jailed/.test(after.text || ''), after.text)
    check('failed read: says the check failed', after.text === 'Could not check the validator right now.', after.text)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vh-failed.png` })
    check('failed read: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // 6. A failed first read says nothing at all (no ok line, no invented copy).
  {
    const { ctx, page, errors } = await open('fail')
    await page.waitForTimeout(6000)
    const line = await healthLine(page)
    check('failed first read: no health line', line.text === null, JSON.stringify(line))
    check('failed first read: nothing claims the validator is fine',
      !/active and not jailed/.test((await page.locator('.earn-card').innerText()).replace(/\s+/g, ' ')))
    check('failed first read: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
