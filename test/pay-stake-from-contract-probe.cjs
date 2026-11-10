// Nimiq Pay stake funded from the HTLC contract, every RPC stubbed (firefox).
//
// The reported bug (2026-11-10, owner wallet in Pay): Pay funds an add-stake
// straight from its HTLC contract, so the stake writes NO tx to the basic
// address. The contract sweep (htlcInTransit) was keyed on the basic tx list
// and kept its pre-stake reading, and htlcLuna = max(contract, scan) pinned
// Available at the old figure while Staked already counted the moved NIM, so
// the total double-counted the stake until a reload.
//
// Fixture: basic 1 NIM, contract R funded by the basic address holds 108 NIM,
// staker 7,772.33 NIM. Then, with no new basic tx, R drops to 38.5 NIM and the
// staker rises to 7,841.83 NIM (a 69.5 NIM add-stake from the contract).
// Correct total before and after: 7,881.33 NIM. The bug reads 7,950.83.
//
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/pay-stake-from-contract-probe.cjs <baseUrl>
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const PAY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'
const ADDR = 'NQ82 6GYU NXUU 05DM 1M7F 0SJJ D42E NUNS KELR'
const FLAT = ADDR.replace(/\s+/g, '')
const R = 'NQ37 095H KLEG LTHP 7BNA H31G QSU1 RMR6 TRU7'
const R_FLAT = R.replace(/\s+/g, '')
const VALIDATOR = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : ' :: ' + info}`)
}

;(async () => {
  const browser = await firefox.launch()
  const state = { rLuna: 108 * 100000, stakeLuna: 777233000 }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  await ctx.addInitScript(
    ([addr, remote]) => {
      localStorage.setItem(
        'nimbooks:session',
        JSON.stringify({ provider: 'pay', nimiqAddress: addr, remoteAddress: remote, view: 'overview' })
      )
      localStorage.setItem('nimbooks:countConsent', 'no')
      window.nimiqPay = {}
      window.nimiq = {
        listAccounts: async () => [addr, remote],
        isConsensusEstablished: async () => true,
        getBlockNumber: async () => 1000000,
        on: () => {},
      }
    },
    [ADDR, R]
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) return route.continue()
    if (!url.includes('rpc.nimiqwatch.com')) {
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
      if (at === FLAT) return reply({ result: { data: { address: FLAT, type: 'basic', balance: 100000 } } })
      if (at === R_FLAT)
        return reply({
          result: { data: { address: R_FLAT, type: 'htlc', balance: state.rLuna, sender: FLAT, recipient: FLAT, timeout: 0 } },
        })
      return reply({ result: { data: { address: at, type: 'basic', balance: 0 } } })
    }
    if (req.method === 'getTransactionsByAddress') {
      if (req.params?.[2] != null) return reply({ result: { data: [] } })
      if (at === FLAT)
        return reply({
          result: {
            data: [
              {
                hash: 'a'.repeat(64),
                from: FLAT,
                to: R_FLAT,
                value: String(108 * 100000),
                fee: '0',
                timestamp: 1790000000000,
                toType: 2,
                executionResult: true,
                recipientData: '343fcb7b9c015b50d4ef06a526904eb72da9ba99' + '0'.repeat(64),
              },
            ],
          },
        })
      return reply({ result: { data: [] } })
    }
    if (req.method === 'getStakerByAddress')
      return reply({
        result: {
          data: { address: ADDR, balance: state.stakeLuna, delegation: VALIDATOR, inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 },
        },
      })
    return reply({ result: { data: null } })
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.nim-tile .value', { timeout: 30000 })

  const readNim = async () => {
    try {
      const t = (await page.locator('.nim-tile .value').first().innerText()).trim()
      const n = Number(t.replace(/[^0-9.]/g, ''))
      return { t, n }
    } catch {
      return { t: '', n: NaN }
    }
  }
  const waitFor = async (want, ms) => {
    const seen = []
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const { t, n } = await readNim()
      if (t && seen[seen.length - 1] !== t) seen.push(t)
      if (Math.abs(n - want) < 0.005) return { ok: true, seen }
      await page.waitForTimeout(250)
    }
    return { ok: false, seen }
  }

  const before = await waitFor(7881.33, 30000)
  check('total before the stake = 7,881.33 NIM (1 basic + 108 contract + 7,772.33 staked)', before.ok, before.seen.join(' | '))
  // Let one heartbeat pass so the sweep has cached its pre-stake reading.
  await page.waitForTimeout(12000)

  // The add-stake lands: funded from the contract, no basic-address tx.
  state.rLuna = 3850000
  state.stakeLuna = 784183000
  const after = await waitFor(7881.33, 1000) // may still be right by coincidence of timing; the real check is below
  // Watch two full heartbeats: the figure must settle at 7,881.33 and never
  // stay on the double-counted 7,950.83.
  await page.waitForTimeout(25000)
  const { t: finalT, n: finalN } = await readNim()
  check('total after the stake settles at 7,881.33 NIM (no double count)', Math.abs(finalN - 7881.33) < 0.005, `read ${finalT}; seen ${after.seen.join(' | ')}`)
  check('no page errors', errors.length === 0, errors.join(' | '))

  await browser.close()
  console.log(`${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
