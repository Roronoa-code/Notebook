// Drives the real app window: first run, imports, previews, notes + Tidy up, in-app video,
// boards, Bin + Undo, and reopening the app. Saves screenshots to test-output/ui.
// Usage: npm run test:ui   (needs ffmpeg for the sample media)
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { _electron: electron } = require('playwright-core');
const { makeSamples } = require('./make-samples');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'test-output', 'ui');
const LIB = path.join(OUT, 'Notebook Library');
let passed = 0;
const ok = (msg) => { passed++; console.log('  ok  ' + msg); };

async function launch() {
  // Set NOTEBOOK_EXE to test the packaged app (dist/win-unpacked/Notebook.exe) instead of the source.
  const exe = process.env.NOTEBOOK_EXE;
  const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: [APP] }), env: { ...process.env, NOTEBOOK_USER_DATA: path.join(OUT, 'userdata') } });
  const page = await app.firstWindow();
  const web = [];
  page.on('request', (r) => { if (/^(https?|wss?):/.test(r.url())) web.push(r.url()); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [page ' + m.type() + '] ' + m.text()); });
  page.on('pageerror', (e) => console.log('  [page error] ' + e.message));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, web };
}

// Replaces the Windows folder/file pickers and confirm boxes with fixed answers.
const answerPickers = (app, filePaths) => app.evaluate(({ dialog }, paths) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  dialog.showMessageBox = async () => ({ response: 0 });
}, filePaths);

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const samples = makeSamples(path.join(OUT, 'samples'));
  const photos = samples.filter((f) => f.endsWith('.jpg'));
  const videos = samples.filter((f) => f.endsWith('.mp4'));

  let { app, page, web } = await launch();
  await page.locator('#welcome').waitFor();
  await answerPickers(app, [LIB]);
  await page.click('#w-choose');
  await page.locator('.bcard').first().waitFor();
  assert.equal(await page.locator('.bcard:not(.add)').count(), 5);
  ok('first run: library created, board cards shown');

  await page.locator('.bcard', { hasText: 'Outfits' }).click();
  assert.match(await page.locator('.bcard.on .name').innerText(), /Outfits/);
  await answerPickers(app, photos);
  await page.click('#add-photos');
  await page.waitForFunction(() => document.querySelectorAll('.grid .card').length === 2);
  await answerPickers(app, videos);
  await page.click('#add-videos');
  await page.waitForFunction(() => document.querySelectorAll('.grid .card img').length === 4, null, { timeout: 30000 });
  assert.equal(await page.locator('.bcard.on .count').innerText(), '4 items');
  ok('2 photos + 2 videos imported onto Outfits, previews made for all 4');

  await page.click('#new-note');
  await page.locator('.editor').waitFor();
  await page.keyboard.type('autumn capsule - need brown loafers, cream knit (the chunky one), wide leg trousers');
  await page.click('.editor-wrap .btn.accent');
  assert.equal(await page.locator('.editor h2').innerText(), 'Autumn capsule');
  assert.equal(await page.locator('.editor li').count(), 3);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '3-note.png') });
  await page.keyboard.press('Escape');
  await page.locator('.card', { hasText: 'Autumn capsule' }).waitFor();
  ok('new note + Tidy up turns text into a heading and bullets, saved as a card');

  await page.locator('.card', { hasText: 'Screen_Recording' }).click();
  const video = page.locator('.stage video');
  await video.waitFor();
  const played = await video.evaluate(async (v) => {
    v.muted = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 1200));
    return { t: v.currentTime, w: v.videoWidth, d: v.duration };
  });
  assert.ok(played.t > 0.5 && played.w === 1080 && played.d > 3, JSON.stringify(played));
  await page.screenshot({ path: path.join(OUT, '4-video.png') });
  ok(`Samsung-style MP4 plays inside the app (${played.w}px wide, ${played.d.toFixed(1)}s)`);

  await page.locator('.side .chip.tog', { hasText: 'Wallpapers' }).click();
  await page.locator('.side .chip.tog.on', { hasText: 'Wallpapers' }).waitFor();
  await page.locator('.side .btn.danger').click();
  await page.locator('.toast button', { hasText: 'Undo' }).click();
  await page.waitForFunction(() => document.getElementById('bin-count').textContent === '0');
  await page.locator('.bcard', { hasText: 'Wallpapers' }).click();
  await page.locator('.grid .card', { hasText: 'Screen_Recording' }).waitFor();
  assert.equal(await page.locator('.grid .card').count(), 1);
  ok('item on two boards; Move to Bin + Undo brings it back on both');

  await page.click('.bcard[data-id="all"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, '2-all-items.png') });
  await page.locator('.grid .card').first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '5-photo.png') });
  await page.keyboard.press('Escape');
  assert.deepEqual(web, [], 'no web requests');
  ok('no internet requests were made');
  await app.close();

  fs.rmSync(path.join(OUT, 'samples'), { recursive: true }); // originals gone
  ({ app, page, web } = await launch());
  await page.locator('.grid .card').first().waitFor();
  assert.equal(await page.locator('.grid .card').count(), 5);
  assert.equal(await page.locator('.grid .card img').count(), 4);
  await page.locator('.card', { hasText: 'Autumn capsule' }).click();
  assert.match(await page.locator('.editor').innerText(), /Need brown loafers/);
  await page.keyboard.press('Escape');
  await page.locator('.card', { hasText: 'VID_' }).click();
  const again = await page.locator('.stage video').evaluate((v) => new Promise((r) => { if (v.readyState >= 1) r(v.duration); else v.onloadedmetadata = () => r(v.duration); }));
  assert.ok(again > 2);
  ok('after closing the app and deleting the originals, all 5 items, the note and video reopen');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(OUT, '1-home.png') });
  await app.close();

  console.log(`\nAll ${passed} checks passed. Screenshots: ${OUT}`);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
