// The recording audit of 30 September 2026 (1000168136.mp4, issues R01–R19 and checks V01–V05): each issue's pass
// condition, measured frame by frame on the mock bridge in headless Edge at the phone's own size (384×832). The
// phone's slow library calls are simulated (each one blocks the page for a while, as saving library.json does), which
// is what exposed the animation clocks running backwards. No phone, no real library, no real mouse or keyboard.
// Usage: node scripts/test-phone-recording.js
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--allow-file-access-from-files'] });
  const passed = [];
  const ok = (name) => { passed.push(name); console.log('  ' + name); };
  // NB_ALL=1: a group that fails is reported and the rest still run (to compare a build before and after).
  const failed = [];
  const group = async (fn, name) => { try { await fn(); ok(name); } catch (e) { if (!process.env.NB_ALL) throw e; failed.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0].slice(0, 220)}`); } };
  try {
    const page = await browser.newPage({ viewport: { width: 384, height: 832 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--st', '28px'); document.documentElement.style.setProperty('--sb', '16px');
      // As on the phone: every change blocks the page while the library is saved.
      const slow = (name, ms) => { const f = NBNative[name]; NBNative[name] = (...a) => { const t = performance.now() + ms; while (performance.now() < t) { /* saving */ } return f(...a); }; };
      ['bin', 'restore', 'update', 'addBoard', 'deleteBoard', 'renameBoard'].forEach((n) => slow(n, 90));
      // A few more things in the library, so the grid has depth and two columns to move between.
      const mk = (title, html) => { const r = JSON.parse(NBNative.addNote('')); NBNative.update(r.id, JSON.stringify({ title, html })); return r.id; };
      window.NOTE = mk('Shopping list', '<h2>Shopping list</h2><p>Milk, bread, the long list of things that wraps onto a few lines so the pin has words near it</p>');
      nbOnState(NBNative.state());
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const frames = (fnSrc, ms) => { const p = page.evaluate(([src, ms]) => new Promise((res) => { const f = new Function('return (' + src + ')()'); const out = []; const t0 = performance.now(); const step = () => { out.push({ t: performance.now() - t0, ...f() }); if (performance.now() - t0 < ms) requestAnimationFrame(step); else res(out); }; requestAnimationFrame(step); }), [fnSrc, ms]); p.catch(() => {}); return p; };
    const home = async () => { await page.evaluate(() => { while (nbBack()) { /* Home */ } }); await page.waitForTimeout(700); };
    const count = () => page.evaluate(() => parseInt(document.querySelector('#count').textContent, 10));
    // The bottom area, each frame: the surface, its purple, and every rider (drawn box and how visible its content is).
    const SHELL = `() => {
      const s = NBSurface.state(), c = s.out ? s.cur : null;
      const riders = [...document.querySelectorAll('.riding')].map((el) => { const r = el.getBoundingClientRect(); const kids = [...el.children]; return { id: el.id || el.className, vis: kids.length ? Math.max(...kids.map((k) => +getComputedStyle(k).opacity)) : 0, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      return { c, f: c ? c.f : 0, riders, count: parseInt(document.querySelector('#count').textContent, 10), words: document.querySelector('#toastbox')?.textContent.trim() || '' };
    }`;
    const inside = (fr) => fr.riders.every((r) => r.vis < 0.05 || !fr.c || (r.l >= fr.c.x - 1.5 && r.t >= fr.c.y - 1.5 && r.r <= fr.c.x + fr.c.w + 1.5 && r.b <= fr.c.y + fr.c.h + 1.5));
    const double = (fr) => fr.riders.filter((r) => r.vis > 0.15).length > 1;
    const emptyMs = (frs) => { let worst = 0, from = null; for (const fr of frs) { const empty = fr.c && fr.f < 0.05 && fr.riders.every((r) => r.vis < 0.05); if (empty && from === null) from = fr.t; if (!empty && from !== null) { worst = Math.max(worst, fr.t - from); from = null; } } return worst; };
    const shellOk = (frs, what, maxEmpty = 170) => {
      const out = frs.find((fr) => !inside(fr));
      assert.ok(!out, `${what}: what rides the surface is drawn whole inside it (never sliced by its edge) ${out ? JSON.stringify({ t: Math.round(out.t), c: out.c, riders: out.riders }) : ''}`);
      assert.ok(!frs.some(double), `${what}: the old and new contents never share the surface at once`);
      const e = emptyMs(frs);
      assert.ok(e <= maxEmpty, `${what}: the surface is never an empty shape for long (${Math.round(e)}ms)`);
      assert.ok(frs.every((fr) => !fr.c || (fr.c.x > -8 && fr.c.x + fr.c.w < 392 && fr.c.w > 20 && fr.c.h > 20)), `${what}: the surface stays on screen and never collapses to a sliver`);
    };

    // ---------- R04 R05 R06 R07: pick two, Bin, Undo (and again while the message is showing) ----------
    await group(async () => {
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 0; });
      await page.waitForTimeout(300);
      const ids =await page.evaluate(() => [...document.querySelectorAll('#homegrid > .card[data-a="open"]')].slice(1, 3).map((c) => c.dataset.v));
      const order0 = await page.evaluate(() => [...document.querySelectorAll('#homegrid > .card')].map((c) => c.dataset.v || c.dataset.stack));
      const n0 = await count();
      const a = await page.locator(`#homegrid > .card[data-v="${ids[0]}"]`).boundingBox();
      await touch('touchStart', a.x + 30, a.y + 30); await page.waitForTimeout(650); await touch('touchEnd'); await page.waitForTimeout(350);
      await page.locator(`#homegrid > .card[data-v="${ids[1]}"]`).click(); await page.waitForTimeout(600);
      assert.match(await page.locator('#selcount').textContent(), /2 selected/);
      const GRID = `() => { const cards = [...document.querySelectorAll('#homegrid > .card')].map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.v || c.dataset.stack, l: r.left, t: r.top, w: r.width, h: r.height, o: +getComputedStyle(c).opacity }; }); const ghosts = [...document.querySelectorAll('.screen > .ghost')].map((g) => ({ id: g.dataset.v, o: +getComputedStyle(g).opacity })); return { cards, ghosts }; }`;
      const wBin = frames(`() => ({ ...(${SHELL})(), ...(${GRID})() })`, 750); // (a message stays about a second before it folds: Undo is pressed within it)
      await page.locator('#selbin').click();
      const bin = await wBin;
      assert.ok(bin.every((f) => f.count >= n0 - 2 && f.count <= n0), `R05 Bin: the count stays between ${n0} and ${n0 - 2} (${[...new Set(bin.map((f) => f.count))].join(' ')})`);
      assert.equal(bin.at(-1).count, n0 - 2);
      assert.ok(bin.filter((f) => f.count < n0).slice(0, 4).some((f) => ids.every((id) => f.ghosts.some((g) => g.id === id && g.o > 0.3))), 'R04 both binned cards are still drawn leaving where they were');
      // every card that stays is traceable: it glides (no frame-to-frame leap) or cross-fades into another column
      const leaps = []; for (let k = 1; k < bin.length; k++) for (const c of bin[k].cards) { const p = bin[k - 1].cards.find((x) => x.id === c.id); if (p && c.o > 0.9 && p.o > 0.9 && Math.hypot(c.l - p.l, c.t - p.t) > 150) leaps.push(`${c.id} ${Math.round(bin[k - 1].t)}→${Math.round(bin[k].t)}ms ${Math.round(p.l)},${Math.round(p.t)}→${Math.round(c.l)},${Math.round(c.t)}`); }
      assert.deepEqual(leaps, [], 'R04 no card leaps between frames (more than 150px: the start of a fast glide is up to about a quarter of its way)');
      shellOk(bin, 'R04 picking bar into the message');
      const wUndo = frames(`() => ({ ...(${SHELL})(), ...(${GRID})() })`, 1300);
      await page.locator('#toastbox [data-a="undo"]').click();
      const undo = await wUndo;
      assert.ok(undo.every((f) => f.count >= n0 - 2 && f.count <= n0), `R05 Undo: the count stays between ${n0 - 2} and ${n0} (${[...new Set(undo.map((f) => f.count))].join(' ')})`);
      assert.equal(undo.at(-1).count, n0, 'R05 Undo lands on the exact count');
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#homegrid > .card')].map((c) => c.dataset.v || c.dataset.stack)), order0, 'R06 the same cards, in the same order, once');
      assert.ok(undo.every((f) => f.f < 0.02), 'R07 the confirmation never passes through the purple +');
      const from = undo.findIndex((f) => /Restored/.test(f.words));
      assert.ok(from >= 0 && undo.slice(from).every((f) => !f.words || f.words === 'Restored 2 things'), 'R07 one readable confirmation: "Restored 2 things", nothing else after it');
      shellOk(undo, 'R07 message into the confirmation');
      // no two cards pile up while they move: overlap between any two drawn cards stays small
      let pile = 0, who = ''; for (const f of undo) { const cs = f.cards.filter((c) => c.o > 0.5 && !ids.includes(c.id)); /* (a returning card grows in above the ones making room) */ for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const x = Math.max(0, Math.min(cs[i].l + cs[i].w, cs[j].l + cs[j].w) - Math.max(cs[i].l, cs[j].l)), y = Math.max(0, Math.min(cs[i].t + cs[i].h, cs[j].t + cs[j].h) - Math.max(cs[i].t, cs[j].t)); const o = (x * y) / Math.min(cs[i].w * cs[i].h, cs[j].w * cs[j].h); if (o > pile) { pile = o; who = `${Math.round(f.t)}ms ${cs[i].id}${ids.includes(cs[i].id) ? '(back)' : ''} ${cs[j].id}${ids.includes(cs[j].id) ? '(back)' : ''}`; } } }
      assert.ok(pile < 0.25, `R06 the cards that stay never form an accidental pile while they move (${pile.toFixed(2)} ${who})`);
      // Undo while the cards are still leaving: they come back once, from where they are
      await page.waitForTimeout(2500);
      await touch('touchStart', a.x + 30, a.y + 30); await page.waitForTimeout(650); await touch('touchEnd'); await page.waitForTimeout(350);
      await page.locator(`#homegrid > .card[data-v="${ids[1]}"]`).click(); await page.waitForTimeout(600);
      await page.locator('#selbin').click(); await page.waitForTimeout(90);
      await page.locator('#toastbox [data-a="undo"]').click(); await page.locator('#toastbox [data-a="undo"]').click({ timeout: 300 }).catch(() => {});
      await page.waitForTimeout(900);
      assert.equal(await count(), n0, 'R05 a quick (and repeated) Undo restores exactly once');
      assert.equal(await page.evaluate((i) => JSON.parse(NBNative.state()).items.filter((x) => i.includes(x.id) && !x.deletedAt).length, ids), 2);
      assert.equal(await page.locator('.screen > .ghost').count(), 0, 'R06 nothing left over from the leaving pictures');
      await page.waitForTimeout(2500);
    }, 'R04 R05 R06 R07 delete two and Undo: one transaction, bounded count, traceable cards, one confirmation');

    // ---------- R08: Recent → For you directly, with a long frame (building the pane) at the start ----------
    await group(async () => {
      const TAB = `() => ({ dx: new DOMMatrix(getComputedStyle(document.querySelector('#homegrid')).transform).m41, on: [...document.querySelectorAll('#homeseg button')].map((b) => +b.style.getPropertyValue('--on') || 0), sel: [...document.querySelectorAll('#homeseg button')].findIndex((b) => b.classList.contains('on')) })`;
      for (const [to, back] of [['ideas', false], ['recent', true], ['ideas', false], ['recent', true]]) {
        const w = frames(TAB, 800);
        await page.evaluate((t) => { document.querySelector('#tab-' + t).click(); requestAnimationFrame(() => { const e = performance.now() + 220; while (performance.now() < e) { /* busy */ } }); }, to);
        const fr = await w;
        const W = 384, dxs = fr.map((f) => f.dx);
        assert.ok(dxs.every((x) => (back ? x >= -1 && x <= W + 1 : x <= 1 && x >= -W - 1)), `R08 ${to}: the pane never passes its place (${Math.min(...dxs).toFixed(0)}…${Math.max(...dxs).toFixed(0)})`);
        assert.ok(dxs.every((x, k) => k === 0 || (back ? x >= dxs[k - 1] - 0.5 || x === 0 : x <= dxs[k - 1] + 0.5 || x === 0)), `R08 ${to}: it travels one way, never back`);
        assert.ok(fr.every((f) => f.on[1] < 0.05), 'R08 Notes never lights up on the way past it');
        assert.ok(fr.every((f) => f.sel === -1 || f.sel === (to === 'ideas' ? 2 : 0) || f.t < 20), 'R08 the chosen tab is the current one from the start');
        await page.waitForTimeout(300);
      }
      // reversal mid-way and rapid alternation
      await page.evaluate(() => document.querySelector('#tab-ideas').click()); await page.waitForTimeout(90);
      await page.evaluate(() => document.querySelector('#tab-recent').click()); await page.waitForTimeout(60);
      await page.evaluate(() => document.querySelector('#tab-notes').click()); await page.waitForTimeout(900);
      assert.equal(await page.locator('#tab-notes.on').count(), 1);
      await page.evaluate(() => document.querySelector('#tab-recent').click()); await page.waitForTimeout(900);
    }, 'R08 tapped tabs: one destination, no overshoot or wrong-side landing, Notes never lit on the way');

    // ---------- R15: after a change, the pane that slides in is the pane that stays ----------
    await group(async () => {
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 0; });
      await page.evaluate(() => document.querySelector('#tab-notes').click()); await page.waitForTimeout(900);
      await page.evaluate(() => { const id = JSON.parse(NBNative.state()).items.find((x) => x.kind === 'photo' && !x.deletedAt).id; NBNative.update(id, JSON.stringify({ title: 'Changed while on Notes' })); nbOnState(NBNative.state()); });
      await page.waitForTimeout(400);
      const PANE = `() => { const g = document.querySelector('#homegrid'), pk = document.querySelector('#homepager > .peek:not(.parked)'), el = pk || g, o = el.getBoundingClientRect(); return { pane: !!pk, cards: [...el.querySelectorAll(':scope > .card')].map((c) => { const r = c.getBoundingClientRect(); return (c.dataset.v || c.dataset.stack) + '@' + Math.round(r.left - o.left) + ',' + Math.round(r.top - o.top); }).join('|') }; }`;
      const w = frames(PANE, 900);
      await page.evaluate(() => document.querySelector('#tab-recent').click());
      const fr = await w;
      const moving = fr.filter((f) => f.pane).at(-1), settled = fr.at(-1);
      assert.ok(moving && !settled.pane, 'the pane slid in and landed');
      assert.equal(moving.cards, settled.cards, 'R15 the moving pane and the settled grid show the same cards in the same places');
    }, 'R15 Notes → Recent after a change: same cards, same places, before and after landing');

    // ---------- R09 R10 R11: For you, refresh ----------
    await group(async () => {
      await page.evaluate(() => document.querySelector('#tab-ideas').click()); await page.waitForTimeout(900);
      // every idea picture shows only once it has fully arrived, in a card that already has its final shape
      const imgs = await page.evaluate(() => [...document.querySelectorAll('#homegrid .card.idea img')].map((i) => ({ ready: i.classList.contains('ready'), complete: i.complete && i.naturalWidth > 0, o: +getComputedStyle(i).opacity })));
      assert.ok(imgs.length && imgs.every((i) => (i.ready ? i.complete : i.o === 0)), 'R10 no idea picture is drawn before it has fully arrived');
      await page.evaluate(() => { const f = NBNative.feedReload; window.__held = []; NBNative.feedReload = (k) => { window.__held.push(() => f(k)); }; });
      const top = () => page.evaluate(() => Math.round(document.querySelector('#homegrid .ideacols').getBoundingClientRect().top));
      const t0 = await top();
      const calls0 = await page.evaluate(() => NB_MOCK_CALLS.length);
      await page.locator('#homegrid .ideas-refresh').click(); await page.waitForTimeout(250);
      assert.equal(await top(), t0, 'R09 starting a refresh does not move the pictures');
      assert.equal(await page.locator('#homegrid .ideas-refresh.turning').count(), 1, 'R11 the refresh shows on its button');
      await page.locator('#homegrid .ideas-refresh').click({ force: true }).catch(() => {});
      await page.evaluate(() => document.querySelector('#tab-recent').click()); await page.waitForTimeout(700);
      await page.evaluate(() => document.querySelector('#tab-ideas').click()); await page.waitForTimeout(700);
      assert.equal(await page.evaluate(() => window.__held.length), 1, 'R11 one request at a time: tapping again or leaving and coming back asks nothing more');
      assert.ok(await page.evaluate((n) => NB_MOCK_CALLS.slice(n).every((c) => c[0] !== 'feedRefresh'), calls0), 'R11 no second request behind it');
      const orbs = await page.evaluate(() => document.querySelectorAll('#homegrid .ideas-refresh .nb-effect-orb').length);
      assert.equal(orbs, 0, 'R11 one pending look: the arrows turn, nothing swaps in');
      await page.evaluate(() => { NBNative.feedReload = null; window.__held.shift()(); });
      await page.waitForTimeout(1200);
      assert.equal(await top(), t0, 'R09 finishing a refresh does not move the pictures either');
      assert.equal(await page.locator('#homegrid .ideas-refresh.turning').count(), 0);
    }, 'R09 R10 R11 refresh: pictures stay put, one request, one look, complete pictures only');

    // ---------- R12 R13 R14: a pin opens full screen out of itself; Not for me ----------
    await group(async () => {
      const CARDS = `() => ({ cards: [...document.querySelectorAll('#homegrid .card.idea')].map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.v, l: r.left, t: r.top }; }) })`;
      const first = page.locator('#homegrid .card.idea').first();
      const from = await first.locator('.media').boundingBox();
      const wOpen = frames(`() => { const i = document.querySelector('.iv-img'); if (!i) return { none: true }; const r = i.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width }; }`, 700);
      await first.click();
      const open = (await wOpen).filter((f) => !f.none);
      assert.ok(open.length && Math.abs(open[0].l - from.x) < 30 && Math.abs(open[0].w - from.width) < 40, `R12 the picture grows out of the pin that was tapped (${JSON.stringify(open[0])} from ${JSON.stringify(from)})`);
      let jump = 0; for (let k = 1; k < open.length; k++) jump = Math.max(jump, Math.abs(open[k].t - open[k - 1].t), Math.abs(open[k].w - open[k - 1].w));
      assert.ok(jump < 150, `R12 it grows continuously (${Math.round(jump)}px)`);
      assert.ok(open.at(-1).w > 250, 'R12 full screen');
      assert.equal(await page.locator('.ideaview [data-a="ideaHide"]').isVisible(), true);
      const wHide = frames(`() => ({ ...(${SHELL})(), ...(${CARDS})() })`, 1600);
      await page.locator('.ideaview [data-a="ideaHide"]').click();
      const hide = await wHide;
      shellOk(hide.filter((f) => f.c), 'R14 the + into "Idea hidden"');
      const leaps = []; for (let k = 1; k < hide.length; k++) for (const c of hide[k].cards) { const p = hide[k - 1].cards.find((x) => x.id === c.id); if (p && Math.hypot(c.l - p.l, c.t - p.t) > 150) leaps.push(c.id); }
      assert.deepEqual(leaps, [], 'R14 no idea card leaps across a column between frames');
      assert.equal(await page.locator('.ideaview').count(), 0);
      await page.waitForTimeout(3200);
    }, 'R12 R13 R14 pin: grows full screen out of itself; Not for me: the others glide into place');

    // ---------- R17 V03: New board and the keyboard ----------
    await group(async () => {
      await page.evaluate(() => document.querySelector('#tab-recent').click()); await page.waitForTimeout(700);
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 0; });
      const wOpen = frames(SHELL, 900);
      await page.locator('.pile.new').click();
      const open = await wOpen;
      shellOk(open, 'R13 New board growing out of the +');
      await page.waitForTimeout(300);
      // the app reports the keyboard every frame as it slides up: the form rides on it, frame for frame
      const y0 = await page.evaluate(() => document.querySelector('#formsheet').getBoundingClientRect().top);
      const ys = await page.evaluate(async () => { const out = []; for (let k = 1; k <= 16; k++) { const v = 330 * (1 - Math.pow(1 - k / 16, 3)); nbKeyboard(v, k < 16); await new Promise((r) => requestAnimationFrame(r)); out.push([v, document.querySelector('#formsheet').getBoundingClientRect().top]); } return out; });
      assert.ok(ys.every(([v, y]) => Math.abs(y0 - y - v) < 1.5), `R17 the form rides the keyboard (${ys.map(([v, y]) => Math.round(y0 - y - v)).join(' ')})`);
      // a tap beside the form while the keyboard is still moving is not "close"
      await page.evaluate(() => nbKeyboard(335, true));
      await page.evaluate(() => document.querySelector('#popscrim').click());
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => !document.querySelector('#formsheet').hidden && !document.querySelector('#formsheet').inert), true, 'V03 a tap as the keyboard moves the form does not close it');
      await page.evaluate(() => nbKeyboard(335, false));
      await page.waitForTimeout(450);
      // Cancel while typing: the form rides the keyboard down, then folds away
      await page.locator('#f1').focus();
      const wClose = frames(`() => ({ ...(${SHELL})(), y: document.querySelector('#formsheet').getBoundingClientRect().top, hidden: document.querySelector('#formsheet').hidden })`, 1200);
      await page.locator('#formsheet [data-a="closeForm"]').click();
      await page.evaluate(async () => { for (let k = 1; k <= 16; k++) { nbKeyboard(335 * Math.pow(1 - k / 16, 2), k < 16); await new Promise((r) => requestAnimationFrame(r)); } });
      const close = await wClose;
      const riding = close.filter((f) => !f.hidden && !f.c);
      let jump = 0; for (let k = 1; k < riding.length; k++) jump = Math.max(jump, Math.abs(riding[k].y - riding[k - 1].y));
      assert.ok(jump < 60, `R17 closing follows the keyboard down, no jump (${Math.round(jump)}px)`);
      shellOk(close.filter((f) => f.c), 'R13 New board folding back');
      await page.evaluate(() => nbKeyboard(0, false));
      await page.waitForTimeout(600);
    }, 'R17 V03 New board: rides the keyboard up and down frame for frame; a tap during that is not a dismissal');

    // ---------- R18 R19 V05: delete the last board from its options ----------
    await group(async () => {
      await home();
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 0; });
      await page.evaluate(() => { const r = document.querySelector('#rail'); r.scrollLeft = r.scrollWidth; });
      await page.waitForTimeout(400);
      const last = page.locator('.pile[data-v]').last();
      const lb = await last.boundingBox();
      await touch('touchStart', lb.x + 40, lb.y + 50); await page.waitForTimeout(650); await touch('touchEnd');
      await page.waitForTimeout(700);
      assert.equal(await page.locator('#formsheet.boardbar #f1').isVisible(), true);
      await page.locator('#formsheet [data-a="deleteBoard"]').click();
      assert.equal(await page.locator('#formsheet [data-a="deleteBoard"] .surelbl').isVisible(), true, 'V05 armed, the delete says what the next tap does');
      const RAIL = `() => ({ ...(${SHELL})(), piles: [...document.querySelectorAll('.pile')].map((p) => ({ id: p.dataset.v || 'new', l: p.getBoundingClientRect().left })) })`;
      const w = frames(RAIL, 750); // (Undo is pressed within the message's second)
      await page.locator('#formsheet [data-a="deleteBoard"]').click();
      const del = await w;
      let leap = 0; for (let k = 1; k < del.length; k++) for (const p of del[k].piles) { const q = del[k - 1].piles.find((x) => x.id === p.id); if (q) leap = Math.max(leap, Math.abs(p.l - q.l)); }
      assert.ok(leap < 60, `R18 the boards beside it glide, never a whole-slot leap (${Math.round(leap)}px in a frame)`);
      shellOk(del, 'R19 the board options into "Deleted"');
      assert.ok(del.every((f) => !(f.riders.some((r) => /formsheet|boardbar|popsheet/.test(r.id) && r.vis > 0.15) && f.riders.some((r) => /toast/.test(r.id) && r.vis > 0.15))), 'R19 Save and Undo never on screen together');
      const wU = frames(RAIL, 1300);
      await page.locator('#toastbox [data-a="undo"]').click();
      const und = await wU;
      leap = 0; for (let k = 1; k < und.length; k++) for (const p of und[k].piles) { const q = und[k - 1].piles.find((x) => x.id === p.id); if (q) leap = Math.max(leap, Math.abs(p.l - q.l)); }
      assert.ok(leap < 60, `R18 Undo: the boards glide back too (${Math.round(leap)}px)`);
      await page.waitForTimeout(3000);
    }, 'R18 R19 V05 deleting the last board: neighbours glide, one message, armed delete says so');

    // ---------- R01 V01: the PC can't be reached ----------
    await group(async () => {
      await page.evaluate(() => { const st = JSON.parse(NBNative.state()); st.sync = { paired: true, pcName: 'Mani', lastSync: new Date(Date.now() - 3600e3).toISOString() }; nbOnState(JSON.stringify(st)); });
      await page.evaluate(() => nbOnSync(JSON.stringify({ phase: 'error', message: "Can't find your PC. Make sure it's switched on with Notebook running, and that your phone is on the same Wi-Fi." })));
      await page.waitForTimeout(700);
      const msg = await page.evaluate(() => { const s = document.querySelector('#toastbox .words > span'); return { text: s.textContent, cut: s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1 }; });
      assert.equal(msg.text, "Can't find your PC.", 'R01 away from Sync, the message is one short sentence');
      assert.equal(msg.cut, false, 'R01 and nothing of it is cut off');
      assert.equal(await page.locator('#pulse span').textContent(), 'PC offline', 'V01 the status no longer says Synced while the PC is out of reach');
      await page.evaluate(() => { const s = document.querySelector('#toastbox .words > span'); s.textContent = 'A much longer message that needs two lines to be read at this width on the phone'; });
      const two = await page.evaluate(() => { const s = document.querySelector('#toastbox .words > span'); return s.scrollHeight <= s.clientHeight + 1 && s.getClientRects().length > 0; });
      assert.ok(two, 'R01 a longer message takes a second line instead of being cut');
      await page.evaluate(() => nbOnSync(JSON.stringify({ phase: 'done', status: { paired: true, pcName: 'Mani', lastSync: new Date().toISOString() } })));
      assert.equal(await page.locator('#pulse span').textContent(), 'Synced');
      await page.waitForTimeout(3000);
    }, 'R01 V01 the PC out of reach: a short readable message, and a status that says so');

    // ---------- R02: a pinned note keeps its words clear of the pin ----------
    await group(async () => {
      // pin it through the picking bar, as you would
      const c = await page.locator(`#homegrid > .card[data-v="${await page.evaluate(() => window.NOTE)}"]`).boundingBox();
      await touch('touchStart', c.x + 30, c.y + 30); await page.waitForTimeout(650); await touch('touchEnd'); await page.waitForTimeout(400);
      await page.locator('#selpin').click(); await page.waitForTimeout(900);
      const hit = await page.evaluate(() => {
        const card = document.querySelector(`#homegrid > .card[data-v="${window.NOTE}"]`), pin = card.querySelector('.pinmark').getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(card.querySelector('.notecard'));
        return [...range.getClientRects()].some((r) => r.width && r.left < pin.right && r.right > pin.left && r.top < pin.bottom && r.bottom > pin.top);
      });
      assert.equal(hit, false, 'R02 no letter of the note sits under the pin');
      await page.waitForTimeout(3000);
    }, 'R02 pinned note: the pin has its own corner');

    // ---------- R16: board covers are ready before they scroll into view ----------
    await group(async () => {
      const covers = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); return [...document.querySelectorAll('#rail .pile-img')].map((i) => ({ sync: i.getAttribute('decoding') === 'sync', done: i.complete && i.naturalWidth > 0 })); });
      assert.ok(covers.length && covers.every((c) => c.sync && c.done), 'R16 every cover in the rail, on screen or not, is loaded and drawn with its card');
    }, 'R16 board covers ready ahead of the sweep');

    // ---------- An empty board name: the white button itself says so (no new pop-up), then turns back ----------
    await group(async () => {
      await home();
      await page.locator('#homescroll').evaluate((el) => { el.scrollTop = 0; });
      await page.locator('.pile.new').click(); await page.waitForTimeout(900);
      const btn = page.locator('#formsheet [data-a="saveForm"]'), w0 = (await btn.boundingBox()).width;
      await btn.click(); await page.waitForTimeout(500);
      assert.equal(await btn.innerText(), 'Give the board a name');
      assert.ok((await btn.boundingBox()).width > w0 + 40, 'it stretches across the row');
      assert.equal(await page.locator('#toastbox .toast').count(), 0, 'no separate message');
      await page.locator('#f1').type('M'); await page.waitForTimeout(500);
      assert.equal(await btn.innerText(), 'Create board', 'typing turns it back');
      await page.locator('#formsheet [data-a="closeForm"]').click(); await page.waitForTimeout(900);
    }, 'Empty name: the Create board button becomes the message and back');

    assert.deepEqual(errors, [], 'no script errors');
    if (failed.length) { console.log(`${failed.length} of ${passed.length + failed.length} groups failed.`); process.exitCode = 1; return; }
    console.log(`Recording audit checks passed (${passed.length} groups).`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
