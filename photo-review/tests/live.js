const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e))); p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url()); });
    await p.goto('http://127.0.0.1:2292/'); await p.waitForSelector('.tabs'); await p.waitForTimeout(1500);
    const prog = await p.textContent('#prog'); const ow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    await p.goto('http://127.0.0.1:2292/pairs'); await p.waitForSelector('.row');
    const rows = (await p.$$('.row')).length, ow2 = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    console.log(W, '| questions:', prog.slice(0, 70), '| no h-scroll', ow, '| pairs rows', rows, 'no h-scroll', ow2, '| errors', errs.length, errs.slice(0, 2));
    if (W === 1440) { await p.goto('http://127.0.0.1:2292/'); await p.waitForTimeout(1500); await p.screenshot({ path: process.argv[2] + '/live_questions.png' }); }
  }
  await b.close();
})();
