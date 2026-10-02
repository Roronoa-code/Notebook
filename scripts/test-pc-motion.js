// The phone's motion fixes brought to the PC (1 Oct 2026): a binned card is seen leaving where it was and Undo
// grows it back with no gap; a pin's close-up flies out of its pin and back into it; idea pictures show only once
// fully loaded; New ideas works with the search field's beam and liquid droplets. Real window on the second
// monitor, a temporary library and the stand-in feed; no real mouse or keyboard.
// Usage: node scripts/test-pc-motion.js   (needs ffmpeg)
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { _electron: electron } = require('playwright-core');
const { makeSamples } = require('./make-samples');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'test-output', 'pc-motion-' + process.pid);
const LIB = path.join(OUT, 'Notebook Library');
const ENV = { ...process.env, NOTEBOOK_USER_DATA: path.join(OUT, 'userdata'), NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47863', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_FAKE_NAMES: '1', NOTEBOOK_FAKE_FEED: '1', NOTEBOOK_TOOLS: path.join(OUT, 'tools'), NOTEBOOK_WINDOW_DISPLAY: 'second' };
const ok = (msg) => console.log('  ok  ' + msg);
const frames = (page, src, ms) => page.evaluate(([src, ms]) => new Promise((res) => { const f = new Function('return (' + src + ')()'); const out = []; const t0 = performance.now(); const step = () => { out.push({ t: performance.now() - t0, ...f() }); if (performance.now() - t0 < ms) requestAnimationFrame(step); else res(out); }; requestAnimationFrame(step); }), [src, ms]);

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const src = makeSamples(path.join(OUT, 'raw')).filter((f) => /\.jpg$/.test(f));
  const files = Array.from({ length: 6 }, (_, i) => { const to = path.join(OUT, `photo ${i}.jpg`); fs.writeFileSync(to, Buffer.concat([fs.readFileSync(src[i % src.length]), Buffer.from('x' + i)])); return to; });
  await require('../main/library').Library.openOrCreate(LIB);
  fs.mkdirSync(ENV.NOTEBOOK_USER_DATA, { recursive: true });
  fs.writeFileSync(path.join(ENV.NOTEBOOK_USER_DATA, 'config.json'), JSON.stringify({ libraryPath: LIB }));
  const app = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }), env: ENV });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.bcard').first().waitFor();
    await page.evaluate(async (paths) => NB.apply(await nb.importPaths(paths, null)), files);
    await page.locator('.grid > .card').nth(5).waitFor();
    await page.waitForTimeout(1200);

    // ---- a binned card leaves where it was; Undo grows it back in its place ----
    const id = await page.locator('.grid > .card').nth(1).getAttribute('data-id');
    const was = await page.locator(`.grid > .card[data-id="${id}"]`).boundingBox();
    const W = frames(page, `() => { const g = document.querySelector('.grid > .card-ghost'); const r = g && g.getBoundingClientRect(); return { ghost: g ? { l: r.left, t: r.top, o: +getComputedStyle(g).opacity } : null, cards: document.querySelectorAll('.grid > .card').length }; }`, 700);
    await page.evaluate(async (i) => NB.apply(await nb.moveToBin(i)), id);
    const bin = await W;
    const seen = bin.filter((f) => f.ghost && f.ghost.o > 0.2);
    assert.ok(seen.length >= 3, 'the binned card is drawn leaving for several frames');
    assert.ok(Math.abs(seen[0].ghost.l - was.x) < 2 && Math.abs(seen[0].ghost.t - was.y) < 2, 'right where it was');
    assert.equal(bin.at(-1).ghost, null, 'and then it is gone');
    const U = frames(page, `() => { const c = document.querySelector('.grid > .card[data-id="${id}"]'); const r = c && c.getBoundingClientRect(); return { c: c ? { o: +getComputedStyle(c).opacity, w: r.width } : null }; }`, 500);
    await page.evaluate(async (i) => NB.apply(await nb.restore(i)), id);
    const undo = await U;
    const first = undo.findIndex((f) => f.c);
    assert.ok(first >= 0, 'Undo: the card is back');
    assert.ok(undo.slice(first, first + 12).some((f) => f.c.o > 0.5), 'and grows in straight away (no waiting gap)');
    const now = await page.locator(`.grid > .card[data-id="${id}"]`).boundingBox();
    assert.ok(Math.abs(now.x - was.x) < 2 && Math.abs(now.y - was.y) < 2, 'in the same place as before');
    ok('Bin: the card is seen leaving where it was; Undo grows it back in its place with no gap');

    // ---- For you: pictures only when loaded; a pin's close-up flies out of it and back ----
    await page.locator('.segbtn', { hasText: 'For you' }).click();
    await page.locator('#ideas .idea').nth(5).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const pics = await page.evaluate(() => [...document.querySelectorAll('#ideas .idea img')].map((i) => ({ ready: i.classList.contains('ready'), loaded: i.complete && i.naturalWidth > 0, o: +getComputedStyle(i).opacity })));
    assert.ok(pics.every((p) => (p.ready ? p.loaded : p.o === 0)), 'no idea picture is shown before it has fully loaded');
    const pin = page.locator('#ideas .idea').first(), pr = await pin.locator('.media').boundingBox();
    const O = frames(page, `() => { const f = document.querySelector('.iv-flyer'); const r = f && f.getBoundingClientRect(); return { f: r ? { l: r.left, t: r.top, w: r.width } : null, view: !!document.querySelector('.ideaview') }; }`, 700);
    await pin.locator('.idea-open').evaluate((b) => b.click());
    const open = (await O).filter((f) => f.f);
    assert.ok(open.length > 5, 'the picture flies to the close-up');
    assert.ok(Math.abs(open[0].f.l - pr.x) < 30 && Math.abs(open[0].f.w - pr.width) < 40, `starting from its pin (${JSON.stringify(open[0].f)} vs ${Math.round(pr.x)},${Math.round(pr.width)})`);
    assert.ok(open.at(-1).f.w > pr.width * 1.3, 'growing into the close-up');
    await page.waitForTimeout(500);
    const C = frames(page, `() => { const f = document.querySelector('.iv-flyer'); const r = f && f.getBoundingClientRect(); return { f: r ? { l: r.left, w: r.width } : null, view: !!document.querySelector('.ideaview') }; }`, 800);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const close = (await C).filter((f) => f.f);
    assert.ok(close.length > 5 && Math.abs(close.at(-1).f.l - pr.x) < 12 && Math.abs(close.at(-1).f.w - pr.width) < 16, 'Esc: it flies back into its pin');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.ideaview, .iv-flyer').count(), 0);
    assert.equal(await pin.locator('.media').evaluate((m) => m.style.visibility), '', 'the pin is showing again');
    ok('For you: pictures only once loaded; a close-up flies out of its pin and back into it');

    // ---- New ideas: the beam on the search field and droplets in the button, then they settle ----
    const R = frames(page, `() => { const i = document.querySelector('.refresh-ico'); return { turning: !!i && i.classList.contains('turning'), goo: !!document.querySelector('.refresh-ico .goo circle[r]:not([r="0"])'), beam: !!document.querySelector('.ideas-search .search-wrap .nb-effect-beam') }; }`, 5000);
    await page.locator('.btn', { hasText: 'New ideas' }).click();
    const r = await R;
    assert.ok(r.some((f) => f.turning && f.goo && f.beam), 'while it works: droplets in the button and the beam on the search field together');
    assert.ok(!r.at(-1).turning && !r.at(-1).beam, 'when it lands, both settle');
    assert.equal(await page.locator('.btn', { hasText: 'New ideas' }).isEnabled(), true);
    ok('New ideas: beam on the search field and liquid droplets while it works; both settle when it lands');

    await page.screenshot({ path: path.join(APP, 'test-output', 'pc-motion-ideas.png') });
    assert.deepEqual(errors, [], 'no script errors');
    console.log('PC motion checks passed.');
  } finally {
    await app.close();
    fs.rmSync(OUT, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
