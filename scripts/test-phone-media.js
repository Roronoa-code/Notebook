// Phone: the open photo or video, driven with real touches (the mock bridge; no phone or library touched).
// One picture, handled directly: it grows out of its card, zooms and pans in place, swipes to its
// neighbours, drags down back into its card, and drags up into Details & boards. Which gestures work
// depends on the state (viewing, zoomed, details open), Android Back steps back through those states,
// and interrupted or rapid gestures carry on from where they are.
// Usage: node scripts/test-phone-media.js (requires Microsoft Edge).
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 384, height: 832 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
    await page.waitForTimeout(1200); // the one-time card entrance
    const cdp = await page.context().newCDPSession(page);
    const W = 384, H = 832;
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ id, x, y })) });
    // A one-finger drag in `steps` moves, `ms` apart; `lift` false keeps the finger down.
    async function drag(from, to, { steps = 10, ms = 16, lift = true } = {}) {
      await touch('touchStart', [from]);
      for (let i = 1; i <= steps; i++) { await touch('touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await page.waitForTimeout(ms); }
      if (lift) await touch('touchEnd', []);
    }
    const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); };
    const media = page.locator('.media-screen .stage .photo img, .media-screen .stage .vbox').first();
    const matrix = () => media.evaluate((el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return { s: m.a, x: m.m41, y: m.m42 }; });
    const title = () => page.locator('.dhead > span').textContent();
    const current = () => page.evaluate(() => document.querySelector('#stage > .media-screen:last-child .dhead span')?.textContent);
    const expanded = () => page.locator('.dhead').getAttribute('aria-expanded');
    const sheetH = () => page.locator('.media-screen .sheet').evaluate((el) => el.getBoundingClientRect().height);
    const centre = async () => { const b = await media.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

    // Open the first photo: it grows out of its card; the grid stays underneath.
    const firstCard = page.locator('#homegrid .card[data-a="open"]').first();
    const firstTitle = (await firstCard.getAttribute('aria-label')).replace(/^Open /, '');
    await firstCard.click();
    assert.ok(await media.evaluate((el) => el.getAnimations()[0].effect.getKeyframes()[0].transform.includes('scale(')), 'the photo grows out of its card');
    assert.equal(await page.locator('#homegrid').isVisible(), true, 'the grid is still underneath');
    assert.equal(await page.locator('.photo-viewer, dialog').count(), 0, 'no second viewer');
    // Touching it mid-opening takes over at once (no jump when the animation would have finished).
    await page.waitForTimeout(120);
    await touch('touchStart', [[W / 2, 330]]);
    assert.equal(await media.evaluate((el) => el.getAnimations().length), 0, 'a touch finishes the opening straight away');
    await touch('touchEnd', []);
    await page.waitForTimeout(700);
    assert.equal(await expanded(), 'false', 'details start closed (every picture the same)');
    assert.equal(await page.locator('.media-body').isVisible(), false);

    // Zoom in place: the sheet steps aside, but a visible Back keeps the way out discoverable.
    let [x, y] = await centre();
    await tap(x, y); await page.waitForTimeout(80); await tap(x, y);
    await page.waitForTimeout(700);
    assert.ok((await matrix()).s > 2, 'double-tap enlarges the photo');
    assert.equal(await page.locator('.media-screen.zoomed').count(), 1);
    assert.equal(await page.locator('.media-screen .sheet').evaluate((el) => getComputedStyle(el).opacity), '0', 'the sheet steps aside while zoomed');
    // One finger pans (and can't go past the picture's edges); it doesn't swipe or dismiss.
    const before = await matrix();
    await drag([x, y], [x + 400, y + 300], { steps: 12 });
    await page.waitForTimeout(800);
    const panned = await matrix(), box = await media.boundingBox();
    assert.ok(panned.x > before.x + 20, 'one finger pans the enlarged photo');
    assert.ok(box.x <= 1 && box.y <= 1, `settles with no gap past the picture's edge (left ${box.x.toFixed(1)}, top ${box.y.toFixed(1)})`);
    assert.equal(await title(), firstTitle, 'panning never moved to another picture');
    // The visible Back follows the same order as Android Back.
    assert.equal(await page.locator('.lbback').evaluate((el) => getComputedStyle(el).opacity), '1', 'Back remains visible while zoomed');
    await page.locator('.lbback').click();
    await page.waitForTimeout(700);
    assert.deepEqual(await matrix(), { s: 1, x: 0, y: 0 }, 'Back zooms out');
    assert.equal(await page.locator('.media-screen').count(), 1, 'and stays on the picture');
    assert.equal(await page.locator('.media-screen .sheet').evaluate((el) => getComputedStyle(el).opacity), '1', 'the sheet comes back');
    // Two-finger pinch, then letting one finger go carries on panning without a jump.
    [x, y] = await centre();
    await touch('touchStart', [[x - 30, y], [x + 30, y]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[x - 30 - i * 15, y], [x + 30 + i * 15, y]]); await page.waitForTimeout(16); }
    const pinched = await matrix();
    assert.ok(pinched.s > 2, 'pinching enlarges it');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: 1, x: x + 120, y }] }); // the second finger lifts
    await page.waitForTimeout(16);
    for (let i = 1; i <= 4; i++) { await touch('touchMove', [[x - 120 + i * 10, y]]); await page.waitForTimeout(16); } // the other carries on
    const oneLeft = await matrix();
    assert.ok(Math.abs(oneLeft.s - pinched.s) < 0.01, 'lifting a finger mid-pinch keeps the zoom');
    await touch('touchEnd', []);
    await page.waitForTimeout(800);
    // Pinching back below its size springs to fit.
    [x, y] = [W / 2, 360];
    await tap(x, y); await page.waitForTimeout(80); await tap(x, y);
    await page.waitForTimeout(700);
    assert.deepEqual(await matrix(), { s: 1, x: 0, y: 0 }, 'double-tap when zoomed goes back to fit');

    // Swipe sideways: the neighbour slides in beside it, following the finger.
    [x, y] = await centre();
    await drag([x + 30, y], [x - 30, y], { steps: 8, ms: 60, lift: false });
    assert.ok((await matrix()).x < -35, 'dragging towards the next picture follows the finger without edge resistance');
    assert.equal(await page.locator('.peek').count() >= 1, true, 'the next picture shows beside it');
    const peekX = await page.locator('.peek').last().evaluate((el) => el.getBoundingClientRect().left);
    assert.ok(peekX < W, 'the next picture is coming in from the right');
    await touch('touchEnd', []);
    await page.waitForTimeout(700);
    assert.equal(await title(), firstTitle, 'a short, slow swipe snaps back to the same picture');
    assert.deepEqual(await matrix(), { s: 1, x: 0, y: 0 });
    assert.equal(await page.locator('.peek').count(), 0, 'the neighbours are put away');
    await drag([x + 120, y], [x - 180, y], { steps: 8 });
    await page.waitForTimeout(800);
    const second = await title();
    assert.notEqual(second, firstTitle, 'a longer swipe shows the next picture');
    assert.equal(await page.locator('.media-screen').count(), 1, 'one open picture (swapped in place)');
    assert.deepEqual(await matrix(), { s: 1, x: 0, y: 0 }, 'it lands exactly in place');
    await drag([x - 120, y], [x + 180, y], { steps: 8 });
    await page.waitForTimeout(800);
    assert.equal(await title(), firstTitle, 'swiping the other way comes back');
    await drag([x - 120, y], [x + 180, y], { steps: 8 });
    await page.waitForTimeout(800);
    assert.equal(await title(), firstTitle, 'the first picture has nothing before it: it gives a little and stays');
    // Rapid: two quick flicks in a row both count.
    await drag([x + 100, y], [x - 60, y], { steps: 3, ms: 8 });
    await page.waitForTimeout(260);
    await drag([x + 100, y], [x - 60, y], { steps: 3, ms: 8 });
    await page.waitForTimeout(800);
    assert.ok(![firstTitle, second].includes(await title()), 'two quick flicks move two pictures on');
    await drag([x - 100, y], [x + 60, y], { steps: 3, ms: 8 });
    await page.waitForTimeout(260);
    await drag([x - 100, y], [x + 60, y], { steps: 3, ms: 8 });
    await page.waitForTimeout(800);
    assert.equal(await title(), firstTitle);

    // Drag down: the picture follows (a small drag springs back); the grid shows through behind it.
    await drag([x, y], [x + 10, y + 60], { steps: 6, lift: false });
    const held = await matrix();
    assert.ok(held.y > 40 && held.s < 1, 'the picture follows the finger down, shrinking a little');
    assert.ok(await page.locator('.media-screen .scrim').evaluate((el) => +getComputedStyle(el).opacity < 1), 'the backdrop fades with it');
    assert.equal(await page.locator('#homegrid').isVisible(), true);
    await touch('touchEnd', []);
    await page.waitForTimeout(800);
    assert.deepEqual(await matrix(), { s: 1, x: 0, y: 0 }, 'a small drag springs back');
    // Dragged further, it flies back into its card, never disappearing on the way.
    const seen = page.evaluate(() => new Promise((resolve) => {
      const out = [];
      const frame = () => {
        const img = document.querySelector('#stage > .media-screen .stage img, #stage > .media-screen .stage .vbox');
        const card = document.querySelector('#homegrid .card[data-a="open"] .media');
        const r = img && img.getBoundingClientRect();
        out.push(img ? { on: r.width > 20 && r.bottom > 0 && r.top < innerHeight && +getComputedStyle(img).opacity > 0.5 } : { gone: true, card: !!card && getComputedStyle(card).visibility === 'visible' });
        const done = out.findIndex((f) => f.gone);
        if (out.length < 400 && (done < 0 || out.length - done < 20)) requestAnimationFrame(frame); else resolve(out);
      };
      requestAnimationFrame(frame);
    }));
    await drag([x, y], [x, y + 240], { steps: 10 });
    const frames = await seen;
    const gone = frames.findIndex((f) => f.gone);
    assert.ok(gone > 0, 'the picture closes');
    assert.ok(frames.slice(0, gone).every((f) => f.on), 'the picture is on screen in every frame until it lands');
    assert.ok(frames.slice(gone).every((f) => f.card), 'and its card is showing from then on');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.media-screen').count(), 0);

    // Details & boards: drag the picture up and the sheet follows the finger.
    await firstCard.click();
    await page.waitForTimeout(700);
    [x, y] = await centre();
    const closedH = await sheetH();
    await drag([x, y], [x, y - 90], { steps: 18, lift: false });
    const midH = await sheetH();
    assert.ok(Math.abs(midH - closedH - 90) <= 12, `the sheet follows the finger (${(midH - closedH).toFixed(0)}px for 90px, less the touch slop)`);
    const reveal = await page.evaluate(() => { const sh = document.querySelector('.media-screen .sheet').getBoundingClientRect(), a = document.querySelector('.media-screen [data-close-details]').getBoundingClientRect(), n = document.querySelector('#note').getBoundingClientRect(); return { actions: a.top >= sh.bottom - 1, note: n.top < sh.bottom }; });
    assert.ok(reveal.note && reveal.actions, 'the sheet uncovers its contents from the top (note first, actions last)');
    await drag([x, y - 90], [x, y - 260], { steps: 6, lift: true });
    await page.waitForTimeout(700);
    assert.equal(await expanded(), 'true', 'dragged far enough, it opens');
    // Its actions are fully on screen, above the gesture bar.
    for (const sel of ['[data-a="bin"]', '[data-close-details]']) {
      const b = await page.locator('.media-screen ' + sel).boundingBox();
      assert.ok(b && b.y > 0 && b.y + b.height <= H - 10, `${sel} is fully in view (bottom ${b && (b.y + b.height).toFixed(0)})`);
    }
    // With details open the picture is small above it: sideways and pinch do nothing, a tap closes the sheet.
    [x, y] = await centre();
    const t0 = await title();
    await drag([x + 60, y], [x - 120, y], { steps: 6 });
    await page.waitForTimeout(500);
    assert.equal(await title(), t0, 'no swiping while the details are open');
    await tap(x, y);
    await page.waitForTimeout(700);
    assert.equal(await expanded(), 'false', 'a tap on the picture closes the details');
    // Tap the title bar to open; drag it down to close (it follows the finger).
    await page.locator('.dhead').click();
    await page.waitForTimeout(700);
    const openH = await sheetH();
    const hb = await page.locator('.dhead').boundingBox();
    await drag([hb.x + 40, hb.y + hb.height / 2], [hb.x + 40, hb.y + hb.height / 2 + 80], { steps: 16, lift: false });
    assert.ok(Math.abs(openH - (await sheetH()) - 80) <= 12, 'the title bar drags the sheet down with the finger');
    await touch('touchMove', [[hb.x + 40, hb.y + 400]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(700);
    assert.equal(await expanded(), 'false', 'dragged down, it closes');
    // Tapping quickly twice reverses mid-way and ends where the last tap says.
    await page.locator('.dhead').evaluate((el) => { el.click(); setTimeout(() => el.click(), 90); });
    await page.waitForTimeout(800);
    assert.equal(await expanded(), 'false');
    assert.ok(Math.abs((await sheetH()) - closedH) < 1, 'rapid reversal settles closed');
    // Back closes the details first; Done closes them too.
    await page.locator('.dhead').click();
    await page.waitForTimeout(700);
    await page.locator('#note').fill('Media test caption');
    await page.locator('.lbback').click();
    await page.waitForTimeout(700);
    assert.equal(await expanded(), 'false', 'Back closes the details');
    assert.equal(await page.locator('.media-screen').count(), 1, 'without leaving the picture');
    await page.locator('.dhead').click();
    await page.waitForTimeout(700);
    await page.locator('[data-close-details]').click();
    await page.waitForTimeout(700);
    assert.equal(await expanded(), 'false', 'Done closes the details');
    // Back again: to the grid, where it was, without replaying the cards' entrance.
    await page.evaluate(() => window.nbBack());
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.media-screen').count(), 0, 'Back from the picture goes to the grid');
    assert.equal(await page.locator('#homegrid.anim').count(), 0, 'return does not replay every card entrance');
    await page.evaluate(() => { window.testCard = document.querySelector('.card'); window.nbOnState(window.NBNative.state()); });
    assert.equal(await page.evaluate(() => window.testCard === document.querySelector('.card')), true, 'unchanged sync state keeps the existing grid');
    await firstCard.click();
    await page.waitForTimeout(600);
    await page.locator('.dhead').click();
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#note').inputValue(), 'Media test caption', 'the note was saved');
    await page.evaluate(() => { window.nbBack(); window.nbBack(); });
    await page.waitForTimeout(900);

    // A video: the same gestures (no zoom); a tap pauses, a drag doesn't.
    const videoCard = page.locator('#homegrid .card[data-a="open"]:has(.badge)').first();
    await videoCard.click();
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.vbox video').count(), 1, 'one video');
    assert.equal(await page.locator('video[controls]').count(), 0, 'no Android controls: our own quiet player');
    assert.equal(await page.locator('.vbox video').evaluate((v) => v.muted && v.loop), true, 'loops with the sound off');
    await page.locator('.vbox .vsound').click();
    assert.equal(await page.locator('.vbox video').evaluate((v) => v.muted), false, 'sound button turns sound on');
    [x, y] = await centre();
    const paused = () => page.locator('.vbox video').evaluate((v) => v.paused);
    const p0 = await paused();
    await drag([x, y], [x + 5, y + 50], { steps: 5 });
    await page.waitForTimeout(600);
    assert.equal(await paused(), p0, 'a drag on the video doesn’t pause it');
    await page.evaluate(() => window.nbBack());
    await page.waitForTimeout(900);

    // Reduced motion: everything lands at once.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await firstCard.click();
    await page.waitForTimeout(100);
    [x, y] = await centre();
    await tap(x, y); await page.waitForTimeout(60); await tap(x, y);
    await page.waitForTimeout(50);
    assert.ok((await matrix()).s > 2, 'zoom is immediate with reduced motion');
    assert.deepEqual(errors, []);
    console.log('Phone media passed: grows from its card, zoom in place (double-tap, pinch, pan within its edges), Back zooms out then closes details then leaves, swipe to neighbours (follows the finger, snaps back, rapid flicks), drag down back into its card without ever vanishing, Details & boards by dragging or tapping (follows the finger, actions in view, rapid reversal), video gestures, note saving, grid kept, reduced motion.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
