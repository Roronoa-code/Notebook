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
// Separate runs must not remove a live test library while another window is using it.
const OUT = path.join(APP, 'test-output', 'features-' + process.pid);
const LIB = path.join(OUT, 'Notebook Library');
let passed = 0;
const ok = (msg) => { passed++; console.log('  ok  ' + msg); };
const ENV = { ...process.env, NOTEBOOK_USER_DATA: path.join(OUT, 'userdata'), NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47861', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_FAKE_NAMES: '1', NOTEBOOK_FAKE_FEED: '1', NOTEBOOK_TOOLS: path.join(OUT, 'tools'), NOTEBOOK_WINDOW_DISPLAY: 'second' };
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
  const files = [['outfit coat.jpg', jpg[0]], ['IMG_2031 outfit shirt.jpg', jpg[1]], ['wall lake.jpg', jpg[1]], ['icon logo.jpg', jpg[0]], ['face pfp.jpg', jpg[0]]]
    // A few extra bytes after the picture make each file different, so none is skipped as a duplicate.
    .map(([name, from]) => { const to = path.join(samples, name); fs.writeFileSync(to, Buffer.concat([fs.readFileSync(from), Buffer.from(name)])); return to; });

  await require('../main/library').Library.openOrCreate(LIB);
  fs.mkdirSync(ENV.NOTEBOOK_USER_DATA, { recursive: true });
  fs.writeFileSync(path.join(ENV.NOTEBOOK_USER_DATA, 'config.json'), JSON.stringify({ libraryPath: LIB }));
  let { app, page, web } = await launch();
  await page.locator('.bcard').first().waitFor();
  await page.evaluate(async paths => NB.apply(await nb.importPaths(paths, null)), files);
  await page.locator('.grid .card').nth(4).waitFor();
  await idle(page);
  await page.waitForFunction(() => NB.S.snap.items.every((i) => i.ai && i.ai.type));
  assert.deepEqual(onDisk().items.map((i) => i.ai.type.main).sort(), ['icon', 'outfit', 'outfit', 'profile picture', 'wallpaper']);
  ok('new photos are recognised in the background and saved (type, colours, styles)');

  // Names: a placeholder title (a camera file name) gets a proper name from the naming model; a real one stays.
  await page.waitForFunction(() => NB.S.snap.items.some((i) => i.originalName === 'IMG_2031 outfit shirt.jpg' && i.title !== 'IMG_2031 outfit shirt'), null, { timeout: 20000 });
  for (let i = 0; i < 40 && onDisk().items.find((x) => x.originalName === 'IMG_2031 outfit shirt.jpg').title === 'IMG_2031 outfit shirt'; i++) await page.waitForTimeout(100);
  const named = onDisk().items.find((i) => i.originalName === 'IMG_2031 outfit shirt.jpg');
  assert.equal(named.title, 'Black coat and jeans', 'the camera file name became a proper name');
  assert.equal(named.sourceTitle, 'IMG_2031 outfit shirt');
  assert.equal(onDisk().items.find((i) => i.originalName === 'outfit coat.jpg').title, 'outfit coat', 'a real title stays');
  await page.fill('#search', 'IMG_2031');
  assert.equal(await page.locator('.grid > .card').count(), 1, 'the old name still finds it');
  await page.fill('#search', '');
  ok('placeholder titles get proper names from what the picture shows; real titles stay; old names still searchable');

  // Filters: the cards that stay are the same cards (they glide, nothing reloads), and the title doesn't replay
  await page.evaluate(() => { for (const c of document.querySelectorAll('.grid > .card')) c.dataset.was = '1'; });
  await page.locator('.filters .fchip', { hasText: 'Outfits' }).click();
  assert.equal(await page.locator('.grid > .card').count(), 2, 'only the two outfits');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.card-ghost').count(), 0, 'the fading copies of hidden cards are gone');
  assert.equal(await page.locator('.grid > .card[data-was]').count(), 2, 'kept cards are reused, not rebuilt');
  assert.equal(await page.locator('.ctx-title.still').count(), 1, 'the title stays still');
  await page.locator('.filters .fchip', { hasText: 'Black' }).click();
  assert.equal(await page.locator('.grid > .card').count(), 2);
  await page.locator('.filters .linkbtn', { hasText: 'Clear filters' }).click();
  assert.equal(await page.locator('.grid > .card').count(), 5);
  await page.locator('.filters .fchip', { hasText: 'Outfits' }).click();
  await page.locator('.bcard[data-id]:not([data-id="all"])').first().click();
  await page.locator('.bcard[data-id="all"]').click();
  assert.equal(await page.locator('.filters .fchip.on').count(), 0, 'switching boards clears the filters');
  assert.equal(await page.locator('.grid > .card').count(), 5);
  ok('filters by type and clothing colour show the right items without rebuilding the page; Clear filters and switching boards show everything');

  // Sorting: by name; by date taken, with a heading per month (these samples carry no date: "No date").
  await page.locator('.sortbox .dd').click();
  await page.locator('.ddlist .ddopt', { hasText: /^Name$/ }).click();
  const sorted = await page.locator('.grid > .card > .sr').allInnerTexts();
  assert.deepEqual(sorted, sorted.slice().sort((a, b) => a.localeCompare(b, 'en-GB', { numeric: true, sensitivity: 'base' })), 'A to Z');
  await page.locator('.sortbox .dd').click();
  await page.locator('.ddlist[data-motion-open="true"] .ddopt', { hasText: 'Date taken, newest' }).click();
  await page.locator('.grid > .dategroup').first().waitFor();
  const thisMonth = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
  assert.equal(await page.locator('.grid > .dategroup').last().innerText(), thisMonth, 'no date inside the picture: the day it was added');
  await page.reload();
  await page.locator('.grid > .dategroup').first().waitFor();
  assert.match(await page.locator('.sortbox .dd').innerText(), /Date taken, newest/, 'remembered');
  await page.locator('.sortbox .dd').click();
  await page.locator('.ddlist[data-motion-open="true"] .ddopt', { hasText: 'Newest added' }).click();
  assert.equal(await page.locator('.grid > .dategroup').count(), 0);
  ok('sort by name or date taken (a heading for each month; the day it was added when the picture has no date), remembered per board');

  // Correcting a label: it saves, survives a restart and a re-scan
  const coat = onDisk().items.find((i) => i.originalName === 'outfit coat.jpg');
  await page.locator(`.grid .card[data-id="${coat.id}"]`).click();
  await page.locator('.side .lsum').click(); // the one-line summary opens the dropdowns
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
  await page.locator('.side .lsum').click();
  assert.equal(await page.locator('.recog .dd[aria-label="What this is"]').innerText(), 'Wallpaper');
  // Colours: take one off, add one, then go back to what the PC saw.
  const colourTags = page.locator('.recog .colourtag.rm');
  const firstColour = (await colourTags.first().innerText()).trim().toLowerCase();
  await colourTags.first().click();
  await page.waitForFunction(([id, c]) => { const l = NB.S.snap.items.find((i) => i.id === id).labels; return l && Array.isArray(l.colours) && !l.colours.includes(c); }, [coat.id, firstColour]);
  await page.locator('.recog .dd[aria-label="Add a colour"]').click();
  await page.locator('.ddlist[data-motion-open="true"] .ddopt', { hasText: /^Orange$/ }).click();
  await page.waitForFunction((id) => (NB.S.snap.items.find((i) => i.id === id).labels.colours || []).includes('orange'), coat.id);
  assert.ok(onDisk().items.find((i) => i.id === coat.id).labels.colours.includes('orange'), 'saved');
  await page.locator('.recog .linkbtn', { hasText: 'Use the colours the PC saw' }).click();
  await page.waitForFunction((id) => !Array.isArray((NB.S.snap.items.find((i) => i.id === id).labels || {}).colours), coat.id);
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
  // The background recogniser saves every second or so: wait for it to reach the file.
  for (let i = 0; i < 50 && !onDisk().items.filter((x) => x.ai && x.ai.styles).every((x) => x.ai.stylesFor.includes('gorpcore')); i++) await page.waitForTimeout(100);
  assert.ok(onDisk().items.filter((i) => i.ai && i.ai.styles).every((i) => i.ai.stylesFor.includes('gorpcore')), 'outfits looked at again for the new list');
  ok('the style list takes your own styles and outfits are re-styled against it');

  // Suggested groups and matching sets
  await page.locator('#suggested .sughead').waitFor({ timeout: 10000 });
  assert.equal(await page.locator('#suggested.open').count(), 0, 'Suggested starts folded away');
  assert.equal(await page.locator('#suggested .sugbody').evaluate((b) => Math.round(b.getBoundingClientRect().height)), 0);
  await page.locator('#suggested .sughead').click();
  await page.locator('#suggested .navrow').first().waitFor({ timeout: 10000 });
  const mid = await page.locator('#suggested .sugbody').evaluate(async (b) => { await new Promise((r) => setTimeout(r, 120)); return b.getBoundingClientRect().height; });
  await page.waitForTimeout(600);
  const full = await page.locator('#suggested .sugbody').evaluate((b) => b.getBoundingClientRect().height);
  assert.ok(mid > 0 && mid < full, `it slides open (${Math.round(mid)} of ${Math.round(full)}px part way), not all at once`);
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

  // Ideas: "For you" on All items and "Ideas" on a board (a stand-in feed, no internet)
  await page.locator('.bcard[data-id="all"]').click();
  await page.locator('.segbtn', { hasText: 'For you' }).click();
  await page.locator('#ideas .idea').nth(11).waitFor({ timeout: 20000 });
  assert.ok(await page.locator('#grid').isHidden(), 'the saved items step aside');
  await page.waitForFunction(() => { const i = document.querySelector('#ideas .idea img'); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await page.locator('.ideas-hint').count(), 1, 'says signing in to Pinterest adds the home feed');
  const cols = await page.locator('#ideas .ideacol').count();
  assert.ok(cols >= 2, 'laid out in columns');
  const first = await page.locator('#ideas .idea').count();
  await page.locator('#page').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForFunction((n) => document.querySelectorAll('#ideas .idea').length > n, first, { timeout: 20000 });
  ok(`For you shows pins in ${cols} columns with their pictures; scrolling down loads more`);

  const gone = await page.locator('#ideas .idea').first().getAttribute('data-pin');
  await page.locator('#ideas .idea').first().hover();
  await page.locator('#ideas .idea').first().locator('.idea-hide').click();
  await page.waitForFunction((id) => !document.querySelector(`#ideas .idea[data-pin="${id}"]`), gone);
  const again = await page.evaluate(() => nb.feed('all'));
  assert.ok(!again.feed.pins.some((p) => p.id === gone), 'a hidden pin stays hidden');
  const savedFeed = () => JSON.parse(fs.readFileSync(path.join(OUT, 'userdata', 'feed', 'feeds.json'), 'utf8'));
  for (let i = 0; i < 50 && !savedFeed().hidden.includes(gone); i++) await page.waitForTimeout(100);
  const feedFile = savedFeed();
  assert.ok(feedFile.hidden.includes(gone), 'remembered after a restart');
  ok('Not for me hides a pin for good');

  // Clicking a pin: a close-up inside Notebook, a sharper picture follows, ← → for the next, Esc closes.
  await page.locator('#ideas .idea .idea-open').first().click();
  await page.locator('.ideaview .idea-save').waitFor();
  const firstPin = await page.locator('.ideaview').getAttribute('data-pin');
  await page.waitForFunction(() => { const i = document.querySelector('.ideaview img'); return i && /-big\.jpg$/.test(i.src); });
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.locator('.ideaview:not([inert])').getAttribute('data-pin'), firstPin, 'the next idea');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.ideaview'));
  ok('clicking a pin opens a close-up straight away (sharper picture, next with →, Esc closes)');

  // Direct search and related pins stay inside Notebook, with a return to the original feed.
  await page.locator('.ideas-search input').fill('blue room');
  await page.locator('.ideas-search input').press('Enter');
  await page.locator('.ideas-breadcrumb').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#ideas .idea').length > 0);
  await page.locator('#ideas .idea .idea-open').first().click();
  await page.locator('.idea-related').click();
  await page.waitForFunction(() => document.querySelector('.ideas-breadcrumb')?.textContent.includes('More like'));
  await page.locator('.ideas-breadcrumb button').click();
  await page.waitForFunction(() => document.querySelector('.ideas-breadcrumb')?.textContent.includes('blue room'));
  await page.locator('.ideas-breadcrumb button').click();
  await page.locator('.ideas-breadcrumb').waitFor({ state: 'detached' });
  await page.locator('#ideas .idea .idea-save').first().waitFor();
  ok('search and More like this stay in Notebook; Back returns through discovery to For you');

  // Save: with no downloader tools in the test, it says so and the button goes back to Save.
  const card = page.locator('#ideas .idea').first();
  await card.hover();
  await card.locator('.idea-save').click();
  await page.locator('.toast', { hasText: 'downloader tools' }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#ideas .idea .idea-save').dataset.state === 'save');
  ok('Save sends the pin to the downloader (and says plainly when it can’t)');

  // A board keeps Ideas on and shows its own; Saved brings the board back.
  await page.locator(`.bcard[data-id="${board.id}"]`).click();
  await page.locator('.segbtn.on', { hasText: 'Ideas' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#ideas .idea').length >= 6, null, { timeout: 20000 });
  const boardFeed = await page.evaluate((id) => nb.feed(id), board.id);
  assert.equal(boardFeed.feed.key, board.id, 'the board has its own feed');
  await page.waitForFunction(() => [...document.querySelectorAll('#ideas .idea')].slice(0, 4).every((el) => {
    const img = el.querySelector('img');
    return img?.complete && img.naturalWidth > 0 && !el.getAnimations().some((a) => a.playState === 'running');
  }));
  await page.screenshot({ path: path.join(OUT, 'ideas.png') });
  await page.locator('.segbtn', { hasText: 'Saved' }).click();
  await page.locator('#grid > .card').first().waitFor();
  assert.ok(await page.locator('#ideas').isHidden());
  assert.equal(await page.locator('#grid > .card').count(), 3, 'the board’s own items are back');
  ok('each board has its own Ideas; Saved goes back to the board’s items');

  assert.deepEqual(web, [], 'no internet requests');
  ok('no internet requests were made');
  await app.close();
  console.log(`\nAll ${passed} checks passed. Screenshots: ${OUT}`);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
