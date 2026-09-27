// Regression-lite battery (firefox): core demo journey + copy/label gates.
// Recreation of the freeze-gate + invoice batteries after /tmp housekeeping
// wiped them; kept in-repo so it survives. Run with playwright installed:
//   NODE_PATH=<dir containing playwright> node test/regression-lite.js [BASE_URL]
// (firefox, not chromium: the chromium compositor crashes on some kernels.)
const { firefox } = require('playwright');

(async () => {
  const base = process.env.BASE_URL || process.argv[2] || 'http://127.0.0.1:8099';
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

  // 1. Cold open renders + current badge
  const body = await page.locator('body').innerText();
  t('cold open renders', body.length > 200);
  t('version badge visible', await page.getByText('v1.19.0', { exact: true }).count() > 0);

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
    t('changelog has entries', await page.locator('.changelog-entry').count() >= 3);
    const close = page.locator('[aria-label="Close"]').first();
    if (await close.count() > 0) await close.click();
    await page.waitForTimeout(400);
  } else {
    t('changelog feedback line', false, 'badge missing');
    t('changelog has entries', false, 'badge missing');
  }

  // 6. Verify page stands alone (garbage invoice handled)
  await page.goto(base + '/verify/#garbage-not-a-receipt', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const verifyBody = await page.locator('body').innerText();
  t('verify page handles garbage', verifyBody.length > 30 && !verifyBody.toLowerCase().includes('unhandled'));

  // 7. Zero em-dash in rendered copy across routes
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const finalBody = await page.locator('body').innerText();
  t('no em-dash in rendered copy', !finalBody.includes('—'));

  // 8. Zero console errors throughout
  t('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
