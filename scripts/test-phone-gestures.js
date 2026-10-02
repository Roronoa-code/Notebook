// Phone touch gestures (items panel drag/flick, swipe down to close a photo), using the mock bridge.
// Usage: node scripts/test-phone-gestures.js (requires Microsoft Edge).
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--allow-file-access-from-files'] }) // local sample photos readable, as they are in the app;
  try {
    const page = await browser.newPage({ viewport: { width: 384, height: 832 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
    await page.waitForTimeout(1200);
    const cdp = await page.context().newCDPSession(page);
    // Search and Sync are in Home's header (from elsewhere, Back first).
    const goTo = async (label) => {
      if (!(await page.locator('#homegrid:visible').count())) { await page.evaluate(() => { while (nbBack()) { /* back to Home */ } }); await page.waitForTimeout(600); }
      await page.locator(label === 'Search' ? '#searchbtn' : '#pulse').click();
      await page.waitForTimeout(700);
    };
    // The picture is changed by pressing and holding the name at the top.
    const openCover = async () => {
      const m = await page.locator('#mani').boundingBox();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: m.x + 80, y: m.y + m.height / 2 }] });
      await page.waitForTimeout(650);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.locator('#coverpanel.formed.open').waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
    };
    // A drag made of small steps, `ms` apart, so speed can be controlled.
    async function drag(x, fromY, toY, steps, ms) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / steps }] });
        await page.waitForTimeout(ms);
      }
    }
    const release = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // Every floating sheet uses a real backdrop and the same interrupted drag behaviour.
    const backdropTap = async () => {
      await page.locator('#popscrim').click({ position: { x: 6, y: 120 } });
      await page.locator('#popscrim').waitFor({ state: 'hidden' });
    };
    const holdOrb = async () => { const b = await page.locator('#orb').boundingBox(); await page.mouse.move(b.x + 30, b.y + 30); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up(); }; // tap = new note; hold = the arc
    await holdOrb();
    await page.locator('.fanscrim').waitFor();
    assert.ok(await page.locator('.fanscrim').evaluate(el => el.getBoundingClientRect().height === innerHeight), 'the fan dims the whole screen');
    await page.locator('.fanscrim').click({ position: { x: 6, y: 120 } });
    await page.locator('.fan-item').first().waitFor({ state: 'detached' });
    assert.equal(await page.locator('#orb').getAttribute('aria-expanded'), 'false', 'outside tap closes the fan');
    // The name breaks into dots that gather into the Header picture panel: a titled box as tall as its contents,
    // with Done, over a scrim that also covers the orb.
    // Its choices enter once and stay (audit F05): watch every frame from the press until well after it has formed.
    const tileWatch = page.evaluate(() => new Promise((res) => {
      const seen = []; const t0 = performance.now();
      const f = () => { const t = document.querySelector('.covertiles .tile'); seen.push(t && document.querySelector('#coverpanel.formed') ? +getComputedStyle(t).opacity : -1); if (performance.now() - t0 < 2200) requestAnimationFrame(f); else res(seen); };
      requestAnimationFrame(f);
    }));
    await openCover();
    const opac = await tileWatch;
    const firstShown = opac.findIndex((o) => o > 0.95);
    assert.ok(firstShown > 0, 'the choices appear');
    assert.ok(opac.slice(firstShown).every((o) => o > 0.95), `once shown they never vanish and re-enter (${opac.slice(firstShown).filter((o) => o <= 0.95).length} dips)`);
    const panelBox = await page.evaluate(() => { const p = document.querySelector('#coverpanel').getBoundingClientRect(), b = document.querySelector('.coverbody').getBoundingClientRect(); return { top: p.top, bottom: p.bottom, body: b.bottom, h: innerHeight }; });
    assert.ok(panelBox.top <= 1 && panelBox.bottom < panelBox.h - 100 && panelBox.bottom - panelBox.body < 8, `the panel is as tall as its contents (${JSON.stringify(panelBox)})`);
    assert.match(await page.locator('.coverhead').innerText(), /Header picture/i);
    assert.equal(await page.locator('.coverhead [data-a="cover"]').innerText(), 'Done');
    assert.ok(await page.locator('.covertiles .tile').count() >= 2, 'the pictures are in it');
    assert.equal(await page.locator('#mani').evaluate((el) => el.classList.contains('dotsafe')), true, 'the name has become the dots');
    assert.equal(await page.locator('#orb').isVisible(), false, 'the orb goes under the same scrim (it steps aside)');
    // Outside tap, Done, Back and choosing a picture all close it, and the name comes back.
    await page.locator('#coverdim').click({ position: { x: 20, y: 700 } });
    await page.locator('#coverpanel').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#mani').evaluate((el) => el.classList.contains('dotsafe')), false, 'the dots spell the name again');
    assert.equal(await page.locator('.dotcanvas').count(), 0, 'no particles left over');
    assert.equal(await page.locator('#orb').isVisible(), true, 'the orb comes back');
    await openCover();
    await page.locator('.coverhead [data-a="cover"]').click();
    await page.locator('#coverpanel').waitFor({ state: 'hidden' });
    await openCover();
    assert.equal(await page.evaluate(() => nbBack()), true);
    await page.locator('#coverpanel').waitFor({ state: 'hidden' });

    // The press that opens the panel never also chooses a picture (F15): hold on well past the opening, over a tile.
    const pressAt = await page.locator('#mani').boundingBox();
    const px = pressAt.x + 80, py = pressAt.y + pressAt.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: py }] });
    await page.waitForTimeout(1600);
    const under = await page.evaluate(([x, y]) => { const t = document.elementFromPoint(x, y)?.closest('.tile'); return t ? t.dataset.v ?? '' : null; }, [px, py]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    assert.ok(under !== null, 'a picture choice ended up under the finger (the risky case)');
    assert.equal(await page.locator('#coverpanel.open').count(), 1, 'lifting that finger leaves the panel open');
    assert.equal(await page.evaluate(() => NBNative.getPref('coverId')), '', 'and chooses nothing');
    await page.evaluate(() => nbBack());
    await page.locator('#coverpanel').waitFor({ state: 'hidden' });

    // Every sample picture keeps its subject as dots, at rest and while pressed (F06), and choosing one never
    // leaves the header blank on the way back (F07).
    const dotStats = (sel) => page.evaluate((s) => {
      const c = document.querySelector(s); if (!c || !c.width) return null;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 60) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      return { n, w: (x1 - x0) / c.width, h: (y1 - y0) / c.height };
    }, sel);
    const samplePhotos = await page.evaluate(() => JSON.parse(NBNative.state()).items.filter((i) => i.kind === 'photo' && !i.deletedAt).map((i) => i.id));
    for (const id of samplePhotos) {
      await openCover();
      const blank = page.evaluate(() => new Promise((res) => {
        let gaps = 0; const t0 = performance.now();
        const f = () => {
          const m = document.querySelector('#mani'), dc = document.querySelector('.dotcanvas'), cov = m.querySelector('.cover, .maniink');
          const shown = (dc && +getComputedStyle(dc).opacity > 0.3) || (cov && !m.classList.contains('dotsafe') && +getComputedStyle(cov).opacity > 0.5);
          if (!shown) gaps++;
          if (performance.now() - t0 < 2400) requestAnimationFrame(f); else res(gaps);
        };
        requestAnimationFrame(f);
      }));
      await page.locator(`.covertiles .tile[data-v="${id}"]`).click();
      assert.equal(await blank, 0, `the header is never blank while ${id} settles in`);
      await page.locator('#coverpanel').waitFor({ state: 'hidden', timeout: 4000 });
      await page.waitForTimeout(200);
      const rest = await dotStats('#mani canvas.cover');
      assert.ok(rest && rest.n > 150 && rest.w > 0.3 && rest.h > 0.45, `the dotted picture keeps a subject, not a strip or fragment (${JSON.stringify(rest)})`);
      // pressed: the same dots shiver in place (the particle canvas), bounded to a few pixels
      const m = await page.locator('#mani').boundingBox();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: m.x + 80, y: m.y + m.height / 2 }] });
      await page.waitForTimeout(250);
      const held = await dotStats('.dotcanvas');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(250);
      assert.ok(held && Math.abs(held.n - rest.n) / rest.n < 0.35 && Math.abs(held.w - rest.w * (m.width - 24) / m.width) < 0.12, `pressed, the subject is unchanged (${JSON.stringify({ rest, held })})`);
    }
    await page.evaluate(() => { NBNative.setPref('coverId', ''); nbOnState(NBNative.state()); });

    // A real library has many pictures: the tile list scrolls under a finger without closing the box.
    await page.evaluate(() => {
      window.coverTestOriginal = NBNative.state();
      const db = JSON.parse(coverTestOriginal), photo = db.items.find(i => i.kind === 'photo');
      for (let i = 0; i < 100; i++) db.items.push({ ...photo, id: `extra-${i}`, title: `Background ${i + 1}` });
      nbOnState(JSON.stringify(db));
    });
    await page.waitForTimeout(500);
    await openCover();
    const tileBox = await page.locator('.covertiles').boundingBox();
    await drag(tileBox.x + 100, tileBox.y + tileBox.height - 40, tileBox.y + 40, 10, 16);
    await release();
    await page.waitForTimeout(300);
    assert.ok(await page.locator('.covertiles').evaluate((el) => el.scrollTop > 20), 'the tiles scroll under a real touch drag');
    assert.equal(await page.locator('#coverpanel.formed').count(), 1, 'scrolling keeps the box open');
    const pick = await page.locator('.covertiles .tile').evaluateAll((els) => { const box = document.querySelector('.covertiles').getBoundingClientRect(); const t = els.find((e) => { const r = e.getBoundingClientRect(); return r.top > box.top + 4 && r.bottom < box.bottom - 4 && e.dataset.v; }); return t && t.dataset.v; });
    await page.locator(`.covertiles .tile[data-v="${pick}"]`).click();
    await page.locator('#coverpanel').waitFor({ state: 'hidden', timeout: 4000 });
    assert.equal(await page.locator('#mani .cover').count(), 1, 'the chosen picture is at the top');
    await page.evaluate(() => { NBNative.setPref('coverId', ''); nbOnState(coverTestOriginal); });
    await page.reload();
    await page.waitForTimeout(800);
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });

    await goTo('Sync');
    await page.locator('[data-a="manual"]').click();
    await backdropTap();
    await page.locator('#formsheet').waitFor({ state: 'hidden', timeout: 1500 }); // (back into the +)
    assert.equal(await page.locator('#formsheet').isVisible(), false, 'outside tap closes forms');
    assert.equal(await page.evaluate(() => nbBack()), true);
    await page.locator('#homegrid').waitFor();

    // The fan: reversing mid-open carries on from where it is, and Back closes it before anything else.
    await holdOrb(); await page.waitForTimeout(80);
    await page.locator('#orb').click(); await page.waitForTimeout(600);
    assert.equal(await page.locator('.fan-item').count(), 0, 'a tap on the orb closes it again, mid-opening');
    assert.equal(await page.locator('.note-screen').count(), 0, 'and does not also make a note');
    await holdOrb(); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => nbBack()), true);
    await page.locator('.fan-item').first().waitFor({ state: 'detached' });

    await goTo('Search'); await page.waitForTimeout(500);
    await page.evaluate(() => nbBack()); await page.locator('#homegrid').waitFor();
    await goTo('Sync'); await page.waitForTimeout(500);
    await page.locator('[data-a="openBin"]').click(); await page.locator('#bingrid').waitFor();
    await page.evaluate(() => nbBack()); await page.locator('#syncbody').waitFor();
    await page.evaluate(() => nbBack()); await page.locator('#homegrid').waitFor();
    await page.locator('#homesort .sortpill').click();
    await page.evaluate(() => nbBack()); await page.locator('.sortmenu').waitFor({ state: 'detached' });
    await page.waitForTimeout(500);

    // Home is one scroll: the grid sits under the masthead and board rail, so scroll it into reach.
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
    await page.waitForTimeout(300);

    // Swipe down on an open photo: a small swipe snaps back, a long one goes back to its card.
    await page.locator('#homegrid .card').first().click();
    await page.locator('.media-screen').waitFor();
    await page.waitForTimeout(700);
    await drag(190, 300, 340, 4, 40);
    assert.ok(await page.locator('.media-screen .stage img').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42 > 20), 'the photo follows the swipe');
    assert.ok(await page.locator('.media-screen .scrim').evaluate((el) => +getComputedStyle(el).opacity < 1), 'the backdrop fades with it');
    assert.equal(await page.locator('.media-screen').evaluate((el) => getComputedStyle(el).transform), 'none', 'the rest of the screen stays put');
    await release();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.media-screen').count(), 1, 'a small swipe stays');
    await drag(190, 300, 520, 10, 30);
    await release();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.media-screen').count(), 0, 'a long swipe goes back');
    assert.equal(await page.locator('#orb').isVisible(), true, 'the orb is back');

    // Stacks: press and hold a card to start picking, tap another, Stack (with the panel up).
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; }); await page.waitForTimeout(300);
    const box = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const photos = page.locator('#homegrid .card[data-v]');
    const first = await box('#homegrid .card[data-v] >> nth=0');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
    await page.waitForTimeout(650);
    await release();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#selbar').isVisible(), true, 'holding a card starts picking');
    assert.equal(await page.locator('#selstack').isDisabled(), true, 'one pick is not enough');
    const insetBar = () => page.locator('#selbar').evaluate((bar) => {
      const r = bar.getBoundingClientRect();
      return r.left >= 15 && r.right <= innerWidth - 15 && [...bar.children].every((el) => {
        const c = el.getBoundingClientRect(); return c.left >= r.left && c.right <= r.right;
      });
    });
    assert.ok(await insetBar(), 'one-selection toolbar is wholly inside the viewport');
    await photos.nth(0).click();
    assert.equal(await page.locator('#selcount').textContent(), '0 selected');
    await page.setViewportSize({ width: 320, height: 832 });
    assert.ok(await insetBar(), 'zero-selection toolbar and close button fit a narrow screen');
    await page.setViewportSize({ width: 384, height: 832 });
    await photos.nth(0).click();
    const firstId = await photos.nth(0).getAttribute('data-v'), secondId = await photos.nth(1).getAttribute('data-v');
    await photos.nth(1).click();
    assert.match(await page.locator('#selcount').textContent(), /2 selected/);
    await page.locator('#selstack').click();
    await page.waitForTimeout(300);
    const stack = page.locator('#homegrid .stackcard');
    assert.equal(await stack.count(), 1, 'one stack card');
    assert.equal(await stack.locator('.fanitem').count(), 2, 'with both pictures');
    assert.equal(await page.locator(`#homegrid .card[data-v="${firstId}"], #homegrid .card[data-v="${secondId}"]`).count(), 0, 'no longer loose cards');
    // Each card carries its own number; only the front one shows it.
    const front = () => stack.evaluate((el) => [...el.querySelectorAll('.stackct')].filter((b) => +getComputedStyle(b).opacity > 0.5).map((b) => b.textContent).join(','));
    const f0 = await front(), f1 = f0 === '1/2' ? '2/2' : '1/2';
    assert.equal(f0, `${[await photos.nth(0).count()].length && (await stack.locator('.fanitem').evaluateAll((els, id) => els.findIndex((e) => e.dataset.v === id), firstId)) + 1}/2`, 'the card the stack was made from is in front');
    // Flick left: next picture on top.
    const s = await box('#homegrid .stackcard');
    await drag(s.x + 60, s.y, s.y, 1, 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x - 90, y: s.y + 4 }] });
    await page.waitForTimeout(30);
    await release();
    await page.waitForTimeout(600);
    assert.equal(await front(), f1, 'a flick goes to the next picture');
    // Flick right: the same motion as left, the other way: the front card moves with the finger.
    const frontId = await stack.evaluate((el) => [...el.querySelectorAll('.fanitem')].find((b) => +getComputedStyle(b).getPropertyValue('--front') > 0.5).dataset.v);
    await drag(s.x - 60, s.y, s.y, 1, 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x - 20, y: s.y + 4 }] });
    await page.waitForTimeout(30);
    const followsRight = await stack.evaluate((el, id) => new DOMMatrix(getComputedStyle(el.querySelector(`.fanitem[data-v="${id}"]`)).transform).m41, frontId);
    assert.ok(followsRight > 1, `dragged right, the front card goes right with the finger (${followsRight})`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x + 90, y: s.y + 4 }] });
    await page.waitForTimeout(30);
    await release();
    await page.waitForTimeout(600);
    assert.equal(await front(), f0, 'and the other picture comes to the top');
    assert.equal(await page.locator('.media-screen').count(), 0, 'the flick did not open anything');
    // Tap opens the picture on top; it can be taken out of the stack there.
    await stack.click();
    await page.locator('.media-screen').waitFor();
    await page.locator('.dhead').click();
    await page.waitForTimeout(500);
    await page.locator('[data-a="unstack"]').click();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#homegrid .stackcard').count(), 0, 'a stack of one goes back to loose cards');

    // Drag to stack: hold a card, drag it onto another, let go. Then drag a third onto the stack.
    const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    async function dragOnto(from, to, hold = 320) {
      const a = await centre(from);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
      await page.waitForTimeout(hold); // held: it lifts; then it drags however long it was held
      assert.equal(await from.evaluate((el) => el.classList.contains('held')), true, 'holding still lifts the card');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + 18, y: a.y + 12 }] });
      await page.waitForTimeout(40);
      assert.ok(await from.evaluate((el) => el.classList.contains('carried') && getComputedStyle(el).visibility === 'hidden') && await page.locator('.dragbundle .dragface').count() === 1, 'a hold and a move carries the card: its copy under the finger, and it leaves the grid');
      await page.waitForTimeout(420); // the rest of the grid has closed up
      const b = await centre(to);
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + 18 + ((b.x - a.x - 18) * i) / 8, y: a.y + 12 + ((b.y - a.y - 12) * i) / 8 }] });
        await page.waitForTimeout(25);
      }
      assert.equal(await to.evaluate((el) => el.classList.contains('dropnear') && !el.classList.contains('droptarget')), true, 'the card under the finger starts to fill its ring');
      await page.waitForTimeout(480);
      assert.equal(await to.evaluate((el) => el.classList.contains('droptarget')), true, 'after a moment\'s rest it is ready to take it');
      await release();
      await page.waitForTimeout(500);
    }
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; }); await page.waitForTimeout(300);
    const loose = page.locator('#homegrid .card:not(.stackcard)');
    // Letting go over a card straight away puts it back (only a rest makes a stack).
    {
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
      const all = await page.evaluate(() => [...document.querySelectorAll('#homegrid .card:not(.stackcard)')].map((c) => { const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.top, r.bottom]; }).filter((r) => r[2] > 30 && r[3] < 600));
      const [a, b] = [all[0], all.find((r) => Math.abs(r[0] - all[0][0]) > 50)];
      const stacksBefore = await page.locator('#homegrid .stackcard').count();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a[0], y: a[1] }] });
      await page.waitForTimeout(320);
      for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a[0] + ((b[0] - a[0]) * i) / 8, y: a[1] + ((b[1] - a[1]) * i) / 8 }] }); await page.waitForTimeout(20); }
      await page.waitForTimeout(120);
      await release();
      await page.waitForTimeout(700);
      assert.equal(await page.locator('#homegrid .stackcard').count(), stacksBefore, 'let go on a card without resting: no stack');
      assert.equal(await page.locator('#homegrid .card.carried, .dragbundle').count(), 0, 'it is back in its place');
    }
    // Holding a card at the bottom edge scrolls the list; letting go off any card puts it back.
    {
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
      const first = await centre(page.locator('#homegrid .card').first());
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
      await page.waitForTimeout(320);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 6, y: 812 }] });
      await page.waitForTimeout(600);
      const scrolled = await page.locator('#homescroll').evaluate((el) => el.scrollTop);
      assert.ok(scrolled > 20, `the list scrolls while a card is held at the edge (${scrolled}px)`);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 6, y: 400 }] });
      await release();
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#homegrid .stackcard').count(), 0, 'dropped on nothing: no stack');
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 420; });
      await page.waitForTimeout(100);
    }
    const n0 = await loose.count();
    // two cards fully on screen (the first card in each column)
    const [i0, i1] = await page.evaluate(() => { const cs = [...document.querySelectorAll('#homegrid .card:not(.stackcard)')]; const on = cs.map((c, i) => [i, c.getBoundingClientRect()]).filter(([, r]) => r.bottom < innerHeight - 90 && r.top > 0); return [on[0][0], on.find(([, r]) => r.left !== on[0][1].left)[0]]; });
    await dragOnto(loose.nth(i0), loose.nth(i1));
    assert.equal(await page.locator('#homegrid .stackcard').count(), 1, 'dropping one card on another stacks them');
    assert.equal(await page.locator('#homegrid .stackcard .fanitem').count(), 2);
    assert.equal(await page.locator('#selbar').isVisible(), false, 'dragging does not start picking');
    await dragOnto(page.locator('#homegrid .card:not(.stackcard)').first(), page.locator('#homegrid .stackcard'), 1200); // a long hold still drags
    assert.equal(await page.locator('#homegrid .stackcard .fanitem').count(), 3, 'dropping onto a stack adds to it');
    assert.equal(await page.locator('#homegrid .card:not(.stackcard)').count(), n0 - 3);
    // Holding a stack still (no drag) picks it as one thing.
    const st = await centre(page.locator('#homegrid .stackcard'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [st] });
    await page.waitForTimeout(550);
    assert.equal(await page.locator('#homegrid .stackcard').evaluate((el) => el.classList.contains('held')), true, 'a long press lifts it while the finger is still down');
    await release();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#homegrid .stackcard').evaluate((el) => el.classList.contains('sel')), true, 'letting go without moving picks it');
    assert.equal(await page.locator('#selcount').textContent(), '1 selected', 'a stack counts as one');
    assert.equal(await page.locator('#selstack').isDisabled(), true);
    await page.waitForFunction(() => !document.querySelector('#selbar').classList.contains('riding')); // settled
    const glass = await page.locator('#selbar').evaluate((e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { width: r.width, height: r.height, blur: s.backdropFilter }; });
    assert.ok(glass.width <= 230 && glass.height >= 100 && glass.blur.includes('blur'), 'selection opens as a compact glass control, not a long bar');
    const exitFrames = page.evaluate(() => new Promise((resolve) => {
      const out = [], t0 = performance.now();
      const step = (now) => {
        const bar = document.querySelector('#selbar');
        const s = NBSurface.state(), shape = s.out && s.cur, acts = [...bar.children].filter((el) => getComputedStyle(el).visibility === 'visible' && +getComputedStyle(el).opacity > 0.3);
        out.push({ bar: !bar.hidden, selected: !!document.querySelector('.grid .card.sel'), riding: bar.classList.contains('riding'), opacity: Math.max(0, ...[...bar.children].map((el) => +getComputedStyle(el).opacity)),
          escaped: !!shape && acts.some((el) => { const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; return cx < shape.x || cx > shape.x + shape.w || cy < shape.y || cy > shape.y + shape.h; }) });
        if (now - t0 < 350) requestAnimationFrame(step); else resolve(out);
      };
      requestAnimationFrame(step);
    }));
    await page.locator('[data-a="selCancel"]').click();
    const exit = await exitFrames;
    const fading = exit.filter((f) => f.bar && !f.selected).map((f) => f.opacity);
    assert.ok(fading.every((o, i) => i === 0 || o <= fading[i - 1] + 0.001), 'the actions fade as the picking ends, never coming back');
    assert.ok(exit.every((f) => !f.escaped), 'no button shows outside the shape as it folds into the orb');

    // Inside a board, the stack made in All shows as loose cards; a stack made in the board groups there.
    await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(400);
    const pill = await page.evaluate(() => { const p = document.querySelector('.pile[data-v]'); return [p.dataset.v, 0, p.querySelector('.nm').textContent]; });
    await page.locator('.pile[data-v]').first().click();
    await page.waitForTimeout(700);
    await page.locator('#boardgrid').waitFor();
    await page.waitForTimeout(700);
    const boardCards = page.locator('#boardgrid .card:not(.stackcard)');
    assert.equal(await page.locator('#boardgrid .stackcard').count(), 0, 'a stack made in All is loose cards in a board');
    assert.ok(await boardCards.count() >= 2, `the board “${pill[2].trim()}” needs two cards for this check`);
    const b0 = await centre(boardCards.nth(0));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [b0] });
    await page.waitForTimeout(650);
    await release();
    await page.waitForTimeout(350);
    await boardCards.nth(1).click();
    await page.locator('#selstack').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#boardgrid .stackcard').count(), 1, 'a stack made in the board groups in the board');

    assert.deepEqual(errors, []);
    console.log('Phone gestures passed: swipe-down closes a photo (small swipes snap back), hold-to-pick and Stack, flick through a stack, take out of a stack, drag onto a card or a stack to stack, a held stack counts as one, stacks made in All are loose inside a board while a stack made in the board groups there, the list scrolls while a card is held at the edge.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
