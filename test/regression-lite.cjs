// Regression-lite battery (firefox): core demo journey + copy/label gates,
// plus statement / tax / load-older coverage (v1.30: full-history rewards).
// Recreation of the freeze-gate + invoice batteries after /tmp housekeeping
// wiped them; kept in-repo so it survives. Run with playwright installed:
//   NODE_PATH=<dir containing playwright> node test/regression-lite.js [BASE_URL]
// (firefox, not chromium: the chromium compositor crashes on some kernels.)
const { firefox } = require('playwright');
const {
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
} = require('./lib/regression-lite-helpers.cjs');

// A retired validator with 10k+ transactions: the plain 1,000-row history
// loader hits the cap, so the Export tab offers "Load older history".
const CAPPED_ADDR = 'NQ97 H1NR S3X0 CVFQ VJ9Y 9A0Y FRQN Q6EU D0PL';
// An xFratta run validator, staking since January 2025 with only ~100 chain
// transactions: history is short, but hundreds of synthetic reward rows get
// merged in. Regression guard: reward rows must not trip historyHitCap.
const STAKER_ADDR = 'NQ62 68D7 RQHN MSTR 1Y0T SY1P HU89 5QJ5 YV05';

(async () => {
  const base = process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8099';
  // Mutation proof switch: RL_MUTATE=1 multiplies the S3 expected reward total
  // by 0.5, so the S3 equality check must fail; unset means the honest run.
  const mutate = !!process.env.RL_MUTATE;
  const browser = await firefox.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let pass = 0, fail = 0;
  const t = (name, ok, extra = '') => {
    console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' ' + extra : ''));
    ok ? pass++ : fail++;
  };

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 1. Cold open renders + current badge (label derived from package.json
  // so the gate can never go stale on a version bump)
  const pkgVersion = require('path').join(__dirname, '..', 'package.json');
  const expected = 'v' + require(pkgVersion).version;
  const body = await page.locator('body').innerText();
  t('cold open renders', body.length > 200);
  t('version badge visible (' + expected + ')', await page.getByText(expected, { exact: true }).count() > 0);

  // 2. Demo journey: sample wallet -> dashboard
  const demo = page.locator('button:has-text("sample wallet"), button:has-text("demo"), a:has-text("demo")').first();
  if (await demo.count() > 0) { await demo.click(); await page.waitForTimeout(1800); }
  const demoBody = await page.locator('body').innerText();
  t('demo dashboard renders', /balance|NIM/i.test(demoBody));

  // 3. Dock tabs reachable
  const tabs = page.locator('nav button, .dock button, [data-tour$="-tab"]');
  t('dock tabs present', (await tabs.count()) >= 3);

  // 4. Send sheet: demo banner (v1.19.0 regression anchor)
  const sendBtn = page.locator('button:has-text("Send")').first();
  if (await sendBtn.count() > 0) {
    await sendBtn.click(); await page.waitForTimeout(800);
    t('send demo banner', await page.locator('.demo-banner').count() > 0);
    const close = page.locator('[aria-label="Close"]').first();
    if (await close.count() > 0) await close.click();
  } else t('send demo banner', false, 'send button missing');

  // 5. Changelog modal: pinned feedback line + entries
  const badge = page.locator('.version-badge').first();
  if (await badge.count() > 0) {
    await badge.click(); await page.waitForTimeout(800);
    t('changelog feedback line', await page.locator('.changelog-feedback').count() > 0);
    const fbText = await page.locator('.changelog-feedback').first().innerText().catch(() => '');
    t('feedback line is the email', fbText.includes('nimbooks@subimpact.net') && !fbText.includes('at nimbooks.subimpact.net'), JSON.stringify(fbText.trim().slice(0, 60)));
    const tg = await page.locator('.changelog-feedback a[href="https://t.me/subimpactNET/6"]').count();
    t('feedback line links the Telegram group', tg === 1);
    t('changelog has entries', await page.locator('.changelog-entry').count() >= 3);
    const close = page.locator('[aria-label="Close"]').first();
    if (await close.count() > 0) await close.click();
    await page.waitForTimeout(400);
  } else {
    t('changelog feedback line', false, 'badge missing');
    t('changelog has entries', false, 'badge missing');
  }

  // 6. Export view: portfolio report card unlocked in demo
  const exportTab = page.locator('[data-tour="export-tab"], button:has-text("Export")').first();
  const exportSeen = (await exportTab.count()) > 0;
  if (exportSeen) {
    await exportTab.click();
    await page.waitForTimeout(800);
    const portfolioCard = page.locator('.portfolio-card');
    const cardCount = await portfolioCard.count();
    const cardText = cardCount > 0 ? await portfolioCard.first().innerText() : '';
    // .label is text-transform: uppercase, and innerText reflects that.
    const hasReportText = /portfolio report/i.test(cardText);
    const isLocked = (await page.locator('.portfolio-card.locked, .portfolio-card .gate-locked').count()) > 0;
    const savePdf = portfolioCard.locator('button:has-text("Save as PDF")').first();
    const savePdfEnabled = (await savePdf.count()) > 0 && !(await savePdf.isDisabled());
    t(
      'portfolio report unlocked in demo',
      cardCount > 0 && hasReportText && !isLocked && savePdfEnabled,
      cardCount === 0
        ? 'card missing'
        : !hasReportText
          ? 'title missing'
          : isLocked
            ? 'unexpectedly locked'
            : !savePdfEnabled
              ? 'save button disabled or missing'
              : ''
    );
  } else {
    t('portfolio report unlocked in demo', false, 'export tab missing');
  }

  // 6b. Demo Export view: statement card, tax card, no load-older (D1-D4).
  {
    if (!exportSeen) {
      t('D1 statement summary rows on demo', false, 'export tab missing');
      t('D2 statementYear picker on demo', false, 'export tab missing');
      t('D3 tax card rows on demo', false, 'export tab missing');
      t('D4 no Load older history on demo', false, 'export tab missing');
    } else {
      const stmt = statementCard(page);
      await stmt.locator('.statement-summary').first().waitFor({ timeout: 20000 })
        .catch(() => {}); // demo data is local; long waits are not needed here

      /* D1: summary labels (case-insensitive: labels render uppercase) */
      const d1rows = await summaryRows(stmt);
      const d1need = ['received', 'sent to others', 'rewards', 'net change'];
      const d1missing = d1need.filter((l) => !rowByLabel(d1rows, l));
      t(
        'D1 statement summary rows (received/sent to others/rewards/net change)',
        d1missing.length === 0,
        d1missing.length ? 'missing: ' + d1missing.join(', ') + ' got: ' + JSON.stringify(d1rows.map((r) => r[0])) : ''
      );

      /* D2: year picker -> newest year rebuilds -> restore all */
      const d2sel = stmt.locator('#statementYear');
      const d2vals = (await d2sel.count()) > 0
        ? await d2sel.locator('option').evaluateAll((os) => os.map((o) => o.getAttribute('value')))
        : [];
      const d2years = d2vals.filter((v) => /^\d{4}$/.test(v)).sort();
      const d2newest = d2years[d2years.length - 1];
      t(
        'D2 statementYear offers all + at least one year',
        d2vals.includes('all') && d2years.length >= 1,
        JSON.stringify(d2vals)
      );
      if (d2newest) {
        await d2sel.selectOption(d2newest);
        let rebuilt = false;
        for (let i = 0; i < 40 && !rebuilt; i++) {
          rebuilt = (await d2sel.inputValue()) === d2newest && !!rowByLabel(await summaryRows(stmt), 'rewards');
          if (!rebuilt) await page.waitForTimeout(250);
        }
        t(
          'D2 selecting year ' + d2newest + ' rebuilds summary (Rewards row still present)',
          rebuilt,
          rebuilt ? '' : 'no rebuilt summary with a Rewards row in 10s'
        );
        await d2sel.selectOption('all');
        await page.waitForTimeout(400);
      }

      /* D3: tax card = year rows with Gain/Income figures, or "None in this history" */
      const taxDemo = taxCard(page);
      const taxRows = await taxDemo.count() > 0
        ? await taxDemo.locator('.tax-year-row').evaluateAll((rows) =>
            rows.map((r) => ({
              year: (r.querySelector('.tax-year') || {}).innerText || '',
              figures: (r.querySelector('.tax-year-figures') || {}).innerText || '',
            })))
        : [];
      const taxFigOk = taxRows.some((r) => /gain .* · income .*/i.test(r.figures));
      const taxNoneOk = (await taxDemo.count()) > 0
        && /none in this history/i.test(await taxDemo.innerText().catch(() => ''));
      t(
        'D3 tax card rows (Gain/Income or None in this history)',
        (await taxDemo.count()) > 0 && (taxFigOk || taxNoneOk),
        taxFigOk ? '' : 'rows: ' + JSON.stringify(taxRows)
      );

      /* D4: demo wallet is small, so the cap button must be absent */
      await page.waitForTimeout(500);
      t('D4 no Load older history on the demo wallet', (await loadOlderButton(page).count()) === 0);
    }
  }

  // 7. Verify page stands alone (garbage invoice handled)
  await page.goto(base + '/verify/#garbage-not-a-receipt', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const verifyBody = await page.locator('body').innerText();
  t('verify page handles garbage', verifyBody.length > 30 && !verifyBody.toLowerCase().includes('unhandled'));

  // 8. Zero em-dash in rendered copy across routes
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const finalBody = await page.locator('body').innerText();
  t('no em-dash in rendered copy', !finalBody.includes('\u2014'));

  // 9. Zero console errors on the demo page battery
  t('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  // 10. Capped-wallet leg (C1-C3): pay session on a retired validator. The
  // plain 1,000-row loader hits the cap and offers "Load older history".
  //
  // Reaching the cap: the app's own 250ms-per-page pacing trips the nimiqwatch
  // RPC rate limiter around page 16 of 20 (see the helper's fetchTxWindowRows
  // comment), and a partial slot makes its 10s heartbeat re-walk from scratch,
  // so the plain loader cannot get there by itself from this environment. So
  // the browser is seeded with what exactly one successful plain walk would
  // have cached: 1,000 real chain rows fetched by the helper at the tolerated
  // pace, in the app's own written format. The app then opens with an already
  // capped list, and the checks below exercise the cap-driven UI truthfully.
  let capCtx = null;
  {
    const capErrors = [];
    try {
      const capRows = mapTxRows(await fetchTxWindowRows(CAPPED_ADDR));
      const flat = CAPPED_ADDR.replace(/\s+/g, '');
      const capSeed = { key: 'nimbooks:txs:' + flat, entry: { address: CAPPED_ADDR, at: Date.now(), txs: capRows } };
      const opened = await openPayExport(browser, base, CAPPED_ADDR, (p) =>
        p.on('pageerror', (e) => capErrors.push(String(e))), capSeed);
      capCtx = opened.ctx;
      const capPage = opened.page;
      const capBtn = loadOlderButton(capPage);
      let capped = true;
      await capBtn.waitFor({ state: 'visible', timeout: 90000 }).catch(() => { capped = false; });
      t('C1 Load older history appears (capped history, <=90s)', capped);

      let dialogOpen = false, closed = false;
      if (capped) {
        await capBtn.click();
        // The confirm dialog: a role=dialog with aria-label "Load older
        // history" (src/App.tsx extendedConfirmOpen modal). Never confirm it:
        // accepting would walk every older transaction (44k rows).
        const dialog = capPage.locator('[role="dialog"][aria-label="Load older history"]');
        dialogOpen = await dialog.waitFor({ state: 'visible', timeout: 10000 })
          .then(() => true).catch(() => false);
        if (dialogOpen) {
          // Its markup has a header close control (button[aria-label="Close"]),
          // and a Cancel button beside the Load confirm; both are safe.
          const closeCtl = dialog.locator('button[aria-label="Close"], button:has-text("Cancel")').first();
          await closeCtl.click();
          closed = await dialog.waitFor({ state: 'detached', timeout: 10000 })
            .then(() => true).catch(() => false);
          await capPage.waitForTimeout(1500);
          const loadingShown = (await capPage.locator('body').innerText()).match(/loading older history/i);
          t(
            'C2 dialog opens and its close control dismisses it (no load started)',
            closed && !loadingShown,
            !dialogOpen ? 'dialog never opened' : !closed ? 'dialog stayed open' : loadingShown ? 'loading text: ' + loadingShown : ''
          );
        } else {
          t('C2 dialog opens and its close control dismisses it (no load started)', false, 'dialog never opened');
        }
      }
      t('C3 zero page errors on the capped page', capErrors.length === 0, capErrors.slice(0, 2).join(' | '));
    } catch (e) {
      t('C1 Load older history appears (capped history, <=90s)', false, String(e).slice(0, 120));
      t('C2 dialog opens and its close control dismisses it (no load started)', false, 'leg errored');
      t('C3 zero page errors on the capped page', false, 'leg errored');
    }
    if (capCtx) await capCtx.close().catch(() => {});
  }

  // 11. Live staker leg (S1, S3-S6): Pay session on an xFratta validator,
  // staking since January 2025 with only ~100 chain transactions. The
  // statement must merge in hundreds of synthetic reward rows, and the cap
  // button must stay away: reward rows do not count toward the 1,000 cap.
  let liveCtx = null;
  {
    const liveErrors = [];
    const restakeRequests = [];

    /* S3 expected total, from the same open data the app reads (Nimiq
       Watch v2 restake events): windows starting in 2025, summed. */
    let expNim = null;
    let expErr = '';
    try {
      expNim = await restakeYearNim(STAKER_ADDR, '2025');
      if (mutate) expNim *= 0.5;
    } catch (e) {
      expErr = 'nimiqwatch fetch failed: ' + String(e).slice(0, 120);
    }

    try {
      const opened = await openPayExport(browser, base, STAKER_ADDR, (p) => {
        p.on('pageerror', (e) => liveErrors.push(String(e)));
        p.on('request', (req) => {
          const u = req.url();
          if (u.includes('restake-grouped')) restakeRequests.push(u);
        });
      });
      liveCtx = opened.ctx;
      const livePage = opened.page;
      const stmt = statementCard(livePage);

      // S3: statement year 2025, then poll for the Rewards row to fill in.
      const yearSel = stmt.locator('#statementYear');
      const years = await yearSel.locator('option').evaluateAll((os) => os.map((o) => o.getAttribute('value')));
      t('S3 setup: year 2025 offered in #statementYear', years.includes('2025'), JSON.stringify(years));
      let rewardsNim = 0, rewardsRow = '';
      if (years.includes('2025')) {
        await yearSel.selectOption('2025');
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          const r = rowByLabel(await summaryRows(stmt), 'rewards');
          const v = r ? num(r[1]) : 0;
          if (v > 0) { rewardsRow = r[1]; rewardsNim = v; break; }
          await livePage.waitForTimeout(500);
        }
      }
      t(
        'S3 2025 Rewards row filled in (statement, <=90s)',
        rewardsNim > 0,
        expErr || (rewardsNim > 0 ? rewardsRow : 'rewards row stayed zero/missing in 90s')
      );
      t(
        'S3 sanity: expected 2025 rewards are a full year (> 1000 NIM)',
        expNim !== null && expNim > 1000,
        'expected=' + (expNim === null ? 'n/a' : expNim.toFixed(5)) + ' NIM'
      );
      t(
        'S3 statement 2025 Rewards == Nimiq Watch total (+/- 0.01 NIM)',
        expNim !== null && rewardsNim > 0 && Math.abs(rewardsNim - expNim) <= 0.01,
        'api=' + (expNim === null ? 'n/a' : expNim.toFixed(5)) + ' NIM, app=' + rewardsNim.toFixed(5) + ' NIM'
      );

      // S1: with ~100 real txs but hundreds of reward rows, the cap button
      // must be ABSENT (historyHitCap ignores synthetic rows). Give the
      // derived state a beat to settle after the reward rows landed.
      await livePage.waitForTimeout(2500);
      t('S1 Load older history ABSENT (rewards do not count toward the cap)', (await loadOlderButton(livePage).count()) === 0);

      // S4: tax card has a 2025 row with non-zero income (rewards are income).
      const tax = taxCard(livePage);
      let income2025 = null;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && income2025 === null) {
        const rows = await tax.locator('.tax-year-row').evaluateAll((rs) =>
          rs.map((r) => ({
            year: ((r.querySelector('.tax-year') || {}).innerText || '').trim(),
            figures: (r.querySelector('.tax-year-figures') || {}).innerText || '',
          })));
        for (const r of rows) {
          if (r.year === '2025') {
            const m = /income\s+([^·]+)/i.exec(r.figures);
            const v = m ? num(m[1]) : NaN;
            if (Number.isFinite(v) && v !== 0) income2025 = v;
          }
        }
        if (income2025 === null) await livePage.waitForTimeout(1000);
      }
      t(
        'S4 tax card 2025 income is non-zero',
        income2025 !== null,
        income2025 !== null ? 'income=' + income2025 : 'no 2025 tax row with non-zero income in 30s'
      );

      // S6: the page itself requested the full-year rewards window.
      const fullYearReqs = restakeRequests.filter((u) => {
        try { return new URL(u).searchParams.get('from') === '2025-01-01'; } catch { return false; }
      });
      const seen = restakeRequests.map((u) => {
        try { const q = new URL(u).searchParams; return q.get('from') + '>' + q.get('to'); } catch { return u; }
      });
      t(
        'S6 page requested rewards with from=2025-01-01 (full history, not 90d)',
        fullYearReqs.length > 0,
        'restake requests: ' + JSON.stringify(seen)
      );

      // S5: copy + errors on the live page.
      const stmtText = await stmt.innerText().catch(() => '');
      const taxText = (await tax.count()) > 0 ? await tax.innerText().catch(() => '') : '';
      t('S5 no em-dash in statement or tax card text', !stmtText.includes('\u2014') && !taxText.includes('\u2014'));
      t('S5 zero page errors on the live staker page', liveErrors.length === 0, liveErrors.slice(0, 2).join(' | '));
    } catch (e) {
      t('S3 setup: year 2025 offered in #statementYear', false, String(e).slice(0, 120));
      t('S3 2025 Rewards row filled in (statement, <=90s)', false, 'leg errored: ' + String(e).slice(0, 120));
      t('S3 sanity: expected 2025 rewards are a full year (> 1000 NIM)', expNim !== null && expNim > 1000, 'expected=' + (expNim === null ? 'n/a' : expNim.toFixed(5)) + ' NIM');
      t('S3 statement 2025 Rewards == Nimiq Watch total (+/- 0.01 NIM)', false, 'leg errored');
      t('S1 Load older history ABSENT (rewards do not count toward the cap)', false, 'leg errored');
      t('S4 tax card 2025 income is non-zero', false, 'leg errored');
      t('S6 page requested rewards with from=2025-01-01 (full history, not 90d)', restakeRequests.some((u) => { try { return new URL(u).searchParams.get('from') === '2025-01-01'; } catch { return false; } }), 'requests: ' + restakeRequests.length);
      t('S5 no em-dash in statement or tax card text', false, 'leg errored');
      t('S5 zero page errors on the live staker page', false, 'leg errored');
    }
    if (liveCtx) await liveCtx.close().catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();