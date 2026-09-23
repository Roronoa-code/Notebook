// Phone UI on the PC, using the existing preview data. No owner library or device is touched.
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
    assert.equal(await page.locator('#lift').evaluate(el => getComputedStyle(el).transitionDuration.split(',')[0]), '0.6s', 'all-boards rise uses the tuned timing');
    await page.waitForTimeout(1200); // Let the one-time initial card entrance finish.
    const offsets = await page.evaluate(async () => {
      const lift = document.querySelector('#lift'), card = lift.querySelectorAll('.card')[2], result = [];
      for (let direction = 0; direction < 2; direction++) {
        lift.querySelector('.grip').click();
        const start = performance.now();
        await new Promise(resolve => { const frame = now => {
          result.push(card.getBoundingClientRect().top - lift.getBoundingClientRect().top);
          if (now - start < 800) requestAnimationFrame(frame); else resolve();
        }; requestAnimationFrame(frame); });
      }
      return result;
    });
    assert.ok(Math.max(...offsets) - Math.min(...offsets) < 1, 'all cards stay fixed inside the panel throughout both directions');
    await page.locator('.grip').click();
    await page.locator('.card').first().click();
    assert.ok(await page.locator('.ghost').evaluate(el => el.getAnimations()[0].effect.getKeyframes()[0].transform.includes('scale(')), 'the photo flies out of its card');
    await page.locator('.ghost').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.media-details').getAttribute('open'), null);
    await page.locator('.photo-open').click();
    await page.locator('.photo-viewer').waitFor();
    const viewport = page.locator('.photo-viewport');
    const box = await viewport.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const scale = () => page.locator('.photo-viewport img').evaluate((img) => new DOMMatrix(getComputedStyle(img).transform).a);
    await page.mouse.dblclick(x, y);
    await page.waitForTimeout(260);
    assert.ok(await scale() > 2, 'double-tap enlarges the photo');
    await page.mouse.dblclick(x, y); // double-tap again resets
    await page.waitForTimeout(260);
    assert.equal(await scale(), 1);

    const cdp = await page.context().newCDPSession(page);
    const touch = (id, tx, ty) => ({ id, x: tx, y: ty });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(0, x - 30, y), touch(1, x + 30, y)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(0, x - 90, y), touch(1, x + 90, y)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    assert.ok(await scale() > 2, 'two-finger pinch enlarges the photo');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(0, x, y)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(0, x + 45, y + 30)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    assert.ok(await page.locator('.photo-viewport img').evaluate((img) => Math.abs(new DOMMatrix(getComputedStyle(img).transform).m41) > 10), 'enlarged photo pans');
    await page.evaluate(() => window.nbBack());
    await page.locator('.photo-viewer').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.photo-open').count(), 1, 'Back closes zoom before leaving the item');
    for (const distance of [40, -160, 160]) {
      if (!(await page.locator('.photo-viewer').count())) await page.locator('.photo-open').click();
      await page.waitForTimeout(240);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(0, x, y)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(0, x, y + distance)] });
      assert.ok(Math.abs(await page.locator('.photo-viewer').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42)) > 20, 'viewer follows the swipe');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      if (Math.abs(distance) > 90) await page.locator('.photo-viewer').waitFor({ state: 'detached' });
      else {
        await page.waitForTimeout(300);
        assert.equal(await page.locator('.photo-viewer').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42), 0, 'short swipe returns to rest');
      }
    }
    const disclosure = page.locator('.media-details summary');
    const sheetHeight = () => page.locator('.media-screen .sheet').evaluate(el => el.getBoundingClientRect().height);
    const collapsed = await sheetHeight();
    await disclosure.click();
    await page.waitForTimeout(80);
    const opening = await sheetHeight();
    await page.waitForTimeout(450);
    const expanded = await sheetHeight();
    assert.ok(opening > collapsed && opening < expanded - 1, 'details animates open through intermediate heights');
    await disclosure.click();
    await page.waitForTimeout(80);
    const closing = await sheetHeight();
    assert.ok(closing > collapsed && closing < expanded, 'details animates closed through intermediate heights');
    // Reverse while still closing, using a direct click so Playwright does not wait for layout to settle.
    await disclosure.evaluate(el => el.click());
    await page.waitForTimeout(470);
    assert.equal(await sheetHeight(), expanded, 'rapid reversal finishes expanded');
    await disclosure.click();
    await page.waitForTimeout(470);
    assert.equal(await page.locator('.media-details').getAttribute('open'), null, 'closing unmounts the disclosure content from view');
    await disclosure.click();
    await page.waitForTimeout(470);
    assert.equal(await page.locator('#note').isVisible(), true);
    await page.locator('#note').fill('Media test caption');
    await page.locator('[data-a="back"]').first().click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#homegrid.anim').count(), 0, 'return does not replay every card entrance');
    await page.evaluate(() => {
      window.testCard = document.querySelector('.card');
      window.nbOnState(window.NBNative.state());
    });
    assert.equal(await page.evaluate(() => window.testCard === document.querySelector('.card')), true, 'unchanged sync state keeps the existing grid');
    await page.locator('.card').first().click();
    await page.locator('.media-details summary').click();
    assert.equal(await page.locator('#note').inputValue(), 'Media test caption');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.photo-open').click();
    assert.equal(await page.locator('.photo-viewer').evaluate((el) => el.getAnimations().length), 0);
    await page.getByRole('button', { name: 'Close photo' }).click();
    await page.locator('[data-a="back"]').first().click();
    await page.locator('.card').nth(1).click();
    assert.equal(await page.locator('video[controls]').count(), 1, 'one native video player');
    assert.equal(await page.locator('#playbtn').count(), 0, 'no duplicate play overlay');
    assert.deepEqual(errors, []);
    console.log('Phone media passed: expand, pinch/pan, swipe both ways, snap-back, animated/reversible details, single player, caption saving, slower boards, grid retention and reduced motion.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
