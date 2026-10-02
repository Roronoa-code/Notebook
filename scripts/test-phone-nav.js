// Runs the bundled phone UI with its existing mock bridge. No phone data is touched.
// Usage: node scripts/test-phone-nav.js (requires Microsoft Edge).
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const rect = (sel) => page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
    const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

    // The orb: a tap is a new note that grows out of it, and nothing else (the actions must never pop up under the
    // same finger and take its lift: that opened the camera on every tap).
    const ob = await page.locator('#orb').boundingBox();
    await page.touchscreen.tap(ob.x + 30, ob.y + 30);
    await page.waitForTimeout(90);
    assert.equal(await page.locator('.note-screen .growface').count(), 1, 'the orb is the note as it grows');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.note-screen').count(), 1, 'a tap on the orb opens a new note');
    assert.equal(await page.locator('.fan-item').count(), 0, 'and no actions');
    assert.equal(await page.locator('.toast').count(), 0, 'nothing else was set off (no camera)');
    assert.equal(await page.evaluate(() => document.activeElement?.id || ''), '', 'opening a note does not bring up the keyboard');
    await page.evaluate(() => nbBack()); await page.waitForTimeout(800);
    assert.equal(await page.locator('.note-screen').count(), 0);
    assert.equal(await page.locator('#orb').isVisible(), true, 'the orb comes back');

    // Hold it: the three creation actions fan out along an arc, always in this order, all on screen; let go where
    // you are and they stay out to be tapped.
    await page.mouse.move(ob.x + 30, ob.y + 30); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
    await page.locator('.fan-item').first().waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#orb').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await page.locator('.fan-item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Photos', 'Note', 'Camera']);
    const boxes = await page.locator('.fan-item').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, r.width]; }));
    assert.ok(boxes.every(([l, t, r, b]) => l >= 0 && t >= 0 && r <= 360 && b <= 800), 'every action is on screen');
    assert.ok(boxes.every((b) => b[4] >= 48), 'generous targets');
    const gaps = boxes.slice(1).map((b, i) => Math.hypot((b[0] + b[2]) / 2 - (boxes[i][0] + boxes[i][2]) / 2, (b[1] + b[3]) / 2 - (boxes[i][1] + boxes[i][3]) / 2));
    assert.ok(gaps.every((g) => g > 60), 'the buttons do not overlap');
    assert.equal(await page.locator('.fanlabel').count(), 1, 'one label slot');
    assert.equal(await page.locator('.fanlabel').evaluate((e) => getComputedStyle(e).opacity), '0', 'no word until you are over one');
    await page.locator('#orb').click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.fan-item').count(), 0, 'tapping the orb again folds it away');

    // Hold the orb and sweep across every action and back: one label, one highlight, never over another action.
    const o = await page.locator('#orb').boundingBox();
    await page.mouse.move(o.x + 30, o.y + 30);
    await page.mouse.down();
    await page.waitForTimeout(500);
    for (const id of ['Photos', 'Note', 'Camera', 'Note', 'Photos', 'Camera']) {
      const c = await page.locator(`.fan-item[aria-label="${id}"]`).evaluate((e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await page.mouse.move(c[0], c[1], { steps: 4 });
      await page.waitForTimeout(170);
      assert.equal(await page.locator('.fan-item.hot').count(), 1, 'one highlight');
      assert.equal(await page.locator('.fan-item.hot').getAttribute('aria-label'), id, 'the one under your thumb lights up');
      assert.equal(await page.locator('.fanlabel').innerText(), id, 'and the label names it');
      const lab = await rect('.fanlabel');
      for (const other of await page.locator('.fan-item').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }))) assert.ok(!overlaps(lab, other), 'the label never covers an action');
      assert.ok(!overlaps(lab, { l: c[0] - 20, t: c[1] - 20, r: c[0] + 20, b: c[1] + 20 }), 'nor the thumb');
    }
    // Let go back over the orb: nothing happens.
    await page.mouse.move(o.x + 30, o.y + 30, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.fan-item').count(), 0);
    assert.equal(await page.locator('#homegrid').count(), 1);

    // Search and Sync live in Home's header, open out of their controls, and have a Back.
    assert.equal(await page.locator('#searchbtn').getAttribute('aria-label'), 'Search');
    assert.match(await page.locator('#pulse').innerText(), /Not paired|Synced|Sample/);
    await page.locator('#searchbtn').click();
    await page.locator('#q').waitFor();
    await page.waitForTimeout(120);
    const mid = await page.evaluate(() => ({ ghost: !!document.querySelector('.route-ghost'), heads: [...document.querySelectorAll('.pagetitle, .poster')].filter((e) => e.checkVisibility({ opacityProperty: true }) && /SEARCH|FIND IT/i.test(e.textContent)).length }));
    assert.equal(mid.ghost, true, 'the tapped control stays drawn as the screen grows out of it');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.route-ghost').count(), 0, 'and hands over by the end');
    assert.equal(await page.locator('#stage > .screen:visible').count(), 1, 'search opened out of its button');
    assert.equal(await page.getByText('Find it').count(), 0, 'one headline, not two');
    await page.locator('.utiltop [aria-label="Back"]').click();
    await page.locator('#homegrid').waitFor();
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#searchbtn').evaluate((e) => getComputedStyle(e).visibility), 'visible', 'the source control is back in place');
    await page.locator('#pulse').click();
    await page.locator('#syncbody').waitFor();
    await page.waitForTimeout(600);
    await page.evaluate(() => nbBack());
    await page.locator('#homegrid').waitFor();
    await page.waitForTimeout(600);

    // Rapid moves leave one screen and Home intact.
    await page.evaluate(async () => {
      for (const sel of ['#searchbtn', '.utiltop [aria-label="Back"]', '#pulse', '.utiltop [aria-label="Back"]', '#searchbtn', '.utiltop [aria-label="Back"]']) {
        [...document.querySelectorAll(sel)].pop()?.click(); await new Promise((r) => setTimeout(r, 70));
      }
    });
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#stage > .screen:visible').count(), 1, 'rapid navigation leaves one screen');
    assert.equal(await page.locator('#stage #rail').count(), 1, 'returning Home cannot be removed by an older transition');
    assert.equal(await page.locator('#stage > .screen:visible').evaluate((el) => getComputedStyle(el).pointerEvents), 'auto');
    assert.equal(await page.locator('.route-ghost').count(), 0, 'no copy left behind');

    // Tabs are one strip: a tapped tab slides the pane and line; the requested label is highlighted throughout.
    const topMotion = await page.evaluate(async () => {
      const seg = document.querySelector('#homeseg');
      const at = () => parseFloat(getComputedStyle(seg).getPropertyValue('--i'));
      const agree = () => { const on = [...seg.querySelectorAll('button')].filter((b) => b.classList.contains('on')); return on.length === 1 && on[0].getAttribute('aria-selected') === 'true'; };
      let ok = true, frames = 0;
      const watch = () => new Promise((res) => { const t0 = performance.now(); const f = () => { frames++; ok = ok && agree(); if (performance.now() - t0 < 600) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      document.querySelector('#tab-notes').click();
      await new Promise((r) => setTimeout(r, 60));
      const mid = at();
      await watch();
      const end = at();
      // Interrupted: towards For you, then straight back to Recent part way. It turns round from where it is.
      document.querySelector('#tab-ideas').click();
      await new Promise((r) => setTimeout(r, 70));
      const before = at();
      const target = seg.querySelector('button.on')?.id;
      document.querySelector('#tab-recent').click();
      const after = at();
      await watch();
      return { mid, end, before, after, target, ok, frames, final: at() };
    });
    assert.ok(topMotion.mid > 0 && topMotion.mid < 1 && topMotion.end === 1, `the tab line travels (${topMotion.mid} then ${topMotion.end})`);
    assert.ok(Math.abs(topMotion.after - topMotion.before) < 0.05, `an interrupted change carries on from where it is (${topMotion.before} → ${topMotion.after})`);
    assert.equal(topMotion.target, 'tab-ideas', 'a direct tap highlights its requested destination');
    assert.ok(topMotion.ok && topMotion.frames > 10, 'label, line and selection agree on every frame');
    assert.equal(topMotion.final, 0);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#tab-recent.on').count(), 1);
    assert.equal(await page.locator('#homepager > .peek:not(.parked)').count(), 0, 'nothing left showing beside the grid');
    assert.ok(await page.locator('#homepager > .peek.parked').evaluateAll((els) => els.every((e) => getComputedStyle(e).visibility === 'hidden' && e.getBoundingClientRect().height < 200)), 'panes made ready beside it are unseen and never lengthen the page');

    // Reduced motion: nothing is left half way.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(ob.x + 30, ob.y + 30); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.fan-item').count(), 3);
    await page.locator('#orb').click();
    await page.locator('#pulse').click();
    await page.locator('#syncbody').waitFor();
    assert.equal(await page.locator('.fan-item').count(), 0);
    assert.equal(await page.locator('#stage > .screen:visible').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Phone navigation passed: creation fan (order, on screen, one label clear of every action), hold-and-sweep, Search and Sync from the header with Back, screens that open from their control, rapid taps, tabs as one strip with one current tab and interrupted reversal, reduced motion.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
