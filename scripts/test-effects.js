// Effect lifecycle and actual phone waits, using Edge and the mock bridge only.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');
const APP = path.resolve(__dirname, '..');

(async () => {
  for (const file of ['effects.js', 'effects.css', 'vendor/thinking-orbs.js', 'vendor/LIBRARIES-LICENSE.txt'])
    assert.equal(fs.readFileSync(path.join(APP, 'renderer', file), 'utf8'), fs.readFileSync(path.join(APP, 'phone/app/src/main/assets/www', file), 'utf8'), 'shared assets: ' + file);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 384, height: 832 }, isMobile: true, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(APP, 'phone/app/src/main/assets/www/index.html')).href);
    await page.waitForTimeout(600);
    await page.locator('#tab-ideas').click();
    await page.locator('[data-a="lift"]').click();
    await page.locator('#homegrid .card.idea').first().waitFor();
    await page.evaluate(() => { NBNative.feedReload = () => {}; });
    await page.locator('[data-a="ideasNow"]').click();
    assert.equal(await page.locator('[data-a="ideasNow"] canvas').count(), 0, 'no effect for a short wait');
    await page.locator('[data-a="ideasNow"] canvas').waitFor({ timeout: 4000 });
    const at = await page.locator('[data-a="ideasNow"]').getAttribute('data-nb-since');
    await page.evaluate(() => window.nbOnState(NBNative.state()));
    await page.locator('[data-a="ideasNow"] canvas').waitFor({ timeout: 1000 });
    assert.equal(await page.locator('[data-a="ideasNow"]').getAttribute('data-nb-since'), at, 'redraw retains wait time');
    await page.screenshot({ path: path.join(APP, 'test-output/effects-phone-ideas.png') });
    await page.evaluate(() => window.nbOnFeed(JSON.stringify({ key: 'all', error: 'Test: temporarily unavailable' })));
    await page.waitForFunction(() => !document.querySelector('[data-a="ideasNow"] canvas'));

    // The real sync callback starts the connecting effect, then removes it for measured transfers.
    await page.evaluate(() => { const st = JSON.parse(NBNative.state()); st.sync = { paired: true, pcName: 'Test PC' }; window.nbOnState(JSON.stringify(st)); });
    await page.locator('#nav-sync').click();
    await page.evaluate(() => window.nbOnSync(JSON.stringify({ phase: 'connecting' })));
    await page.locator('#synctitle canvas').waitFor({ timeout: 4000 });
    await page.evaluate(() => window.nbOnSync(JSON.stringify({ phase: 'downloading', done: 1, total: 3 })));
    await page.waitForFunction(() => !document.querySelector('#synctitle canvas'));
    assert.match(await page.locator('#syncmsg').innerText(), /Getting 2 of 3/);

    // Shared controller: long beam, reduced motion, removed hosts, and no effect on a cancelled short job.
    await page.evaluate(() => {
      const host = document.createElement('button'); host.id = 'effect-test'; host.textContent = 'Saving…';
      Object.assign(host.style, { position: 'fixed', top: '20px', left: '20px', borderRadius: '24px', padding: '24px' });
      document.body.append(host); NBEffects.set(host, 'beam', Date.now() - 4000);
    });
    await page.locator('#effect-test .nb-effect-beam').waitFor();
    assert.equal(await page.locator('#effect-test .nb-effect-beam').evaluate(el => getComputedStyle(el).borderTopLeftRadius), '24px');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#effect-test .nb-effect-beam').evaluate(el => getComputedStyle(el).display), 'none');
    await page.evaluate(() => { const el = document.getElementById('effect-test'); NBEffects.set(el, null); el.remove(); });
    await page.waitForFunction(() => !document.querySelector('.nb-effect-beam'));

    // Desktop picture search: a stale completion cannot clear the latest wait or redraw stale results.
    const desktop = await browser.newPage();
    desktop.on('pageerror', e => errors.push(e.message));
    await desktop.setContent('<div class="search-wrap"><input id="search"></div>');
    for (const file of ['vendor/thinking-orbs.js', 'effects.js']) await desktop.addScriptTag({ path: path.join(APP, 'renderer', file) });
    await desktop.evaluate(() => { window.NB = {}; window.pending = {}; window.draws = 0; window.nb = { searchPictures: q => new Promise(resolve => pending[q] = resolve) }; });
    await desktop.addScriptTag({ path: path.join(APP, 'renderer/search.js') });
    await desktop.evaluate(() => NB.search.changed('first', () => draws++));
    await desktop.waitForFunction(() => !!pending.first);
    await desktop.evaluate(() => NB.search.changed('second', () => draws++));
    await desktop.waitForFunction(() => !!pending.second);
    await desktop.evaluate(() => pending.first({ ids: ['old'] }));
    assert.equal(await desktop.locator('.search-wrap').getAttribute('aria-busy'), 'true');
    assert.equal(await desktop.evaluate(() => draws), 0);
    await desktop.evaluate(() => pending.second({ ids: ['new'] }));
    await desktop.waitForFunction(() => !document.querySelector('[aria-busy]'));
    assert.equal(await desktop.evaluate(() => draws), 1);
    assert.deepEqual(errors, []);
    console.log('Effects passed: shared assets, real phone waits, delay/redraw, completion/error, transfer counts, reduced motion, host cleanup and stale desktop searches.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
