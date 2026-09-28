// Only the new effects, through the real packaged window and IPC listeners.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const { Library } = require('../main/library');
const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'test-output', 'effects-desktop-' + process.pid);
(async () => {
  const libraryPath = path.join(OUT, 'library'), userData = path.join(OUT, 'userdata');
  await Library.openOrCreate(libraryPath);
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ libraryPath }));
  const imagePath = path.join(OUT, 'sample.png');
  fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9uoAAAAASUVORK5CYII=', 'base64'));
  const app = await electron.launch({
    ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }),
    env: { ...process.env, NOTEBOOK_USER_DATA: userData, NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47865', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_FAKE_NAMES: '1', NOTEBOOK_FAKE_FEED: '1', NOTEBOOK_TOOLS: path.join(OUT, 'tools'), NOTEBOOK_WINDOW_DISPLAY: 'second' }
  });
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('#link-input').waitFor();
    await page.waitForFunction(() => window.NB?.links && NB.S?.snap);
    await app.evaluate(({ app }, file) => {
      const { Downloader } = process.mainModule.require(app.getAppPath() + '/main/downloader.js');
      Downloader.prototype.fetch = () => new Promise((resolve, reject) => { globalThis.finishEffectSave = () => resolve({ files: [file], title: 'Test TikTok' }); globalThis.failEffectSave = () => reject({ friendly: 'Test save failed' }); });
    }, imagePath);
    const paste = url => page.locator('#link-input').evaluate((el, url) => {
      const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', url);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, url);
    await paste('https://www.tiktok.com/@notebook-test/video/100');
    await page.locator('#toasts').getByText('Saving from TikTok…', { exact: true }).waitFor({ timeout: 1500 });
    assert.equal(await page.locator('.linkwrap .nb-effect-beam').count(), 0);
    await page.locator('.linkwrap .nb-effect-beam').waitFor({ timeout: 5000 }).catch(async e => {
      console.log(await page.locator('.linkwrap').evaluate(el => ({ html: el.outerHTML, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches })), errors);
      throw e;
    });
    // Quiet test windows can be occluded: capture the real CSS at a fixed visible frame.
    await page.locator('.linkwrap .nb-effect-beam').evaluate(el => {
      for (const animation of el.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 900; }
    });
    assert.equal(await page.locator('.linkwrap .nb-effect-beam').evaluate(el => getComputedStyle(el).borderTopLeftRadius), await page.locator('#link-input').evaluate(el => getComputedStyle(el).borderTopLeftRadius), 'beam follows the rounded input');
    await page.screenshot({ path: path.join(OUT, 'saving-effect.png') });
    // A finished save must still be confirmed when returning from another app.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await page.waitForFunction(() => !document.hasFocus(), null, { polling: 100 });
    await app.evaluate(() => globalThis.finishEffectSave());
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent === 'TikTok added to your notebook', null, { polling: 100 });
    await page.waitForTimeout(6300);
    assert.equal(await page.locator('.toast:not(.out)').count(), 1, 'confirmation does not expire while hidden');
    assert.equal(await page.locator('.toast svg').count(), 1, 'success has a tick');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await page.screenshot({ path: path.join(OUT, 'tiktok-added.png') });
    assert.ok(await page.locator('#toasts').evaluate(el => Number(getComputedStyle(el).zIndex)) > 60, 'above the Ideas preview');
    // Emulate returning focus without taking the owner's real keyboard or mouse.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('.toast').waitFor({ state: 'detached', timeout: 7500 });
    await paste('https://www.tiktok.com/@notebook-test/video/100');
    await page.locator('#toasts').getByText('Already in your notebook', { exact: true }).waitFor();
    await paste('https://www.tiktok.com/@notebook-test/video/101');
    await page.locator('#toasts').getByText('Saving from TikTok…', { exact: true }).waitFor();
    await app.evaluate(() => globalThis.failEffectSave());
    await page.locator('#toasts').getByText('Test save failed', { exact: true }).waitFor();
    assert.equal(await page.locator('#toasts').getByText('Saving from TikTok…', { exact: true }).count(), 0);
    await page.locator('.linkwrap .nb-effect-beam').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.linkwrap').getAttribute('aria-busy'), null);
    assert.deepEqual(errors, []);
    console.log('Link feedback passed: actual paste/save flow, immediate progress, beam, success tick, hidden-window retention, duplicate and failure. Screenshots: ' + OUT);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
