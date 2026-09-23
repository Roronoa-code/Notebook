// Drives the real app window: first run, imports, previews, notes + Tidy up, in-app video,
// boards, Bin + Undo, reopening, the Phone panel with a pretend phone, hide-to-tray and --background.
// Saves screenshots to test-output/ui. Usage: node scripts/test-ui.js   (needs ffmpeg for the sample media)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { _electron: electron } = require('playwright-core');
const { makeSamples } = require('./make-samples');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'test-output', 'ui');
const LIB = path.join(OUT, 'Notebook Library');
let passed = 0;
const ok = (msg) => { passed++; console.log('  ok  ' + msg); };

// Phone sync listens on 127.0.0.1 during the check, so Windows Firewall doesn't ask.
const SYNC_PORT = 47851;
// The stand-in recogniser keeps the real models out of this check; the window opens on the second monitor.
const ENV = { ...process.env, NOTEBOOK_USER_DATA: path.join(OUT, 'userdata'), NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: String(SYNC_PORT), NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_TOOLS: path.join(OUT, 'tools'), NOTEBOOK_WINDOW_DISPLAY: 'second' };
const startApp = (extra = []) => {
  // Set NOTEBOOK_EXE to test the packaged app (dist/win-unpacked/Notebook.exe) instead of the source.
  const exe = process.env.NOTEBOOK_EXE;
  return electron.launch({ ...(exe ? { executablePath: exe, args: extra } : { args: [APP, ...extra] }), env: ENV });
};

async function api(port, method, route, body, token) {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

async function launch() {
  const app = await startApp();
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
  assert.match(await page.locator('.bcard.on .count').innerText(), /^4 items$/i); // shown in capitals by CSS
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
  await page.locator('.grid .card', { hasText: 'wallpaper dusk' }).dragTo(page.locator('.bcard', { hasText: 'Icons' }));
  await page.locator('.bcard', { hasText: 'Icons' }).locator('.count', { hasText: '1 item' }).waitFor();
  ok('dragging a card onto a board card adds it to that board');

  await page.locator('.grid .card', { hasText: 'wallpaper dusk' }).click();
  await page.locator('.side .caption').fill('chest 27in, want it in black');
  await page.locator('.side .chip.add').click();
  await page.locator('.side .chip-input').fill('Videos Wallpaper');
  await page.keyboard.press('Enter');
  await page.locator('.side .chip.tog.on', { hasText: 'Videos Wallpaper' }).waitFor();
  const fit = await page.evaluate(() => { const r = document.querySelector('.stage').getBoundingClientRect(); const i = document.querySelector('.stage img').getBoundingClientRect(); return { stageW: r.width, imgW: i.width }; });
  assert.ok(Math.abs(fit.stageW - fit.imgW) < 4, 'photo fills its frame: ' + JSON.stringify(fit));
  await page.screenshot({ path: path.join(OUT, '6-photo-note.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.locator('.grid .card', { hasText: 'wallpaper dusk' }).click();
  assert.equal(await page.locator('.side .caption').inputValue(), 'chest 27in, want it in black');
  assert.equal(await page.locator('.grid .card .cap, .grid .card .cap-note').count(), 0, 'mood board: pictures only on the cards');
  await page.keyboard.press('Escape');
  ok('photo note saved (shown when opened, not on the card); new board made from the open item; frame fits the photo');

  await page.screenshot({ path: path.join(OUT, '2-all-items.png') });
  await page.locator('.grid .card').first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '5-photo.png') });
  await page.keyboard.press('Escape');
  assert.deepEqual(web, [], 'no web requests');
  ok('no internet requests were made');

  // Board strip: a board with thumbnails selected, empty boards beside it, then hovered (fan-out).
  await page.locator('.bcard', { hasText: 'Outfits' }).click();
  await page.waitForTimeout(900);
  const strip = await page.locator('#boards').boundingBox();
  const clip = { x: Math.max(0, strip.x - 10), y: Math.max(0, strip.y - 10), width: strip.width + 20, height: strip.height + 20 };
  await page.screenshot({ path: path.join(OUT, '7-board-strip.png'), clip });
  await page.locator('.bcard', { hasText: 'Outfits' }).hover();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '8-board-strip-hover.png'), clip });
  const hl = await page.evaluate(() => { const a = document.querySelector('.bhl').getBoundingClientRect(), b = document.querySelector('.bcard.on').getBoundingClientRect(); return { dx: a.left - b.left, dw: a.width - b.width, dy: a.top - b.top }; });
  assert.ok(Math.abs(hl.dx) < 1 && Math.abs(hl.dw) < 1, 'highlight sits on the selected card: ' + JSON.stringify(hl));
  assert.equal(await page.locator('.bcard .stack .ph.blank').count() > 0, true);
  ok('board strip screenshots saved; highlight lines up with the selected card');

  // ---------- picking, stacks and "show on phone" ----------
  await page.click('.bcard[data-id="all"]');
  await page.waitForTimeout(700);
  const loose = page.locator('.grid .card:not(.stackcard)', { has: page.locator('img') });
  const [idA, idB] = [await loose.nth(0).getAttribute('data-id'), await loose.nth(1).getAttribute('data-id')];
  await loose.nth(0).click({ modifiers: ['Control'] });
  await loose.nth(1).click({ modifiers: ['Control'] });
  assert.equal(await page.locator('.viewer').count(), 0, 'Ctrl-click picks instead of opening');
  assert.match(await page.locator('#selbar .count').innerText(), /2 picked/);
  await page.locator('#selbar .btn', { hasText: 'Stack' }).click();
  const stackCard = page.locator('.grid .stackcard');
  await stackCard.waitFor();
  assert.equal(await stackCard.locator('.fanitem').count(), 2);
  assert.equal(await page.locator('#selbar').isHidden(), true);
  assert.equal(await stackCard.locator('.stackct').innerText(), '1/2');
  await stackCard.hover();
  await stackCard.locator('.fanarrow.r').click();
  assert.equal(await stackCard.locator('.stackct').innerText(), '2/2', 'the arrow goes to the next picture');
  await page.mouse.move(10, 10);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '11-stack.png') });
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')).items;
  assert.ok(onDisk().filter((i) => i.id === idA || i.id === idB).every((i) => i.stack && i.stack === onDisk().find((x) => x.id === idA).stack), 'saved as one stack');
  ok('Ctrl-click picks, Stack makes one fanned card, arrows go through it; saved');

  await stackCard.locator('.fanitem[tabindex="0"]').click();
  await page.locator('#on-phone').waitFor();
  assert.equal(await page.locator('#on-phone').isChecked(), true, 'on the phone by default');
  await page.locator('#on-phone').uncheck();
  await page.waitForTimeout(300);
  const topId = await page.evaluate(() => document.querySelector('.stackcard .fanitem[tabindex="0"]').dataset.id);
  assert.equal(onDisk().find((i) => i.id === topId).phone, false, 'switched off for the phone');
  await page.locator('.side .btn', { hasText: 'Take out of stack' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.grid .stackcard').count(), 0, 'a stack of one goes back to loose cards');
  assert.equal(await page.locator(`.grid .card[data-id="${topId}"] .offphone`).count(), 1, 'the card shows it is not on the phone');
  await page.locator(`.grid .card[data-id="${topId}"]`).click();
  await page.locator('#on-phone').check();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.ok(!('phone' in onDisk().find((i) => i.id === topId)), 'back on the phone');
  ok('"Show on phone" switch saves, shows on the card, and switches back; Take out of stack');
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

  // ---------- Phone panel, and a sync from a pretend phone ----------
  await page.click('#phone');
  await page.locator('.phone .qr img').waitFor();
  const code = (await page.locator('.phone .code').innerText()).trim();
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  const port = Number(/port (\d+)/.exec(await page.locator('.phone .status').first().innerText())[1]);
  assert.equal(await page.locator('#keep-ready').isChecked(), false);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '9-phone-panel.png') });
  const paired = await api(port, 'POST', '/api/pair', { code, deviceId: 'ui-phone', deviceName: 'Test phone' });
  assert.equal(paired.status, 200);
  await page.locator('.phone .devices li', { hasText: 'Test phone' }).waitFor();
  await page.locator('#keep-ready:checked').waitFor();
  const at = new Date().toISOString();
  const synced = await api(port, 'POST', '/api/sync', {
    deviceId: 'ui-phone', boards: [], tombstones: { items: [], boards: [] },
    items: [{ id: crypto.randomUUID(), kind: 'note', title: 'Written on the phone', html: '<p>Written on the phone</p>', importedAt: at, updatedAt: at, boards: [], deletedAt: null }]
  }, paired.body.token);
  assert.equal(synced.status, 200);
  assert.ok(synced.body.items.length >= 6);
  await page.locator('.phone .devices li', { hasText: 'Last synced' }).waitFor();
  await page.screenshot({ path: path.join(OUT, '10-phone-paired.png') });
  await page.keyboard.press('Escape');
  await page.locator('.grid .card', { hasText: 'Written on the phone' }).waitFor();
  ok(`Phone panel shows the QR and code (port ${port}); a phone pairs, syncs a note, and it appears straight away`);

  // Keep ready is on now, so closing the window hides it and sync keeps answering.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(500);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible())), [false]);
  assert.equal((await api(port, 'GET', '/api/ping', null, paired.body.token)).status, 200);
  ok('with "Keep Notebook ready" on, closing the window hides it to the tray and sync still answers');
  await app.close();

  // Started with Windows: --background opens no window, but sync is running.
  const bg = await startApp(['--background']);
  let ping = null;
  for (let i = 0; i < 40 && !ping; i++) {
    ping = await api(SYNC_PORT, 'GET', '/api/ping').catch(() => null);
    if (!ping) await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(ping && ping.status, 401);
  assert.deepEqual(ping.body, { error: 'not paired' });
  assert.equal(await bg.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
  assert.equal(bg.windows().length, 0);
  ok('--background starts with no window, and sync answers /api/ping without a token with 401');
  await bg.close();

  // ---------- Library menu: Back up, Export, then Restore with the original library gone (plan steps 5 and 8) ----------
  ({ app, page, web } = await launch());
  await page.locator('.grid .card').first().waitFor();
  const BK = path.join(OUT, 'Backups'), EXP = path.join(OUT, 'Exports'), RS = path.join(OUT, 'Restored');
  for (const d of [BK, EXP, RS]) fs.mkdirSync(d, { recursive: true });
  // Each folder picker gets the next answer in the list; nothing opens in File Explorer.
  const queuePickers = (paths) => app.evaluate(({ dialog, shell }, list) => {
    const q = list.slice();
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [q.shift()] });
    dialog.showMessageBox = async () => ({ response: 0 });
    shell.openPath = async () => '';
  }, paths);
  const lib0 = JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8'));
  const live0 = lib0.items.filter((i) => !i.deletedAt);
  const note0 = live0.find((i) => i.kind === 'note' && /loafers/.test(i.html));

  await queuePickers([BK]);
  await page.click('#lib-btn');
  await page.click('#backup');
  await page.locator('.toast', { hasText: 'Backed up' }).waitFor();
  const bkDir = path.join(BK, fs.readdirSync(BK).find((f) => f.startsWith('Notebook Backup')));
  const bkLib = JSON.parse(fs.readFileSync(path.join(bkDir, 'library.json'), 'utf8'));
  assert.equal(bkLib.items.length, lib0.items.length);
  assert.deepEqual(bkLib.boards.map((b) => b.name), lib0.boards.map((b) => b.name));
  for (const it of lib0.items.filter((i) => i.file)) assert.equal(fs.statSync(path.join(bkDir, it.file)).size, fs.statSync(path.join(LIB, it.file)).size, it.file);
  ok(`Library → Back up makes a complete copy: ${bkLib.items.length} items, ${bkLib.boards.length} boards, every file the same size`);

  await queuePickers([EXP]);
  await page.click('#lib-btn');
  await page.click('#export');
  await page.locator('.toast', { hasText: 'Exported' }).waitFor();
  const exDir = path.join(EXP, fs.readdirSync(EXP).find((f) => f.startsWith('Notebook Export')));
  assert.equal(fs.readdirSync(path.join(exDir, 'Media')).length, live0.filter((i) => i.file).length, 'every photo and video');
  const noteFiles = fs.readdirSync(path.join(exDir, 'Notes'));
  assert.ok(noteFiles.some((f) => /loafers/.test(fs.readFileSync(path.join(exDir, 'Notes', f), 'utf8'))), 'note text is readable');
  const csv = fs.readFileSync(path.join(exDir, 'boards.csv'), 'utf8');
  assert.ok(csv.includes('Outfits') && csv.includes('chest 27in'), 'boards.csv has board membership and photo notes');
  ok('Library → Export: every photo and video, notes as plain text, boards.csv with board membership (opens without Notebook)');
  await app.close();

  // The original library becomes unavailable; Restore from the welcome screen into a separate folder.
  const away = LIB + ' (unavailable)';
  fs.renameSync(LIB, away);
  ({ app, page, web } = await launch());
  await page.locator('#welcome').waitFor();
  await queuePickers([bkDir, RS]);
  await page.click('#w-restore');
  await page.locator('.grid .card').first().waitFor();
  const rsDir = path.join(RS, fs.readdirSync(RS).find((f) => f.startsWith('Notebook Library (restored')));
  const rl = JSON.parse(fs.readFileSync(path.join(rsDir, 'library.json'), 'utf8'));
  assert.equal(rl.items.length, lib0.items.length);
  assert.deepEqual(rl.boards.map((b) => b.name), lib0.boards.map((b) => b.name));
  for (const b of lib0.boards) await page.locator('.bcard .name', { hasText: b.name }).first().waitFor();
  await page.locator(`.grid .card[data-id="${note0.id}"]`).click();
  assert.match(await page.locator('.editor').innerText(), /brown loafers/);
  await page.keyboard.press('Escape');
  const binnedBefore = lib0.items.filter((i) => i.deletedAt).length;
  assert.equal(rl.items.filter((i) => i.deletedAt).length, binnedBefore, 'the Bin comes back too');
  assert.deepEqual(web, [], 'still no internet requests');
  ok(`with the original library unavailable, Restore brings back all ${rl.items.length} items, edits and ${rl.boards.length} boards into a new folder`);
  await app.close();
  fs.renameSync(away, LIB);

  console.log(`\nAll ${passed} checks passed. Screenshots: ${OUT}`);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
