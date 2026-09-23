// Phone touch gestures (items panel drag/flick, swipe down to close a photo), using the mock bridge.
// Usage: node scripts/test-phone-gestures.js (requires Microsoft Edge).
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
    await page.waitForTimeout(1200);
    const cdp = await page.context().newCDPSession(page);
    const liftY = () => page.locator('#lift').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
    // A drag made of small steps, `ms` apart, so speed can be controlled.
    async function drag(x, fromY, toY, steps, ms) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] });
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / steps }] });
        await page.waitForTimeout(ms);
      }
    }
    const release = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const rest = await liftY();
    // Slow, short drag: the panel follows the finger, then springs back down.
    await drag(190, 700, 600, 10, 40);
    const held = await liftY();
    assert.ok(Math.abs(rest - held - 100) < 12, `panel follows the finger (moved ${rest - held}px for 100px)`);
    await release();
    await page.waitForTimeout(1200);
    assert.ok(Math.abs((await liftY()) - rest) < 1, 'a small slow drag settles back down');
    assert.equal(await page.locator('#lift.up').count(), 0);

    // Short, fast flick: goes all the way up.
    await drag(190, 700, 640, 3, 8);
    await release();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#lift.up').count(), 1, 'a quick flick lifts the panel');
    assert.ok((await liftY()) < 80, 'panel is up under the top bar');

    // Pull down from the top of the list: follows, and a longer slow pull lowers it.
    await drag(190, 300, 700, 16, 30);
    await release();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#lift.up').count(), 0, 'pulling down lowers it');

    // Swipe down on an open photo: a small swipe snaps back, a long one goes back to its card.
    await page.locator('.grip').click();
    await page.waitForTimeout(900);
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
    assert.equal(await page.locator('#nav').isVisible(), true);

    // Stacks: press and hold a card to start picking, tap another, Stack.
    await page.locator('.grip').click();
    await page.waitForTimeout(900);
    const box = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const photos = page.locator('#homegrid .card[data-v]');
    const first = await box('#homegrid .card[data-v] >> nth=0');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
    await page.waitForTimeout(650);
    await release();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#selbar').isVisible(), true, 'holding a card starts picking');
    assert.equal(await page.locator('#selstack').isDisabled(), true, 'one pick is not enough');
    const firstId = await photos.nth(0).getAttribute('data-v'), secondId = await photos.nth(1).getAttribute('data-v');
    await photos.nth(1).click();
    assert.match(await page.locator('#selcount').textContent(), /2 picked/);
    await page.locator('#selstack').click();
    await page.waitForTimeout(300);
    const stack = page.locator('#homegrid .stackcard');
    assert.equal(await stack.count(), 1, 'one stack card');
    assert.equal(await stack.locator('.fanitem').count(), 2, 'with both pictures');
    assert.equal(await page.locator(`#homegrid .card[data-v="${firstId}"], #homegrid .card[data-v="${secondId}"]`).count(), 0, 'no longer loose cards');
    assert.equal(await stack.locator('.stackct').textContent(), '1/2');
    // Flick left: next picture on top.
    const s = await box('#homegrid .stackcard');
    await drag(s.x + 60, s.y, s.y, 1, 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x - 90, y: s.y + 4 }] });
    await page.waitForTimeout(30);
    await release();
    await page.waitForTimeout(500);
    assert.equal(await stack.locator('.stackct').textContent(), '2/2', 'a flick goes to the next picture');
    assert.equal(await page.locator('.media-screen').count(), 0, 'the flick did not open anything');
    // Tap opens the picture on top; it can be taken out of the stack there.
    await stack.click();
    await page.locator('.media-screen').waitFor();
    await page.locator('.media-details summary').click();
    await page.waitForTimeout(500);
    await page.locator('[data-a="unstack"]').click();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#homegrid .stackcard').count(), 0, 'a stack of one goes back to loose cards');

    // Drag to stack: hold a card, drag it onto another, let go. Then drag a third onto the stack.
    const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    async function dragOnto(from, to) {
      const a = await centre(from), b = await centre(to);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
      await page.waitForTimeout(550);
      assert.equal(await from.evaluate((el) => el.classList.contains('lifted')), true, 'holding lifts the card');
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }] });
        await page.waitForTimeout(25);
      }
      assert.equal(await to.evaluate((el) => el.classList.contains('droptarget')), true, 'the card under the finger lights up');
      await release();
      await page.waitForTimeout(500);
    }
    if (!(await page.locator('#lift.up').count())) { await page.locator('.grip').click(); await page.waitForTimeout(900); }
    const loose = page.locator('#homegrid .card:not(.stackcard)');
    const n0 = await loose.count();
    // two cards fully on screen (the first card in each column)
    const [i0, i1] = await page.evaluate(() => { const cs = [...document.querySelectorAll('#homegrid .card:not(.stackcard)')]; const on = cs.map((c, i) => [i, c.getBoundingClientRect()]).filter(([, r]) => r.bottom < innerHeight - 90 && r.top > 0); return [on[0][0], on.find(([, r]) => r.left !== on[0][1].left)[0]]; });
    await dragOnto(loose.nth(i0), loose.nth(i1));
    assert.equal(await page.locator('#homegrid .stackcard').count(), 1, 'dropping one card on another stacks them');
    assert.equal(await page.locator('#homegrid .stackcard .fanitem').count(), 2);
    assert.equal(await page.locator('#selbar').isVisible(), false, 'dragging does not start picking');
    await dragOnto(page.locator('#homegrid .card:not(.stackcard)').first(), page.locator('#homegrid .stackcard'));
    assert.equal(await page.locator('#homegrid .stackcard .fanitem').count(), 3, 'dropping onto a stack adds to it');
    assert.equal(await page.locator('#homegrid .card:not(.stackcard)').count(), n0 - 3);
    // Holding a stack still (no drag) picks it as one thing.
    const st = await centre(page.locator('#homegrid .stackcard'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [st] });
    await page.waitForTimeout(550);
    await release();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#selcount').textContent(), '1 picked', 'a stack counts as one');
    assert.equal(await page.locator('#selstack').isDisabled(), true);
    await page.locator('[data-a="selCancel"]').click();

    assert.deepEqual(errors, []);
    console.log('Phone gestures passed: panel follows the finger, slow drags settle back, flicks lift, pull-down lowers, swipe-down closes a photo (small swipes snap back), hold-to-pick and Stack, flick through a stack, take out of a stack, drag onto a card or a stack to stack, a held stack counts as one.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
