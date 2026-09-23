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
    await page.waitForTimeout(550);

    const frames = await page.evaluate(async () => {
      const nav = document.querySelector('#nav');
      const sync = document.querySelector('#nav-sync');
      const home = document.querySelector('#nav-home');
      const read = () => ({
        x: new DOMMatrix(getComputedStyle(nav, '::before').transform).m41,
        width: sync.getBoundingClientRect().width,
        navWidth: nav.getBoundingClientRect().width,
        opacity: Number(getComputedStyle(sync.querySelector('.navlbl')).opacity)
      });
      const result = [read()];
      sync.click();
      const start = performance.now();
      await new Promise((resolve) => {
        const sample = (now) => {
          result.push(read());
          if (now - start < 600) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      result.homeWidth = home.getBoundingClientRect().width;
      return result;
    });
    assert.ok(frames.some((f) => f.x > 10 && f.x < 155), 'selection travels through intermediate positions');
    assert.ok(frames.some((f) => f.width > 52 && f.width < 96), 'label space expands gradually');
    assert.ok(frames.some((f) => f.opacity > 0 && f.opacity < 1), 'label fades in');
    assert.ok(Math.abs(frames.at(-1).x - 166) < 1, 'selection lands on Sync');
    assert.ok(Math.max(...frames.map((f) => f.navWidth)) - Math.min(...frames.map((f) => f.navWidth)) < 1, 'bar keeps its width between Home and Sync');
    assert.equal(await page.locator('#nav-sync').getAttribute('aria-current'), 'page');

    // Reverse while in flight: CSS must continue from the currently displayed position.
    const reverse = await page.evaluate(async () => {
      const nav = document.querySelector('#nav');
      const x = () => new DOMMatrix(getComputedStyle(nav, '::before').transform).m41;
      document.querySelector('#nav-home').click();
      await new Promise((r) => setTimeout(r, 100));
      const before = x();
      document.querySelector('#nav-sync').click();
      return { before, after: x() };
    });
    assert.ok(Math.abs(reverse.before - reverse.after) < 1, 'rapid reversal starts where the highlight already is');
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
      document.querySelector('#nav-home').click();
      await new Promise((r) => setTimeout(r, 70));
      document.querySelector('#nav-sync').click();
      await new Promise((r) => setTimeout(r, 70));
      document.querySelector('#nav-home').click();
    });
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#stage > .screen').count(), 1, 'rapid navigation leaves one screen');
    assert.equal(await page.locator('#stage #stack').count(), 1, 'returning Home cannot be removed by an older transition');
    assert.equal(await page.locator('#stage > .screen').evaluate((el) => getComputedStyle(el).pointerEvents), 'auto');

    const topMotion = await page.evaluate(async () => {
      const seg = document.querySelector('.topbar .seg');
      document.querySelector('#tab-notes').click();
      await new Promise(r => setTimeout(r, 100));
      const mid = new DOMMatrix(getComputedStyle(seg, '::before').transform).m41;
      await new Promise(r => setTimeout(r, 450));
      const end = new DOMMatrix(getComputedStyle(seg, '::before').transform).m41;
      document.querySelector('#tab-recent').click();
      return { mid, end };
    });
    assert.ok(topMotion.mid > 0 && topMotion.mid < 78 && Math.abs(topMotion.end - 78) < 1, 'top Recent/Notes selection travels too');
    await page.locator('#addbtn').click();
    assert.equal(await page.locator('#addsheet').isVisible(), true);
    await page.locator('#addbtn').click();
    await page.locator('#addsheet').waitFor({ state: 'hidden', timeout: 1000 }); // sinks away rather than vanishing
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#nav-sync').click();
    assert.equal(await page.locator('#nav').evaluate((el) => getComputedStyle(el, '::before').transitionDuration), '0s');
    assert.deepEqual(errors, []);
    console.log('Phone navigation passed: travelling highlight, gradual labels, stable width, rapid reversal, screen retention, Add and reduced motion.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
