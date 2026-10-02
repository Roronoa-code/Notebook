// Replay the 2 October recording: rapid Notes / For you swipes, including catching a moving pane.
// Default: mock bridge, no real input, library or phone. NB_DEVICE=1 verifies the installed Samsung WebView
// after forwarding that app's WebView socket to localhost:9237; it only switches tabs and swipes.
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

// Drawing 114 cards must not cross the synchronous Android bridge 114 times for the same pins.
const vm = require('vm'), fs = require('fs');
const scope = { window: {} }, prefs = { itemPins: '["one"]' };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../phone/app/src/main/assets/www/sort.js'), 'utf8'), scope);
let reads = 0;
const sort = scope.window.NBSort({ N: { getPref: (key) => { reads++; return prefs[key] || ''; }, setPref: (key, value) => { prefs[key] = value; } }, esc: (s) => s });
for (let i = 0; i < 114; i++) assert.equal(sort.isPinned('one'), true);
assert.equal(reads, 1, 'one native read for a whole grid');
sort.setPins(['two'], true);
assert.equal(sort.isPinned('two'), true);
assert.equal(sort.isPinned('one'), true);
sort.setPins(['one'], false);
assert.equal(sort.isPinned('one'), false);
assert.equal(prefs.itemPins, '["two"]', 'pin edits still persist');

(async () => {
  const native = process.env.NB_DEVICE === '1';
  const browser = native ? await chromium.connectOverCDP('http://127.0.0.1:9237') : await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = native ? browser.contexts()[0].pages().find((p) => p.url().startsWith('https://appassets.local/www/')) : await browser.newPage({ viewport: { width: 384, height: 832 }, hasTouch: true, isMobile: true });
    assert.ok(page, 'Notebook WebView is open');
    if (!native) await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
    if (!native) await page.evaluate(() => {
      for (let i = 0; i < 5; i++) {
        const { id } = JSON.parse(NBNative.addNote(''));
        NBNative.update(id, JSON.stringify({ title: 'Layout note ' + i, html: '<p>Several notes must stay in one column.</p>' }));
      }
      nbOnState(NBNative.state());
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#tab-notes').click();
    await page.waitForTimeout(700);
    await page.locator('#homescroll').evaluate((e) => { e.scrollTop = 0; });
    const notesLayout = await page.evaluate(() => {
      const grid = document.querySelector('#homegrid'), r = grid.getBoundingClientRect();
      return [...grid.querySelectorAll(':scope > .card')].map((c) => {
        const b = c.getBoundingClientRect();
        return { left: b.left - r.left, right: b.right - r.left, top: b.top - r.top, width: r.width };
      });
    });
    assert.ok(notesLayout.length >= 2, 'the regression uses multiple notes');
    assert.ok(notesLayout.every((r) => r.left >= 0 && r.right <= r.width + 1), 'every note stays inside Notes, never overflowing into For you');
    assert.ok(notesLayout.every((r, i) => !i || r.top > notesLayout[i - 1].top), 'notes form one vertical column');
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const { w, y } = await page.evaluate(() => ({ w: innerWidth, y: Math.min(innerHeight - 100, document.querySelector('#homepager').getBoundingClientRect().top + 170) }));
    const pane = () => page.evaluate(() => {
      const grid = document.querySelector('#homegrid'), peek = document.querySelector('#homepager > .peek:not(.parked)');
      const x = (e) => e.getBoundingClientRect().x;
      const spill = [grid, peek].filter(Boolean).some((g) => {
        const r = g.getBoundingClientRect();
        return [...g.querySelectorAll('.notecard')].some((n) => { const b = n.getBoundingClientRect(); return b.left < r.left - 1 || b.right > r.right + 1; });
      });
      return { spill, x: x(grid), peek: peek && { x: x(peek), tab: peek.dataset.tab, notes: peek.querySelectorAll('.notecard').length }, notes: grid.querySelectorAll('.notecard').length, ideas: grid.querySelectorAll('.idea').length, i: parseFloat(document.querySelector('#homeseg').style.getPropertyValue('--i')) };
    });

    await touch('touchStart', w * 0.85, y);
    await touch('touchMove', w * 0.85 - 48, y);
    assert.ok(Math.abs((await pane()).x + 48) < 2, 'the FIRST movement follows the finger, even when events are coalesced');
    await touch('touchMove', w * 0.15, y);
    await touch('touchEnd');
    // Catch it beyond halfway before it settles, without a move yet: both panes must stay where they were.
    const before = await pane();
    assert.ok(before.x < -w / 2 && before.peek?.tab === 'ideas');
    await page.evaluate(() => document.querySelector('#homepager').addEventListener('touchstart', () => {
      window.__caughtFrom = document.querySelector('#homegrid').getBoundingClientRect().x;
    }, { capture: true, once: true }));
    await touch('touchStart', w * 0.2, y);
    const caught = await pane();
    assert.equal(caught.notes, 0, 'For you contains no note nodes after the handover');
    assert.equal(caught.peek?.tab, 'notes', 'the outgoing note stays in its own neighbour when caught');
    const caughtFrom = await page.evaluate(() => window.__caughtFrom);
    assert.ok(Math.abs(caught.peek.x - caughtFrom) < 2, `catching the pane does not teleport the note (${caughtFrom} to ${caught.peek.x})`);
    await touch('touchMove', w * 0.8, y);
    await touch('touchEnd');
    await page.waitForTimeout(650);

    // Alternating at recording speed, not waiting for a full settle between gestures.
    for (let n = 0; n < 6; n++) {
      const left = n % 2 === 0, from = w * (left ? 0.85 : 0.15), to = w * (left ? 0.15 : 0.85);
      await touch('touchStart', from, y);
      for (let k = 1; k <= 4; k++) { await touch('touchMove', from + (to - from) * k / 4, y); await page.waitForTimeout(12); }
      await touch('touchEnd');
      await page.waitForTimeout(45);
      const s = await pane();
      assert.equal(s.spill, false, 'no note paints outside its own pane during the swipe');
      if (s.peek) assert.ok(Math.abs(Math.abs(s.peek.x - s.x) - w) < 2, 'panes stay one width apart');
      if (s.ideas) assert.equal(s.notes, 0, 'no notes mixed into the For you grid');
      if (s.peek?.tab === 'ideas') assert.equal(s.peek.notes, 0, 'no notes mixed into the incoming For you pane');
    }
    await page.waitForTimeout(700);
    await page.locator('#tab-ideas').click();
    await page.waitForTimeout(700);
    const end = await pane();
    assert.equal(end.i, 2);
    assert.equal(end.x, 0);
    assert.equal(end.notes, 0, 'settled For you never contains notes');
    assert.equal(end.peek, null);
    assert.deepEqual(errors, []);
    console.log('Phone pager passed: multiple notes stay in one column, first move tracks the finger, caught swipes keep both panes, rapid reversal never mixes notes into For you.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
