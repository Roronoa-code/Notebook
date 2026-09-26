// Real native Pinterest discovery, on an explicitly selected emulator only.
// Install the current APK first. NOTEBOOK_TEST_EMULATOR=emulator-5554 node scripts/test-phone-discovery.js
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { _android } = require('playwright-core');

(async () => {
  const serial = process.env.NOTEBOOK_TEST_EMULATOR;
  assert.match(serial || '', /^emulator-\d+$/, 'Select a PC emulator; never run this against the owner’s phone.');
  const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
  const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  const pkg = 'com.mani.notebook', out = path.resolve(__dirname, '../test-output/phone-discovery');
  fs.mkdirSync(out, { recursive: true });
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'am', 'start', '-W', '-n', `${pkg}/.MainActivity`);
  const device = (await _android.devices()).find((d) => d.serial() === serial);
  assert.ok(device, 'selected emulator is connected');
  let page = await (await device.webView({ pkg }, { timeout: 30000 })).page();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let disabledNetwork = false;
  try {
    await page.waitForSelector('#tab-ideas');
    await page.evaluate(() => {
      const state = JSON.parse(NBNative.unpair());
      window.nbOnState(JSON.stringify(state));
      window.__ideaSaves = [];
      const receive = window.nbOnIdeaSaved;
      window.nbOnIdeaSaved = (json) => { window.__ideaSaves.push(JSON.parse(json)); receive(json); };
    });
    assert.equal(await page.evaluate(() => JSON.parse(NBNative.state()).sync.paired), false);
    await page.locator('#tab-ideas').click();
    await page.locator('#homegrid .idea-query').fill('minimal black room');
    await page.locator('#homegrid .idea-query').press('Enter');
    await page.waitForFunction(() => document.querySelector('#homegrid .ideacols')?.dataset.key === 'search:minimal black room', null, { timeout: 120000 });
    await page.waitForFunction(() => [...document.querySelectorAll('#homegrid .card.idea img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 });
    const firstId = await page.locator('#homegrid .card.idea').first().getAttribute('data-v');
    await page.locator('#homegrid .card.idea').first().click();
    await page.locator('[data-a="ideaRelated"]').click();
    await page.waitForFunction((key) => document.querySelector('#homegrid .ideacols')?.dataset.key === key, 'pin:' + firstId, { timeout: 120000 });
    await page.locator('#homegrid [data-a="ideasBack"]').click();
    await page.waitForFunction(() => document.querySelector('#homegrid .ideacols')?.dataset.key === 'search:minimal black room');
    await page.screenshot({ path: path.join(out, 'native-search.png') });

    const before = await page.evaluate(() => JSON.parse(NBNative.state()).items.length);
    await page.locator('#homegrid .card.idea:not(.saved)').filter({ hasNot: page.locator('.badge') }).first().click();
    await page.locator('[data-a="ideaSave"]').click();
    await page.waitForFunction(() => window.__ideaSaves.length > 0, null, { timeout: 120000 });
    const save = await page.evaluate(() => window.__ideaSaves.at(-1));
    assert.equal(save.ok, true, save.message);
    const items = await page.evaluate(() => JSON.parse(NBNative.state()).items);
    assert.ok(items.length > before && items.some((i) => i.source === save.url), 'saved directly into the phone library');
    assert.equal(await page.evaluate((url) => JSON.parse(NBNative.feed()).feeds['search:minimal black room'].pins.find((p) => p.url === url)?.saved, save.url), true, 'native saved state survives a new snapshot');
    // The emulator's radio state is restored even when the offline assertion fails.
    const airplane = adb('shell', 'settings', 'get', 'global', 'airplane_mode_on');
    if (airplane !== '1') { adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'); disabledNetwork = true; }
    adb('shell', 'am', 'force-stop', pkg);
    adb('shell', 'am', 'start', '-W', '-n', `${pkg}/.MainActivity`);
    const restartedPid = Number(adb('shell', 'pidof', pkg));
    page = await (await device.webView({ socketName: `webview_devtools_remote_${restartedPid}` }, { timeout: 30000 })).page();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('#tab-ideas').click();
    await page.locator('#homegrid .idea-query').fill('minimal black room');
    await page.locator('#homegrid .idea-query').press('Enter');
    await page.waitForFunction(() => document.querySelector('#homegrid .ideacols')?.dataset.key === 'search:minimal black room');
    await page.waitForFunction(() => [...document.querySelectorAll('#homegrid .card.idea img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
    assert.deepEqual(errors, []);
    console.log('Native phone discovery passed without pairing: public search, pictures, related pins, Back, direct original-image save, durable saved state and cached browsing in airplane mode.');
  } finally {
    if (disabledNetwork) adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable');
    await Promise.race([device.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
