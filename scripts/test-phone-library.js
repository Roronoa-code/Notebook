// Phone search, Bin and mood-board cards, using the phone UI's mock bridge. No phone data is touched.
// Usage: node scripts/test-phone-library.js (requires Microsoft Edge).
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

    // Mood board: photo cards show only the picture.
    assert.equal(await page.locator('#homegrid .cap, #homegrid .capnote').count(), 0, 'no titles or notes under photos');
    assert.equal(await page.locator('#homegrid .badge').first().innerText(), '', 'video mark has no duration text');

    // A crop made on the PC arrives with a sync: the card and the open photo show only that part, in its shape.
    const cropped = await page.evaluate(() => {
      const st = JSON.parse(NBNative.state()), it = st.items.find((i) => i.kind === 'photo' && !i.deletedAt && i.w && i.h);
      it.crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.4 };
      window.nbOnState(JSON.stringify(st));
      return { id: it.id, want: (it.w * 0.5) / (it.h * 0.4) };
    });
    await page.waitForTimeout(700);
    const cardImg = page.locator(`#homegrid .card[data-v="${cropped.id}"] img`);
    assert.match(await cardImg.evaluate((i) => getComputedStyle(i).objectViewBox), /inset/, 'the card shows the crop');
    const got = await cardImg.evaluate((i) => i.getBoundingClientRect().width / i.getBoundingClientRect().height);
    assert.ok(Math.abs(got - cropped.want) < 0.03, `the card takes the cropped shape (${got.toFixed(3)} vs ${cropped.want.toFixed(3)})`);

    // Sort (as on the PC): by date taken with month headings, by name; cards glide to their new places.
    await page.locator('#homesort .sortpill').click();
    await page.locator('.sortmenu:not(.out) [data-a="sortPick"][data-v="taken"]').click();
    const glided = await page.evaluate(() => document.querySelectorAll('#homegrid .card').length && [...document.querySelectorAll('#homegrid .card')].some((c) => c.getAnimations().length));
    assert.ok(glided, 'the cards glide rather than jump');
    await page.waitForTimeout(600);
    const thisMonth = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
    assert.deepEqual(await page.locator('#homegrid .dategroup').allInnerTexts(), [thisMonth, 'JUNE 2025', 'FEBRUARY 2025'], 'no date inside: the day it was added');
    assert.equal(await page.locator('#homegrid .dategroup:nth-of-type(2) + .card').getAttribute('aria-label'), 'Open Sage cardigan fit', 'newest taken first');
    assert.match(await page.locator('#homesort').innerText(), /Date taken/);
    await page.locator('#homesort .sortpill').click();
    await page.locator('.sortmenu:not(.out) [data-a="sortPick"][data-v="name"]').click();
    await page.waitForTimeout(600);
    const names = (await page.locator('#homegrid > .card').evaluateAll((cs) => cs.map((c) => c.getAttribute('aria-label').replace(/^Open /, ''))));
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b, 'en-GB', { numeric: true, sensitivity: 'base' })), 'A to Z');
    await page.locator('#homesort .sortpill').click();
    await page.locator('.sortmenu:not(.out) [data-a="sortPick"][data-v="added"]').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#homegrid .dategroup').count(), 0);

    // In a board, scrolled down: opening a picture and closing it comes back to the same place, same cards.
    await page.locator('.pill[data-pill="0"]').click();
    if (!(await page.locator('#boardgrid').count())) await page.locator('.pill[data-pill="0"]').click();
    await page.locator('#boardgrid').waitFor();
    await page.waitForTimeout(900);
    const scr = page.locator('.screen:has(#boardgrid)');
    const down = await scr.evaluate((s) => { s.scrollTop = s.scrollHeight; return s.scrollTop; });
    assert.ok(down > 50, 'the board scrolls');
    await page.evaluate(() => document.querySelectorAll('#boardgrid .card').forEach((c) => { c.dataset.kept = '1'; }));
    await page.locator('#boardgrid .card[data-a="open"]').last().click();
    await page.locator('.media-screen, .notestage').first().waitFor();
    await page.waitForTimeout(700);
    await page.locator('.lbback, [data-a="back"]').first().click();
    await page.waitForTimeout(900);
    assert.equal(await scr.evaluate((s) => s.scrollTop), down, 'still scrolled to where it was');
    assert.equal(await page.locator('#boardgrid .card:not([data-kept])').count(), 0, 'the same cards (nothing redrawn)');
    await page.locator('[data-a="boardBack"]').click();
    await page.waitForTimeout(700);

    // Search: titles, photo notes, note text and board names.
    await page.locator('#nav-search').click();
    await page.locator('#q').waitFor();
    const results = async (q) => { await page.locator('#q').fill(q); return page.locator('#searchgrid .card').count(); };
    assert.equal(await results('plaid'), 1, 'finds by title');
    assert.equal(await results('black'), 1, 'finds by a note on a photo');
    assert.equal(await results('loafers'), 1, 'finds text inside a note');
    assert.equal(await results('icons'), 1, 'finds by board name');
    assert.equal(await results('zzzz'), 0);
    assert.match(await page.locator('#searchgrid').innerText(), /Nothing matches/);
    await results('plaid');
    await page.locator('#searchgrid .card').click();
    await page.locator('.media-screen').waitFor();

    // Move it to the Bin, then find it there and put it back.
    await page.locator('.dhead').click();
    await page.waitForTimeout(500);
    await page.locator('[data-a="bin"]').click();
    await page.waitForTimeout(700);
    await page.locator('#nav-sync').click();
    assert.match(await page.locator('#binrowcount').innerText(), /1 item/i);
    await page.locator('[data-a="openBin"]').click();
    await page.locator('#bingrid .card').waitFor();
    await page.locator('#bingrid .card').click();
    await page.locator('[data-a="restoreItem"]').click();
    assert.equal(await page.locator('#bingrid .card').count(), 0, 'put back leaves the Bin');
    assert.equal(await page.locator('#emptybin').isHidden(), true);

    // Bin two things, delete one forever (two taps), then empty the Bin (two taps).
    const binTwo = await page.evaluate(() => {
      const s = JSON.parse(NBNative.state());
      const ids = s.items.slice(0, 2).map((x) => x.id);
      ids.forEach((i) => NBNative.bin(i));
      window.nbOnState(NBNative.state());
      return ids;
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#bingrid .card').count(), 2);
    await page.locator('#bingrid .card').first().click();
    await page.locator('[data-a="deleteForever"]').click();
    assert.equal(await page.locator('#bingrid .card').count(), 2, 'first tap only asks');
    await page.locator('[data-a="deleteForever"]').click();
    assert.equal(await page.locator('#bingrid .card').count(), 1);
    await page.locator('#emptybin').click();
    await page.locator('#emptybin').click();
    assert.equal(await page.locator('#bingrid .card').count(), 0);
    const left = await page.evaluate((ids) => JSON.parse(NBNative.state()).items.filter((x) => ids.includes(x.id)).length, binTwo);
    assert.equal(left, 0, 'both are gone from the library');

    await page.locator('[data-a="binBack"]').click();
    await page.locator('#syncbody').waitFor();
    assert.deepEqual(errors, []);
    console.log('Phone library passed: mood-board cards, crops from the PC, search (title, note, note text, board), Bin put back, delete forever and empty Bin.');
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
