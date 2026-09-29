// Screenshots of the real desktop app for the motion film (the film uses them as screens and cards).
// Builds a throwaway library from the promo photos (see photos.js), never touches your own settings.
// Usage: node promo/motion/capture-desktop.js   -> promo/motion/out/screens/desktop-*.png + desktop-cards.json
// On Linux run it under xvfb-run. Needs the app's devDependencies (electron, playwright-core).
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const Photos = require('./photos.js');

const APP = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const WORK = path.join(OUT, 'desktop-work');
const SHOTS = path.join(OUT, 'screens');
const W = 1600, H = 1000, SCALE = 2;

(async () => {
  const photos = await Photos.ensure();
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = { ...process.env, NOTEBOOK_USER_DATA: path.join(WORK, 'userdata'), NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47893', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_TOOLS: path.join(WORK, 'tools') };
  const app = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP, `--force-device-scale-factor=${SCALE}`] }), env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h); b.center(); b.show(); }, [W, H]);
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const shot = async (name, clip) => { await settle(); await page.screenshot({ path: path.join(SHOTS, `desktop-${name}.png`), ...(clip ? { clip } : {}) }); console.log('shot', name); };

  // A fresh library with boards named like the owner's.
  await page.locator('#welcome').waitFor();
  const lib = path.join(WORK, 'Notebook Library');
  fs.mkdirSync(lib, { recursive: true });
  await page.click('#w-choose');
  // The app's own folder picker: type the folder, go there, use it.
  const where = page.locator('input').filter({ hasNotText: 'x' }).first();
  await page.getByRole('button', { name: 'Use this folder' }).waitFor();
  await where.fill(lib);
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await settle(500);
  await page.getByRole('button', { name: 'Use this folder' }).click();
  await page.locator('.bcard').first().waitFor();
  const boards = {};
  const have = await page.evaluate(() => NB.S.snap.boards.map((b) => [b.name, b.id]));
  for (const [n, id] of have) boards[n] = id;
  for (const name of Photos.BOARDS.filter((n) => !boards[n])) boards[name] = (await page.evaluate((n) => NB.run('addBoard', n), name)).id;
  // Import in an interleaved order so All looks like a real mixed mood board.
  const order = Photos.mixed(photos);
  for (const p of order) await page.evaluate(([f, b]) => window.nb.importPaths([f], b), [p.file, boards[p.board]]);
  await page.evaluate(() => NB.refresh && NB.refresh());
  await page.waitForFunction((n) => NB.S.snap.items.length >= n && NB.S.snap.items.every((i) => i.thumbSrc), order.length, { timeout: 180000 });
  await page.reload();
  await page.locator('.grid .card img').first().waitFor();
  await settle(2500);

  // Where each card sits on All, so the film can lift real cards out of the screen.
  const cards = async () => page.evaluate(() => [...document.querySelectorAll('.grid .card')].map((c) => { const r = c.getBoundingClientRect(); const it = NB.S.snap.items.find((i) => i.id === c.dataset.id) || {}; return { id: c.dataset.id, title: it.title || '', x: r.x, y: r.y, w: r.width, h: r.height }; }).filter((c) => c.y < innerHeight && c.y + c.h > 0));
  await shot('all');
  fs.writeFileSync(path.join(SHOTS, 'desktop-cards.json'), JSON.stringify({ width: W, height: H, scale: SCALE, cards: await cards() }, null, 2));

  // A link typed into the paste bar (not submitted: saving needs the downloader tools).
  await page.fill('#link-input', 'https://www.tiktok.com/@mani/video/7421093385');
  await shot('paste');
  await page.fill('#link-input', '');
  await page.locator('.page').evaluate((p) => p.scrollTo(0, 900));
  await shot('all-scrolled');
  await page.locator('.page').evaluate((p) => p.scrollTo(0, 0));
  await page.locator('.bcard', { hasText: 'Outfits' }).first().click();
  await shot('outfits');
  await page.locator('.grid .card').nth(1).click();
  await shot('open');
  await page.keyboard.press('Escape');
  await page.locator('.bcard[data-id="all"]').click();
  await settle();
  await page.click('#search');
  await page.keyboard.type('black', { delay: 60 });
  await shot('search');
  await page.fill('#search', '');
  await page.locator('.bcard', { hasText: 'Wallpapers' }).first().click();
  await shot('wallpapers');
  await page.locator('.bcard[data-id="all"]').click();
  for (const [btn, name] of [['#phone', 'phone']]) {
    if (await page.locator(btn).count()) { await page.click(btn); await shot(name); await page.keyboard.press('Escape'); await settle(400); }
  }
  console.log(errors.length ? 'Page errors:\n' + errors.join('\n') : 'No page errors.');
  await app.close();
})().catch(async (e) => { console.error(e); process.exit(1); });
