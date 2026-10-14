const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:2291/';
const OUT = process.argv[2];
let fails = 0, passes = 0;
const ck = (name, ok, extra = '') => { if (ok) passes++; else fails++; console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const post = async (path, body) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return [r.status, await r.json()]; };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  for (const [W, H] of [[1440, 900], [390, 844]]) {
    const tag = W + 'px';
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
    await page.goto(BASE + 'pairs'); await page.waitForSelector('.row');
    ck(`[${tag}] pairs page loads`, true);
    const tabs = await page.$$eval('.tabs a', a => a.map(x => x.textContent));
    ck(`[${tag}] tabs`, tabs.join() === 'Photo questions,Duplicates,Pairs', tabs.join());
    const modes = await page.$$eval('[data-mode]', b => b.map(x => x.textContent));
    ck(`[${tag}] mode counts`, modes.join('|') === 'Edited vs original (121)|Studio look-alikes (4)|Burst frames (30)', modes.join('|'));
    ck(`[${tag}] 10 rows on page 1`, (await page.$$('.row')).length === 10);
    ck(`[${tag}] every pair shows 2 tiles, one in trash now`, await page.$$eval('.row', rs => rs.every(r => r.querySelectorAll('.m').length === 2 && r.querySelectorAll('.nowt').length === 1)));
    // save without who
    await page.evaluate(() => { try { localStorage.removeItem('pr_who') } catch (e) {} });
    await page.reload(); await page.waitForSelector('.row');
    await page.click('#save'); ck(`[${tag}] save without a name is refused`, /pick who/i.test(await page.textContent('#msg')));
    // images decode (scroll through the page so lazy images load)
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(800);
    const bad = await page.$$eval('.row img', is => is.filter(i => !(i.complete && i.naturalWidth > 0)).length);
    ck(`[${tag}] all thumbnails decode`, bad === 0, 'undecoded ' + bad);
    // pick who, change the first pair
    await page.click(`#who .pill:has-text("${W === 1440 ? 'Hussam' : 'Ghazi'}")`);
    const first = page.locator('.row').first();
    const chg = () => first.locator('.chg').textContent();
    ck(`[${tag}] default = no change`, (await chg()).startsWith('No change'));
    const tiles = first.locator('.m');
    // find the tile that is in trash now and tap it
    const idx = await first.locator('.m').evaluateAll(ts => ts.findIndex(t => t.querySelector('.nowt')));
    await tiles.nth(idx).click();
    ck(`[${tag}] tapping the trashed one = taken out of the trash`, (await chg()).includes('1 will be taken out of the trash'), await chg());
    await first.locator('button:has-text("Edited only")').click();
    const keptEdited = await first.locator('.m.keep').evaluateAll(ts => ts.map(t => t.textContent));
    ck(`[${tag}] Edited only keeps one`, keptEdited.length === 1 && /edited version/.test(keptEdited[0]), keptEdited.join().slice(0, 60));
    await first.locator('button:has-text("Original only")').click();
    ck(`[${tag}] Original only restores one and trashes one or no change`, /original/.test(await first.locator('.m.keep').first().textContent()));
    await first.locator('button:has-text("Keep all")').click();
    ck(`[${tag}] Keep all`, (await first.locator('.m.keep').count()) === 2);
    await first.locator('button:has-text("As it is now")').click();
    ck(`[${tag}] As it is now resets`, (await chg()).startsWith('No change'));
    // compare overlay
    await first.locator('button:has-text("Compare large")').click();
    await page.waitForTimeout(500);
    ck(`[${tag}] compare overlay: 2 images`, (await page.$$('#cmp img')).length === 2 && await page.$eval('#ov', o => o.classList.contains('on')));
    await page.click('#ovc');
    // overflow check
    ck(`[${tag}] no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (W === 1440) await page.screenshot({ path: `${OUT}/pairs_edit_${tag}.png` }); else await page.screenshot({ path: `${OUT}/pairs_edit_${tag}.png`, fullPage: false });
    // set row 1 = keep both, row 2 = original only, save the page
    await first.locator('button:has-text("Keep all")').click();
    const second = page.locator('.row').nth(1); await second.locator('button:has-text("Original only")').click();
    if (W === 1440) {
      await page.click('#save'); await page.waitForFunction(() => /Saved/.test(document.getElementById('msg').textContent));
      ck(`[${tag}] saved 10 decisions`, /Saved ✓ 10 decisions as Hussam/.test(await page.textContent('#msg')), await page.textContent('#msg'));
      ck(`[${tag}] moved to page 2`, /Page 2 of 13/.test(await page.textContent('#pg')), await page.textContent('#pg'));
      await page.reload(); await page.waitForSelector('.row');
      const r1 = page.locator('.row').first();
      ck(`[${tag}] reload: first pair shows decided + both kept`, (await r1.locator('.done').count()) === 1 && (await r1.locator('.m.keep').count()) === 2);
      const r2 = page.locator('.row').nth(1);
      ck(`[${tag}] reload: second pair = original only`, (await r2.locator('.m.keep').count()) === 1 && /original/.test(await r2.locator('.m.keep').textContent()));
      ck(`[${tag}] progress text`, /10 of 155 decided by Hussam/.test(await page.textContent('#prog')), await page.textContent('#prog'));
      // another person sees Hussam's choice
      await page.click('#who .pill:has-text("Wissam")');
      ck(`[${tag}] other person sees "Others: Hussam keeps"`, /Others: Hussam keeps 2 of 2/.test(await page.locator('.row').first().textContent()));
    }
    // studio and frames modes
    await page.click('[data-mode="studio"]'); await page.waitForSelector('.row');
    ck(`[${tag}] studio: 4 groups`, (await page.$$('.row')).length === 4);
    await page.click('[data-mode="frames"]'); await page.waitForSelector('.row');
    ck(`[${tag}] frames: 10 rows, all kept by default`, (await page.$$('.row')).length === 10 && (await page.$$eval('.row', rs => rs.every(r => r.querySelectorAll('.m.trash').length === 0))));
    if (W === 390) { ck(`[${tag}] no horizontal scroll (frames)`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); await page.screenshot({ path: `${OUT}/pairs_frames_${tag}.png` }); }
    if (W === 1440) {
      const f = page.locator('.row').first(); await f.locator('.m').nth(1).click();
      ck(`[${tag}] frames: dropping one = moved to trash`, (await f.locator('.chg').textContent()).includes('1 will be moved to the trash'), await f.locator('.chg').textContent());
      await page.screenshot({ path: `${OUT}/pairs_frames_${tag}.png` });
    }
    ck(`[${tag}] no page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
    // other pages still fine
    await page.goto(BASE); await page.waitForSelector('.tabs');
    ck(`[${tag}] Photo questions page: tabs + groups`, (await page.$$eval('.tabs a', a => a.length)) === 3 && await page.evaluate(async () => (await (await fetch('api/state')).json()).groups.length) > 0);
    await page.goto(BASE + 'dups'); await page.waitForFunction(() => document.getElementById('prog').textContent !== 'Loading…');
    ck(`[${tag}] Duplicates page: tabs + closed notice`, (await page.$$eval('.tabs a', a => a.length)) === 3 && /done/.test(await page.textContent('#prog')), await page.textContent('#prog'));
    await ctx.close();
  }
  // server-side validation
  const st = await (await fetch(BASE + 'api/pairs/state')).json();
  const g = st.groups[5], ids = g.members.map(m => m.id);
  let r = await post('api/pairs/decide', { who: 'Hussam', decisions: [{ group: g.id, keep: [ids[0]], trash: [] }] }); ck('server: member missing -> 400', r[0] === 400, JSON.stringify(r[1]));
  r = await post('api/pairs/decide', { who: 'Hussam', decisions: [{ group: g.id, keep: [], trash: ids }] }); ck('server: nothing kept -> 400', r[0] === 400);
  r = await post('api/pairs/decide', { who: 'Nobody', decisions: [{ group: g.id, keep: ids, trash: [] }] }); ck('server: bad name -> 400', r[0] === 400);
  r = await post('api/pairs/decide', { who: 'Hussam', decisions: [{ group: 'zzz', keep: ids, trash: [] }] }); ck('server: unknown group -> 400', r[0] === 400);
  r = await post('api/dups/decide', { who: 'Hussam', decisions: [{ group: g.id, keep: ids, trash: [] }] }); ck('server: pair id refused on the dups endpoint -> 400', r[0] === 400);
  const img = await fetch(BASE + 'img/p/' + ids[0]); ck('server: preview served', img.status === 200 && (img.headers.get('content-type') || '').startsWith('image/'));
  const un = await fetch(BASE + 'img/t/00000000-0000-0000-0000-000000000000'); ck('server: unknown id -> 404', un.status === 404);
  console.log(`\n${passes} passed, ${fails} failed`);
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
