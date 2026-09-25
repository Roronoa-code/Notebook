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

    // Paired with a PC (the next pages of ideas come from it).
    await page.evaluate(() => { const st = JSON.parse(NBNative.state()); st.sync = { paired: true, pcName: 'Test PC', lastSync: new Date().toISOString() }; window.nbOnState(JSON.stringify(st)); });

    // For you on Home: the third tab, pins with their pictures in two steady columns.
    await page.locator('#tab-ideas').click();
    await page.locator('#homegrid .ideacols').waitFor();
    assert.ok(await page.locator('#homegrid .card.idea').count() >= 5, 'the PC’s picks for All');
    assert.equal(await page.locator('#homegrid .ideacol').count(), 2, 'two columns');
    await page.waitForFunction(() => { const i = document.querySelector('#homegrid .card.idea img'); return i && i.complete && i.naturalWidth > 0; });
    assert.ok(await page.locator('#homegrid .card.idea .badge').count() >= 1, 'a video pin is marked');
    const slid = await page.locator('#homeseg').evaluate((s) => getComputedStyle(s, '::before').transform);
    assert.notEqual(slid, 'none', 'the tab highlight slides to For you');

    // Only five pins, so there's no end to scroll to: the next page is asked for straight away, and keeps
    // coming while the end is near. New pins join the bottom; the ones already there don't move.
    await page.waitForFunction(() => window.NB_MOCK_CALLS.some((c) => c[0] === 'feedMore' && c[1] === 'all'));
    await page.waitForFunction(() => document.querySelectorAll('#homegrid .card.idea').length >= 17);
    const place = () => page.evaluate(() => [...document.querySelectorAll('#homegrid .card.idea')].map((c) => { c.dataset.kept = '1'; const r = c.getBoundingClientRect(); return c.dataset.v + '@' + Math.round(r.left) + ',' + Math.round(r.top); }).sort());
    const lift = page.locator('#lift');
    const before = await place();
    const asked = (await calls()).filter((c) => c[0] === 'feedMore').length;
    await lift.evaluate((l) => { l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction((n) => window.NB_MOCK_CALLS.filter((c) => c[0] === 'feedMore').length > n, asked);
    await page.waitForTimeout(500);
    await lift.evaluate((l) => { l.scrollTop = 0; });
    await page.waitForTimeout(300);
    const added = await page.locator('#homegrid .card.idea:not([data-kept])').count();
    const after = await place();
    assert.deepEqual(after.filter((x) => before.some((b) => b.split('@')[0] === x.split('@')[0])), before, 'cards already there stay put');
    assert.ok(added > 0, 'new ones added below');
    const n = await page.locator('#homegrid .card.idea').count();
    await lift.evaluate((l) => { l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#homegrid .card.idea').count(), n, 'nothing more once the PC has no more');

    // Tap a pin: Save to your notebook.
    const pinCard = (id) => page.locator(`#homegrid .card.idea[data-v="${id}"]`);
    await lift.evaluate((l) => { l.scrollTop = 0; });
    await pinCard('900001').click();
    await page.locator('#formsheet [data-a="ideaSave"]').waitFor();
    assert.match(await page.locator('#formsheet [data-a="ideaSave"]').innerText(), /Save to your notebook/);
    await page.locator('#formsheet [data-a="ideaSave"]').click();
    await page.waitForTimeout(400);
    assert.deepEqual((await calls()).find((c) => c[0] === 'feedSave'), ['feedSave', 'https://www.pinterest.com/pin/900001/', '']);
    assert.equal(await page.locator('#homegrid .card.idea.saved').count(), 1, 'the pin shows as saved');
    assert.ok(await page.locator('#formsheet').isHidden(), 'the sheet closes');

    // Not for me: it goes; Open in Pinterest hands the link to the app.
    await pinCard('900002').click();
    await page.locator('#formsheet [data-a="ideaHide"]').click();
    await page.waitForTimeout(500);
    assert.equal(await pinCard('900002').count(), 0);
    assert.ok((await calls()).some((c) => c[0] === 'feedHide' && c[1] === '900002'));
    await pinCard('900003').click();
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
    console.log('Phone ideas passed: For you on Home (two steady columns, next pages before the end), Ideas on a board, Save (to All or the board), Not for me, Open in Pinterest.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
