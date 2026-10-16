// Nimiq Pay send outcomes: the returned tx hash is used directly, and an
// "outcome unknown" rejection (code -32001) never reads as "Send failed" or
// offers a retry. Restored Pay session with a mocked window.nimiq + RPC.
//   NODE_PATH=/root/projects/mykopi-my/node_modules node test/pay-outcome-probe.cjs <baseUrl>
const { firefox } = require('playwright')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
const PAY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NimiqPay/2.0.3 Mobile/15E148'
const ADDR = 'NQ43 Y1RH P1K7 JH78 LRTS 95RY GAUU UBDK FFGX'
const FLAT = ADDR.replace(/\s+/g, '')
const TO = 'NQ08 ACT8 T0FE PTG8 P5RL H2S3 QGXH V15R NVXY'
const NIM = 100000
const H = (c) => c.repeat(64)
let pass = 0, fail = 0
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : ' :: ' + info}`) }

// mode: 'hash' | 'unknown-found' | 'unknown-missing' | 'reject'
async function run(browser, mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: PAY_UA })
  await ctx.addInitScript(([addr, mode, h1, h2]) => {
    localStorage.setItem('nimbooks:session', JSON.stringify({ provider: 'pay', nimiqAddress: addr, view: 'overview' }))
    localStorage.setItem('nimbooks:countConsent', 'no')
    window.nimiqPay = {}
    const send = async () => {
      window.__sends = (window.__sends || 0) + 1
      if (mode === 'hash') return h1
      if (mode === 'reject') throw { code: 4001, message: 'User rejected the request.', type: 'PERMISSION_DENIED' }
      throw { code: -32001, message: 'The transaction outcome is unknown. It may have been submitted; do not retry.', type: 'TRANSACTION_OUTCOME_UNKNOWN', data: { hash: h2 } }
    }
    window.nimiq = {
      listAccounts: async () => [addr],
      isConsensusEstablished: async () => true,
      getBlockNumber: async () => 1000000,
      sendBasicTransaction: send,
      sendBasicTransactionWithData: send,
    }
  }, [ADDR, mode, H('a'), H('b')])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let byHashCalls = 0
  await page.route('**/rpc.nimiqwatch.com/**', async (route) => {
    let req = {}
    try { req = JSON.parse(route.request().postData() || '{}') } catch {}
    const reply = (payload) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: req.id, ...payload }) })
    if (req.method === 'getStakerByAddress') return reply({ error: { code: 1, message: 'No staker with address: x' } })
    if (req.method === 'getAccountByAddress' && String(req.params?.[0]).replace(/\s+/g, '') === FLAT)
      return reply({ result: { data: { address: ADDR, balance: 5000 * NIM, type: 'basic' } } })
    if (req.method === 'getTransactionsByAddress') return reply({ result: { data: [] } })
    if (req.method === 'getTransactionByHash') {
      byHashCalls++
      if (mode === 'unknown-found' && byHashCalls >= 3)
        return reply({ result: { data: { hash: H('b'), from: ADDR, to: TO, value: 12 * NIM, fee: 0, timestamp: Date.now(), executionResult: true, toType: 0, blockNumber: 1000001 } } })
      return reply({ error: { code: -32603, message: 'Internal error', data: `Transaction not found: ${req.params?.[0]}` } })
    }
    return route.continue()
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-tour="quick-send"]:not([disabled])', { timeout: 25000 })
  await page.waitForTimeout(2500)
  await page.locator('[data-tour="quick-send"]').click()
  await page.fill('#sendTo', TO)
  await page.fill('#sendAmount', '12')
  await page.waitForTimeout(300)
  await page.locator('.send-submit', { hasText: /Send 12 NIM/ }).click()

  if (mode === 'hash') {
    await page.waitForSelector('.invoice-sent .ok', { timeout: 8000 })
    const link = await page.locator('.tx-hash-link').first().innerText().catch(() => '')
    check('hash: sent card shows the hash Pay returned, no lookup', link.startsWith(H('a').slice(0, 16)), link)
  } else if (mode === 'reject') {
    await page.waitForTimeout(1500)
    const body = await page.locator('body').innerText()
    check('reject: plain rejection still reads Send failed', /Send failed: User rejected the request\./.test(body), body.slice(0, 300))
    check('reject: send button is back', (await page.locator('.send-submit', { hasText: /Send 12 NIM/ }).count()) === 1)
  } else {
    await page.waitForSelector('.warn', { timeout: 8000 })
    const card = (await page.locator('.invoice-sent').first().innerText()).replace(/\s+/g, ' ')
    check(`${mode}: checking card, no "Send failed"`, /Checking the chain/.test(card) && !/Send failed/.test(await page.locator('body').innerText()), card)
    check(`${mode}: says do not send again`, /Do not send it again/.test(card), card)
    check(`${mode}: no submit button offered`, (await page.locator('.send-submit', { hasText: /Send 12 NIM/ }).count()) === 0)
    if (mode === 'unknown-found') {
      await page.waitForSelector('.invoice-sent .ok', { timeout: 30000 })
      const link = await page.locator('.tx-hash-link').first().innerText().catch(() => '')
      check('unknown-found: upgrades to sent card with the staged hash', link.startsWith(H('b').slice(0, 16)), link)
    } else {
      await page.waitForTimeout(12000)
      check('unknown-missing: still parked, still no submit', (await page.locator('.send-submit', { hasText: /Send 12 NIM/ }).count()) === 0 && (await page.locator('.warn').count()) === 1)
      await page.locator('.invoice-sent button', { hasText: 'Close' }).click()
      await page.waitForTimeout(400)
      await page.locator('[data-tour="quick-send"]').click()
      const amt = await page.inputValue('#sendAmount')
      check('unknown-missing: Close clears the form (no one-tap resend)', amt === '', amt)
    }
  }
  const sends = await page.evaluate(() => window.__sends || 0)
  check(`${mode}: exactly one wallet send call`, sends === 1, String(sends))
  check(`${mode}: no page errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

;(async () => {
  const browser = await firefox.launch()
  try {
    for (const m of ['hash', 'reject', 'unknown-found', 'unknown-missing']) await run(browser, m)
  } catch (e) {
    fail++
    console.log('FAIL harness:', e.message)
  }
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
