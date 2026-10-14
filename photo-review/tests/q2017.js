const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://127.0.0.1:2292/'); await p.waitForFunction(() => document.querySelectorAll('#jump option').length > 3);
    const idx = await p.$$eval('#jump option', os => os.findIndex(o => /USA 2017/.test(o.textContent)));
    await p.selectOption('#jump', String(idx)); await p.waitForTimeout(1200);
    console.log(W, '| h1:', await p.textContent('h1'), '| q:', await p.textContent('#q h2'), '| month label:', await p.textContent('label[for=month]'),
      '| preselected:', await p.$$eval('.opt.on', o => o.map(x => x.textContent.slice(0, 30))), '| hint:', (await p.textContent('.hint').catch(() => '')).slice(0, 60), '| h-scroll ok:', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '| errors', errs.length);
    if (W === 390) await p.screenshot({ path: process.argv[2] + '/q2017_390.png' });
  }
  await b.close();
})();
