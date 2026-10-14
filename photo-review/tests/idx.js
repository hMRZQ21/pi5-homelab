const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e))); p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url()); });
    await p.goto('http://127.0.0.1:2292/'); await p.waitForFunction(() => document.querySelectorAll('#jump option').length > 3);
    const opts = await p.$$eval('#jump option', os => os.map(o => o.textContent));
    const idx = opts.findIndex(t => /Left over/.test(t)); await p.selectOption('#jump', String(idx)); await p.waitForTimeout(1500);
    const imgs = await p.$$eval('#card img', is => ({ n: is.length, bad: is.filter(i => !(i.complete && i.naturalWidth > 0)).length }));
    console.log(W, '| groups', opts.length, '| leftover option:', opts[idx].slice(0, 60), '| tiles', imgs.n, 'undecoded', imgs.bad, '| h-scroll ok', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '| errors', errs.length);
  }
  await b.close();
})();
