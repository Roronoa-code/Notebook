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
    assert.ok(await page.locator('.media-screen').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42 > 20), 'photo follows the swipe');
    await release();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.media-screen').count(), 1, 'a small swipe stays');
    await drag(190, 300, 520, 10, 30);
    await release();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.media-screen').count(), 0, 'a long swipe goes back');
    assert.equal(await page.locator('.ghost').count(), 0, 'the flying photo is cleaned up');
    assert.equal(await page.locator('#nav').isVisible(), true);

    assert.deepEqual(errors, []);
    console.log('Phone gestures passed: panel follows the finger, slow drags settle back, flicks lift, pull-down lowers, swipe-down closes a photo (small swipes snap back).');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
