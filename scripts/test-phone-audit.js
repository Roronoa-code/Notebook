// The UI/motion audit's acceptance checks (Notebook-UI-Motion-Audit-7671), on the mock bridge in headless Edge.
// No phone, no library, no real mouse or keyboard. Usage: node scripts/test-phone-audit.js
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const passed = [];
  const ok = (name) => passed.push(name);
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    // A phone-like status bar and gesture area, as MainActivity sets them.
    await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
    await page.evaluate(() => { document.documentElement.style.setProperty('--st', '28px'); document.documentElement.style.setProperty('--sb', '16px'); });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const tap = async (x, y) => { await touch('touchStart', x, y); await page.waitForTimeout(40); await touch('touchEnd'); };
    const home = async () => { await page.evaluate(() => { while (nbBack()) { /* Home */ } }); await page.waitForTimeout(700); };
    // Records a value every animation frame for `ms`.
    const frames = (fnSrc, ms) => page.evaluate(([src, ms]) => new Promise((res) => { const f = new Function('return (' + src + ')()'); const out = []; const t0 = performance.now(); const step = () => { out.push(f()); if (performance.now() - t0 < ms) requestAnimationFrame(step); else res(out); }; requestAnimationFrame(step); }), [fnSrc, ms]);

    // C01: the first saved content starts well up the screen, and the masthead stays bold.
    // (on the recording's phone: 1080 × 2340 pixels, about 411 × 891 here)
    await page.setViewportSize({ width: 411, height: 891 }); await page.waitForTimeout(300);
    const firstRow = await page.locator('#homegrid .card').first().evaluate((e) => e.getBoundingClientRect().top / innerHeight);
    assert.ok(firstRow <= 0.6, `first content row at ${(firstRow * 100).toFixed(0)}% (was ~71%, target 55–60%)`);
    assert.ok(await page.locator('.pile-stack').first().evaluate((e) => e.getBoundingClientRect().height >= 120), 'board covers keep their full space');
    assert.equal(await page.locator('#tabsbar').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', 'no solid band between boards and tabs');
    await page.locator('#homescroll').evaluate((e) => { e.scrollTop = 700; }); await page.waitForTimeout(150);
    assert.equal(await page.locator('#tabsbar.stuck').count(), 1);
    assert.notEqual(await page.locator('#tabsbar').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', 'sticky tabs keep a solid backing');
    await page.locator('#homescroll').evaluate((e) => { e.scrollTop = 0; }); await page.waitForTimeout(150);
    await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(300);
    assert.match(await page.locator('.countbox').innerText(), /\d+\.\s*SAVED/i, 'the count says what it counts');
    assert.match(await page.locator('#pulse').innerText(), /Not paired|Sample|Synced/);
    ok('C01 home proportions and a self-explaining count');

    // C02: long names get the same two-line space; every name block is the same height; New board says so.
    const names = await page.locator('.pile .nm').evaluateAll((els) => els.map((e) => [e.textContent, e.getBoundingClientRect().height, e.scrollHeight > e.clientHeight + 1]));
    assert.equal(new Set(names.map((n) => Math.round(n[1]))).size, 1, `every board name has the same height (${JSON.stringify(names)})`);
    assert.equal(await page.locator('.pile.new .nm').innerText(), 'CREATE BOARD');
    ok('C02 board covers: one name height, clear Create board');

    // Cancel twice during the reveal: a queued focus must not bring back the keyboard or a panel fragment.
    for (let i = 0; i < 2; i++) {
      await page.locator('.pile.new').click();
      const top = await page.locator('#homescroll').evaluate((e) => e.scrollTop);
      await page.locator('#formsheet [data-a="closeForm"]').evaluate((e) => e.click());
      await page.waitForTimeout(550);
      assert.equal(await page.locator('#formsheet').isVisible(), false);
      assert.equal(await page.locator('#popscrim').isVisible(), false);
      assert.equal(await page.locator('#orb').isVisible(), true);
      assert.equal(await page.locator('#orb svg').count(), 1, 'the returned action has its plus icon');
      assert.equal(await page.locator('#homescroll').evaluate((e) => e.scrollTop), top);
      assert.notEqual(await page.locator('#f1').evaluate((e) => document.activeElement === e), true, 'cancelled form cannot focus later');
    }
    await page.locator('#homescroll').evaluate((e) => { e.scrollTop = 0; e.querySelector('#rail').scrollLeft = 0; });
    ok('New Board quick cancel and repeat keep the keyboard, form, orb and scroll in one lifecycle');

    // F04 + F03: open a later board, come back: same rail position and source cover; the board grows out of
    // the tapped cover with its content visible all the way (no empty box), and the cover is back at the end.
    await page.locator('#rail').evaluate((r) => { r.scrollLeft = 300; });
    await page.waitForTimeout(300);
    const railBefore = await page.locator('#rail').evaluate((r) => r.scrollLeft);
    const pick = await page.locator('.pile[data-v]').evaluateAll((els) => { const i = els.findIndex((e) => { const r = e.getBoundingClientRect(); return r.left > 40 && r.right < 330; }); return i; });
    const pile = page.locator('.pile[data-v]').nth(pick);
    const pileRect = await pile.locator('.pile-stack').evaluate((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width]; });
    const name = (await pile.locator('.nm').innerText()).trim();
    for (let round = 0; round < 2; round++) {
      const watch = frames(`() => { const b = [...document.querySelectorAll('#stage > .screen')].find((s) => s.querySelector('#boardname')); if (!b) return null; const t = b.querySelector('#boardname'), tr = t.getBoundingClientRect(), c = b.style.clipPath, m = /inset\\(([-\\d.]+)px ([-\\d.]+)px ([-\\d.]+)px ([-\\d.]+)px/.exec(c || ''); const box = m ? { l: +m[4], t: +m[1], r: innerWidth - +m[2], b: innerHeight - +m[3] } : { l: 0, t: 0, r: innerWidth, b: innerHeight }; const inside = tr.left >= box.l - 1 && tr.right <= box.r + 1 && tr.top >= box.t - 1 && tr.bottom <= box.b + 1; let seen = 1; for (let e = t; e && e !== b.parentNode; e = e.parentElement) seen *= +getComputedStyle(e).opacity; return { title: seen, inside, screen: +getComputedStyle(b).opacity, ghost: !!document.querySelector('.coverghost') }; }`, 520);
      await pile.click();
      const seen = (await watch).filter(Boolean);
      assert.ok(seen.length > 5 && seen.every((s) => s.screen > 0.99), 'the board page is one opaque surface all the way');
      assert.ok(seen.every((s) => s.inside || s.title < 0.02), 'its title only shows once the surface holds all of it (no cut-off letters)');
      assert.ok(seen[0].ghost, 'the tapped cover is drawn on top as it opens');
      assert.ok(seen.at(-1).title > 0.99 && !seen.at(-1).ghost, 'and hands over to the complete page');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#boardname').innerText(), name);
      await page.locator('[data-a="boardBack"]').click();
      await page.waitForTimeout(700);
      assert.equal(await page.locator('#rail').evaluate((r) => r.scrollLeft), railBefore, 'Back keeps the board rail where it was');
      const back = await pile.locator('.pile-stack').evaluate((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, getComputedStyle(e).visibility]; });
      assert.ok(Math.abs(back[0] - pileRect[0]) < 1 && Math.abs(back[1] - pileRect[1]) < 1, 'the same cover in the same place');
      assert.equal(back[3], 'visible', 'the source cover is not left blacked out');
      assert.equal(await page.locator('.route-ghost').count(), 0);
    }
    ok('F03/F04 board opens from its cover with content present; Back restores rail and cover (twice)');

    // F03 note: the note grows out of its card with its title visible, not an empty dark wrapper.
    await page.locator('#tab-notes').click();
    await page.waitForTimeout(500);
    const noteWatch = frames(`() => { const n = document.querySelector('#stage > .note-screen'); if (!n) return null; const h = n.querySelector('#editor h2, #editor'); const r = h.getBoundingClientRect(); return { o: +getComputedStyle(n).opacity, w: r.width, top: r.top }; }`, 450);
    await page.locator('#homegrid .card[data-a="open"]').first().click();
    const noteFrames = (await noteWatch).filter(Boolean);
    assert.ok(noteFrames.length > 5 && noteFrames.every((f) => f.o > 0.99), 'the note is drawn from the first frame');
    assert.ok(Math.abs(noteFrames[0].top - noteFrames[noteFrames.length - 1].top) > 20, 'the full-width note still opens from its card');
    await page.waitForTimeout(300);
    await page.evaluate(() => nbBack());
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#stage > .note-screen').count(), 0, 'closing folds it back and removes it');
    await page.locator('#tab-recent').click();
    await page.waitForTimeout(500);
    ok('F03 note continuity');

    // F08 / C08: a slow first load shows exactly one status, in the results area; a refresh keeps the results
    // and shows progress on its own button. The status is not a button.
    await page.evaluate(() => { const real = NBNative.feedRefresh.bind(NBNative), reload = NBNative.feedReload.bind(NBNative); window.__slow = []; NBNative.feedRefresh = (k) => window.__slow.push(() => real(k)); NBNative.feedReload = (k) => window.__slow.push(() => reload(k)); });
    const board = page.locator('.pile[data-v]').nth(pick);
    await board.click(); await page.waitForTimeout(600);
    await page.locator('#btab-ideas').click(); await page.waitForTimeout(600);
    const loading = await page.evaluate(() => ({ signals: [...document.querySelectorAll('#boardgrid *')].filter((e) => e.childElementCount === 0 && /Finding ideas/.test(e.textContent)).map((e) => e.tagName), scope: document.querySelector('#boardgrid .ideas-tools .lbl'), label: document.querySelector('#boardgrid .idea-query').getAttribute('aria-label') }));
    assert.deepEqual(loading.signals, ['P'], `one loading signal, not a button (${loading.signals})`);
    assert.equal(loading.scope, null, 'no repeated "Ideas for" line: the title and the tab already say it');
    assert.match(loading.label, /Search Pinterest ideas for /, 'the field still names its scope for a screen reader');
    await page.evaluate(() => { window.__slow.splice(0).forEach((f) => f()); });
    await page.waitForTimeout(400);
    await page.locator('#boardgrid [data-a="ideasNow"]').click();
    await page.waitForTimeout(100);
    // A1: the refresh is the small round button on the search line; while it works it turns (and is the only signal).
    const refreshing = await page.evaluate(() => ({ texts: [...document.querySelectorAll('#boardgrid *')].filter((e) => e.childElementCount === 0 && /Finding (new )?ideas/.test(e.textContent)).length, turning: document.querySelectorAll('#boardgrid .ideas-refresh.turning').length, label: document.querySelector('#boardgrid .ideas-refresh').getAttribute('aria-label'), oneLine: (() => { const l = document.querySelector('#boardgrid .ideas-line'); const a = l.querySelector('.ideas-search').getBoundingClientRect(), b = l.querySelector('.ideas-refresh').getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 2 && !l.querySelector('button[type="submit"]'); })(), cards: document.querySelectorAll('#boardgrid .card.idea').length, disabled: document.querySelector('#boardgrid [data-a="ideasNow"]').disabled }));
    assert.equal(refreshing.texts, 1, 'refreshing: one visible pending message');
    assert.equal(refreshing.turning, 1, 'refreshing: the refresh button turns');
    assert.equal(refreshing.label, 'Finding new ideas');
    assert.ok(refreshing.oneLine, 'search field and refresh share one line, with no separate Search button');
    assert.ok(refreshing.cards > 0, 'the results stay while refreshing');
    assert.equal(refreshing.disabled, true, 'the busy action is not pressable again');
    const oldCards = await page.locator('#boardgrid .card.idea').evaluateAll((els) => els.map((e) => e.dataset.v));
    await page.evaluate(() => {
      window.__decodePending = []; window.__decodeOriginal = Image.prototype.decode;
      Image.prototype.decode = function () { return new Promise((resolve) => window.__decodePending.push(resolve)); };
      window.__slow.splice(0).forEach((f) => f());
    });
    await page.waitForTimeout(150);
    assert.deepEqual(await page.locator('#boardgrid .card.idea').evaluateAll((els) => els.map((e) => e.dataset.v)), oldCards, 'visible results wait for their replacement previews');
    assert.equal(await page.locator('#boardgrid .ideas-refresh').isDisabled(), true, 'refresh stays pending while previews prepare');
    await page.evaluate(() => { Image.prototype.decode = window.__decodeOriginal; window.__decodePending.splice(0).forEach((resolve) => resolve()); });
    await page.waitForTimeout(300);
    ok('F08/C08 one request, clear pending message; results kept while refreshing');
    await home();

    // C07: the sort control says the order in use; the menu opens from it, inside the screen.
    assert.equal((await page.locator('#homesort .sortpill').innerText()).trim(), 'Newest');
    await page.locator('#homesort .sortpill').click();
    await page.waitForTimeout(600);
    const menu = await page.locator('.sortmenu').evaluate((m) => { const r = m.getBoundingClientRect(); return [r.top, r.bottom, r.left, r.right]; });
    assert.ok(menu[0] >= 0 && menu[1] <= 780 && menu[2] >= 0 && menu[3] <= 360, 'the menu is inside the screen');
    await page.locator('.sortmenu [data-v="name"]').click();
    await page.waitForTimeout(600);
    assert.equal((await page.locator('#homesort .sortpill').innerText()).trim(), 'A–Z', 'the chosen order stays visible after closing');
    await page.locator('#homesort .sortpill').click(); await page.waitForTimeout(500);
    await page.locator('.sortmenu [data-v="added"]').click(); await page.waitForTimeout(600);
    ok('C07 sort value visible');

    // Search's surface grows from the header control before its contents appear: no sliced words or
    // double exposure with Home.
    const openWatch = frames(`() => { const s = [...document.querySelectorAll('#stage > .screen')].find((x) => x.querySelector('#q')); if (!s) return null; const c = s.style.clipPath; return { r: c && c.startsWith('circle(') ? parseFloat(c.slice(7)) : 9999, content: +getComputedStyle(s.querySelector('.utiltop')).opacity, home: +getComputedStyle(document.querySelector('#homescroll')).opacity }; }`, 650);
    await page.locator('#searchbtn').click();
    const rs = (await openWatch).filter(Boolean);
    assert.ok(rs.length > 8 && rs[0].r < 60 && rs.some((f) => f.r > 600), 'the surface grows from the button');
    assert.ok(rs.every((f) => f.r >= 600 || f.content < .01), 'words remain hidden while the moving edge crosses them');
    assert.ok(rs.every((f) => f.r === 9999 || f.r < 150 || f.home < .01), 'Home clears before the moving edge crosses its words');
    assert.ok(rs.at(-1).r === 9999 && rs.at(-1).content > .99, 'the complete page is visible when settled');
    // C1: no big title; the field is in the top line; quick picks before typing; a count and pictures for a colour.
    assert.equal(await page.locator('.screen.util .poster:visible').count(), 0, 'no big title');
    const top = await page.evaluate(() => { const b = document.querySelector('.utiltop [aria-label="Back"]').getBoundingClientRect(), f = document.querySelector('.topsearch').getBoundingClientRect(); return Math.abs((b.top + b.bottom) / 2 - (f.top + f.bottom) / 2) < 2; });
    assert.ok(top, 'Back and the search field share the top line');
    await page.evaluate(() => { const db = JSON.parse(NBNative.state()); db.items.filter((i) => i.kind === 'photo').slice(0, 3).forEach((i) => { i.ai = { colours: [{ name: 'black', share: 0.8 }] }; }); db.items.find((i) => i.kind === 'video').ai = { colours: [{ name: 'denim', share: 0.6 }] }; nbOnState(JSON.stringify(db)); });
    await page.waitForTimeout(200);
    assert.ok(await page.locator('.quickpicks [data-a="searchFor"]').count() >= 2, 'quick picks from your colours and boards');
    await page.locator('.quickpicks [data-v="black"]').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#q').inputValue(), 'black');
    assert.match(await page.locator('.searchcount').innerText(), /^3 things$/, 'black finds the black pictures');
    await page.locator('#q').fill('blue');
    await page.waitForTimeout(150);
    assert.match(await page.locator('.searchcount').innerText(), /^1 thing$/, 'denim counts as blue');
    await page.locator('#q').fill('zzzz-nothing');
    await page.waitForTimeout(150);
    assert.equal((await page.locator('#searchgrid').innerText()).trim(), 'Nothing matches “zzzz-nothing”.', 'no results is one quiet line');
    await page.locator('#q').fill('');
    await page.locator('#q').blur();
    // Back: tap Search again part way and it reopens from the size currently on screen (no jump).
    await page.locator('.utiltop [aria-label="Back"]').click();
    await page.waitForTimeout(120);
    const [mid, after] = await page.evaluate(() => {
      const radius = () => { const s = [...document.querySelectorAll('#stage > .screen')].find((x) => x.querySelector('#q')); const c = s?.style.clipPath; return s ? (c?.startsWith('circle(') ? parseFloat(c.slice(7)) : 9999) : -1; };
      const before = radius(); document.querySelector('#searchbtn').click(); return [before, radius()];
    });
    await page.waitForTimeout(800);
    assert.ok(mid > 0 && mid < 9999, `closing is in progress (${mid})`);
    assert.ok(Math.abs(after - mid) < 30, `reopening part way carries on from that size (${mid} → ${after})`);
    await page.locator('.utiltop [aria-label="Back"]').click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#searchbtn').evaluate((e) => getComputedStyle(e).visibility), 'visible', 'the button is back in place');
    assert.equal(await page.locator('.route-ghost').count(), 0);
    ok('B1/C1 Search: unsliced surface from header, reversible, bar at top, quick picks, colour search, quiet no-results');

    // C10: Sync shows a sample banner (when sampling), one primary action per panel, no underlined links.
    await page.locator('#pulse').click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.linkbtn').count(), 0, 'no low-contrast underlined links');
    const galleryButtons = await page.locator('#gallery-session .btn').count();
    assert.ok(galleryButtons <= 1, 'Gallery cleanup shows at most one action for its state');
    assert.equal(await page.locator('#gallery-session [data-a="galleryStop"]').count(), 0, 'no Stop while nothing is running');
    ok('C10 Sync state and actions');

    // F11: nothing the app draws covers the system status area: a solid strip the height of the status bar sits
    // above every screen (it lets touches through, so it is checked by its box, colour and stacking).
    const covered = () => { const s = document.querySelector('.statusscrim'), r = s.getBoundingClientRect(), c = getComputedStyle(s); const stage = document.querySelector('#stage'); return r.top === 0 && r.height === 28 && r.width === innerWidth && c.backgroundColor === 'rgb(11, 11, 11)' && +c.zIndex > 6 && getComputedStyle(stage).zIndex === 'auto' && !!(stage.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); };
    await page.locator('#stage > .screen:visible').evaluate((s) => { s.scrollTop = 200; });
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(covered), 'scrolled Sync text passes under a solid status strip');
    await home();
    await page.locator('#homescroll').evaluate((s) => { s.scrollTop = 160; });
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(covered), 'and so do Home’s headings');
    await page.locator('#homescroll').evaluate((s) => { s.scrollTop = 0; });
    await page.waitForTimeout(200);
    ok('F11 status area kept clear');

    // F10 / C11: a video that can't play: its message sits inside the picture at every sheet position, and the
    // play/sound controls are gone until it can play.
    const video = page.locator('#homegrid .card[data-a="open"]:has(.badge)').first();
    await video.click();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('.vbox.failed').count(), 1, 'the failed state is shown');
    assert.equal(await page.locator('.vbox .vsound').isVisible(), false, 'no sound control on a video that cannot play');
    assert.equal(await page.locator('.vbox .vpaused').isVisible(), false, 'no play button either');
    const head = await page.locator('.dhead').boundingBox();
    await touch('touchStart', head.x + 60, head.y + 20);
    const inside = [];
    for (let i = 1; i <= 14; i++) {
      await touch('touchMove', head.x + 60, head.y + 20 - i * 30);
      inside.push(await page.evaluate(() => { const b = document.querySelector('.vbox').getBoundingClientRect(), m = document.querySelector('.media-message').getBoundingClientRect(); return m.left >= b.left - 0.5 && m.right <= b.right + 0.5 && m.bottom <= b.bottom + 0.5 && m.width > 0; }));
    }
    await touch('touchEnd');
    await page.waitForTimeout(600);
    assert.ok(inside.every(Boolean), `the message stays inside the shrinking picture (${inside})`);
    ok('F10/C11 video failure state contained');

    // F14: the Bin button takes a tap anywhere on it (centre, every edge), right after a sheet drag and after it
    // settles, once per tap. F13: the message names what was binned, sits clear of navigation, and Undo puts back
    // exactly that item, with its boards.
    const trash = async () => page.locator('.media-actions [data-a="bin"]').boundingBox();
    const state = () => page.evaluate(() => JSON.parse(NBNative.state()).items.map((i) => [i.id, !!i.deletedAt, (i.boards || []).join()]));
    const offsets = [[0, 0], [0, 21], [0, -21], [21, 0], [-21, 0], [0, 27], [27, 0]]; // edges of the 48px circle, and just past it
    for (const [dx, dy] of offsets) {
      if (!(await page.locator('.media-screen').count())) { await page.locator('#homegrid .card[data-a="open"]').first().click(); await page.waitForTimeout(900); }
      if (!(await page.locator('.sheet.open').count())) { await page.locator('.dhead').click(); await page.waitForTimeout(700); }
      const before = await state();
      const b = await trash();
      await tap(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
      await page.waitForTimeout(900);
      const after = await state();
      assert.equal(await page.locator('.media-screen').count(), 0, 'the same tap does not then open the card under the Bin button');
      assert.equal(await page.locator('.toast.orbtoast').count(), 1, 'the message is the orb, stretched (one surface, not a pop-up beside it)');
      assert.equal(await page.locator('#orb').isVisible(), false, 'never two of it on screen');
      const binned = after.filter((x, i) => x[1] && !before[i][1]);
      assert.equal(binned.length, 1, `a tap at (${dx}, ${dy}) from the centre bins exactly one item`);
      const title = await page.evaluate((id) => JSON.parse(NBNative.state()).items.find((i) => i.id === id).title, binned[0][0]);
      const msg = await page.locator('.toast span').innerText();
      assert.ok(msg.includes(title.slice(0, 12)), `the message names it (${msg})`);
      const t = await page.locator('.toast').boundingBox();
      const zones = await page.evaluate(() => ['#tabsbar', '#mast', '.utiltop', '.bhead', '#orb', '.statusscrim'].flatMap((sel) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility({ visibilityProperty: true })).map((e) => { const q = e.getBoundingClientRect(); return { sel, x: q.left, y: q.top, w: q.width, h: q.height }; })));
      for (const r of zones) assert.ok(t.x + t.width <= r.x || r.x + r.w <= t.x || t.y + t.height <= r.y || r.y + r.h <= t.y, `the message stays clear of ${r.sel}`);
      await page.locator('.toast [data-a="undo"]').click();
      await page.waitForTimeout(400);
      assert.deepEqual(await state(), before, 'Undo restores exactly that item and its boards');
    }
    await page.waitForTimeout(3200);
    assert.equal(await page.locator('.toast').count(), 0, 'the message folds away');
    assert.equal(await page.locator('#orb').isVisible(), true, 'back into the orb');
    ok('F13/F14 Bin taps at centre and edges; named, clear, correct Undo; the orb becomes the message and folds back');

    // F12: binning from an open picture: the picture drops away on top (not cut by the grid appearing over it),
    // the count changes once, and no survivor flies across columns.
    await home();
    await page.locator('#homegrid .card[data-a="open"]:not(:has(.notecard))').nth(1).click(); // (pictures only: the page order is column by column)
    await page.waitForTimeout(900);
    await page.locator('.dhead').click(); await page.waitForTimeout(700);
    const fall = frames(`() => { const m = document.querySelector('#stage > .media-screen'); const counts = document.querySelector('#count').textContent; if (!m) return { gone: true, counts }; const last = document.querySelector('#stage').lastElementChild === m; const img = m.querySelector('.stage img, .stage .vbox'); return { last, o: +getComputedStyle(img).opacity, counts, flying: [...document.querySelectorAll('#homegrid > .card')].some((c) => c.getAnimations().some((a) => { const k = a.effect.getKeyframes()[0]; const mm = /translate\\((-?[\\d.]+)px/.exec(k.transform || ''); return mm && Math.abs(+mm[1]) > 60; })) }; }`, 900);
    await page.locator('.media-actions [data-a="bin"]').click();
    const fr = await fall;
    const during = fr.filter((f) => !f.gone);
    assert.ok(during.length > 5 && during.every((f) => f.last), 'the binned picture stays on top while it drops away');
    assert.ok(!fr.some((f) => f.flying), 'no card flies across columns');
    const countsSeen = [...new Set(fr.map((f) => f.counts))];
    assert.ok(countsSeen.length <= 7 && Number.parseInt(countsSeen.at(-1), 10) === Number.parseInt(countsSeen[0], 10) - 1, `the count moves once, down by one (${countsSeen})`);
    await page.locator('.toast [data-a="undo"]').click();
    await page.waitForTimeout(500);
    ok('F12 one coherent removal');

    // Pinned boards: hold a board for its options, pin it, and it moves to the front (phone-only setting).
    await home();
    await page.locator('#homescroll').evaluate((e) => { e.scrollTop = 0; });
    const lastPile = page.locator('.pile[data-v]').last();
    const lastId = await lastPile.getAttribute('data-v');
    await lastPile.scrollIntoViewIfNeeded();
    const lp = await lastPile.boundingBox();
    await page.locator('#orb').waitFor({ state: 'visible', timeout: 8000 }); await page.waitForTimeout(450); // (a message still showing is the orb)
    const plusRect = await page.locator('#orb').boundingBox();
    const jumps = (fr) => { let worst = 0; for (let i = 1; i < fr.length; i++) { const a = fr[i - 1].cur, b = fr[i].cur; if (a && b && fr[i - 1].out && fr[i].out) worst = Math.max(worst, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)); } return worst; };
    const boardHoldFrames = frames(`() => { const f = document.querySelector('#formsheet'), s = NBSurface.state(), c = f.querySelector('#f1'); return { riding: f.classList.contains('riding'), out: s.out, cur: s.cur, content: c ? +getComputedStyle(c).opacity : 0, drawn: f.getBoundingClientRect().toJSON(), bar: { width: f.offsetWidth, height: f.offsetHeight } }; }`, 1400);
    await touch('touchStart', lp.x + 40, lp.y + 50); await page.waitForTimeout(700); await touch('touchEnd');
    const held = await boardHoldFrames;
    assert.ok(held.some((f) => f.riding && f.out), 'the board options grow out of the +, as the bottom area\'s one surface (like picking)');
    const firstOut = held.find((f) => f.out && f.cur);
    assert.ok(Math.abs(firstOut.cur.x - plusRect.x) < 14 && Math.abs(firstOut.cur.y - plusRect.y) < 14, `from the plus itself (${JSON.stringify(firstOut.cur)})`);
    // (drawn whole and scaled to fit the surface: readable once they show, and never outside it)
    assert.ok(held.every((f) => !f.riding || f.content < 0.5 || (f.drawn.width >= f.bar.width * 0.6 && f.drawn.left >= f.cur.x - 1.5 && f.drawn.right <= f.cur.x + f.cur.w + 1.5 && f.drawn.top >= f.cur.y - 1.5 && f.drawn.bottom <= f.cur.y + f.cur.h + 1.5)), 'its controls appear only once the surface has room for them');
    assert.ok(held.every((f) => !f.out || f.cur.f < 0.2 || f.cur.w < 90), 'the purple is gone before it has grown: never a purple slab');
    assert.ok(jumps(held) < 40, `the shape never jumps between frames (worst ${Math.round(jumps(held))}px)`);
    assert.equal(await page.locator('#formsheet.boardbar #f1').isVisible(), true, 'the completed board editor shows its controls');
    const bar = await page.locator('#formsheet').evaluate((f) => { const r = f.getBoundingClientRect(); return { w: r.width, h: r.height, right: innerWidth - r.right }; });
    assert.ok(bar.w <= 280 && bar.h <= 130 && Math.abs(bar.right - 18) < 2, `a compact bar at the orb, like the picking bar (${JSON.stringify(bar)})`);
    const heldPose = await page.locator('.rail').first().getAttribute('style');
    await page.evaluate(() => { nbGaze(0, 0); nbGaze(35, 25); });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.rail').first().getAttribute('style'), heldPose, 'board tilt stays frozen underneath the glass');
    assert.equal(await page.locator('#formsheet [data-a="pinBoard"]').count(), 1, 'holding a board opens its options');
    await page.locator('#formsheet [data-a="pinBoard"]').click();
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.pile[data-v]').first().getAttribute('data-v'), lastId, 'the pinned board is first');
    assert.equal(await page.locator('.pile.pinned').count(), 1);
    await page.evaluate(() => nbBack()); await page.waitForTimeout(600);
    await page.locator('.pile[data-v]').first().scrollIntoViewIfNeeded(); await page.waitForTimeout(120);
    const fastPile = await page.locator('.pile[data-v]').first().boundingBox();
    await touch('touchStart', fastPile.x + 40, fastPile.y + 50); await page.waitForTimeout(500); await touch('touchEnd');
    const beforeReverse = await page.evaluate(() => NBSurface.state());
    assert.ok(beforeReverse.moving && beforeReverse.cur.w > 62 && beforeReverse.to.w > 100, 'the board options are still opening');
    await page.evaluate(() => nbBack());
    const reversed = await page.evaluate(() => ({ ...NBSurface.state(), inert: document.querySelector('#formsheet').inert }));
    assert.ok(Math.abs(reversed.cur.w - beforeReverse.cur.w) < 30 && reversed.to.w === 60 && reversed.speed > 0 && reversed.inert, 'closing carries on from where it is, at its speed, back into the + (and it can no longer be tapped)');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#formsheet').isVisible(), false);
    assert.equal(await page.locator('#orb svg').count(), 1);
    ok('pinned boards; board options out of the + and a mid-opening reversal back into it');

    // Deleting a board: tap the bin (it turns red), tap again: the bar itself shrinks into the "Deleted" pill (no
    // separate pop-up), which later folds into the orb. Undo makes the board again with the same items.
    {
      await page.locator('#homescroll').evaluate((e) => { e.scrollTop = 0; }); await page.waitForTimeout(200);
      const pile = page.locator('.pile[data-v]').nth(1);
      const name = (await pile.locator('.nm').innerText()).toLowerCase();
      const boardsBefore = await page.evaluate(() => JSON.parse(NBNative.state()).boards.length);
      const itemsOn = async (nm) => page.evaluate((n) => { const st = JSON.parse(NBNative.state()); const b = st.boards.find((x) => x.name.toLowerCase() === n); return b ? st.items.filter((i) => !i.deletedAt && (i.boards || []).includes(b.id)).length : -1; }, nm);
      const had = await itemsOn(name);
      const pb = await pile.boundingBox();
      await touch('touchStart', pb.x + 40, pb.y + 50); await page.waitForTimeout(700); await touch('touchEnd');
      await page.waitForTimeout(700);
      await page.locator('#formsheet [data-a="deleteBoard"]').click();
      assert.equal(await page.locator('#formsheet [data-a="deleteBoard"].sure[data-beam="nb-confirm"][data-active]').count(), 1, 'the first tap asks: the Border Beam pulse breathes inside it');
      const chain = frames(`() => { const f = document.querySelector('#formsheet'), t = document.querySelector('.toast'), s = NBSurface.state(); return { out: s.out, cur: s.cur, bar: !f.hidden && !f.classList.contains('riding'), pill: !!t && getComputedStyle(t).visibility === 'visible' && !t.classList.contains('riding'), orb: getComputedStyle(document.querySelector('#orb')).visibility === 'visible' && !document.querySelector('#orb').hidden }; }`, 900);
      await page.locator('#formsheet [data-a="deleteBoard"]').click();
      const fr = await chain;
      assert.ok(fr.every((f) => !(f.bar && f.pill)), 'never the bar and the pill at once: one becomes the other');
      assert.ok(fr.every((f) => !(f.pill && f.orb)), 'nor the pill and the orb');
      assert.ok(fr.some((f) => f.pill) && fr.findIndex((f) => f.pill) >= fr.findIndex((f) => !f.bar), 'the pill takes over as the bar lands');
      assert.ok(jumps(fr) < 40, `bar to pill is one continuous shape (worst ${Math.round(jumps(fr))}px in a frame)`);
      assert.ok(await page.locator('.toast.orbtoast .words > span').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'the pill makes room for its whole message');
      assert.match(await page.locator('.toast.orbtoast').innerText(), /Deleted/);
      assert.equal(await page.evaluate(() => JSON.parse(NBNative.state()).boards.length), boardsBefore - 1, 'the board is gone');
      await page.locator('.toast [data-a="undo"]').click();
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => JSON.parse(NBNative.state()).boards.length), boardsBefore, 'Undo makes it again');
      assert.equal(await itemsOn(name), had, 'with the same items');
      await page.waitForTimeout(3300);
      assert.equal(await page.locator('.toast').count(), 0, 'the message folds away');
      assert.equal(await page.locator('#orb').isVisible(), true, 'into the orb');
    }
    ok('deleting a board: bar into pill into orb, with Undo');

    // Hold to pick, then Bin: everything picked goes to the Bin together; one Undo puts it all back.
    const cardsBefore = await page.locator('#homegrid > .card').count();
    const c1 = await page.locator('#homegrid > .card').nth(0).boundingBox();
    await touch('touchStart', c1.x + 40, c1.y + 40); await page.waitForTimeout(620); await touch('touchEnd'); await page.waitForTimeout(40); // picked while held
    const picking = await page.evaluate(() => NBSurface.state());
    assert.ok(picking.moving && picking.to.w > 100, 'the picking bar is still opening');
    await page.evaluate(() => nbBack());
    const unpicking = await page.evaluate(() => NBSurface.state());
    assert.ok(Math.abs(unpicking.cur.w - picking.cur.w) < 30 && unpicking.to.w === 60 && unpicking.speed > 0, 'leaving picking carries on from where it is, at its speed');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#selbar').isVisible(), false);
    const settle = await page.evaluate(async () => {
      const times = [], o = NBSurface.orb(), b = { x: 100, y: 600, w: 272, h: 120, r: 28, f: 0 };
      for (const [from, to] of [[o, b], [b, o]]) {
        const start = performance.now();
        await new Promise((done) => NBSurface.glide(to, { from, done }));
        times.push(performance.now() - start);
        NBSurface.rest();
      }
      return times;
    });
    assert.ok(settle.every((t) => t > 220 && t < 700), `the surface glides (not a snap) and settles in both directions (${settle.map(Math.round)}ms)`);
    await touch('touchStart', c1.x + 40, c1.y + 40); await page.waitForTimeout(650); await touch('touchEnd'); await page.waitForTimeout(400);
    await page.locator('#homegrid > .card').nth(1).click(); await page.waitForTimeout(200);
    await page.locator('#selbin').click(); await page.waitForTimeout(700);
    assert.match(await page.locator('.toast span').innerText(), /^2 things moved to Bin$/);
    assert.equal(await page.locator('#homegrid > .card').count(), cardsBefore - 2);
    await page.locator('.toast [data-a="undo"]').click(); await page.waitForTimeout(700);
    assert.equal(await page.locator('#homegrid > .card').count(), cardsBefore, 'Undo puts both back');
    ok('hold to Bin with one Undo');

    // Holding a card and moving it down onto the boards shelf does not run the list to the bottom.
    await page.locator('#homescroll').evaluate((e) => { e.scrollTop = 200; });
    await page.waitForTimeout(200);
    const hc = await page.locator('#homegrid > .card').nth(0).boundingBox();
    await touch('touchStart', hc.x + 40, hc.y + 40); await page.waitForTimeout(600);
    for (let i = 1; i <= 12; i++) { await touch('touchMove', hc.x + 40, hc.y + 40 + (740 - hc.y - 40) * i / 12); await page.waitForTimeout(16); }
    const y0 = await page.locator('#homescroll').evaluate((e) => e.scrollTop);
    await page.waitForTimeout(1500);
    const y1 = await page.locator('#homescroll').evaluate((e) => e.scrollTop);
    await touch('touchEnd'); await page.waitForTimeout(600);
    assert.ok(Math.abs(y1 - y0) < 5, `over the shelf the list stays put (${y0} → ${y1})`);
    if (await page.locator('.toast [data-a="undo"]').count()) { await page.locator('.toast [data-a="undo"]').click(); await page.waitForTimeout(300); }
    ok('no runaway scrolling while holding a card');

    // The liquid tab line follows the tab position and settles on the chosen tab.
    await page.locator('#homescroll').evaluate((e) => { e.scrollTop = 0; });
    await page.locator('#tab-notes').click(); await page.waitForTimeout(700);
    const tl = await page.evaluate(() => { const l = document.querySelector('#homeseg .tl').getBoundingClientRect(), b = document.querySelector('#tab-notes').getBoundingClientRect(); return Math.abs((l.left + l.right) / 2 - (b.left + b.right) / 2); });
    assert.ok(tl < 2, `the line settles under Notes (${tl})`);
    await page.locator('#tab-recent').click(); await page.waitForTimeout(700);
    ok('liquid tab line lands on its tab');

    // Reduced motion: routes and the header picture still work and leave nothing half way.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.pile[data-v]').nth(pick).click(); await page.waitForTimeout(200);
    assert.equal(await page.locator('#stage > .screen:visible').count(), 1);
    await page.evaluate(() => nbBack()); await page.waitForTimeout(200);
    await page.locator('#searchbtn').click(); await page.waitForTimeout(200);
    await page.evaluate(() => nbBack()); await page.waitForTimeout(200);
    assert.equal(await page.locator('#stage > .screen:visible').count(), 1);
    assert.equal(await page.locator('.route-ghost').count(), 0);
    ok('reduced motion');

    assert.deepEqual(errors, []);
    console.log('Phone audit passed:\n  ' + passed.join('\n  '));
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
