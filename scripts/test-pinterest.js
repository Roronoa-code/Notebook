// Build plan B1/B2 in the real window (needs the internet and the tools in D:\Notebook Tools\bin):
// pasting a link saves it; a bad link goes to the retry list with a plain message; the Pinterest panel
// opens, browsing saves nothing, and "Save to library" saves each of 10 chosen pins correctly.
// Opens on the second monitor when there is one. Usage: node scripts/test-pinterest.js
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { _electron: electron } = require('playwright-core');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'test-output', 'links');
const LIB = path.join(OUT, 'Notebook Library');
const TOOLS = process.env.NOTEBOOK_TOOLS_REAL || 'D:/Notebook Tools';
let passed = 0;
const ok = (msg) => { passed++; console.log('  ok  ' + msg); };
const PINS = ['89790586316488353', '939352434800782314', '877287202436404443', '907616131209109354', '649996158764590487', '844493676156228', '22166223164415731', '18858892187080329', '609463762090689014', '42995371469162986'];
const onDisk = () => JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8'));

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  // Copies of the real downloader tools (never a link to them, so clearing this folder can't touch them);
  // recognition stays the stand-in.
  const tools = path.join(OUT, 'tools');
  fs.mkdirSync(path.join(tools, 'bin'), { recursive: true });
  for (const exe of ['yt-dlp.exe', 'gallery-dl.exe']) fs.copyFileSync(path.join(TOOLS, 'bin', exe), path.join(tools, 'bin', exe));
  const env = { ...process.env, NOTEBOOK_USER_DATA: path.join(OUT, 'userdata'), NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47871', NOTEBOOK_FAKE_RECOGNISER: '1', NOTEBOOK_TOOLS: tools, NOTEBOOK_WINDOW_DISPLAY: 'second' };
  const app = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }), env });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('  [page error] ' + e.message));
  await page.locator('#welcome').waitFor();
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, LIB);
  await page.click('#w-choose');
  await page.locator('.bcard').first().waitFor();

  // Paste a TikTok link into the window: it saves by itself.
  await page.evaluate(() => { const d = new DataTransfer(); d.setData('text/plain', 'https://www.tiktok.com/@boolon.ootd/video/7685607007965007134'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true })); });
  await page.waitForFunction(() => NB.S.snap.items.some((i) => (i.source || '').includes('7685607007965007134')), null, { timeout: 120000 });
  assert.equal(onDisk().items.filter((i) => i.source).length, 1);
  ok('pasting a TikTok link anywhere saves the video by itself');

  // A link that can't be saved: plain message, kept in the retry list under Links.
  await page.fill('#link-input', 'https://www.pinterest.com/pin/1/');
  await page.press('#link-input', 'Enter');
  await page.locator('.toast.error', { hasText: 'removed or the link is wrong' }).waitFor({ timeout: 120000 });
  await page.click('#links-btn');
  await page.locator('.linkspop .retry li', { hasText: 'pinterest.com/pin/1' }).waitFor();
  await page.locator('.linkspop .retry li .btn', { hasText: 'Remove' }).click();
  await page.locator('.linkspop .hint', { hasText: 'Nothing waiting to retry' }).waitFor();
  await page.click('#links-btn');
  ok('a link that fails gets a plain message and waits in the retry list (and can be removed)');

  // Pinterest panel: browsing saves nothing; Save to library saves exactly the open pin.
  await page.click('#pin-btn');
  await page.locator('#pinpanel').waitFor();
  const before = onDisk().items.length;
  await page.evaluate((id) => nb.pinGo(`https://www.pinterest.com/pin/${id}/`), PINS[0]);
  await page.waitForTimeout(4000);
  assert.equal(onDisk().items.length, before, 'browsing a pin saves nothing');
  await page.screenshot({ path: path.join(OUT, 'pinterest-panel.png') });
  let savedPins = 0;
  for (const id of PINS) {
    await page.evaluate((u) => nb.pinGo(u), `https://www.pinterest.com/pin/${id}/`);
    await page.waitForFunction((id2) => (document.getElementById('pin-save').dataset.pin || '').includes(id2) && !document.getElementById('pin-save').disabled, id, { timeout: 30000 });
    const n = onDisk().items.length;
    await page.click('#pin-save');
    await page.waitForFunction((id2) => NB.S.snap.items.some((i) => (i.source || '').includes(id2)), id, { timeout: 120000 }).catch(() => {});
    const got = onDisk().items.filter((i) => (i.source || '').includes(id));
    if (got.length && onDisk().items.length > n) savedPins++;
    else console.log('    not saved:', id, (await page.locator('#pinstatus').innerText()));
  }
  const bySource = new Map(); for (const it of onDisk().items.filter((i) => (i.source || '').includes('pinterest'))) bySource.set(it.source, (bySource.get(it.source) || 0) + 1);
  assert.equal([...bySource.keys()].length, PINS.length, 'each chosen pin saved once (nothing else)');
  assert.equal(savedPins, PINS.length, `${savedPins}/${PINS.length} pins saved`);
  ok(`Pinterest panel: all ${PINS.length} chosen pins saved with Save to library; nothing saved while just browsing`);

  // A menu opened over Pinterest isn't hidden behind it: Pinterest steps aside, then comes back.
  const layers = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
  const withPin = await layers();
  await page.click('#lib-btn');
  await page.waitForFunction(() => true);
  for (let i = 0; i < 30 && (await layers()) === withPin; i++) await page.waitForTimeout(100);
  assert.equal(await layers(), withPin - 1, 'Pinterest steps aside for the Library menu');
  await page.click('#lib-btn');
  for (let i = 0; i < 30 && (await layers()) !== withPin; i++) await page.waitForTimeout(100);
  assert.equal(await layers(), withPin, 'and comes back when it closes');
  assert.equal(await page.locator('#pinpanel').isVisible(), true);
  ok('menus opened over Pinterest show: Pinterest steps aside and comes back');
  await page.click('#pin-close');
  await page.locator('#pinpanel').waitFor({ state: 'hidden' });
  await page.waitForTimeout(1500); // the last page is remembered a moment after it opens
  await app.close();

  // After a restart, the panel opens where you left it.
  const app2 = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }), env });
  const page2 = await app2.firstWindow();
  await page2.locator('.bcard').first().waitFor();
  await page2.click('#pin-btn');
  const pinUrl = () => app2.evaluate(({ webContents }) => (webContents.getAllWebContents().find((w) => /pinterest/.test(w.getURL())) || { getURL: () => '' }).getURL());
  for (let i = 0; i < 60 && !/\/pin\//.test(await pinUrl()); i++) await page2.waitForTimeout(500);
  assert.match(await pinUrl(), /\/pin\//, 'reopens on the last pin');
  ok('after a restart, the Pinterest panel opens on the last page you had open');
  await app2.close();

  // Hide AI pins: with a stand-in detector that calls every picture AI-made, pins are hidden and counted.
  // (The runs above already remembered these pins as not AI-made, so start from a clean slate.)
  fs.rmSync(path.join(OUT, 'userdata', 'pinterest-ai.json'), { force: true });
  const app3 = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }), env: { ...env, NOTEBOOK_FAKE_AI: '1' } });
  const page3 = await app3.firstWindow();
  await page3.locator('.bcard').first().waitFor();
  await page3.click('#pin-btn');
  await page3.locator('#pin-ai-text', { hasText: /AI pins? hidden/ }).waitFor({ timeout: 90000 });
  // Mostly taken out before the page gets them (so no gaps); any caught later are hidden on the page.
  const hiddenOnPage = +(await page3.locator('#pin-ai-text').innerText()).match(/\d+/)[0];
  assert.ok(hiddenOnPage > 0, 'pins judged AI-made are kept off the page');
  const aiFile = path.join(OUT, 'userdata', 'pinterest-ai.json');
  for (let i = 0; i < 50 && !fs.existsSync(aiFile); i++) await page3.waitForTimeout(100); // saved a couple of seconds later
  const saved = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
  assert.ok(saved.hide === true && Object.keys(saved.scores).length > 0, 'answers are remembered');
  await page3.locator('#pin-ai').uncheck();
  await page3.locator('#pin-ai-text', { hasText: 'Hide AI pins' }).waitFor();
  await app3.close();
  ok(`Hide AI pins: pins judged AI-made are hidden (${hiddenOnPage} here) and counted; answers are remembered; the switch turns it off`);

  // Ideas from real Pinterest: For you on All items, a board's own Ideas, and saving one.
  const app4 = await electron.launch({ ...(process.env.NOTEBOOK_EXE ? { executablePath: process.env.NOTEBOOK_EXE } : { args: [APP] }), env });
  const page4 = await app4.firstWindow();
  page4.on('pageerror', (e) => console.log('  [page error] ' + e.message));
  await page4.locator('.bcard').first().waitFor();
  const boardId = await page4.evaluate(async (pins) => {
    const b = await nb.addBoard('Streetwear');
    for (const it of NB.S.snap.items.filter((i) => pins.some((p) => (i.source || '').includes(p))).slice(0, 3)) await nb.updateItem(it.id, { boards: [b.id] });
    NB.apply(await nb.state());
    return b.id;
  }, PINS);
  await page4.locator('.bcard[data-id="all"]').click();
  await page4.locator('.segbtn', { hasText: 'For you' }).click();
  await page4.locator('#ideas .idea').nth(19).waitFor({ timeout: 120000 });
  await page4.waitForFunction(() => [...document.querySelectorAll('#ideas .idea img')].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 });
  const all = (await page4.evaluate(() => nb.feed('all'))).feed;
  assert.ok(all.pins.every((p) => /^https:\/\/www\.pinterest\.com\/pin\/\d+\/$/.test(p.url)), 'real pins');
  assert.equal(all.signedIn, false, 'this test isn’t signed in, so no home feed');
  await page4.screenshot({ path: path.join(OUT, 'ideas-all.png') });
  ok(`For you: ${all.pins.length} real pins from Pinterest (More like this and searches), pictures shown`);

  await page4.locator(`.bcard[data-id="${boardId}"]`).click();
  await page4.waitForFunction((id) => document.querySelectorAll('#ideas .idea').length >= 10 && NB.currentBoardId() === id, boardId, { timeout: 120000 });
  const pick = page4.locator('#ideas .idea').first();
  const pinId = await pick.getAttribute('data-pin');
  await pick.hover();
  await pick.locator('.idea-save').click();
  await page4.waitForFunction((id) => NB.S.snap.items.some((i) => (i.source || '').includes(id)), pinId, { timeout: 120000 });
  const got = onDisk().items.find((i) => (i.source || '').includes(pinId));
  assert.ok(got.boards.includes(boardId), 'saved onto the board it was found for');
  await page4.waitForFunction(() => document.querySelector('#ideas .idea .idea-save').dataset.state === 'saved');
  await page4.screenshot({ path: path.join(OUT, 'ideas-board.png') });
  await app4.close();
  ok('a board’s Ideas come from its own pins and searches; Save puts the pin on that board and shows Saved');
  console.log(`\nAll ${passed} checks passed. Screenshot: ${OUT}`);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
