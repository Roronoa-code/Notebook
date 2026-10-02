// Tabs as one strip, the board shelf and pull-to-sync, on the mock bridge in Edge. No phone data is touched.
// Usage: node scripts/test-phone-swipe.js
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
    await page.waitForTimeout(700);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const swipe = async (x0, y0, x1, y1, steps, ms, hold) => {
      await touch('touchStart', x0, y0);
      for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await page.waitForTimeout(ms); }
      if (hold) return;
      await touch('touchEnd');
    };
    const line = () => page.locator('#homeseg').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--i')));
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
    await page.waitForTimeout(300);

    // Follows the finger one to one, with the next pane beside it and the line travelling.
    await swipe(300, 420, 200, 420, 8, 16, true);
    const during = await page.evaluate(() => ({ dx: new DOMMatrix(getComputedStyle(document.querySelector('#homegrid')).transform).m41, peek: !!document.querySelector('#homepager > .peek:not(.parked)'), i: parseFloat(getComputedStyle(document.querySelector('#homeseg')).getPropertyValue('--i')) }));
    assert.ok(Math.abs(during.dx + 100) < 6, `the pane starts where it is and has caught up with the finger a few pixels later (${during.dx})`); // (V02: it no longer stays 10px behind)
    assert.ok(during.peek, 'the next pane is there beside it');
    assert.ok(during.i > 0.2 && during.i < 0.4, `the tab line travels with it (${during.i})`);
    // Slowly, not far enough: goes back.
    await touch('touchEnd');
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#tab-recent.on').count(), 1, 'a short slow drag goes back');
    assert.equal(await line(), 0);
    assert.equal(await page.locator('#homepager > .peek:not(.parked)').count(), 0, 'nothing left showing beside it');

    // Far enough: lands on Notes. Then a quick flick goes on to For you.
    await swipe(320, 420, 80, 420, 10, 16);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#tab-notes.on').count(), 1, 'a long swipe lands on Notes');
    assert.equal(await line(), 1);
    assert.ok(await page.locator('#homegrid .notecard').count() > 0 && await page.locator('#homegrid .media').count() === 0, 'only notes');
    await swipe(250, 420, 200, 420, 3, 6);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#tab-ideas.on').count(), 1, 'a quick flick is enough');
    assert.equal(await page.locator('#homesort').evaluate((e) => e.inert && getComputedStyle(e).visibility === 'hidden' && getComputedStyle(e).transform === 'none'), true, 'no sort on For you (it has faded away, without shrinking on its own timeline)');

    // The end of the strip is rubbery, and it comes back.
    await swipe(250, 420, 50, 420, 8, 16, true);
    const rub = await page.locator('#homegrid').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    assert.ok(rub < 0 && rub > -90, `past the last tab it resists (${rub})`);
    await touch('touchEnd');
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#tab-ideas.on').count(), 1);
    assert.equal(await page.locator('#homegrid').evaluate((el) => getComputedStyle(el).transform), 'none');

    // Back the other way, twice.
    await swipe(60, 420, 320, 420, 10, 16); await page.waitForTimeout(800);
    await swipe(60, 420, 320, 420, 10, 16); await page.waitForTimeout(800);
    assert.equal(await page.locator('#tab-recent.on').count(), 1, 'swiping right goes back through the tabs');

    // Vertical scrolling is not taken.
    const before = await page.locator('#homescroll').evaluate((el) => el.scrollTop);
    await swipe(180, 600, 190, 300, 10, 16);
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#tab-recent.on').count(), 1);
    assert.ok(await page.locator('#homescroll').evaluate((el) => el.scrollTop) > before, 'a vertical swipe still scrolls');

    // A swipe that begins on a stack flicks the stack, not the tab.
    await page.evaluate(() => { const st = JSON.parse(NBNative.state()); const ids = st.items.filter((x) => x.kind === 'photo').slice(0, 2).map((x) => x.id); NBNative.stack(JSON.stringify(ids), ''); nbOnState(NBNative.state()); });
    await page.waitForTimeout(700);
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
    await page.waitForTimeout(300);
    const s = await page.locator('#homegrid .stackcard').boundingBox();
    const frontNo = () => page.locator('#homegrid .stackcard').evaluate((el) => [...el.querySelectorAll('.stackct')].filter((b) => +getComputedStyle(b).opacity > 0.5).map((b) => b.textContent).join());
    const top0 = await frontNo();
    await swipe(s.x + s.width - 20, s.y + s.height / 2, s.x + 10, s.y + s.height / 2, 6, 10);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#tab-recent.on').count(), 1, 'the tab did not change');
    assert.notEqual(await frontNo(), top0, 'the stack turned');

    // A second finger landing in the middle of a tab swipe settles back, leaving nothing displaced.
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
    await page.waitForTimeout(300);
    await touch('touchStart', 300, 420);
    for (let i = 1; i <= 4; i++) { await touch('touchMove', 300 - i * 20, 420); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 220, y: 420, id: 1 }, { x: 260, y: 440, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#homegrid').evaluate((el) => getComputedStyle(el).transform), 'none', 'the pane is back in place');
    assert.equal(await page.locator('#homepager > .peek:not(.parked)').count(), 0, 'and nothing is left showing beside it');

    // A board has its own two-tab strip.
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 0; });
    await page.locator('.pile[data-v]').first().click();
    await page.locator('#boardgrid').waitFor();
    await page.waitForTimeout(900);
    await swipe(320, 500, 60, 500, 10, 16);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#btab-ideas.on').count(), 1, 'Saved and Ideas swipe too');
    await swipe(60, 500, 320, 500, 10, 16);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#btab-saved.on').count(), 1);
    await page.locator('[data-a="boardBack"]').click();
    await page.waitForTimeout(800);

    // Hold a card: the boards wait as a compact pill where the + was; go right onto it and it opens into every board;
    // drop it on one to file it there, with an Undo.
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
    await page.waitForTimeout(300);
    const card = page.locator('#homegrid .card[data-a="open"]').first();
    const id = await card.getAttribute('data-v');
    const boardsOf = () => page.evaluate((i) => JSON.parse(NBNative.state()).items.find((x) => x.id === i).boards.length, id);
    const had = await boardsOf();
    const c = await card.boundingBox();
    await touch('touchStart', c.x + 60, c.y + 60);
    await page.waitForTimeout(320); // held: it lifts, then moving drags it
    for (let i = 1; i <= 6; i++) { await touch('touchMove', c.x + 60 + i * 8, c.y + 30 + i * 20); await page.waitForTimeout(16); }
    await page.locator('#shelfmini .mc').first().waitFor();
    assert.equal(await page.locator('#orb').evaluate((el) => el.hidden || el.inert), true, 'the orb steps aside');
    const pill = await page.locator('#shelfmini').boundingBox();
    assert.ok(pill.width < 260 && pill.height <= 62, `the boards wait compact (${Math.round(pill.width)}×${Math.round(pill.height)})`);
    assert.equal(await page.locator('#shelf').isVisible(), false, 'not yet open');
    await touch('touchMove', pill.x + pill.width / 2, pill.y + pill.height / 2);
    await page.locator('#shelf .shelftile').first().waitFor();
    await page.waitForTimeout(350);
    assert.ok(await page.locator('#shelf .shelftile').count() >= 4, 'right over it, it opens into every board');
    const pick = await page.locator('#shelf .shelftile:not(.here)').first().boundingBox();
    await touch('touchMove', pick.x + pick.width / 2, pick.y + pick.height / 2);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#shelf .shelftile.hot').count(), 1, 'the one under the card lights up');
    assert.ok((await page.locator('#shelfname').textContent()).length > 0, 'and names itself');
    await touch('touchEnd');
    await page.waitForTimeout(900);
    assert.equal(await boardsOf(), had + 1, 'the card is now on that board too');
    assert.match(await page.locator('.toast').innerText(), /Filed in/);
    assert.equal(await page.locator('#shelf').isVisible(), false);
    await page.locator('.toast [data-a="undo"]').click();
    await page.waitForTimeout(400);
    assert.equal(await boardsOf(), had, 'Undo takes it back');

    // Pick two, then drag either one: a small bundle of both follows the finger (their places kept, quietly), the
    // picking bar turns straight into the shelf (no + in between), and dropping on a board files both, which ends
    // the picking.
    {
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
      await page.waitForTimeout(300);
      const cards = page.locator('#homegrid > .card[data-a="open"]');
      const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
      const ids = [await cards.nth(0).getAttribute('data-v'), await cards.nth(1).getAttribute('data-v')];
      const onBoards = () => page.evaluate((list) => JSON.parse(NBNative.state()).items.filter((x) => list.includes(x.id)).map((x) => x.boards.length), ids);
      const before = await onBoards();
      await touch('touchStart', a.x + 40, a.y + 40);
      await page.waitForTimeout(700);
      assert.equal(await page.locator('#selbar').isVisible(), true, 'holding still brings up picking while the finger is down');
      await touch('touchEnd');
      await page.waitForTimeout(300);
      await cards.nth(1).click();
      assert.match(await page.locator('#selcount').textContent(), /2 selected/);
      const faceWatch = page.evaluate(() => new Promise((res) => { let plus = 0; const t0 = performance.now(); const f = () => { const s = NBSurface.state(); if (s.out && s.cur.f > 0.02) plus++; if (!document.querySelector('#orb').hidden) plus++; if (performance.now() - t0 < 900) requestAnimationFrame(f); else res(plus); }; requestAnimationFrame(f); }));
      await touch('touchStart', b.x + 40, b.y + 40);
      await page.waitForTimeout(320);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', b.x + 40 + i * 6, b.y + 40 + i * 40); await page.waitForTimeout(16); }
      await page.waitForTimeout(300);
      const held = await page.evaluate(() => { const f = document.querySelector('.dragbundle .dragface'), r = f.getBoundingClientRect(); return { w: r.width, h: r.height, faces: document.querySelectorAll('.dragbundle .dragface').length, count: document.querySelector('.dragcount')?.textContent }; });
      assert.ok(Math.max(held.w, held.h) < 175, `the carried card is small under the finger (${Math.round(held.w)}×${Math.round(held.h)})`);
      assert.equal(held.count, '2', 'it says it carries two');
      assert.equal(held.faces, 2, 'both are in the bundle');
      assert.equal(await page.locator('#homegrid .card.carried').count(), 2, 'they have left the grid');
      await page.locator('#selbar').waitFor({ state: 'hidden', timeout: 1500 }); // the picking bar has become the boards pill
      assert.equal(await faceWatch, 0, 'the + never shows while cards are picked or carried');
      const pill = await page.locator('#shelfmini').boundingBox();
      await touch('touchMove', pill.x + pill.width / 2, pill.y + pill.height / 2);
      await page.locator('#shelf .shelftile').first().waitFor(); await page.waitForTimeout(350);
      const tile = await page.locator('#shelf .shelftile:not(.here)').first().boundingBox();
      await touch('touchMove', tile.x + tile.width / 2, tile.y + tile.height / 2);
      await page.waitForTimeout(250);
      await touch('touchEnd');
      await page.waitForTimeout(900);
      const after = await onBoards();
      assert.ok(after.every((n, i) => n >= before[i]) && after.some((n, i) => n > before[i]), `both went onto the board (${before} → ${after})`);
      assert.match(await page.locator('.toast').innerText(), /Filed in/);
      assert.equal(await page.locator('#selbar').isVisible(), false, 'filing ends the picking');
      assert.equal(await page.locator('#homegrid .card.sel, #homegrid .card.carried, .pileghost').count(), 0);
      await page.locator('.toast [data-a="undo"]').click();
      await page.waitForTimeout(400);
      assert.deepEqual(await onBoards(), before, 'one Undo takes both back');
    }

    // Pull down from the top: stretches, and asks to pair when not paired.
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(300);
    await swipe(180, 120, 180, 340, 10, 16, true);
    const pull = await page.locator('#pullind').evaluate((el) => ({ o: +getComputedStyle(el).opacity, armed: el.classList.contains('armed'), t: getComputedStyle(el).transform }));
    assert.ok(pull.o > 0.9 && pull.t !== 'none', 'a button drops from the top as you pull');
    assert.equal(pull.armed, true, 'and fills purple past the line');
    assert.equal(await page.locator('#mani').evaluate((el) => getComputedStyle(el).transform), 'none', 'the page itself does not stretch');
    await touch('touchEnd');
    await page.waitForTimeout(500);
    assert.match(await page.locator('.toast').innerText(), /Pair with your PC/);
    // A second finger landing while a picture is half swiped must not leave it stuck off to the side.
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
    await page.waitForTimeout(300);
    await page.locator('#homegrid .card[data-a="open"]:not(:has(.notecard))').first().click(); // (a picture: cards sit column by column, so the first in the page may be a note)
    await page.locator('.media-screen').waitFor();
    await page.waitForTimeout(900);
    const two = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    for (let n = 0; n < 4; n++) {
      if (!(await page.locator('.media-screen').count())) break;
      const y = 300 + n * 50, x0 = 60 + n * 30, dx = 90 + n * 30;
      await two('touchStart', [{ x: x0, y }]);
      for (let i = 1; i <= 5; i++) { await two('touchMove', [{ x: x0 + (dx * i) / 5, y }]); await page.waitForTimeout(14); }
      const a = { x: x0 + dx, y, id: 1 }, b = { x: x0 + dx + 60, y: y + 20, id: 2 };
      await two('touchStart', [a, b]);
      for (let i = 1; i <= 5; i++) { await two('touchMove', [a, { ...b, x: b.x + i * 20 }]); await page.waitForTimeout(16); }
      await two('touchEnd', []);
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => { const m = document.querySelector('.media-screen .stage img, .media-screen .stage .vbox'); if (!m) return { seen: 0, peeks: -1, note: document.querySelector('#stage').className + ' screens=' + [...document.querySelectorAll('#stage > .screen')].map((e) => e.className + ':' + getComputedStyle(e).visibility).join(',') }; const b = m.getBoundingClientRect(); return { seen: Math.max(0, Math.min(b.right, innerWidth) - Math.max(b.left, 0)), peeks: document.querySelectorAll('.media-screen .peek').length }; });
      assert.ok(r.seen > 140 && r.peeks === 0, `a pinch during a swipe leaves the picture in place (round ${n}: ${JSON.stringify(r)})`);
      await page.evaluate(() => nbBack()); await page.waitForTimeout(800);
    }
    await page.evaluate(() => { while (nbBack()); });
    await page.waitForTimeout(800);
    assert.deepEqual(errors, []);
    console.log('Phone swipe passed: tabs follow the finger one to one, snap or return, resist at the ends, leave vertical scrolling and stacks alone, boards swipe too, several picked cards drag onto a board together (small under the finger), the shelf files a held card with Undo, pull-down drops a sync button.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
