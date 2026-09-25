// Phone Ideas: For you on Home and Ideas on a board, using the phone UI's mock bridge (pins as the PC
// would send them). Save, Not for me and Open in Pinterest. No phone data is touched.
// Usage: node scripts/test-phone-ideas.js (requires Microsoft Edge).
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 384, height: 832 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
    await page.waitForTimeout(600);
    const calls = () => page.evaluate(() => window.NB_MOCK_CALLS);

    // For you on Home: the third tab, pins with their pictures, none of them liftable or stackable.
    await page.locator('#tab-ideas').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#homegrid .card.idea').count(), 5, 'the PC’s picks for All');
    await page.waitForFunction(() => { const i = document.querySelector('#homegrid .card.idea img'); return i && i.complete && i.naturalWidth > 0; });
    assert.equal(await page.locator('#homegrid .card.idea .badge').count(), 1, 'a video pin is marked');
    const slid = await page.locator('.topbar .seg').evaluate((s) => getComputedStyle(s, '::before').transform);
    assert.notEqual(slid, 'none', 'the tab highlight slides to For you');

    // Tap a pin: Save to your notebook.
    await page.locator('#homegrid .card.idea').first().click();
    await page.locator('#formsheet [data-a="ideaSave"]').waitFor();
    assert.match(await page.locator('#formsheet [data-a="ideaSave"]').innerText(), /Save to your notebook/);
    await page.locator('#formsheet [data-a="ideaSave"]').click();
    await page.waitForTimeout(400);
    assert.deepEqual((await calls()).find((c) => c[0] === 'feedSave'), ['feedSave', 'https://www.pinterest.com/pin/900001/', '']);
    assert.equal(await page.locator('#homegrid .card.idea.saved').count(), 1, 'the pin shows as saved');
    assert.ok(await page.locator('#formsheet').isHidden(), 'the sheet closes');

    // Not for me: it goes; Open in Pinterest hands the link to the app.
    await page.locator('#homegrid .card.idea').nth(1).click();
    await page.locator('#formsheet [data-a="ideaHide"]').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#homegrid .card.idea').count(), 4);
    assert.ok((await calls()).some((c) => c[0] === 'feedHide' && c[1] === '900002'));
    await page.locator('#homegrid .card.idea').nth(1).click();
    await page.locator('#formsheet [data-a="ideaOpen"]').click();
    await page.waitForTimeout(300);
    assert.ok((await calls()).some((c) => c[0] === 'openPin' && c[1] === 'https://www.pinterest.com/pin/900003/'));
    await page.screenshot({ path: path.resolve(__dirname, '../test-output/phone-ideas-home.png') });

    // A board: Saved and Ideas; saving from a board's Ideas puts it on that board.
    await page.locator('#tab-recent').click();
    await page.waitForTimeout(400);
    await page.locator('.pill[data-pill="0"]').click();
    if (!(await page.locator('#boardgrid').count())) await page.locator('.pill[data-pill="0"]').click();
    await page.locator('#boardgrid').waitFor();
    assert.equal(await page.locator('#boardgrid .card.idea').count(), 0, 'Saved first');
    await page.locator('#btab-ideas').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#boardgrid .card.idea').count(), 2, 'the board’s own ideas');
    const boardId = await page.evaluate(() => JSON.parse(NBNative.state()).boards[0].id);
    await page.locator('#boardgrid .card.idea').first().click();
    assert.match(await page.locator('#formsheet [data-a="ideaSave"]').innerText(), /Save to Outfits/);
    await page.locator('#formsheet [data-a="ideaSave"]').click();
    await page.waitForTimeout(300);
    assert.deepEqual((await calls()).filter((c) => c[0] === 'feedSave').pop(), ['feedSave', 'https://www.pinterest.com/pin/900006/', boardId]);
    await page.screenshot({ path: path.resolve(__dirname, '../test-output/phone-ideas-board.png') });
    await page.locator('#btab-saved').click();
    await page.waitForTimeout(400);
    assert.ok(await page.locator('#boardgrid .card:not(.idea)').count() > 0, 'Saved shows the board’s items again');

    assert.deepEqual(errors, []);
    console.log('Phone ideas passed: For you on Home, Ideas on a board, Save (to All or the board), Not for me, Open in Pinterest.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
