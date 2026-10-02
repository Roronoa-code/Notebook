// The motion audit of 30 September 2026 (Notebook-Motion-Audit, findings N01–N24): each finding's pass condition,
// checked frame by frame on the mock bridge in headless Edge. No phone, no library, no real mouse or keyboard.
// Usage: node scripts/test-phone-findings.js
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--allow-file-access-from-files'] });
  const passed = [];
  const ok = (name) => { passed.push(name); };
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
    await page.evaluate(() => { document.documentElement.style.setProperty('--st', '28px'); document.documentElement.style.setProperty('--sb', '16px'); });
    // Distinct content as well as blank notes: two compact notes with different titles, a blank one, a long one.
    const ID = await page.evaluate(() => {
      const mk = (title, html) => { const r = JSON.parse(NBNative.addNote('')); NBNative.update(r.id, JSON.stringify({ title, html })); return r.id; };
      const blank = mk('Untitled note', ''), ideas = mk('Gift ideas', '<h2>Gift ideas</h2><p>A scarf</p>'), shop = mk('Shopping list', '<h2>Shopping list</h2><ul><li>Milk</li></ul>');
      nbOnState(NBNative.state());
      return (window.ID = { shop, ideas, blank });
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }] });
    const frames = (fnSrc, ms) => { const p = page.evaluate(([src, ms]) => new Promise((res) => { const f = new Function('return (' + src + ')()'); const out = []; const t0 = performance.now(); const step = () => { out.push(f()); if (performance.now() - t0 < ms) requestAnimationFrame(step); else res(out); }; requestAnimationFrame(step); }), [fnSrc, ms]); p.catch(() => {}); return p; }; // (a check failing first must not leave it unhandled)
    const home = async () => { await page.evaluate(() => { while (nbBack()) { /* Home */ } }); await page.waitForTimeout(700); };
    const scrollTo = async (y) => { await page.locator('#homescroll').evaluate((e, v) => { e.scrollTop = v; }, y); await page.waitForTimeout(250); };
    const cardBox = (sel) => page.locator(sel).evaluate((e) => { const q = e.getBoundingClientRect(); if (q.top < 90 || q.bottom > innerHeight - 170) { const sc = e.closest('.screen'); sc.scrollTop += q.top - 200; } const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
    const hold = async (x, y, ms = 320) => { await touch('touchStart', x, y); await page.waitForTimeout(ms); };
    const moveTo = async (x0, y0, x1, y1, steps, ms = 16) => { for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await page.waitForTimeout(ms); } };
    const bundle = () => page.evaluate(() => {
      const l = document.querySelector('.dragbundle'); if (!l) return null;
      const m = new DOMMatrix(getComputedStyle(l).transform), faces = [...l.querySelectorAll('.dragface')].map((f) => { const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, m: new DOMMatrix(getComputedStyle(f).transform) }; });
      const c = l.querySelector('.dragcount'), cr = c && c.getBoundingClientRect();
      return { x: m.e, y: m.f, faces, count: c ? c.textContent : null, countBox: cr && { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom } };
    });
    const picked = () => page.locator('#selcount').textContent();
    const pick = async (sels) => {
      const a = await cardBox(sels[0]);
      await hold(a.cx, a.cy, 650); await touch('touchEnd'); await page.waitForTimeout(350);
      for (const s of sels.slice(1)) { await page.locator(s).click(); await page.waitForTimeout(80); }
    };
    const endPick = async () => { if (await page.evaluate(() => !!document.querySelector('#selbar:not([hidden])'))) { await page.evaluate(() => nbBack()); await page.waitForTimeout(500); } };

    // ---------- N01: the grab point stays under the finger (outside the shelf and edge limits) ----------
    await scrollTo(420);
    {
      const c = await cardBox(`#homegrid > .card[data-v="${ID.shop}"]`);
      const gx = 30, gy = 20; // where it is held, within the card
      await hold(c.x + gx, c.y + gy);
      let fx = c.x + gx, fy = c.y + gy;
      const path = [];
      for (let i = 1; i <= 6; i++) path.push([120 + i * 4, 200 + i * 10]);               // slow
      // (kept clear of the shelf and the screen's edges, where the bundle is deliberately eased to a stop)
      for (let a = 0; a <= Math.PI * 4; a += Math.PI / 6) path.push([135 + Math.cos(a) * 45, 250 + Math.sin(a) * 90]); // fast circles
      for (const [x, y] of [[185, 250], [85, 270], [180, 150], [95, 340]]) path.push([x, y]);                          // abrupt reversals
      for (let i = 0; i < 6; i++) path.push([140 + (i % 2), 240 - (i % 3)]);             // tiny adjustments
      let worst = 0;
      await touch('touchMove', fx + 20, fy + 12); await page.waitForTimeout(350); // lifted, small, settled (past the browser's own touch slop)
      for (const [x, y] of path) {
        await touch('touchMove', x, y);
        const b = await bundle();
        worst = Math.max(worst, Math.hypot(b.x - x, b.y - y));
      }
      assert.ok(worst < 0.6, `the held point stays exactly under the finger through slow moves, fast circles and reversals (worst ${worst.toFixed(2)}px)`);
      const still = await frames(`() => { const m = new DOMMatrix(getComputedStyle(document.querySelector('.dragbundle')).transform); return [m.e, m.f]; }`, 500);
      assert.ok(still.every((p) => Math.hypot(p[0] - still[0][0], p[1] - still[0][1]) < 0.3), 'holding still, nothing catches up afterwards');
      // the grab point inside the card is the same point it was picked up by
      const b = await bundle(), lead = b.faces[0], s = lead.m.a / Math.cos(Math.atan2(lead.m.b, lead.m.a)) || 1;
      assert.ok(Math.abs(-lead.m.e / s - gx) < 1.5 && Math.abs(-lead.m.f / s - gy) < 1.5, `the same point on the card is held (${(-lead.m.e / s).toFixed(1)}, ${(-lead.m.f / s).toFixed(1)})`);
      await touch('touchCancel'); await page.waitForTimeout(700);
    }
    ok('N01 the carried card stays attached to the finger: no chasing, no catch-up');

    // ---------- N02: a picked group is one bundle: shared movement, an edge of each always showing ----------
    const bundleCheck = async (sels, label) => {
      await scrollTo(420);
      await pick(sels);
      const n = await page.evaluate(() => [...document.querySelectorAll('#homegrid > .card.sel')].reduce((k, c) => k + (c.classList.contains('stackcard') ? c.querySelectorAll('.fanitem').length : 1), 0));
      const a = await cardBox(sels[0]);
      await hold(a.cx, a.cy);
      await moveTo(a.cx, a.cy, 180, 300, 6);
      await page.waitForTimeout(450); // gathered
      const rel = [];
      for (const [x, y] of [[250, 250], [110, 360], [260, 300], [100, 240], [180, 300]]) {
        await touch('touchMove', x, y);
        const b = await bundle();
        const lead = b.faces[0];
        rel.push(b.faces.slice(1).map((f) => ({ dx: f.l - lead.l, dy: f.t - lead.t, edge: Math.max(f.r - lead.r, lead.l - f.l, f.b - lead.b) })));
        if (!rel.count) rel.count = b.count;
      }
      const first = rel[0];
      assert.ok(first.length >= 1, `${label}: the others are in the bundle`);
      assert.ok(rel.every((r) => r.every((f, i) => Math.abs(f.dx - first[i].dx) < 1.5 && Math.abs(f.dy - first[i].dy) < 1.5)), `${label}: they move exactly together through reversals`);
      assert.ok(rel.every((r) => r.every((f) => f.edge >= 4 && f.edge <= 30)), `${label}: an edge of each one behind always shows, and none swings away (${JSON.stringify(rel[0])})`);
      assert.equal(rel.count, String(n), `${label}: the count is right`);
      await touch('touchCancel'); await page.waitForTimeout(700);
      await endPick();
    };
    await bundleCheck([`#homegrid > .card[data-v="${ID.shop}"]`, `#homegrid > .card[data-v="${ID.ideas}"]`], 'two notes');
    const photos = await page.evaluate(() => [...document.querySelectorAll('#homegrid > .card[data-a="open"]')].filter((c) => c.querySelector('img') && !c.querySelector('.badge')).map((c) => c.dataset.v));
    await bundleCheck([`#homegrid > .card[data-v="${photos[0]}"]`, `#homegrid > .card[data-v="${photos[1]}"]`], 'two pictures');
    await bundleCheck([`#homegrid > .card[data-v="${ID.shop}"]`, `#homegrid > .card[data-v="${photos[0]}"]`, `#homegrid > .card[data-v="${ID.blank}"]`], 'a mixed three');
    ok('N02 two notes, two pictures and a mixed three travel as one bundle with a count');

    // ---------- N03: resting near a card's edge never flickers its highlight ----------
    await scrollTo(420);
    {
      const c = await cardBox(`#homegrid > .card[data-v="${ID.shop}"]`);
      const t = await page.evaluate(() => { const cs = [...document.querySelectorAll('#homegrid > .card')].filter((e) => e.dataset.v !== window.ID.shop); const r = cs.map((e) => [e, e.getBoundingClientRect()]).find(([, q]) => q.top > 150 && q.bottom < 560 && q.height > 80); return { id: r[0].dataset.v || r[0].dataset.stack, l: r[1].left, t: r[1].top, r: r[1].right, b: r[1].bottom }; });
      await hold(c.cx, c.cy);
      await moveTo(c.cx, c.cy, t.l + 3, t.t + 40, 8);
      const watch = frames(`() => { const c = document.querySelector('#homegrid .card.dropnear'); return c ? (c.classList.contains('droptarget') ? 2 : 1) : 0; }`, 2000);
      for (let i = 0; i < 40; i++) { await touch('touchMove', t.l + 3 + (i % 2), t.t + 40 + (i % 3)); await page.waitForTimeout(45); } // nearly still, at the edge
      const on = await watch;
      assert.ok(on.every(Boolean), `held two seconds at the edge, it stays marked (${on.filter((v) => !v).length} unmarked frames)`);
      assert.ok(on.filter((v, i) => i && v !== on[i - 1]).length === 1 && on.at(-1) === 2, 'resting there, it gets ready once and stays ready');
      // slowly out across the gap and back in: it changes at most once each way
      const cross = frames(`() => !!document.querySelector('#homegrid .card.dropnear')`, 1400);
      for (let x = t.l + 3; x > t.l - 30; x -= 1.5) { await touch('touchMove', x, t.t + 40); await page.waitForTimeout(12); }
      for (let x = t.l - 30; x < t.l + 6; x += 1.5) { await touch('touchMove', x, t.t + 40); await page.waitForTimeout(12); }
      const seen = await cross, flips = seen.filter((v, i) => i && v !== seen[i - 1]).length;
      assert.ok(flips <= 2, `crossing the gap slowly and back changes it at most twice (${flips})`);
      await touch('touchCancel'); await page.waitForTimeout(700);
    }
    ok('N03 one stable target: no flicker while nearly still or crossing a gap');

    // ---------- N04 + N05: carried, scrolled, let go: each copy flies to where its card is now and hands over ----------
    await scrollTo(300);
    {
      await pick([`#homegrid > .card[data-v="${ID.shop}"]`, `#homegrid > .card[data-v="${ID.ideas}"]`]);
      const ids = [ID.shop, ID.ideas];
      const a = await cardBox(`#homegrid > .card[data-v="${ID.shop}"]`);
      await hold(a.cx, a.cy);
      const shelfTop = async () => page.locator('#shelfmini').evaluate((e) => e.getBoundingClientRect().top); // (the boards, waiting compact)
      await moveTo(a.cx, a.cy, 180, 400, 6);
      await page.waitForTimeout(300);
      const zoneY = (await shelfTop()) - 40;
      const s0 = await page.locator('#homescroll').evaluate((e) => e.scrollTop);
      await touch('touchMove', 180, zoneY); await page.waitForTimeout(1100); // rests in the bottom zone: the list scrolls
      await touch('touchMove', 12, zoneY - 150); await page.waitForTimeout(80);   // somewhere with nothing to drop on
      const s1 = await page.locator('#homescroll').evaluate((e) => e.scrollTop);
      assert.ok(s1 - s0 > 40, `the list scrolled while held at the edge (${s0} → ${s1})`);
      const land = frames(`() => { const out = []; for (const id of ${JSON.stringify(ids)}) { const c = document.querySelector('#homegrid > .card[data-v="' + id + '"]'); const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); const faces = [...document.querySelectorAll('.dragbundle .dragface')]; out.push({ id, card: { l: r.left, t: r.top }, carried: c.classList.contains('carried') || c.classList.contains('landing'), sel: c.classList.contains('sel'), shown: cs.display !== 'none' && cs.visibility === 'visible' && +cs.opacity > 0.99, faces: faces.map((f) => { const q = f.getBoundingClientRect(); return { l: q.left, t: q.top }; }) }); } return { cards: out, scroll: document.querySelector('#homescroll').scrollTop, count: document.querySelector('#selcount').textContent }; }`, 900);
      await touch('touchEnd');
      const fr = await land;
      assert.ok(fr.slice(3).every((f) => f.scroll === fr[3].scroll), 'the edge scrolling stops on letting go');
      // the frame before the copies go, each one sits exactly on its card
      const lastWith = fr.filter((f) => f.cards[0].faces.length).at(-1), after = fr[fr.indexOf(lastWith) + 1];
      for (const c of lastWith.cards) assert.ok(c.faces.some((f) => Math.abs(f.l - c.card.l) < 1.5 && Math.abs(f.t - c.card.t) < 1.5), `the copy of ${c.id} lands exactly on its card (${JSON.stringify(c.faces)} vs ${JSON.stringify(c.card)})`);
      assert.ok(after.cards.every((c) => !c.carried && c.shown), 'and the card takes over in the very next frame, whole');
      // N05: never two versions at once: while its copy is out the card is not in the grid at all; the picks and
      // count stay throughout
      assert.ok(fr.every((f) => f.cards.every((c) => (c.faces.length && !c.shown) || (!c.faces.length && c.shown))), 'one owner per card in every frame (the copy, or the card)');
      assert.ok(fr.every((f) => f.cards.every((c) => c.sel) && /2 selected/.test(f.count)), 'the picked mark and the count stay the same through the landing');
      await endPick();
    }
    ok('N04/N05 after scrolling, each copy lands on its card\'s current place and hands over in one frame; picks kept');

    // ---------- The owner's direction: a carried card leaves the grid; the cards below glide up into its place (within
    // their own column: nothing hops across and the page never jumps), and glide back down if it is put back ----------
    await scrollTo(300);
    {
      const c = await cardBox(`#homegrid > .card[data-v="${ID.ideas}"]`);
      const below = await page.evaluate((id) => { const me = document.querySelector(`#homegrid > .card[data-v="${id}"]`).getBoundingClientRect(); const b = [...document.querySelectorAll('#homegrid > .card')].map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => Math.abs(r.left - me.left) < 2 && r.top > me.top).sort((x, y) => x[1].top - y[1].top)[0]; b[0].id = 'below-probe'; const other = [...document.querySelectorAll('#homegrid > .card')].find((e) => Math.abs(e.getBoundingClientRect().left - me.left) > 50); other.id = 'other-probe'; return { top: b[1].top, h: me.height, other: other.getBoundingClientRect().top, scroll: document.querySelector('#homescroll').scrollTop }; }, ID.ideas);
      await hold(c.cx, c.cy);
      await touch('touchMove', c.cx + 20, c.cy + 14); await page.waitForTimeout(420);
      const during = await page.evaluate((id) => ({ me: getComputedStyle(document.querySelector(`#homegrid > .card[data-v="${id}"]`)).visibility, below: document.querySelector('#below-probe').getBoundingClientRect().top, other: document.querySelector('#other-probe').getBoundingClientRect().top, scroll: document.querySelector('#homescroll').scrollTop }), ID.ideas);
      assert.equal(during.me, 'hidden', 'the carried card no longer shows in the grid');
      assert.ok(Math.abs(during.below - (below.top - below.h - 12)) < 1.5, `the card below glides up into its place (${below.top} → ${during.below})`);
      assert.ok(Math.abs(during.other - below.other) < 0.5 && during.scroll === below.scroll, 'the other column and the page stay still');
      await touch('touchCancel'); await page.waitForTimeout(700);
      const after = await page.evaluate(() => document.querySelector('#below-probe').getBoundingClientRect().top);
      assert.ok(Math.abs(after - below.top) < 0.5, 'put back, its place opens again');
      await page.evaluate(() => { document.querySelector('#below-probe').id = ''; document.querySelector('#other-probe').id = ''; });
    }
    ok('Owner: carried cards leave the grid; their column closes up and opens again, nothing else moves');

    // ---------- The owner's direction: while one finger carries, a second finger scrolls the list ----------
    await scrollTo(200);
    {
      const c = await cardBox(`#homegrid > .card[data-v="${ID.shop}"]`);
      await hold(c.cx, c.cy);
      await touch('touchMove', c.cx + 20, c.cy + 14); await page.waitForTimeout(300);
      const two = (type, a, b) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: a[0], y: a[1], id: 0 }, ...(b ? [{ x: b[0], y: b[1], id: 1 }] : [])] }); // (the carrying finger keeps its id)
      const f = [c.cx + 20, c.cy + 14], s0 = await page.locator('#homescroll').evaluate((e) => e.scrollTop);
      await two('touchStart', f, [300, 600]);
      for (let i = 1; i <= 10; i++) { await two('touchMove', f, [300, 600 - i * 25]); await page.waitForTimeout(16); }
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      const s1 = await page.locator('#homescroll').evaluate((e) => e.scrollTop), b1 = await bundle();
      assert.ok(s1 - s0 > 150, `a second finger scrolls the list (${s0} → ${s1})`);
      assert.ok(Math.hypot(b1.x - f[0], b1.y - f[1]) < 0.6, 'while the bundle stays under the first finger');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: f[0], y: f[1], id: 0 }] }); // the scrolling finger lifts
      await page.waitForTimeout(250);
      assert.equal(await page.locator('.dragbundle').count(), 1, 'still carrying');
      assert.equal(await page.locator('#homegrid .card.droptarget').count(), 0, 'the list moving under a still finger never makes a card ready to stack');
      const stacks = await page.locator('#homegrid .stackcard').count();
      await touch('touchEnd'); await page.waitForTimeout(700);
      assert.equal(await page.locator('#homegrid .stackcard').count(), stacks, 'so letting go just after scrolling makes no stack');
      assert.equal(await page.locator('#homegrid .card.carried, .dragbundle').count(), 0, 'it goes back into its place');
    }
    ok('Owner: a second finger scrolls the list while the first one carries');

    // ---------- N06: while cards are picked or carried the + never shows; pick up and cancel ten times ----------
    await scrollTo(420);
    {
      await pick([`#homegrid > .card[data-v="${ID.shop}"]`, `#homegrid > .card[data-v="${ID.ideas}"]`]);
      const watch = frames(`() => { const s = NBSurface.state(), o = document.querySelector('#orb'), sel = !!document.querySelector('#homegrid > .card.sel'); return { sel, plus: !o.hidden || (s.out && s.cur.f > 0.02), big: s.out && !document.querySelector('#shelf').offsetParent && (s.cur.w > 280 || s.cur.h > 130) }; }`, 7000);
      const a = await cardBox(`#homegrid > .card[data-v="${ID.shop}"]`);
      for (let i = 0; i < 10; i++) {
        await hold(a.cx, a.cy);
        await moveTo(a.cx, a.cy, 170 + (i % 3) * 20, 250, 4);
        await page.waitForTimeout(i % 2 ? 60 : 260); // some re-grabs while the shelf is still coming
        await touch('touchMove', 12, 160); await page.waitForTimeout(20);
        await touch(i % 3 === 2 ? 'touchCancel' : 'touchEnd');
        await page.waitForTimeout(i % 2 ? 120 : 380); // some re-grabs while the cards are still flying home
      }
      const fr = (await watch).filter((f) => f.sel);
      assert.ok(fr.length > 60 && fr.every((f) => !f.plus), 'the + never shows while a selection exists');
      assert.ok(fr.every((f) => !f.big), 'and no oversized empty panel appears (the boards stay a compact pill unless you go onto them)');
      await page.waitForTimeout(500);
      assert.match(await picked(), /2 selected/, 'the picking survives every cancel');
      assert.equal(await page.locator('.dragbundle').count(), 0, 'no copy is left behind');
      await endPick();
    }
    ok('N06 picking bar ↔ shelf directly, no + detour, ten pick-ups and cancels (with re-grabs)');

    // ---------- N07 + N08 + N09: the shelf: the bundle stays above it; name, marker and drop agree; readable ----------
    await scrollTo(420);
    {
      await page.evaluate(() => { NBNative.addBoard('Profile pictures and avatars for later'); nbOnState(NBNative.state()); });
      await page.waitForTimeout(300);
      const a = await cardBox(`#homegrid > .card[data-v="${ID.ideas}"]`);
      await hold(a.cx, a.cy);
      await moveTo(a.cx, a.cy, 180, 420, 5);
      await page.waitForTimeout(350);
      const pill = await page.locator('#shelfmini').evaluate((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
      assert.ok(pill.w < 260 && pill.h <= 62, 'while carrying, the boards wait as a compact pill');
      await moveTo(180, 420, pill.cx, pill.cy, 6);
      await page.locator('#shelf .shelftile').first().waitFor(); await page.waitForFunction(() => !document.querySelector('#shelf').classList.contains('riding')); // opened
      const tiles = await page.locator('#shelf .shelftile').evaluateAll((els) => els.map((t) => { const r = t.getBoundingClientRect(), m = t.querySelector('.mini').getBoundingClientRect(); return { id: t.dataset.board, name: t.dataset.name, x: r.left + r.width / 2, y: m.top + m.height / 2, w: m.width }; }));
      const shelf = await page.locator('#shelf').evaluate((e) => { const r = e.getBoundingClientRect(), lane = e.querySelector('.shelflane').getBoundingClientRect(); return { top: r.top, l: r.left, r: r.right, lane: { t: lane.top, b: lane.bottom, l: lane.left, r: lane.right }, bg: getComputedStyle(e).backgroundColor }; });
      assert.ok(tiles.every((t) => t.w >= 40), 'every board is big enough to aim at');
      assert.ok(shelf.lane.t >= shelf.top && shelf.lane.l >= shelf.l && shelf.lane.r <= shelf.r, 'the name lane is part of the shelf, never over the pictures behind');
      assert.ok(+(/rgba?\((?:[\d.]+,\s*){3}([\d.]+)/.exec(shelf.bg) || [0, 1])[1] >= 0.9, 'on a near-opaque backing');
      // sweep every destination both ways, fast; every frame: one marker, and the name is that marker's
      const sweep = frames(`() => { const hot = [...document.querySelectorAll('#shelf .shelftile.hot')]; const nm = document.querySelector('#shelfname'); const l = document.querySelector('.dragbundle'); const boxes = l ? [...l.querySelectorAll('.dragface, .dragcount')].map((e) => e.getBoundingClientRect()) : []; return { hot: hot.map((h) => h.dataset.name), name: nm ? nm.textContent : '', low: Math.max(0, ...boxes.map((b) => b.bottom)), left: Math.min(999, ...boxes.map((b) => b.left)), right: Math.max(0, ...boxes.map((b) => b.right)) }; }`, 2200);
      for (const t of [...tiles, ...tiles.slice().reverse()]) { await touch('touchMove', t.x, t.y); await page.waitForTimeout(18); }
      const fr = await sweep;
      assert.ok(fr.every((f) => f.hot.length <= 1), 'never two destinations marked');
      assert.ok(fr.every((f) => (f.hot[0] || '') === f.name), 'the name shown is always the marked one');
      assert.ok(fr.every((f) => f.low <= shelf.top + 1 && f.left >= 0 && f.right <= 360), `the carried card and its count stay whole, above the shelf (${Math.max(...fr.map((f) => f.low))} vs ${shelf.top})`);
      // release in the middle of a quick sweep: it lands where the marker is
      const target = tiles[1];
      await touch('touchMove', target.x, target.y); await page.waitForTimeout(8);
      const marked = await page.locator('#shelf .shelftile.hot').getAttribute('data-board');
      await touch('touchEnd'); await page.waitForTimeout(700);
      const on = await page.evaluate((b) => (JSON.parse(NBNative.state()).items.find((i) => i.id === window.ID.ideas).boards || []).includes(b), marked);
      assert.ok(on, 'the drop goes to the marked board');
      const lane = await page.evaluate(() => { const b = [...document.querySelectorAll('.pile .nm')].find((e) => /avatars/i.test(e.textContent)); return !!b; });
      assert.ok(lane, 'a long board name is there to test');
      await page.locator('.toast [data-a="undo"]').click(); await page.waitForTimeout(400);
    }
    ok('N07/N08/N09 bundle whole above the shelf; one marker, its name, the same drop; readable lane on the shelf');

    // ---------- N10 + N13: two compact notes become one compact stack; one stable message ----------
    await scrollTo(420);
    {
      const sizes = await page.evaluate(() => [window.ID.shop, window.ID.ideas].map((id) => document.querySelector(`#homegrid > .card[data-v="${id}"]`).getBoundingClientRect().height));
      await pick([`#homegrid > .card[data-v="${ID.shop}"]`, `#homegrid > .card[data-v="${ID.ideas}"]`]);
      const watch = frames(`() => { const s = document.querySelector('#homegrid .stackcard'); const t = document.querySelector('.toast.orbtoast'); const r = t && !t.classList.contains('riding') && !t.hidden ? t.getBoundingClientRect() : null; const w = t && t.querySelector('.words > span'); return { stack: s ? { vis: getComputedStyle(s).visibility, h: s.getBoundingClientRect().height, align: getComputedStyle(s.querySelector('.fanitem .t')).textAlign } : null, faces: document.querySelectorAll('.dragbundle .dragface').length, toast: r && { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), text: t.innerText }, fits: w ? w.scrollHeight <= w.clientHeight + 1 : true, orb: !document.querySelector('#orb').hidden }; }`, 1600);
      await page.locator('#selstack').click();
      const fr = await watch;
      const shown = fr.filter((f) => f.stack && f.stack.vis === 'visible');
      assert.ok(shown.length && shown.every((f) => f.faces === 0), 'the stack shows only once its cards have flown into it (one owner)');
      assert.ok(fr.some((f) => f.stack && f.stack.vis === 'hidden' && f.faces >= 2), 'the cards converge into it together');
      const h = shown.at(-1).stack.h;
      assert.ok(h < Math.max(...sizes) * 1.35, `two compact notes make a compact stack (${Math.round(h)}px from ${sizes.map(Math.round)})`);
      assert.equal(shown.at(-1).stack.align, 'left', 'titles stay left-aligned in the stack');
      const toasts = fr.filter((f) => f.toast);
      assert.ok(toasts.length > 3 && toasts.every((f) => f.toast.l === toasts[0].toast.l && f.toast.t === toasts[0].toast.t && f.toast.w === toasts[0].toast.w), `the message never moves or changes width once it shows (${JSON.stringify(toasts.map((f) => f.toast)).slice(0, 200)})`);
      assert.ok(fr.every((f) => f.fits), 'and its words are never cut off');
      assert.ok(fr.every((f) => !(f.orb && f.toast)), 'never beside a separate +');
      assert.match(String(toasts.map((f) => f.toast.text).find(Boolean)), /^Stacked 2/); // (read while it shows: a message is gone within about a second and a half)
    }
    ok('N10/N13 compact notes converge into one compact stack; the message has one place and width');

    // ---------- N11 + N12: browsing a stack settles once; numbers never sit on moving words ----------
    {
      await page.waitForTimeout(2800);
      const st = page.locator('#homegrid .stackcard');
      await page.evaluate(() => { const s = document.querySelector('#homegrid .stackcard'); s.scrollIntoView({ block: 'center' }); });
      await page.waitForTimeout(300);
      const b = await cardBox('#homegrid .stackcard');
      const front = () => st.evaluate((el) => [...el.querySelectorAll('.stackct')].filter((x) => +getComputedStyle(x).opacity > 0.5).map((x) => x.textContent).join());
      const f0 = await front();
      // short drag: cancels cleanly
      await touch('touchStart', b.cx, b.cy); await moveTo(b.cx, b.cy, b.cx - 20, b.cy, 4, 30); await page.waitForTimeout(200); await touch('touchEnd'); await page.waitForTimeout(600);
      assert.equal(await front(), f0, 'a short, slow drag goes back');
      // a flick: exactly one on, and once the front has settled nothing moves again
      const wobble = frames(`() => [...document.querySelectorAll('#homegrid .stackcard .fanitem')].map((e) => { const m = new DOMMatrix(getComputedStyle(e).transform); const t = e.querySelector('.t'), c = e.querySelector('.stackct'); let tr = null; if (t) { const rg = document.createRange(); rg.selectNodeContents(t); tr = rg.getBoundingClientRect(); } const cr = c.getBoundingClientRect(); const o = +getComputedStyle(c).opacity; return { x: m.e, y: m.f, a: m.a, badge: o, hit: !!tr && o > 0.05 && tr.right > cr.left && tr.left < cr.right && tr.bottom > cr.top && tr.top < cr.bottom, left: e.getBoundingClientRect().left }; })`, 1200);
      await touch('touchStart', b.cx + 40, b.cy); await touch('touchMove', b.cx + 20, b.cy); await touch('touchMove', b.cx - 40, b.cy); await page.waitForTimeout(16); await touch('touchEnd');
      const fr = await wobble;
      const restAt = fr.findIndex((f, i) => i > 3 && f.every((c, k) => Math.abs(c.x - fr.at(-1)[k].x) < 0.3 && Math.abs(c.y - fr.at(-1)[k].y) < 0.3 && Math.abs(c.a - fr.at(-1)[k].a) < 0.002));
      assert.ok(restAt > 0 && fr.slice(restAt).every((f) => f.every((c, k) => Math.abs(c.x - fr.at(-1)[k].x) < 0.3)), 'once settled, no card opens out again');
      assert.notEqual(await front(), f0, 'a flick shows the next one');
      assert.ok(fr.every((f) => f.filter((c) => c.badge > 0.05).length <= 1), 'only one number shows at a time');
      assert.ok(fr.every((f) => f.every((c) => !c.hit)), 'no title ever runs under a number');
      assert.ok(fr.every((f) => f.every((c) => c.left >= -2 && c.left - b.x > -b.w * 0.2)), 'every card stays within the stack\'s own area, on screen');
      // rapid repeated flicks: one on per flick, coherent
      const f1 = await front();
      for (let i = 0; i < 2; i++) { await touch('touchStart', b.cx + 40, b.cy); await touch('touchMove', b.cx + 20, b.cy); await touch('touchMove', b.cx - 40, b.cy); await page.waitForTimeout(16); await touch('touchEnd'); await page.waitForTimeout(90); }
      await page.waitForTimeout(700);
      assert.equal(await front(), f1, 'two quick flicks on a stack of two go round once and back');
      // the opposite way during a settle: caught where it is and turned round
      await touch('touchStart', b.cx + 40, b.cy); await touch('touchMove', b.cx + 20, b.cy); await touch('touchMove', b.cx - 40, b.cy); await page.waitForTimeout(16); await touch('touchEnd');
      await page.waitForTimeout(60);
      await touch('touchStart', b.cx - 40, b.cy); await touch('touchMove', b.cx - 20, b.cy); await touch('touchMove', b.cx + 40, b.cy); await page.waitForTimeout(16); await touch('touchEnd');
      await page.waitForTimeout(700);
      assert.ok(/^\d\/2$/.test(await front()), 'an opposite flick mid-settle leaves it settled on a card');
    }
    ok('N11/N12 stack browsing: short drags cancel, one step per flick, no after-wobble, no number over moving words');

    // ---------- N14 + N15 + N18: a new note from the orb; Home untouched; untouched drafts leave nothing ----------
    await scrollTo(300);
    {
      const before = await page.evaluate(() => ({ n: JSON.parse(NBNative.state()).items.length, count: document.querySelector('#count').textContent, cards: [...document.querySelectorAll('#homegrid > .card')].map((c) => { const r = c.getBoundingClientRect(); return [c.dataset.v || c.dataset.stack, Math.round(r.left), Math.round(r.top)]; }) }));
      for (let round = 0; round < 5; round++) {
        const watch = frames(`() => { const n = document.querySelector('.note-screen'); if (!n) return null; const f = n.querySelector('.growface svg'), c = n.style.clipPath, m = /inset\\(([\\d.]+)px ([\\d.]+)px ([\\d.]+)px ([\\d.]+)px/.exec(c || ''); const area = m ? (innerWidth - +m[2] - +m[4]) * (innerHeight - +m[1] - +m[3]) / (innerWidth * innerHeight) : 1; let ed = 1; for (let e = n.querySelector('#editor'); e && e !== n.parentNode; e = e.parentElement) ed *= +getComputedStyle(e).opacity; const home = [...document.querySelectorAll('#homegrid > .card')].map((c) => { const r = c.getBoundingClientRect(); return [c.dataset.v || c.dataset.stack, Math.round(r.left), Math.round(r.top)]; }); return { plus: f ? f.getBoundingClientRect().width : 0, area, ed, count: document.querySelector('#count').textContent, home: JSON.stringify(home) }; }`, 650);
        const o = await page.locator('#orb').boundingBox();
        await page.touchscreen.tap(o.x + 30, o.y + 30);
        const fr = (await watch).filter(Boolean);
        assert.ok(fr.length > 5 && fr.every((f) => f.plus <= 30), 'the plus never grows (N14)');
        assert.ok(fr.every((f) => f.area >= 0.8 || f.ed < 0.02), 'the note\'s words appear only once the shell nearly fills the screen');
        assert.ok(fr.every((f) => f.count === before.count && f.home === JSON.stringify(before.cards)), 'Home does not change underneath while it opens (N15)');
        await page.waitForTimeout(200);
        await page.evaluate(() => nbBack());
        await page.waitForTimeout(700);
      }
      const after = await page.evaluate(() => ({ n: JSON.parse(NBNative.state()).items.length, count: document.querySelector('#count').textContent }));
      assert.deepEqual(after, { n: before.n, count: before.count }, 'opening + and going back five times changes nothing (N18)');
      assert.equal(await page.locator('#orb').isVisible(), true, 'and the orb is back');
      // written in: kept, and it folds into its own new card, landing exactly on it (N16)
      const o = await page.locator('#orb').boundingBox();
      await page.touchscreen.tap(o.x + 30, o.y + 30);
      await page.waitForTimeout(600);
      await page.locator('#editor').click();
      await page.keyboard.type('Packing list');
      await page.waitForTimeout(700);
      const fold = frames(`() => { const n = document.querySelector('#stage > .note-screen'); const c = [...document.querySelectorAll('#homegrid > .card')].find((e) => /Packing list/i.test(e.textContent)); if (!c) return null; const r = c.getBoundingClientRect(); if (!n) return { gone: true, card: [r.left, r.top, r.width, r.height], vis: getComputedStyle(c).visibility }; const q = n.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(n).transform), clip = /inset\\(0px 0px ([\\d.]+)px/.exec(getComputedStyle(n).clipPath || ''); return { gone: false, note: [q.left, q.top, q.width, (innerHeight - (clip ? +clip[1] : 0)) * m.a], card: [r.left, r.top, r.width, r.height], vis: getComputedStyle(c).visibility }; }`, 900);
      await page.evaluate(() => nbBack());
      const ff = (await fold).filter(Boolean);
      const last = ff.filter((f) => !f.gone).at(-1), first = ff.find((f) => f.gone);
      assert.ok(last && first, 'the note folds into its new card');
      assert.ok(last.note.every((v, i) => Math.abs(v - last.card[i]) < 3), `its last frame is exactly the card (${last.note.map(Math.round)} vs ${last.card.map(Math.round)})`);
      assert.ok(ff.every((f) => f.gone || f.vis === 'hidden') && first.vis === 'visible', 'the card shows only as the note goes');
      const steps = ff.filter((f) => !f.gone).map((f) => f.note[1]);
      assert.ok(steps.slice(-4).every((y, i, a) => i === 0 || Math.abs(y - a[i - 1]) < 30), 'it slows into the card (no jump at the end)');
      assert.equal(await page.evaluate(() => JSON.parse(NBNative.state()).items.length), before.n + 1, 'written in, it is kept');
    }
    ok('N14/N15/N16/N18 one shell from the orb (no giant +), Home still, untouched notes leave nothing, a kept note lands on its card');

    // ---------- N16: interrupting the note on its way open turns it round from where it is ----------
    {
      await page.locator('#tab-notes').click(); await page.waitForTimeout(600);
      const c = page.locator('#homegrid .card[data-a="open"]').first();
      await c.click();
      await page.waitForTimeout(110);
      const mid = await page.locator('#stage > .note-screen').evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).a);
      const turn = frames(`() => { const n = document.querySelector('#stage > .note-screen'); return n ? new DOMMatrix(getComputedStyle(n).transform).a : null; }`, 600);
      await page.evaluate(() => nbBack());
      const sc = (await turn).filter((v) => v !== null);
      assert.ok(mid > 0.3 && mid < 0.99, `it was part way open (${mid})`);
      assert.ok(Math.abs(sc[0] - mid) < 0.12 && sc.every((v, i) => i === 0 || v <= sc[i - 1] + 0.001), `Back turns it round from where it is, shrinking all the way (${sc.slice(0, 4).map((v) => v.toFixed(2))})`);
      await page.waitForTimeout(400);
      await page.locator('#tab-recent').click(); await page.waitForTimeout(600);
    }
    ok('N16 a note interrupted on its way open turns round without a snap');

    // ---------- N17: the note and its boards are one surface ----------
    {
      await page.locator('#tab-notes').click(); await page.waitForTimeout(600);
      await page.locator('#homegrid .card[data-a="open"]').first().click(); await page.waitForTimeout(700);
      const j = await page.evaluate(() => { const n = document.querySelector('.note-screen'), st = n.querySelector('.notestage'), sh = n.querySelector('.sheet'); const cs = getComputedStyle(sh); return { bg: [getComputedStyle(n).backgroundColor, getComputedStyle(st).backgroundColor, cs.backgroundColor], radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius], divider: cs.borderTopWidth }; });
      assert.ok(j.bg.every((c) => c === j.bg[1]), `one colour behind the editor, the boards and their join (${j.bg})`);
      assert.deepEqual(j.radius, ['0px', '0px'], 'a square join: no corners to show the page behind');
      assert.equal(j.divider, '1px', 'with one quiet divider');
      await page.evaluate(() => nbBack()); await page.waitForTimeout(700);
      await page.locator('#tab-recent').click(); await page.waitForTimeout(600);
    }
    ok('N17 the note\'s boards join its editor square, on one surface');

    // ---------- N19 (the owner's direction: everything at the bottom right comes out of the +): board options from the
    // thumbnail and from the pencil are the + growing into them, one surface with no purple slab or empty panel, and go
    // back into it the same way ----------
    await scrollTo(0);
    {
      // (the controls ride the surface drawn whole, scaled to fit inside it: "escaped" is any of them drawn outside it)
      const watchPlus = () => frames(`() => { const s = NBSurface.state(), f = document.querySelector('#formsheet'), drawn = f.getBoundingClientRect(), bar = { width: f.offsetWidth, height: f.offsetHeight }, kids = [...f.children], vis = kids.length ? Math.max(...kids.map((k) => +getComputedStyle(k).opacity)) : 0, c = s.cur; const inside = !c || (drawn.left >= c.x - 1.5 && drawn.top >= c.y - 1.5 && drawn.right <= c.x + c.w + 1.5 && drawn.bottom <= c.y + c.h + 1.5); return { out: s.out, slab: s.out && s.cur.f > 0.2 && s.cur.w > 120, empty: s.out && s.cur.w > bar.width * 0.9 && s.cur.h > bar.height * 0.9 && vis < 0.05 && f.classList.contains('riding') && !f.hidden, escaped: s.out && f.classList.contains('riding') && vis > 0.05 && !inside }; }`, 1100);
      for (const how of ['thumb-x', 'thumb-back', 'pencil']) {
        let w;
        if (how === 'pencil') {
          await page.locator('.pile[data-v]').first().click(); await page.waitForTimeout(700);
          w = watchPlus();
          await page.locator('.bhead [data-a="editBoard"]').click();
        } else {
          const p = await page.locator('.pile[data-v]').first().boundingBox();
          w = watchPlus();
          await touch('touchStart', p.x + 40, p.y + 50); await page.waitForTimeout(600); await touch('touchEnd');
        }
        await page.waitForTimeout(500);
        assert.equal(await page.locator('#formsheet.boardbar #f1').isVisible(), true, `${how}: the board's options are open`);
        if (how === 'thumb-x') await page.locator('#formsheet [data-a="closeForm"]').click(); else await page.evaluate(() => nbBack());
        const fr = await w;
        assert.ok(fr.some((f) => f.out), `${how}: the options come out of the + and go back into it`);
        assert.ok(fr.every((f) => !f.slab), `${how}: never a purple slab`);
        assert.ok(fr.every((f) => !f.empty && !f.escaped), `${how}: its controls arrive as the surface makes room, never outside it`);
        await page.waitForTimeout(400);
        if (how === 'pencil') { await page.evaluate(() => nbBack()); await page.waitForTimeout(700); }
      }
    }
    ok('N19 board options from the thumbnail and the pencil: the + growing into them as one surface (owner\'s direction), no slab');

    // ---------- N20: a board opens from its cover without cut-off title or strips of Home; reverses half way ----------
    await scrollTo(0);
    {
      const pile = page.locator('.pile[data-v]').nth(1);
      const w = frames(`() => { const b = [...document.querySelectorAll('#stage > .screen')].find((s) => s.querySelector('#boardname')); if (!b) return null; const home = document.querySelector('#homescroll'); const c = b.style.clipPath, m = /inset\\(([-\\d.]+)px ([-\\d.]+)px ([-\\d.]+)px ([-\\d.]+)px/.exec(c || ''); return { home: +getComputedStyle(home).opacity, clip: m ? [+m[1], +m[2], +m[3], +m[4]] : [0, 0, 0, 0] }; }`, 700);
      await pile.click();
      await page.waitForTimeout(150);
      await page.evaluate(() => nbBack());
      const fr = (await w).filter(Boolean);
      const open = fr.map((f) => f.clip.reduce((a, b) => a + b, 0));
      const turnAt = open.findIndex((v, i) => i && v > open[i - 1] + 0.5);
      assert.ok(turnAt > 0, 'it was opening, then turned round');
      assert.ok(open.every((v, i) => i === 0 || Math.abs(v - open[i - 1]) < 260), 'from exactly where it was (no jump)');
      assert.ok(fr.every((f) => f.home > 0.3), 'Home dims evenly underneath, never left in strips at full strength');
      await page.waitForTimeout(600);
      assert.equal(await page.locator('.coverghost').count(), 0);
      assert.equal(await page.locator('.pile[data-v]').nth(1).locator('.pile-stack').evaluate((e) => getComputedStyle(e).visibility), 'visible', 'the cover is back');
    }
    // a long board name shrinks to fit rather than breaking a word in two
    {
      const p = page.locator('.pile[data-v]').filter({ hasText: /wallpapers/i }).first();
      await p.click(); await page.waitForTimeout(900);
      const broken = await page.evaluate(() => { const t = document.querySelector('#boardname'), words = [], walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const re = /\S+/g; let m; while ((m = re.exec(n.data))) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); words.push([m[0], new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size]); } } return words.filter((w) => w[1] > 1).map((w) => w[0]); });
      assert.deepEqual(broken, [], 'no word of the board name is split across lines');
      await page.evaluate(() => nbBack()); await page.waitForTimeout(800);
    }
    ok('N20 board entry: one surface from the cover, content once it fits, Home dims evenly, reversible; long names never split');

    // ---------- N21 + N22 + N24: tab swipes follow the finger from the first move; one timeline; no flash ----------
    await scrollTo(420);
    {
      assert.ok(await page.locator('#homepager > .peek.parked').count() >= 1, 'the pane beside is ready before any swipe');
      const at = async () => page.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => r())); return { dx: new DOMMatrix(getComputedStyle(document.querySelector('#homegrid')).transform).m41, i: parseFloat(getComputedStyle(document.querySelector('#homeseg')).getPropertyValue('--i')), on: [...document.querySelectorAll('#homeseg button')].map((b) => +b.style.getPropertyValue('--on')), sort: +getComputedStyle(document.querySelector('#homesort')).opacity, st: getComputedStyle(document.querySelector('#homesort')).transform }; }); // (moves that nothing blocks arrive with the next frame)
      await touch('touchStart', 300, 420);
      const track = [];
      for (let i = 1; i <= 12; i++) { await touch('touchMove', 300 - i * 12, 420); track.push([i * 12, await at()]); }
      const rec = track.filter(([, a]) => a.dx !== 0); // (the browser keeps back moves inside its own small slop)
      // (V02 of the 30 Sept recording audit: it starts from where it is, without a jump, and has caught up with the
      // finger within 24px, instead of staying 10px behind it for the whole swipe)
      const behind = rec.map(([d, a]) => a.dx + d), d0 = rec.length ? rec[0][0] : 0;
      assert.ok(rec.length > 6 && behind[0] <= 14 && behind.every((b, k) => k === 0 || b <= behind[k - 1] + 0.5) && rec.every(([d], k) => d - d0 < 24 || Math.abs(behind[k]) < 1.5), `the pane follows the finger from its first move (${behind.map((b) => b.toFixed(0)).join(' ')})`);
      await page.waitForTimeout(300);
      const paused = await at();
      assert.ok(Math.abs(paused.dx - track.at(-1)[1].dx) < 0.5, 'holding half way, it stays');
      for (let i = 1; i <= 6; i++) await touch('touchMove', 156 + i * 12, 420);
      const back = await at();
      assert.ok(back.dx > paused.dx + 60, 'and comes back with the finger');
      assert.ok([...track.map(([, a]) => a), back].every((a) => a.on.every((v, k) => Math.abs(v - Math.max(0, 1 - Math.abs(a.i - k))) < 0.01)), 'label brightness follows the same position as the line');
      assert.ok([...track.map(([, a]) => a), back].every((a) => a.st === 'none'), 'the sort button never shrinks on its own timeline');
      await touch('touchEnd'); await page.waitForTimeout(700);
      // to For you: no placeholder text flashes before its pictures
      const flash = frames(`() => [...document.querySelectorAll('#homepager .card.idea .media')].some((m) => { const c = getComputedStyle(m, '::before').content; return c && c !== 'none' && c !== 'normal' && m.getBoundingClientRect().right > 0 && m.getBoundingClientRect().left < innerWidth; })`, 1400);
      await page.locator('#tab-ideas').click();
      assert.ok((await flash).every((v) => !v), 'no "Preview unavailable" flashes on the way in');
      await page.locator('#tab-recent').click(); await page.waitForTimeout(700);
    }
    ok('N21/N22/N24 tabs: ready beside, finger-linked from the first move, pause and reverse, one timeline, no placeholder flash');

    // ---------- N23: the Ideas header is compact: no repeated label, no band, content higher ----------
    await scrollTo(0);
    {
      await page.locator('.pile[data-v]').first().click(); await page.waitForTimeout(800);
      await page.locator('#btab-ideas').click(); await page.waitForTimeout(900);
      const h = await page.evaluate(() => { const count = document.querySelector('#boardcount').getBoundingClientRect(), bar = document.querySelector('#boardbar'), tabs = document.querySelector('#boardseg').getBoundingClientRect(), search = document.querySelector('#boardgrid .ideas-search').getBoundingClientRect(), first = document.querySelector('#boardgrid .card.idea'); return { countToTabs: tabs.top - count.bottom, tabsH: tabs.height, toSearch: search.top - tabs.bottom, toGallery: first ? first.getBoundingClientRect().top - count.bottom : 0, band: getComputedStyle(bar).backgroundColor, label: !!document.querySelector('#boardgrid .ideas-tools .lbl') }; });
      assert.equal(h.label, false, 'no repeated "Ideas for" line');
      assert.equal(h.band, 'rgba(0, 0, 0, 0)', 'no black band behind the tabs until they stick');
      assert.ok(h.countToTabs < 20, `the count and the Saved / Ideas row sit together (${h.countToTabs}px)`);
      assert.ok(h.tabsH >= 44 && h.tabsH <= 48, `a 44–48px row (${h.tabsH})`);
      assert.ok(h.toGallery < 150, `the pictures start much higher (${Math.round(h.toGallery)}px below the count, was ~180)`);
      await page.evaluate(() => { while (nbBack()) { /* Home */ } }); await page.waitForTimeout(700);
    }
    ok('N23 compact Ideas header: title, count, one row, search with the ideas');

    // A Pinterest idea opens full screen of its own (never inside the board bar's layout, the reported screenshot):
    // open a board's options first, then an idea.
    {
      await scrollTo(0);
      const p = await page.locator('.pile[data-v]').first().boundingBox();
      await touch('touchStart', p.x + 40, p.y + 50); await page.waitForTimeout(600); await touch('touchEnd'); await page.waitForTimeout(500);
      await page.evaluate(() => nbBack()); await page.waitForTimeout(500);
      await page.locator('#tab-ideas').click(); await page.waitForTimeout(900);
      await page.locator('#homegrid .card.idea').first().click(); await page.waitForTimeout(600);
      const v = await page.locator('.ideaview').evaluate((f) => ({ w: f.getBoundingClientRect().width, img: f.querySelector('.iv-img').getBoundingClientRect().width, sheet: !document.querySelector('#formsheet').hidden, buttons: [...f.querySelectorAll('.btn')].every((b) => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().height <= 50) }));
      assert.ok(v.w >= 360 && v.img > 250 && !v.sheet && v.buttons, `the idea opens full screen, on its own (${JSON.stringify(v)})`);
      await page.evaluate(() => nbBack()); await page.waitForTimeout(700);
      await page.locator('#tab-recent').click(); await page.waitForTimeout(700);
    }
    ok('A Pinterest idea opens full screen, on its own, after the board options were open');

    assert.deepEqual(errors, []);
    console.log('Phone findings passed (motion audit N01–N24):\n  ' + passed.join('\n  '));
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
