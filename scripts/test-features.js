// Drives the real window for the build plan's Track A features, with a stand-in recogniser (so it runs
// fast and without the models): background recognition, filters, correcting labels (they survive a
// restart and a re-scan), the style list, and suggested groups (keep as board, dismiss). Opens on the
// second monitor when there is one. Usage: node scripts/test-features.js   (needs ffmpeg)
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { _electron: electron } = require('playwright-core');
const { makeSamples } = require('./make-samples');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'test-output', 'features');
const LIB = path.join(OUT, 'Notebook Library');
let passed = 0;
const ok = (msg) => { passed++; console.log('  ok  ' + msg); };
const ENV = { ...process.env, NOTEBOOK_USER_DATA: path.join(OUT, 'userdata'), NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47861', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_TOOLS: path.join(OUT, 'tools'), NOTEBOOK_WINDOW_DISPLAY: 'second' };
const onDisk = () => JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8'));

async function launch() {
  const app = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }), env: ENV });
  const page = await app.firstWindow();
  const web = [];
  page.on('request', (r) => { if (/^(https?|wss?):/.test(r.url())) web.push(r.url()); });
  page.on('pageerror', (e) => console.log('  [page error] ' + e.message));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, web };
}
const idle = (page) => page.waitForFunction(async () => (await nb.aiStatus()).status.state === 'idle', null, { timeout: 30000 });

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const src = makeSamples(path.join(OUT, 'raw'));
  const samples = path.join(OUT, 'samples');
  fs.mkdirSync(samples, { recursive: true });
  // Names the stand-in recogniser understands: two outfits, a wallpaper, an icon and a profile picture.
  const jpg = src.filter((f) => f.endsWith('.jpg'));
  const files = [['outfit coat.jpg', jpg[0]], ['outfit shirt.jpg', jpg[1]], ['wall lake.jpg', jpg[1]], ['icon logo.jpg', jpg[0]], ['face pfp.jpg', jpg[0]]]
    // A few extra bytes after the picture make each file different, so none is skipped as a duplicate.
    .map(([name, from]) => { const to = path.join(samples, name); fs.writeFileSync(to, Buffer.concat([fs.readFileSync(from), Buffer.from(name)])); return to; });

  let { app, page, web } = await launch();
  await page.locator('#welcome').waitFor();
  await app.evaluate(({ dialog }, paths) => { const q = paths.slice(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [q.shift()] }); }, [LIB]);
  await page.click('#w-choose');
  await page.locator('.bcard').first().waitFor();
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, files);
  await page.click('#add-photos');
  await page.locator('.grid .card').nth(4).waitFor();
  await idle(page);
  await page.waitForFunction(() => NB.S.snap.items.every((i) => i.ai && i.ai.type));
  assert.deepEqual(onDisk().items.map((i) => i.ai.type.main).sort(), ['icon', 'outfit', 'outfit', 'profile picture', 'wallpaper']);
  ok('new photos are recognised in the background and saved (type, colours, styles)');

  // Filters: the cards that stay are the same cards (they glide, nothing reloads), and the title doesn't replay
  await page.evaluate(() => { for (const c of document.querySelectorAll('.grid > .card')) c.dataset.was = '1'; });
  await page.locator('.filters .fchip', { hasText: 'Outfits' }).click();
  assert.equal(await page.locator('.grid > .card').count(), 2, 'only the two outfits');
  assert.equal(await page.locator('.grid > .card[data-was]').count(), 2, 'kept cards are reused, not rebuilt');
  assert.equal(await page.locator('.ctx-title.still').count(), 1, 'the title stays still');
  await page.locator('.filters .fchip', { hasText: 'Black' }).click();
  assert.equal(await page.locator('.grid > .card').count(), 2);
  await page.locator('.filters .linkbtn', { hasText: 'Clear filters' }).click();
  assert.equal(await page.locator('.grid > .card').count(), 5);
  ok('filters by type and clothing colour show the right items without rebuilding the page; Clear filters shows everything');

  // Correcting a label: it saves, survives a restart and a re-scan
  const coat = onDisk().items.find((i) => i.originalName === 'outfit coat.jpg');
  await page.locator(`.grid .card[data-id="${coat.id}"]`).click();
  await page.locator('.recog .dd[aria-label="What this is"]').click();
  await page.locator('.ddlist .ddopt', { hasText: /^Wallpaper$/ }).click();
  await page.waitForFunction((id) => NB.S.snap.items.find((i) => i.id === id).labels, coat.id);
  assert.equal(onDisk().items.find((i) => i.id === coat.id).labels.main, 'wallpaper');
  await page.keyboard.press('Escape');
  await app.close();
  ({ app, page, web } = await launch());
  await page.locator('.grid .card').first().waitFor();
  await page.evaluate(() => nb.rescan());
  await page.waitForTimeout(300);
  await idle(page);
  const after = onDisk().items.find((i) => i.id === coat.id);
  assert.equal(after.labels.main, 'wallpaper', 'the correction survives a restart and a re-scan');
  assert.equal(after.ai.type.main, 'outfit', 'the re-scan only refreshed what the PC saw');
  await page.locator(`.grid .card[data-id="${coat.id}"]`).click();
  assert.equal(await page.locator('.recog .dd[aria-label="What this is"]').innerText(), 'Wallpaper');
  await page.locator('.recog .linkbtn', { hasText: 'Use what the PC saw' }).click();
  await page.waitForFunction((id) => !NB.S.snap.items.find((i) => i.id === id).labels, coat.id);
  await page.keyboard.press('Escape');
  ok('a corrected label saves, survives a restart and a re-scan, and can go back to what the PC saw');

  // Your style list
  await page.locator('.filters .fchip', { hasText: 'Styles' }).click();
  await page.locator('.stylepop .chip-input').fill('gorpcore');
  await page.keyboard.press('Enter');
  await page.locator('.stylepop .btn', { hasText: 'Save' }).click();
  await page.waitForFunction(() => NB.S.snap.items.filter((i) => i.ai && i.ai.styles).every((i) => i.ai.stylesFor && i.ai.stylesFor.includes('gorpcore')), null, { timeout: 20000 });
  await idle(page);
  assert.ok(onDisk().settings.styles.includes('gorpcore'));
  assert.ok(onDisk().items.filter((i) => i.ai && i.ai.styles).every((i) => i.ai.stylesFor.includes('gorpcore')), 'outfits looked at again for the new list');
  ok('the style list takes your own styles and outfits are re-styled against it');

  // Suggested groups and matching sets
  await page.locator('#suggested .navrow').first().waitFor({ timeout: 10000 });
  const names = await page.locator('#suggested .sugname').allInnerTexts();
  assert.ok(names.some((n) => /set/i.test(n)), 'a matching set: ' + names.join(', '));
  const itemsBefore = JSON.stringify(onDisk().items.map((i) => [i.id, i.boards, i.deletedAt]));
  const set = page.locator('#suggested .navrow', { hasText: 'set' }).first();
  await set.click();
  assert.equal(await page.locator('.grid > .card').count(), 3, 'wallpaper, icon and profile picture');
  assert.equal(JSON.stringify(onDisk().items.map((i) => [i.id, i.boards, i.deletedAt])), itemsBefore, 'looking at a suggestion changes nothing');
  await page.locator('.sugbar .btn', { hasText: 'Keep as board' }).click();
  await page.locator('.bcard.on .name', { hasText: /set/i }).waitFor();
  const board = onDisk().boards.find((b) => /set/i.test(b.name));
  assert.equal(onDisk().items.filter((i) => i.boards.includes(board.id)).length, 3);
  assert.equal(onDisk().items.length, 5, 'nothing deleted');
  const left = await page.locator('#suggested .navrow').count();
  if (left) {
    const first = await page.locator('#suggested .sugname').first().innerText();
    await page.locator('#suggested .navrow').first().click();
    await page.locator('.sugbar .btn', { hasText: 'Dismiss' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('#suggested .navrow').length === n, left - 1);
    assert.equal(await page.locator('#suggested .navrow').count(), left - 1, `dismissed “${first}”`);
  }
  await page.screenshot({ path: path.join(OUT, 'suggested.png') });
  ok('suggestions appear beside the boards; viewing one changes nothing; Keep as board makes a board; Dismiss removes it');

  assert.deepEqual(web, [], 'no internet requests');
  ok('no internet requests were made');
  await app.close();
  console.log(`\nAll ${passed} checks passed. Screenshots: ${OUT}`);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
