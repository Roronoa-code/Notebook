// Smoke test for the installed/packaged app: real recognition (the real models in D:\Notebook Tools)
// works from inside the packaged app on a separate test library. Opens on the second monitor.
// Usage: NOTEBOOK_EXE="...\dist\win-unpacked\Notebook.exe" node scripts/test-packaged-recognition.js
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { _electron: electron } = require('playwright-core');

const OUT = path.join(__dirname, '..', 'test-output', 'packaged-recognition');
const LIB = path.join(OUT, 'Notebook Library');
const SET = 'D:/Notebook Tools/testset/set';
(async () => {
  assert.ok(process.env.NOTEBOOK_EXE, 'set NOTEBOOK_EXE to the packaged Notebook.exe');
  fs.rmSync(OUT, { recursive: true, force: true });
  const env = { ...process.env, NOTEBOOK_USER_DATA: path.join(OUT, 'userdata'), NOTEBOOK_SYNC_HOST: '127.0.0.1', NOTEBOOK_SYNC_PORT: '47881', NOTEBOOK_TOOLS: 'D:/Notebook Tools', NOTEBOOK_WINDOW_DISPLAY: 'second' };
  const app = await electron.launch({ executablePath: process.env.NOTEBOOK_EXE, env });
  const page = await app.firstWindow();
  await page.locator('#welcome').waitFor();
  fs.mkdirSync(OUT, { recursive: true });
  const camera = path.join(OUT, 'IMG_0001.jpg'); // a camera-style file name: it should get a proper name
  fs.writeFileSync(camera, Buffer.concat([fs.readFileSync(path.join(SET, 'outfit_05.jpg')), Buffer.from('copy')]));
  const files = ['outfit_24.jpg', 'wallpaper_15.jpg', 'icon_12.jpg'].map((f) => path.join(SET, f)).concat(camera);
  await app.evaluate(({ dialog }, [lib, list]) => { const q = [[lib], list]; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: q.shift() }); }, [LIB, files]);
  await page.click('#w-choose');
  await page.locator('.bcard').first().waitFor();
  await page.click('#add-photos');
  await page.waitForFunction(() => NB.S.snap.items.length === 4 && NB.S.snap.items.every((i) => i.ai && (i.ai.type || i.ai.failed)), null, { timeout: 300000 });
  await page.waitForTimeout(2000);
  const got = await page.evaluate(() => NB.S.snap.items.map((i) => [i.originalName, i.ai.type && i.ai.type.main, (i.ai.colours || []).map((c) => c.name).join(','), i.title, i.ai.caption || '']));
  console.log(got.map((g) => g.join('  ')).join('\n'));
  assert.deepEqual(got.map((g) => g[1]).sort(), ['icon', 'outfit', 'outfit', 'wallpaper']);
  const cam = got.find((g) => g[0] === 'IMG_0001.jpg');
  assert.ok(cam[3] !== 'IMG_0001' && cam[4], 'the camera file got a proper name from its caption: ' + cam[3]);
  assert.equal(got.find((g) => g[0] === 'outfit_24.jpg')[3], 'outfit_24', 'a real file name stays');
  const status = await page.evaluate(async () => (await nb.aiStatus()).status);
  console.log('  ok  the packaged app recognises pictures with the real models' + (status.device ? ` (on ${status.device})` : ''));
  await app.close();
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
