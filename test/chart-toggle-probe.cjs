// Chart toggle probe (classic): one chart card, line/bar switch, remembered.
const { chromium } = require('playwright')
const fs = require('fs')
const BASE = process.argv[2] || 'http://127.0.0.1:8099'
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' :: ' + x : ''}`) }
const exe = fs.readdirSync('/root/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().pop()
;(async () => {
  const browser = await chromium.launch({ executablePath: `/root/.cache/ms-playwright/${exe}/chrome-linux64/chrome` })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /sample|demo|try/i }).first().click().catch(() => {})
  await page.waitForTimeout(14000)
  await page.getByRole('button', { name: /not now|skip|no thanks/i }).first().click({ timeout: 1500 }).catch(() => {})
  const state = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll('section.analytics .chart-card')]
    return { cards: cards.length, titles: cards.map(c => (c.querySelector('.label') || {}).innerText || ''), toggle: !!document.querySelector('.chart-toggle'), pressed: [...document.querySelectorAll('.chart-toggle-btn')].map(b => b.getAttribute('aria-pressed')), legendOrTap: !!document.querySelector('.chart-tappable') }
  })
  let s = await state()
  check('one chart card by default', s.cards === 1, JSON.stringify(s))
  check('default is the daily net flow (bars)', /Daily net flow/i.test(s.titles[0]) && s.legendOrTap)
  check('toggle present with two buttons', s.toggle && s.pressed.length === 2)
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.chart-toggle-btn')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
  check('toggle buttons at least 34px tall', sizes.every(([w, h]) => h >= 34), JSON.stringify(sizes))
  await page.getByRole('button', { name: /Balance over time/i }).click()
  s = await state()
  check('switches to the balance line', s.cards === 1 && /balance trajectory/i.test(s.titles[0]), s.titles[0])
  check('line button pressed', s.pressed[0] === 'true' && s.pressed[1] === 'false')
  const stored = await page.evaluate(() => localStorage.getItem('nimbooks:analytics:chart'))
  check('choice stored', stored === 'balance', stored)
  await page.reload({ waitUntil: 'networkidle' })
  // The demo session is not kept across a reload: re-enter it.
  await page.getByRole('button', { name: /sample|demo|try/i }).first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(14000)
  await page.getByRole('button', { name: /not now|skip|no thanks/i }).first().click({ timeout: 1500 }).catch(() => {})
  s = await state()
  check('choice survives a reload', /balance trajectory/i.test(s.titles[0] || ''), s.titles[0])
  await page.getByRole('button', { name: /Daily net flow \(bar/i }).click()
  s = await state()
  check('back to bars', /Daily net flow/i.test(s.titles[0]))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  check('no horizontal overflow at 390', overflow)
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close(); process.exit(fail ? 1 : 0)
})()
