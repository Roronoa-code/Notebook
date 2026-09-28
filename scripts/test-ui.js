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
// Waits (up to 5 s) for something saved to disk to become true.
const until = async (test, what) => { for (let i = 0; i < 50; i++) { try { if (test()) return; } catch { /* file mid-write */ } await new Promise((r) => setTimeout(r, 100)); } assert.fail(what); };

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

// Answer the app's current custom picker/confirmation bridge; keep real validation in main.
const answerPickers = (app, filePaths) => {
  for (const p of filePaths) if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return app.evaluate(({ BrowserWindow, dialog }, paths) => {
  global.testPickerPaths = paths; global.testPickerQueue = null;
  const web = BrowserWindow.getAllWindows()[0].webContents;
  if (!web.testSend) {
    web.testSend = web.send.bind(web);
    web.send = (channel, ...args) => {
      if (channel !== 'ui:request') return web.testSend(channel, ...args);
      const request = args[0], value = request.kind === 'confirm' ? true : global.testPickerQueue ? [global.testPickerQueue.shift()] : global.testPickerPaths;
      web.executeJavaScript('nb.replyUI(' + JSON.stringify(request.id) + ',' + JSON.stringify(value) + ')');
    };
  }
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  dialog.showMessageBox = async () => ({ response: 0 });
}, filePaths); };

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

  // The quiet player: plays on its own with the sound off; click pauses, the speaker turns sound on.
  await page.waitForFunction(() => { const v = document.querySelector('.vbox video'); return v && !v.paused && v.muted && v.loop; });
  await page.locator('.vbox').click({ position: { x: 60, y: 60 } });
  await page.waitForFunction(() => document.querySelector('.vbox video').paused && document.querySelector('.vbox.paused'));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.querySelector('.vbox video').paused);
  await page.locator('.vbox').hover();
  await page.locator('.vsound').click();
  assert.equal(await page.locator('.vbox video').evaluate((v) => v.muted), false, 'sound on');
  assert.equal(await page.locator('.vsound').getAttribute('aria-pressed'), 'true');
  ok('the quiet player: plays muted on a loop, click or Space pauses, the speaker turns sound on');

  await page.locator('.side .chip.tog', { hasText: 'Wallpapers' }).click();
  await page.locator('.side .chip.tog.on', { hasText: 'Wallpapers' }).waitFor();
  await page.locator('.side .iconbtn[aria-label^="Move to Bin"]').click();
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
  await page.locator('#selbar').waitFor({ state: 'hidden' });
  assert.equal(await stackCard.locator('.stackct').innerText(), '1/2');
  assert.equal(await stackCard.locator('.fanarrow').count(), 0, 'no arrow buttons on stacks');
  await page.waitForTimeout(600); // let the new stack settle into place
  const sb = await stackCard.boundingBox();
  await page.mouse.move(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(sb.x + sb.width * 0.75 - i * 14, sb.y + sb.height / 2 + 1);
  assert.equal(await page.locator('#drop').isHidden(), true, 'swiping a stack never shows "Drop to add"');
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.equal(await stackCard.locator('.stackct').innerText(), '2/2', 'dragging across the stack goes to the next picture');
  assert.equal(await page.locator('.viewer').count(), 0, 'and does not open it');
  const shape = await stackCard.evaluate((el) => { const id = el.querySelector('.fanitem[tabindex="0"]').dataset.id, m = NB.S.snap.items.find((i) => i.id === id), f = el.querySelector('.fan').getBoundingClientRect(); return { want: m.h / m.w, got: f.height / f.width }; });
  assert.ok(Math.abs(shape.want - shape.got) < 0.02, 'the stack takes the shape of the picture on top: ' + JSON.stringify(shape));
  await page.mouse.move(10, 10);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '11-stack.png') });
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')).items;
  assert.ok(onDisk().filter((i) => i.id === idA || i.id === idB).every((i) => i.stack && i.stack === onDisk().find((x) => x.id === idA).stack), 'saved as one stack');
  ok('Ctrl-click picks, Stack makes one fanned card, dragging across goes through it; saved');

  await stackCard.locator('.fanitem[tabindex="0"]').click();
  await page.locator('#on-phone').waitFor();
  assert.equal(await page.locator('#on-phone').isChecked(), true, 'on the phone by default');
  await page.locator('#on-phone').uncheck();
  await page.waitForTimeout(300);
  const topId = await page.evaluate(() => document.querySelector('.stackcard .fanitem[tabindex="0"]').dataset.id);
  await until(() => onDisk().find((i) => i.id === topId).phone === false, 'switched off for the phone');
  await page.locator('.side [aria-label="Take out of stack"]').click();
  await page.waitForFunction((id) => {
    const it = NB.S.snap.items.find((i) => i.id === id);
    return it && !it.stack && !document.querySelector('.grid .stackcard');
  }, topId, { timeout: 5000 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.grid .stackcard').count(), 0, 'a stack of one goes back to loose cards');
  assert.equal(await page.locator(`.grid .card[data-id="${topId}"] .offphone`).count(), 1, 'the card shows it is not on the phone');
  await page.locator(`.grid .card[data-id="${topId}"]`).click();
  await page.locator('#on-phone').check();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await until(() => !('phone' in onDisk().find((i) => i.id === topId)), 'back on the phone');
  ok('"Show on phone" switch saves, shows on the card, and switches back; Take out of stack');

  // Stacks made in All show as loose cards inside a board; a stack made in the board groups there (and in All).
  const pair = await page.evaluate(() => { const b = NB.S.snap.boards.find((x) => NB.S.snap.items.filter((i) => !i.deletedAt && i.kind !== 'note' && i.boards.includes(x.id)).length >= 2); return { board: b.id, ids: NB.S.snap.items.filter((i) => !i.deletedAt && i.kind !== 'note' && i.boards.includes(b.id)).slice(0, 2).map((i) => i.id) }; });
  await page.evaluate(async (ids) => { NB.apply(await nb.stackItems(ids)); NB.refreshGrid(); }, pair.ids);
  await page.locator('.grid .stackcard').waitFor();
  await page.click(`.bcard[data-id="${pair.board}"]`);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.grid .stackcard').count(), 0, 'a stack made in All is loose cards in a board');
  await page.locator(`.grid .card[data-id="${pair.ids[0]}"]`).dragTo(page.locator(`.grid .card[data-id="${pair.ids[1]}"]`));
  await page.locator('.grid .stackcard').waitFor();
  assert.deepEqual((await page.locator('.grid .stackcard .fanitem').evaluateAll((b) => b.map((x) => x.dataset.id))).sort(), pair.ids.slice().sort(), 'dropping a card onto another card stacks them');
  assert.ok(onDisk().filter((i) => pair.ids.includes(i.id)).every((i) => i.stackIn === pair.board), 'saved as stacked in this board');
  await page.click('.bcard[data-id="all"]');
  await page.locator('.grid .stackcard').waitFor();
  await page.evaluate(async (id) => { NB.apply(await nb.unstackItem(id)); NB.refreshGrid(); }, pair.ids[0]);
  await page.waitForFunction(() => !document.querySelector('.grid .stackcard'));
  ok('drop a card onto a card to stack; stacks only group inside a board when they were made there; all stacks group in All items');

  // Crop: drag the frame's corner in, save; the card and the open photo show only that part.
  const cropId = await page.evaluate(() => [...document.querySelectorAll('.grid > .card:not(.stackcard)')].map((c) => c.dataset.id).find((id) => NB.S.snap.items.find((i) => i.id === id).kind === 'photo'));
  const photoCard = page.locator(`.grid .card[data-id="${cropId}"]`);
  const cardShape = async () => page.locator(`.grid .card[data-id="${cropId}"] .media`).evaluate((m) => m.getBoundingClientRect().height / m.getBoundingClientRect().width);
  const shapeBefore = await cardShape();
  await photoCard.click();
  await page.locator('.side [aria-label="Crop"]').click();
  const frame = page.locator('.cropbox');
  await frame.waitFor();
  const fb = await frame.boundingBox();
  await page.mouse.move(fb.x + 4, fb.y + 4);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width * 0.3, fb.y + fb.height * 0.1, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: path.join(OUT, '12-crop.png') });
  await page.locator('.side .btn', { hasText: 'Save crop' }).click();
  await page.waitForFunction((id) => NB.S.snap.items.find((i) => i.id === id).crop, cropId);
  const crop = onDisk().find((i) => i.id === cropId).crop;
  assert.ok(crop.x > 0.25 && crop.y > 0.05 && crop.w < 0.75 && crop.h < 0.95, 'crop saved: ' + JSON.stringify(crop));
  assert.match(await page.locator('.stage img').evaluate((i) => getComputedStyle(i).objectViewBox), /inset/, 'the open photo shows the crop');
  await page.screenshot({ path: path.join(OUT, '13-cropped.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  assert.match(await page.locator(`.grid .card[data-id="${cropId}"] img`).evaluate((i) => getComputedStyle(i).objectViewBox), /inset/, 'the card shows the crop');
  const shapeAfter = await cardShape();
  const want = shapeBefore * (crop.h / crop.w);
  assert.ok(Math.abs(shapeAfter - want) < 0.03, `the card takes the cropped shape (${shapeAfter.toFixed(3)} vs ${want.toFixed(3)})`);
  await page.locator(`.grid .card[data-id="${cropId}"]`).click();
  await page.locator('.side [aria-label="Change crop"]').click();
  await page.locator('.side .linkbtn', { hasText: 'Show the whole picture' }).click();
  await page.locator('.side .btn', { hasText: 'Save crop' }).click();
  await page.waitForFunction((id) => !NB.S.snap.items.find((i) => i.id === id).crop, cropId);
  await page.keyboard.press('Escape');
  ok('Crop: drag the frame, save; the card and open photo show only that part (file untouched); Show the whole picture undoes it');

  // Paste a picture (like a screenshot): it's added. Pasting it again says it's already there.
  const pasteImage = () => page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 64, 48); g.fillStyle = '#fff'; g.fillRect(8, 8, 20, 20);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const d = new DataTransfer(); d.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true }));
  });
  const countBefore = await page.evaluate(() => NB.S.snap.items.length);
  await pasteImage();
  await page.waitForFunction((n) => NB.S.snap.items.length === n + 1, countBefore);
  const pasted = onDisk().find((i) => /^Pasted /.test(i.originalName));
  assert.ok(pasted && pasted.kind === 'photo' && pasted.hash, 'a pasted picture is saved as a photo');
  await pasteImage();
  await page.locator('.toast', { hasText: 'already in your notebook' }).waitFor();
  assert.equal(await page.evaluate(() => NB.S.snap.items.length), countBefore + 1, 'the same picture isn’t added twice');
  await page.evaluate(async (id) => { NB.apply(await nb.moveToBin(id)); NB.apply(await nb.emptyBin()); }, pasted.id); // keep the later counts as they were
  await page.waitForFunction((n) => NB.S.snap.items.length === n, countBefore);
  ok('pasting a picture adds it; pasting the same one again says it’s already there');

  // A video card plays quietly while the pointer rests on it.
  const vidCard = page.locator('.grid > .card', { has: page.locator('.badge') }).first();
  await vidCard.hover();
  await page.locator('.grid .hoverplay.on').waitFor({ timeout: 8000 });
  assert.equal(await page.locator('.grid .hoverplay').evaluate((v) => v.muted && !v.paused), true);
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !document.querySelector('.grid .hoverplay'));
  ok('video cards play quietly on hover and stop when the pointer leaves');

  // Card size: Ctrl + plus makes cards bigger, Ctrl + 0 goes back; it's remembered.
  const cardWidth = () => page.locator('.grid > .card').first().evaluate((c) => c.getBoundingClientRect().width);
  const w0 = await cardWidth();
  await page.locator('.page').hover();
  await page.keyboard.press('Control+Equal');
  await page.waitForTimeout(600);
  assert.ok(await cardWidth() > w0 + 10, 'cards get bigger');
  assert.ok(+(await page.evaluate(() => localStorage.getItem('nb.cardSize'))) > 250, 'remembered');
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(600);
  assert.ok(Math.abs(await cardWidth() - w0) < 2, 'and back');
  ok('card size changes with Ctrl + plus / minus (Ctrl + 0 resets) and is remembered');

  // Pick several and Add to board.
  const two = await page.evaluate(() => [...document.querySelectorAll('.grid > .card:not(.stackcard)')].slice(0, 2).map((c) => c.dataset.id));
  for (const id of two) await page.locator(`.grid .card[data-id="${id}"]`).click({ modifiers: ['Control'] });
  await page.locator('#selbar .btn', { hasText: 'Add to board' }).click();
  await page.locator('.ddlist.menu .ddopt', { hasText: 'Profile pictures' }).click();
  await page.waitForFunction((ids) => ids.every((id) => NB.S.snap.items.find((i) => i.id === id).boards.includes(NB.S.snap.boards.find((b) => b.name === 'Profile pictures').id)), two);
  await page.locator('#selbar').waitFor({ state: 'hidden' });
  ok('picking several and Add to board puts them all on it');

  // Delete board uses the custom confirmation bridge (accepted by this harness).
  const tempBoard = await page.evaluate(async () => (NB.apply(await nb.addBoard('Temporary'))).id);
  await page.click(`.bcard[data-id="${tempBoard}"]`);
  const del = page.locator('.context .btn.danger', { hasText: 'Delete board' });
  await del.click();
  await page.waitForFunction((id) => !NB.S.snap.boards.some((b) => b.id === id), tempBoard);
  await page.click('.bcard[data-id="all"]');
  ok('Delete board completes through the custom confirmation bridge');

  // Searching inside a board with no matches offers the matches in All items.
  const emptyBoard = await page.evaluate(async () => (NB.apply(await nb.addBoard('Empty for search'))).id);
  await page.click(`.bcard[data-id="${emptyBoard}"]`);
  await page.fill('#search', 'autumn');
  await page.locator('#empty .btn', { hasText: /Show 1 in All items/ }).click();
  await page.locator('.bcard[data-id="all"].on').waitFor();
  await page.locator('.grid .card', { hasText: 'Autumn capsule' }).waitFor();
  await page.fill('#search', '');
  await page.evaluate(async (id) => NB.apply(await nb.deleteBoard(id)), emptyBoard);
  ok('searching inside a board offers the matches found in All items');

  // No flicker: a change in the background (here a rename) keeps the pictures already on screen.
  const still = await page.evaluate(async () => {
    const boardImgs = [...document.querySelectorAll('.bcard .stack img')], card = document.querySelector('.grid > .card:not(.stackcard)');
    const cardImg = card.querySelector('img'), id = card.dataset.id;
    const before = NB.S.snap.items.find((i) => i.id === id).title;
    NB.apply(await nb.updateItem(id, { title: 'Renamed quietly' }));
    const same = boardImgs.every((i) => i.isConnected) && document.querySelector(`.grid .card[data-id="${id}"] img`) === cardImg;
    const label = document.querySelector(`.grid .card[data-id="${id}"]`).getAttribute('aria-label');
    NB.apply(await nb.updateItem(id, { title: before }));
    return { same, label };
  });
  assert.equal(still.same, true, 'board pictures and the card picture are kept');
  assert.equal(still.label, 'Open Renamed quietly', 'the card still knows its new name');
  ok('background changes don’t rebuild pictures already on screen (no flicker)');

  // Boards can be dragged into a new order.
  const boardNames = () => page.locator('.bcard[data-id]:not([data-id="all"]) .name').allInnerTexts();
  const namesBefore = await boardNames();
  // The drag events go straight to the two board cards (a mouse drag here depends on how far the list has scrolled).
  await page.evaluate(([from, to]) => {
    const card = (name) => [...document.querySelectorAll('.bcard[data-id]')].find((c) => c.querySelector('.name').textContent === name);
    const a = card(from), b = card(to), d = new DataTransfer(), r = b.getBoundingClientRect();
    const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: d, clientX: r.left + 20, clientY: y }));
    fire(a, 'dragstart', 0); fire(b, 'dragover', r.top + 4); fire(b, 'drop', r.top + 4); fire(a, 'dragend', 0);
  }, [namesBefore[namesBefore.length - 1], namesBefore[0]]);
  await page.waitForFunction((first) => document.querySelector('.bcard[data-id]:not([data-id="all"]) .name').textContent !== first, namesBefore[0]);
  const namesAfter = await boardNames();
  assert.equal(namesAfter[0], namesBefore[namesBefore.length - 1], 'the last board moved to the top');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')).boards.map((b) => b.name), namesAfter, 'and the order is saved');
  const movedFirst = namesAfter[0];
  await page.locator('.bcard', { hasText: movedFirst }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction((n) => document.querySelectorAll('.bcard[data-id]:not([data-id="all"]) .name')[1].textContent === n, movedFirst);
  ok('boards can be dragged into a new order, or moved with Alt + arrow keys');

  // Ctrl + A picks everything, Delete bins it, Undo brings it all back. Delete also bins an open item.
  const liveCount = await page.evaluate(() => NB.S.snap.items.filter((i) => !i.deletedAt).length);
  await page.locator('.page').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+a');
  assert.match(await page.locator('#selbar .count').innerText(), new RegExp(`${liveCount} picked`));
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => NB.S.snap.items.every((i) => i.deletedAt));
  await page.locator('.toast button', { hasText: 'Undo' }).last().click();
  await page.waitForFunction((n) => NB.S.snap.items.filter((i) => !i.deletedAt).length === n, liveCount);
  const oneId = await page.locator('.grid > .card:not(.stackcard)').first().getAttribute('data-id');
  await page.locator(`.grid .card[data-id="${oneId}"]`).click();
  await page.locator('.viewer').waitFor();
  await page.keyboard.press('Delete');
  await page.waitForFunction((id) => NB.S.snap.items.find((i) => i.id === id).deletedAt, oneId);
  await page.evaluate(async (id) => NB.apply(await nb.restore(id)), oneId);
  ok('Ctrl + A picks everything, Delete moves it to the Bin and Undo brings it back; Delete also bins an open item');

  // The shortcuts sheet: ? opens it, Esc closes it; it's also in the Library menu.
  await page.waitForFunction(() => !NB.viewer.isOpen());
  await page.keyboard.press('Shift+Slash');
  await page.locator('.keys').waitFor();
  assert.ok((await page.locator('.keys').innerText()).includes('Drag onto a card'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.keys'));
  await page.click('#lib-btn');
  await page.click('#lib-keys');
  await page.locator('.keys').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.keys'));
  ok('the shortcuts sheet opens with ? or from the Library menu and closes with Esc');
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
  const queuePickers = async paths => {
    for (const p of paths) if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    await answerPickers(app, [paths[0]]);
    await app.evaluate(({ shell }, values) => { global.testPickerQueue = values; shell.openPath = async () => ''; }, paths);
  };
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

  // Back up every week: switching it on asks for a folder and makes the first backup straight away.
  const AUTO = path.join(OUT, 'auto backups');
  fs.mkdirSync(AUTO, { recursive: true });
  await queuePickers([AUTO]);
  if (!await page.evaluate(() => NB.motion.isOpen(document.getElementById('lib-pop')))) await page.click('#lib-btn');
  await page.locator('#auto-backup').check();
  await page.locator('.toast', { hasText: 'Backed up automatically' }).waitFor({ timeout: 60000 });
  const autoDirs = fs.readdirSync(AUTO).filter((f) => f.startsWith('Notebook Backup') && !f.includes('in progress'));
  assert.equal(autoDirs.length, 1, 'the first automatic backup is made');
  assert.equal(JSON.parse(fs.readFileSync(path.join(AUTO, autoDirs[0], 'library.json'), 'utf8')).items.length, lib0.items.length);
  assert.match(await page.locator('#auto-backup-info').innerText(), /last one today/);
  const cfgAuto = JSON.parse(fs.readFileSync(path.join(OUT, 'userdata', 'config.json'), 'utf8')).autoBackup;
  assert.ok(cfgAuto.on && cfgAuto.dir === AUTO && cfgAuto.made.length === 1);
  await page.locator('#auto-backup').uncheck();
  await until(() => JSON.parse(fs.readFileSync(path.join(OUT, 'userdata', 'config.json'), 'utf8')).autoBackup.on === false, 'switched off');
  if (await page.evaluate(() => NB.motion.isOpen(document.getElementById('lib-pop')))) await page.click('#lib-btn');
  ok('Back up every week: switching it on makes the first backup straight away, into the chosen folder');

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
