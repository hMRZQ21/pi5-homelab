const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:2291/';
let fails = 0, passes = 0;
const ck = (n, ok, x = '') => { ok ? passes++ : fails++; console.log((ok ? 'ok   ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const post = async (b) => { const r = await fetch(BASE + 'api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof b === 'string' ? b : JSON.stringify(b) }); return r.status; };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, userAgent: 'TestUA-' + W }); const page = await ctx.newPage(); const t = W + 'px';
    // --- questions page
    await page.goto(BASE); await page.waitForSelector('#card .q, #card .opt, .opt'); 
    await page.waitForTimeout(600);
    await page.click('.foot .btn.pri'); await page.waitForTimeout(400);
    ck(`[${t}] questions: save without a name shows the message`, /pick who/i.test(await page.textContent('#msg')));
    await page.click(`#who .pill:has-text("Ghazi")`); await page.waitForTimeout(300);
    await page.route('**/api/answer', r => r.abort());
    await page.click('.opt >> nth=0'); await page.click('.foot .btn.pri'); await page.waitForTimeout(600);
    ck(`[${t}] questions: failed save shows "Could not save"`, /Could not save/.test(await page.textContent('#msg')), await page.textContent('#msg'));
    await page.unroute('**/api/answer');
    await page.click('.foot .btn.pri'); await page.waitForFunction(() => /Saved ✓ as Ghazi/.test(document.getElementById('msg').textContent), null, { timeout: 5000 }).catch(() => {});
    ck(`[${t}] questions: success banner names the person`, /Saved ✓ as Ghazi/.test(await page.textContent('#msg')), await page.textContent('#msg'));
    // --- pairs page: refuse without name, then save
    const ctx2 = await browser.newContext({ viewport: { width: W, height: H }, userAgent: 'TestUA-pairs-' + W }); const p2 = await ctx2.newPage();
    await p2.goto(BASE + 'pairs'); await p2.waitForSelector('.row'); await p2.click('#save'); await p2.waitForTimeout(400);
    ck(`[${t}] pairs: refused without a name`, /pick who/i.test(await p2.textContent('#msg')));
    await p2.click('#who .pill:has-text("Ghazi")'); await p2.click('#save'); await p2.waitForFunction(() => /Saved/.test(document.getElementById('msg').textContent));
    ck(`[${t}] pairs: banner`, /Saved ✓ 10 decisions as Ghazi/.test(await p2.textContent('#msg')), await p2.textContent('#msg'));
    // --- dups page + a js error
    const p3 = await ctx2.newPage(); await p3.goto(BASE + 'dups'); await p3.waitForFunction(() => document.getElementById('prog').textContent !== 'Loading…');
    await p3.evaluate(() => setTimeout(() => { throw new Error('boom-test') }, 0)); await p3.waitForTimeout(600);
    await ctx.close(); await ctx2.close();
  }
  // server validation of /api/event
  ck('server: unknown type -> 400', await post({ page: 'pairs', type: 'nope', who: null }) === 400);
  ck('server: unknown page -> 400', await post({ page: 'x', type: 'open', who: null }) === 400);
  ck('server: unknown name -> 400', await post({ page: 'pairs', type: 'pick', who: 'Eve' }) === 400);
  ck('server: bad json -> 400', await post('{nope') === 400);
  ck('server: oversized -> 400', await post({ page: 'pairs', type: 'open', who: null, detail: 'x'.repeat(5000) }) === 400);
  ck('server: valid -> 200', await post({ page: 'pairs', type: 'open', who: 'Reem', detail: 'ok' }) === 200);
  console.log(`\n${passes} passed, ${fails} failed`); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
