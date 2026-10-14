const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e))); p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url()); });
    await p.goto('http://127.0.0.1:2292/pairs'); await p.waitForFunction(() => document.getElementById('prog').textContent !== 'Loading…');
    const pairs = [await p.textContent('#prog'), await p.$$eval('[data-mode]', b => b.map(x => x.textContent).join(' | ')), await p.textContent('#list')];
    await p.goto('http://127.0.0.1:2292/dups'); await p.waitForFunction(() => document.getElementById('prog').textContent !== 'Loading…');
    const dups = [await p.textContent('#prog'), (await p.textContent('#list')).slice(0, 70)];
    console.log(W, '| pairs:', JSON.stringify(pairs), '| dups:', JSON.stringify(dups), '| errors', errs.length);
    if (W === 390) await p.screenshot({ path: process.argv[2] + '/pairs_empty_390.png' });
  }
  await b.close();
})();
