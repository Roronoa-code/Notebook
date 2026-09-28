// Only Suggested opening/closing, in an isolated real app with a stand-in suggestion list.
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const { _electron: electron } = require('playwright-core');
const { Library } = require('../main/library');
const APP = path.resolve(__dirname, '..'), OUT = path.join(APP, 'test-output', 'suggest-motion-' + process.pid);
(async () => {
  const libraryPath = path.join(OUT, 'library'), userData = path.join(OUT, 'userdata');
  await Library.openOrCreate(libraryPath); fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ libraryPath }));
  const app = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }),
    env: { ...process.env, NOTEBOOK_USER_DATA: userData, NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47866', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_FAKE_NAMES: '1', NOTEBOOK_FAKE_FEED: '1', NOTEBOOK_TOOLS: path.join(OUT, 'tools'), NOTEBOOK_WINDOW_DISPLAY: 'second' } });
  try {
    const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => window.NB?.smart && NB.S?.snap);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('suggest:list');
      ipcMain.handle('suggest:list', () => ({ suggestions: ['Black outfits', 'Blue outfits', 'Matching set'].map((name, i) => ({ sig: String(i), name, kind: 'outfit', ids: [] })) }));
    });
    await page.evaluate(() => NB.smart.loadSuggestions());
    await page.waitForTimeout(100); // Establish the folded layout before the first transition.
    const sample = async (reverse = false) => page.evaluate(async reverse => {
      const head = document.querySelector('.sughead'), body = document.querySelector('.sugbody');
      const frames = [], start = performance.now(); let reversed = false, jump = 0;
      head.click();
      await new Promise(resolve => {
        const tick = () => {
          const time = performance.now() - start, height = body.getBoundingClientRect().height;
          frames.push({ time, height });
          if (reverse && !reversed && time >= 75) { reversed = true; head.click(); jump = Math.abs(body.getBoundingClientRect().height - height); }
          if (time < 450) requestAnimationFrame(tick); else resolve();
        }; requestAnimationFrame(tick);
      });
      return { frames, jump, open: head.getAttribute('aria-expanded'), inert: body.inert };
    }, reverse);
    const opening = await sample();
    const full = opening.frames.at(-1).height;
    assert.ok(full > 100 && opening.frames.some(f => f.height > 0 && f.height < full), 'actually unfolds: ' + JSON.stringify(opening.frames));
    for (let i = 1; i < opening.frames.length; i++) assert.ok(opening.frames[i].height >= opening.frames[i - 1].height - .5, 'no opening bounce');
    assert.equal(opening.open, 'true'); assert.equal(opening.inert, false);
    assert.equal(await page.locator('.sugbody').evaluate(el => getComputedStyle(el).transitionDuration), '0.24s');
    assert.deepEqual(await page.locator('.sugbody .navrow').evaluateAll(els => els.map(el => [getComputedStyle(el).opacity, getComputedStyle(el).transform])), [['1', 'none'], ['1', 'none'], ['1', 'none']]);
    await page.screenshot({ path: path.join(OUT, 'open.png') });
    const closing = await sample();
    for (let i = 1; i < closing.frames.length; i++) assert.ok(closing.frames[i].height <= closing.frames[i - 1].height + .5, 'no closing bounce');
    assert.equal(closing.frames.at(-1).height, 0); assert.equal(closing.inert, true);
    const reversal = await sample(true);
    assert.ok(reversal.jump < 1, 'reverses from its current height');
    assert.equal(reversal.frames.at(-1).height, 0); assert.equal(reversal.open, 'false');
    await page.locator('.sughead').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.sughead').getAttribute('aria-expanded'), 'true');
    await page.waitForTimeout(300);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.sugbody').evaluate(el => el.getBoundingClientRect().height), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('nb.suggested')), 'shut');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await app.evaluate(({ ipcMain }) => {
      for (const channel of ['links:list', 'links:update', 'links:check']) ipcMain.removeHandler(channel);
      ipcMain.handle('links:list', () => ({ retry: [], ready: true, versions: { ytdlp: 'test', gallerydl: 'test' } }));
      ipcMain.handle('links:update', () => new Promise(resolve => { globalThis.finishIconWork = resolve; }));
      ipcMain.handle('links:check', () => new Promise(resolve => { globalThis.finishIconWork = resolve; }));
    });
    await page.locator('#links-btn').click();
    for (const label of ['Update downloader', 'Check my links']) {
      const button = page.getByRole('button', { name: label, exact: true });
      await button.click();
      const busy = page.locator('.linkspop button[aria-busy="true"]');
      await page.waitForTimeout(300); // Let the panel settle before measuring the icon swap.
      const x = await busy.locator('span').last().evaluate(el => el.getBoundingClientRect().left);
      await busy.locator('canvas').waitFor(); await page.waitForTimeout(200);
      assert.equal(await busy.locator('svg').evaluate(el => getComputedStyle(el).opacity), '0', 'original icon gives way to orb');
      assert.equal(await busy.locator('canvas').count(), 1);
      assert.equal(await busy.locator('span').last().evaluate(el => el.getBoundingClientRect().left), x, 'label does not move');
      assert.equal(await busy.locator('canvas').evaluate(el => el.getBoundingClientRect().width), 18);
      await page.screenshot({ path: path.join(OUT, label === 'Update downloader' ? 'update-orb.png' : 'check-orb.png') });
      await app.evaluate(() => globalThis.finishIconWork({ error: 'Test work finished' }));
      await page.locator('.work-icon.done').waitFor();
      assert.ok(await page.locator('.work-icon.done canvas').count(), 'orb remains during the return transition');
      await button.waitFor();
      await page.waitForFunction(() => !document.querySelector('.linkspop canvas'));
      assert.equal(await button.locator('svg').evaluate(el => getComputedStyle(el).opacity), '1');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(OUT, 'motion.json'), JSON.stringify({ opening, closing, reversal }, null, 2));
    console.log('Motion passed: Suggested 240ms unfold, reversal, keyboard/reduced motion; Update and Check replace their icon with one orb, keep text still, and transition back on completion. Evidence: ' + OUT);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
