// Opens the app on the second monitor with a realistic test library (pictures from the test set) and
// saves screenshots of every screen, for looking over the design. Nothing touches your own library.
// Usage: node scripts/audit-app.js [--keep]   (--keep reuses the library from the last run)
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'test-output', 'audit');
const LIB = path.join(OUT, 'Notebook Library');
const POOL = 'D:/Notebook Tools/testset/pool';
const keep = process.argv.includes('--keep');

(async () => {
  if (!keep) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const env = { ...process.env, NOTEBOOK_USER_DATA: path.join(OUT, 'userdata'), NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47891', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_TOOLS: path.join(OUT, 'tools'), NOTEBOOK_WINDOW_DISPLAY: 'second' };
  const app = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }), env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, 'shots', name + '.png') }); };
  if (!keep) {
    await page.locator('#welcome').waitFor();
    await shot('00-welcome');
    const files = fs.readdirSync(POOL).filter((f) => /^(outfit|wallpaper)/.test(f)).slice(0, 36).map((f) => path.join(POOL, f));
    await app.evaluate(({ dialog }, [lib, list]) => { const q = [[lib], list]; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: q.shift() }); dialog.showMessageBox = async () => ({ response: 0 }); }, [LIB, files]);
    await page.click('#w-choose');
    await page.locator('.bcard').first().waitFor();
    await page.click('#add-photos');
    await page.waitForFunction((n) => NB.S.snap.items.length === n && NB.S.snap.items.every((i) => i.thumbSrc), files.length, { timeout: 120000 });
  }
  await page.locator('.grid .card img').first().waitFor();
  await page.waitForTimeout(1500);
  await shot('01-all');
  await page.locator('.page').evaluate((p) => p.scrollTo(0, 1400));
  await shot('02-all-scrolled');
  await page.locator('.page').evaluate((p) => p.scrollTo(0, 0));
  await page.locator('.grid .card').nth(2).click();
  await shot('03-open');
  await page.keyboard.press('Escape');
  await page.locator('.bcard', { hasText: 'Outfits' }).click();
  await shot('04-board');
  await page.click('#search'); await page.keyboard.type('outfit');
  await shot('05-search');
  await page.fill('#search', '');
  await page.click('#bin-btn');
  await shot('06-bin');
  await page.click('.bcard[data-id="all"]');
  for (const [btn, name] of [['#links-btn', '07-links'], ['#phone', '08-phone'], ['#lib-btn', '09-library']]) {
    if (await page.locator(btn).count()) { await page.click(btn); await shot(name); await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  }
  console.log(errors.length ? 'Page errors:\n' + errors.join('\n') : 'No page errors.');
  console.log('Screenshots in ' + path.join(OUT, 'shots'));
  if (!process.argv.includes('--stay')) await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
