// Landing + learn-page probe (firefox). Checks the interactive landing: the
// connect panel above the fold, the feature cards and explainers on a phone, the
// explorer on desktop, the #/learn and #/learn/<slug> links, and the two sample
// wallet entries (the tour offer is skipped for a screen, kept for the tour).
//
// Usage: NODE_PATH=/root/projects/mykopi-my/node_modules node test/landing-probe.cjs <baseUrl> [shotDir]
// Firefox only: Chromium's compositor crashes on some kernels (see regression-lite).
const { firefox } = require('playwright')

const BASE = (process.argv[2] || 'http://127.0.0.1:8099').replace(/\/$/, '')
const SHOTS = process.argv[3] || ''
const PAY_UA =
  'Mozilla/5.0 (Linux; Android 16; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 NimiqPay/2.0.3'
const PHONE = { width: 360, height: 780 }
const DESK = { width: 1280, height: 800 }
// Every feature, in landing order: the Earn group first, then the books.
const EARN_SLUGS = ['staking', 'pay-stake', 'rewards', 'yield-calculator', 'tax']
const BOOK_SLUGS = [
  'balance', 'history', 'analytics', 'send-receive', 'requests', 'receipts',
  'cashlinks', 'statements', 'exports', 'portfolio', 'mcp', 'privacy',
]
const SLUGS = [...EARN_SLUGS, ...BOOK_SLUGS]
const EM_DASH = '\u2014'

// Environment noise, not page errors: `vite preview` has no Pages Functions, so
// /api/* answers 404, and CoinGecko rate-limits the sandbox (429, no CORS header).
// Uncaught exceptions and any other console error still fail the probe.
const ENV_NOISE = /Cross-Origin|CORS|429|404|Failed to load|XML Parsing Error|NS_ERROR|coingecko|status of 404/i
const noise = []

let pass = 0
let fail = 0
const check = (name, ok, info = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !info ? '' : `  :: ${info}`}`)
}

async function open(browser, viewport, { ua, initScript } = {}) {
  const ctx = await browser.newContext({ viewport, ...(ua ? { userAgent: ua } : {}) })
  if (initScript) await ctx.addInitScript(initScript)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (ENV_NOISE.test(m.text())) noise.push(m.text().slice(0, 80))
    else errors.push('console: ' + m.text())
  })
  return { ctx, page, errors }
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

// The tour offer only appears once the sample wallet has finished loading.
async function waitSampleIdle(page) {
  await page.waitForSelector('.refresh-btn:not([disabled])', { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2500)
}

// A full document load (a hash-only goto would stay in the same document).
async function loadAt(page, url) {
  await page.goto('about:blank')
  await page.goto(url, { waitUntil: 'domcontentloaded' })
}
const hashNow = (page) => page.evaluate(() => window.location.hash)

async function sheetFacts(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.learn-sheet')
    if (!sheet) return null
    const lists = sheet.querySelectorAll('ul.learn-bullets')
    return {
      title: document.querySelector('#learn-sheet-title')?.textContent?.trim() ?? '',
      steps: sheet.querySelectorAll('ol.learn-steps > li').length,
      behind: lists[0]?.querySelectorAll('li').length ?? 0,
      good: lists[1]?.querySelectorAll('li').length ?? 0,
      heads: [...sheet.querySelectorAll('p.learn-h')].map((p) => p.textContent.trim()),
      tryBtn: [...sheet.querySelectorAll('button')].some((b) => /try it in the sample wallet/i.test(b.textContent)),
      tourBtn: [...sheet.querySelectorAll('button')].some((b) => /take the guided tour/i.test(b.textContent)),
      text: sheet.innerText,
    }
  })
}

;(async () => {
  const browser = await firefox.launch()
  const allText = []

  // ── 1. Phone (360x780), a browser ─────────────────────────────────────────
  {
    const { ctx, page, errors } = await open(browser, PHONE)
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.learn-card', { timeout: 20000 })

    const tryBtn = page.getByRole('button', { name: /try with a sample wallet/i })
    const tryBox = await tryBtn.boundingBox()
    check('phone: "Try with a sample wallet" visible without scrolling', !!tryBox && tryBox.y + tryBox.height <= PHONE.height, JSON.stringify(tryBox))
    const connectBox = await page.getByRole('link', { name: /open in nimiq pay/i }).boundingBox()
    check('phone: "Open in Nimiq Pay" visible without scrolling', !!connectBox && connectBox.y + connectBox.height <= PHONE.height, JSON.stringify(connectBox))
    // regression-lite clicks the first button containing "sample wallet" in DOM order
    check('phone: first DOM "sample wallet" button is the connect panel one',
      await page.evaluate(() => /^Try with a sample wallet$/.test([...document.querySelectorAll('button')].find((b) => /sample wallet/i.test(b.textContent))?.textContent.trim() || '')))

    // Two stories on a phone: Earn on your NIM first, the books folded away
    // behind one button (they used to be 14 equal cards in one row).
    const cards = await page.locator('.learn-card').count()
    check('phone: 5 Earn cards first, book features folded away', cards === EARN_SLUGS.length, `found ${cards}`)
    const sections = await page.evaluate(() =>
      [...document.querySelectorAll('#learn-features .learn-head h2')].map((h) => h.textContent.trim())
    )
    check('phone: sections read "Earn on your NIM" then "Your books, kept for you"',
      sections[0] === 'Earn on your NIM' && sections[1] === 'Your books, kept for you', JSON.stringify(sections))
    const earnFirst = await page.evaluate(() =>
      [...document.querySelectorAll('.learn-card')].map((c) => c.dataset.group)
    )
    check('phone: every card in the first row is an Earn card', earnFirst.every((g) => g === 'earn'), JSON.stringify(earnFirst))
    const toggle = page.locator('.learn-books-toggle')
    check('phone: the books start behind "Show all 12 book features"',
      (await toggle.innerText()).trim() === `Show all ${BOOK_SLUGS.length} book features` &&
      (await toggle.getAttribute('aria-expanded')) === 'false' &&
      (await page.locator('#learn-books-cards').count()) === 0,
      (await toggle.innerText()).trim())
    await toggle.click()
    const expanded = await page.locator('.learn-card').count()
    check('phone: the button opens all book features (5 + 12 = 17 cards)',
      expanded === SLUGS.length && (await toggle.getAttribute('aria-expanded')) === 'true', `found ${expanded}`)
    check('phone: no horizontal overflow at 360px (landing)', (await overflow(page)) <= 1, `overflow=${await overflow(page)}`)
    allText.push(await page.locator('body').innerText())

    for (const slug of SLUGS) {
      await page.locator(`.learn-card[data-feature="${slug}"]`).click()
      await page.waitForSelector('.learn-sheet', { timeout: 5000 })
      const f = await sheetFacts(page)
      const okHeads = ['How to use it', 'Behind the scenes', 'Good to know'].every((h) => f.heads.includes(h))
      check(
        `phone sheet ${slug}: steps, behind the scenes, good to know, both buttons`,
        !!f && f.steps >= 3 && f.steps <= 4 && f.behind >= 2 && f.behind <= 4 && f.good >= 1 && f.good <= 5 && okHeads && f.tryBtn && f.tourBtn && !!f.title,
        f ? JSON.stringify({ title: f.title, steps: f.steps, behind: f.behind, good: f.good, heads: f.heads }) : 'no sheet'
      )
      check(`phone sheet ${slug}: hash is #/learn/${slug}`, (await hashNow(page)) === `#/learn/${slug}`, await hashNow(page))
      allText.push(f.text)
      await page.keyboard.press('Escape')
      await page.waitForSelector('.learn-sheet', { state: 'detached', timeout: 5000 })
      check(`phone sheet ${slug}: Escape closes it and clears the hash`, (await hashNow(page)) === '', await hashNow(page))
    }

    // Back gesture closes the sheet (the sheet has its own history entry).
    await page.locator('.learn-card[data-feature="analytics"]').click()
    await page.waitForSelector('.learn-sheet')
    await page.goBack()
    await page.waitForSelector('.learn-sheet', { state: 'detached', timeout: 5000 }).catch(() => {})
    check('phone: Back gesture closes the sheet', (await page.locator('.learn-sheet').count()) === 0)
    check('phone: Back leaves the plain landing URL', (await hashNow(page)) === '', await hashNow(page))

    // Close button, and focus stays inside the sheet while Tab is pressed.
    await page.locator('.learn-card[data-feature="privacy"]').click()
    await page.waitForSelector('.learn-sheet')
    const onOpen = await page.evaluate(() => !!document.querySelector('.learn-sheet')?.contains(document.activeElement))
    check('phone: focus moves into the sheet on open', onOpen)
    let escaped = false
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => !!document.querySelector('.learn-sheet')?.contains(document.activeElement))
      if (!inside) { escaped = true; break }
    }
    check('phone: Tab is trapped inside the sheet', !escaped)
    await page.locator('.learn-sheet [aria-label="Close"]').click()
    await page.waitForSelector('.learn-sheet', { state: 'detached', timeout: 5000 })
    check('phone: the close button closes the sheet', (await hashNow(page)) === '', await hashNow(page))

    // The sheet scrolls inside itself.
    await page.locator('.learn-card[data-feature="tax"]').click()
    await page.waitForSelector('.learn-sheet')
    const scrolls = await page.evaluate(() => {
      const o = document.querySelector('.learn-overlay')
      const before = o.scrollTop
      o.scrollTop = 400
      return { canScroll: o.scrollHeight > o.clientHeight, moved: o.scrollTop > before }
    })
    check('phone sheet: scrolls inside (full-screen overlay)', scrolls.canScroll && scrolls.moved, JSON.stringify(scrolls))
    check('phone sheet: no horizontal overflow at 360px', (await overflow(page)) <= 1, `overflow=${await overflow(page)}`)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-sheet-tax.png` })
    await page.locator('.learn-sheet [aria-label="Close"]').click()
    await page.waitForSelector('.learn-sheet', { state: 'detached', timeout: 5000 })

    // Deep link: #/learn/tax opens that explainer directly; Back closes it.
    await loadAt(page, BASE + '/#/learn/tax')
    await page.waitForSelector('.learn-sheet', { timeout: 20000 })
    const deep = await sheetFacts(page)
    check('phone deep link #/learn/tax opens the Crypto tax explainer', !!deep && /crypto tax/i.test(deep.title), deep && deep.title)
    await page.goBack()
    await page.waitForSelector('.learn-sheet', { state: 'detached', timeout: 5000 }).catch(() => {})
    check('phone deep link: Back closes it without leaving NimBooks', (await page.locator('.learn-sheet').count()) === 0 && (await page.url()).startsWith(BASE))

    // #/learn scrolls the features into view.
    await loadAt(page, BASE + '/#/learn')
    await page.waitForSelector('#learn-features', { timeout: 20000 })
    await page.waitForTimeout(600)
    const featTop = await page.evaluate(() => document.getElementById('learn-features').getBoundingClientRect().top)
    check('phone #/learn scrolls the features into view', featTop < PHONE.height * 0.6, `top=${featTop}`)

    // Try it for tax: the sample wallet opens on Export, on the tax card, with no tour offer.
    await loadAt(page, BASE + '/#/learn/tax')
    await page.waitForSelector('.learn-sheet', { timeout: 20000 })
    await page.locator('.learn-sheet button', { hasText: /try it in the sample wallet/i }).click()
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await page.waitForSelector('[data-learn="tax"]', { timeout: 30000 })
    await waitSampleIdle(page)
    const exportActive = await page.locator('.tab[aria-current="page"]').innerText().catch(() => '')
    check('phone Try it (tax): lands on the Export tab', /export/i.test(exportActive), exportActive)
    const taxTop = await page.evaluate(() => {
      const el = document.querySelector('[data-learn="tax"]')
      return el ? el.getBoundingClientRect().top : null
    })
    check('phone Try it (tax): scrolls the tax card into view', taxTop !== null && taxTop < PHONE.height * 0.5, `top=${taxTop}`)
    check('phone Try it (tax): no tour offer card', (await page.locator('#tour-offer-title').count()) === 0)
    check('phone Try it (tax): the address is the plain landing (no learn hash)', (await hashNow(page)) === '', await hashNow(page))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-try-tax.png` })
    check('phone Try it: no horizontal overflow', (await overflow(page)) <= 1, `overflow=${await overflow(page)}`)
    check('phone Try it (tax): no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // Every "Try it" lands on its screen, with no tour offer (phone).
  // Expected view and anchor per feature, as lib/features.ts declares them.
  const VIEW_TAB = { dashboard: 'Overview', history: 'History', receipts: 'Receipts', request: 'Request', export: 'Export' }
  const TRY = {
    // The Earn group first, in landing order, then the books.
    staking: ['dashboard', null],
    'pay-stake': ['dashboard', null],
    rewards: ['history', null],
    'yield-calculator': ['dashboard', 'earn'],
    tax: ['export', 'tax'],
    balance: ['dashboard', 'total'],
    history: ['history', null],
    analytics: ['dashboard', 'analytics'],
    'send-receive': ['dashboard', 'quick-actions'],
    requests: ['request', null],
    receipts: ['receipts', null],
    cashlinks: ['dashboard', 'quick-actions'],
    statements: ['export', 'statement'],
    exports: ['export', 'export'],
    portfolio: ['export', 'portfolio'],
    mcp: ['dashboard', 'mcp'],
    privacy: ['export', 'backup'],
  }
  {
    const { ctx, page, errors } = await open(browser, PHONE)
    for (const [slug, [view, target]] of Object.entries(TRY)) {
      await loadAt(page, `${BASE}/#/learn/${slug}`)
      await page.waitForSelector('.learn-sheet', { timeout: 20000 })
      await page.locator('.learn-sheet button', { hasText: /try it in the sample wallet/i }).click()
      await page.waitForSelector('.topbar', { timeout: 30000 })
      await waitSampleIdle(page)
      const tab = await page.locator('.tab[aria-current="page"]').innerText().catch(() => '')
      const r = await page.evaluate((t) => {
        const el = t ? document.querySelector(`[data-learn="${t}"]`) : null
        return { found: !!el, top: el ? Math.round(el.getBoundingClientRect().top) : null }
      }, target)
      const wantsStake = slug === 'staking' || slug === 'pay-stake'
      const stakeOpen = wantsStake ? await page.locator('[role="dialog"][aria-label="Stake NIM"]').count() > 0 : true
      const offer = await page.locator('#tour-offer-title').count()
      const landed = tab.toLowerCase().includes(VIEW_TAB[view].toLowerCase())
      // In view: the anchor is on screen. A card at the foot of the page cannot scroll to the top.
      const anchored = target === null || (r.found && r.top !== null && r.top >= -20 && r.top < PHONE.height - 120)
      check(`phone Try it ${slug}: on ${VIEW_TAB[view]}${target ? `, anchor ${target}` : ''}${wantsStake ? ', Stake panel open' : ''}, no tour offer`,
        landed && anchored && stakeOpen && offer === 0,
        JSON.stringify({ tab, anchor: r, stakeOpen, offer }))
      if (wantsStake) {
        // Closing the panel must not bring the tour offer back either.
        await page.keyboard.press('Escape')
        await page.waitForTimeout(2500)
        check(`phone Try it ${slug}: closing the panel does not offer the tour`, (await page.locator('#tour-offer-title').count()) === 0)
      }
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    check('phone Try it (all 17): no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // Take the guided tour (phone): the tour offer shows.
  {
    const { ctx, page, errors } = await open(browser, PHONE)
    await loadAt(page, BASE + '/#/learn/balance')
    await page.waitForSelector('.learn-sheet', { timeout: 20000 })
    await page.locator('.learn-sheet button', { hasText: /take the guided tour/i }).click()
    await page.waitForSelector('#tour-offer-title', { timeout: 30000 })
    check('phone "Take the guided tour" shows the tour offer', true)
    check('phone guided tour: sample wallet is on the Overview', (await page.locator('.tab[aria-current="page"]').innerText().catch(() => '')).match(/overview/i) !== null)
    check('phone guided tour: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // Plain "Try with a sample wallet" keeps today's behaviour: the tour offer shows.
  {
    const { ctx, page, errors } = await open(browser, PHONE)
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.learn-card', { timeout: 20000 })
    await page.getByRole('button', { name: /try with a sample wallet/i }).click()
    await page.waitForSelector('#tour-offer-title', { timeout: 30000 })
    check('plain "Try with a sample wallet" still offers the tour', true)
    check('plain sample wallet: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // Mocked Nimiq Pay (phone): "Connect Wallet" is above the fold.
  {
    const { ctx, page, errors } = await open(browser, PHONE, {
      ua: PAY_UA,
      initScript: () => {
        window.nimiqPay = {}
      },
    })
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.learn-card', { timeout: 20000 })
    const box = await page.getByRole('button', { name: /connect wallet/i }).boundingBox()
    check('Nimiq Pay (mocked): "Connect Wallet" visible without scrolling', !!box && box.y + box.height <= PHONE.height, JSON.stringify(box))
    check('Nimiq Pay (mocked): "Try with a sample wallet" visible without scrolling', await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /sample wallet/i.test(x.textContent))
      return !!b && b.getBoundingClientRect().bottom <= window.innerHeight
    }))
    check('Nimiq Pay (mocked): the 5 Earn cards are the visible row (books folded)',
      (await page.locator('.learn-card').count()) === EARN_SLUGS.length)
    check('Nimiq Pay (mocked): "Show all 12 book features" is there',
      (await page.locator('.learn-books-toggle').innerText()).trim() === `Show all ${BOOK_SLUGS.length} book features`)
    check('Nimiq Pay (mocked): no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // Reduced motion: the illustrations do not animate.
  {
    const ctx = await browser.newContext({ viewport: PHONE, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(BASE + '/#/learn/analytics', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.learn-sheet', { timeout: 20000 })
    const anim = await page.evaluate(() => [...document.querySelectorAll('.learn-sheet .la-grow')].map((el) => getComputedStyle(el).animationName))
    check('reduced motion: illustrations have no animation', anim.length > 0 && anim.every((n) => n === 'none'), JSON.stringify(anim.slice(0, 3)))
    await ctx.close()
  }

  // ── 2. Desktop (1280x800) ─────────────────────────────────────────────────
  {
    const { ctx, page, errors } = await open(browser, DESK)
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.learn-list button', { timeout: 20000 })

    const tryBox = await page.getByRole('button', { name: /try with a sample wallet/i }).boundingBox()
    check('desktop: "Try with a sample wallet" visible without scrolling', !!tryBox && tryBox.y + tryBox.height <= DESK.height, JSON.stringify(tryBox))
    check('desktop: 17 features in the list', (await page.locator('.learn-list button[data-feature]').count()) === SLUGS.length)
    const groups = await page.evaluate((earnCount) => {
      const titles = [...document.querySelectorAll('.learn-list-title')].map((t) => t.textContent.trim())
      const order = [...document.querySelectorAll('.learn-list button[data-feature]')].map((b) => b.dataset.group)
      const firstBooks = order.indexOf('books')
      return {
        titles,
        earnFirst: firstBooks === earnCount,
        allEarnBeforeBooks:
          order.slice(0, firstBooks).every((g) => g === 'earn') && order.slice(firstBooks).every((g) => g === 'books'),
      }
    }, EARN_SLUGS.length)
    check('desktop: two groups, "Earn on your NIM" then "Your books, kept for you"',
      groups.titles[0] === 'Earn on your NIM' && groups.titles[1] === 'Your books, kept for you' && groups.earnFirst && groups.allEarnBeforeBooks,
      JSON.stringify(groups))
    check('desktop: no sheet (the explainer is in place)', (await page.locator('.learn-sheet').count()) === 0)
    check('desktop: "Open on your phone" code shown', (await page.locator('.learn-phone-qr svg').count()) === 1)
    check('desktop: QR is labelled for Nimiq Pay', (await page.locator('.learn-phone-qr svg').getAttribute('aria-label')) === 'QR code that opens NimBooks in Nimiq Pay')
    check('desktop: no horizontal overflow at 1280', (await overflow(page)) <= 1, `overflow=${await overflow(page)}`)
    allText.push(await page.locator('body').innerText())
    check('desktop: no page errors on the landing', errors.length === 0, errors.slice(0, 3).join(' | '))

    for (const slug of SLUGS) {
      await page.locator(`.learn-list button[data-feature="${slug}"]`).click()
      await page.waitForFunction((s) => window.location.hash === `#/learn/${s}`, slug, { timeout: 5000 }).catch(() => {})
      const f = await page.evaluate(() => {
        const panel = document.querySelector('.learn-panel')
        const lists = panel ? panel.querySelectorAll('ul.learn-bullets') : []
        return {
          title: panel?.querySelector('h3')?.textContent?.trim() ?? '',
          steps: panel ? panel.querySelectorAll('ol.learn-steps > li').length : 0,
          behind: lists[0]?.querySelectorAll('li').length ?? 0,
          good: lists[1]?.querySelectorAll('li').length ?? 0,
          tryBtn: panel ? [...panel.querySelectorAll('button')].some((b) => /try it in the sample wallet/i.test(b.textContent)) : false,
          tourBtn: panel ? [...panel.querySelectorAll('button')].some((b) => /take the guided tour/i.test(b.textContent)) : false,
          text: panel ? panel.innerText : '',
          current: document.querySelector('.learn-list button[aria-current="true"]')?.dataset.feature ?? '',
        }
      })
      check(
        `desktop panel ${slug}: steps, behind the scenes, good to know, both buttons`,
        f.steps >= 3 && f.steps <= 4 && f.behind >= 2 && f.behind <= 4 && f.good >= 1 && f.good <= 5 && f.tryBtn && f.tourBtn && !!f.title && f.current === slug,
        JSON.stringify({ title: f.title, steps: f.steps, behind: f.behind, good: f.good, current: f.current })
      )
      check(`desktop ${slug}: address follows the selection`, (await hashNow(page)) === `#/learn/${slug}`, await hashNow(page))
      allText.push(f.text)
    }

    // Deep link on desktop: the panel opens on that feature, no sheet.
    await loadAt(page, BASE + '/#/learn/staking')
    await page.waitForSelector('.learn-panel', { timeout: 20000 })
    const staking = await page.evaluate(() => ({ title: document.querySelector('.learn-panel h3')?.textContent?.trim(), sheet: !!document.querySelector('.learn-sheet') }))
    check('desktop deep link #/learn/staking selects Staking in the panel', /staking/i.test(staking.title) && !staking.sheet, JSON.stringify(staking))

    // Try it for tax from the desktop panel.
    await page.locator('.learn-list button[data-feature="tax"]').click()
    await page.locator('.learn-panel button', { hasText: /try it in the sample wallet/i }).click()
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await page.waitForSelector('[data-learn="tax"]', { timeout: 30000 })
    await waitSampleIdle(page)
    const exportActive = await page.locator('.tab[aria-current="page"]').innerText().catch(() => '')
    check('desktop Try it (tax): lands on the Export tab', /export/i.test(exportActive), exportActive)
    check('desktop Try it (tax): no tour offer card', (await page.locator('#tour-offer-title').count()) === 0)
    check('desktop Try it (tax): no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // Desktop: Take the guided tour shows the offer.
  {
    const { ctx, page, errors } = await open(browser, DESK)
    await loadAt(page, BASE + '/#/learn/privacy')
    await page.waitForSelector('.learn-panel', { timeout: 20000 })
    await page.locator('.learn-panel button', { hasText: /take the guided tour/i }).click()
    await page.waitForSelector('#tour-offer-title', { timeout: 30000 })
    check('desktop "Take the guided tour" shows the tour offer', true)
    check('desktop guided tour: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // ── 2b. The support section: donation address card + public supporters list
  //          served by a mocked /api/supporters (the probe never touches RPC).
  {
    const FIXTURE = {
      address: 'NQ39 XC3L JHXL 5GKB K09G J765 X577 PS3A KHFE',
      totalNim: 21809.29948,
      count: 1,
      supporters: [{ name: 'Wool', amountNim: 21809.29948, lastAt: 1791907083283 }],
      updatedAt: 1791907200000,
    }
    for (const [label, viewport] of [['phone', PHONE], ['desktop', DESK]]) {
      const { ctx, page, errors } = await open(browser, viewport)
      await page.route('**/api/supporters', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) }))
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      if (label === 'phone') await page.waitForSelector('.learn-card', { timeout: 20000 })
      else await page.waitForSelector('.learn-list button', { timeout: 20000 })
      await page.waitForSelector('.learn-support .learn-support-total', { timeout: 10000 })
      const facts = await page.evaluate(() => {
        const sec = document.querySelector('.learn-support')
        const copy = [...document.querySelectorAll('.learn-support-card button')].find((b) => /copy/i.test(b.textContent))
        return {
          present: !!sec,
          title: sec?.querySelector('h2')?.textContent?.trim() ?? '',
          addr: sec?.querySelector('.learn-support-addr')?.textContent?.trim() ?? '',
          hasCopy: !!copy,
          copyLabel: copy?.textContent?.trim() ?? '',
          qr: !!sec?.querySelector('svg.qr'),
          total: [...(sec?.querySelectorAll('.learn-support-total') ?? [])].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).join(''),
          list: [...(sec?.querySelectorAll('.learn-support-list li') ?? [])].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
          text: sec?.innerText ?? '',
        }
      })
      check(`${label}: support section shows the donation address in mono`, /NQ39 XC3L JHXL 5GKB K09G J765 X577 PS3A KHFE/.test(facts.addr), facts.addr)
      check(`${label}: support section has a copy button`, facts.hasCopy, JSON.stringify(facts))
      check(`${label}: support section shows a QR code`, facts.qr)
      check(`${label}: "Total raised: 21,809 NIM" (whole NIM, rounded down)`, /Total raised:\s*21,809 NIM/.test(facts.total), facts.total)
      check(`${label}: "Support NimBooks" heading and copy line`, facts.title === 'Support NimBooks' && /free and built by one person/.test(facts.text), JSON.stringify({ title: facts.title }))
      check(`${label}: ImpactZero staking line`, /Staking with ImpactZero, the validator run by the person who builds NimBooks, also supports it/.test(facts.text))
      check(`${label}: supporters list shows "Wool" with his amount`,
        facts.list.some((li) => /Wool/.test(li) && /21,809 NIM/.test(li)), JSON.stringify(facts.list))
      check(`${label}: body text carries no supporter address ("NQ88")`, !(await page.evaluate(() => document.body.innerText)).includes('NQ88'))
      check(`${label}: no horizontal overflow at 360px (support section)`, (await overflow(page)) <= 1, `overflow=${await overflow(page)}`)
      check(`${label}: support section: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
      await ctx.close()
    }

    // API fails: the address card stays, the list part hides.
    {
      const { ctx, page, errors } = await open(browser, PHONE)
      await page.route('**/api/supporters', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) }))
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.learn-support .learn-support-card', { timeout: 10000 })
      const down = await page.evaluate(() => {
        const sec = document.querySelector('.learn-support')
        return {
          addr: sec?.querySelector('.learn-support-addr')?.textContent?.trim() ?? '',
          copy: [...(sec?.querySelectorAll('button') ?? [])].some((b) => /copy/i.test(b.textContent)),
          qr: !!sec?.querySelector('svg.qr'),
          total: !!sec?.querySelector('.learn-support-total'),
          list: !!sec?.querySelector('.learn-support-list'),
        }
      })
      check('API 503: the address card still renders', /NQ39 XC3L/.test(down.addr) && down.copy && down.qr, JSON.stringify(down))
      check('API 503: the supporters list hides, gracefully', !down.total && !down.list, JSON.stringify(down))
      check('API 503: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
      await ctx.close()
    }

    // Zero donations: "Be the first supporter".
    {
      const { ctx, page } = await open(browser, PHONE)
      await page.route('**/api/supporters', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ totalNim: 0, count: 0, supporters: [], updatedAt: 1 }) }))
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.learn-support-pool', { timeout: 10000 })
      check('zero donations: "Be the first supporter" shows',
        (await page.locator('.learn-support-pool').innerText()).includes('Be the first supporter'))
      await ctx.close()
    }
  }

  // ── 3. Copy rules across everything the probe read ────────────────────────
  const joined = allText.join('\n')
  check('no em-dash in rendered landing or explainer text', !joined.includes(EM_DASH), `${(joined.match(new RegExp(EM_DASH, 'g')) || []).length} found`)
  check('no "base.org" in rendered text', !/base\.org/i.test(joined))

  console.log(`\n${new Set(noise).size} distinct environment messages ignored (preview server 404s, CoinGecko 429s)`)
  console.log(`${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
