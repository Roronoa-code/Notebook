// The 1 October 2026 fix pack (NBF-01 to NBF-07): picture returns, For you publication, the picking bar coming out
// of the +, picked-card spacing and taps, each checked frame by frame on the mock bridge in headless Edge. No phone,
// no library, no real mouse or keyboard. Test pictures are the mock's own sample images.
// Usage: node scripts/test-phone-continuity.js
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const URL = pathToFileURL(path.resolve(__dirname, '../phone/app/src/main/assets/www/index.html')).href;
const HOUR = 3600e3;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--allow-file-access-from-files'] });
  const passed = [];
  const ok = (name) => passed.push(name);
  // NB_ALL=1: every group runs and reports, for comparing builds (the default stops at the first failure)
  const failed = [];
  const group = async (fn) => { try { await fn(); } catch (e) { if (!process.env.NB_ALL) throw e; failed.push(e.message.split('\n')[0].slice(0, 300)); } };
  try {
    // `stale`: the phone's cached ideas are hours old, so opening For you rechecks them quietly; the recheck answers
    // with a different set (as Pinterest did in the recording).
    const start = async ({ stale = false, reduced = false } = {}) => {
      const page = await browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      if (stale) {
        await page.addInitScript((HOUR) => {
          let n;
          Object.defineProperty(window, 'NBNative', { configurable: true, get: () => n, set: (v) => {
            n = v;
            const feed = v.feed;
            v.feed = () => { const d = JSON.parse(feed()); d.fetchedAt = new Date(Date.now() - 2 * HOUR).toISOString(); for (const f of Object.values(d.feeds)) f.at = Date.now() - 2 * HOUR; return JSON.stringify(d); };
            v.feedRefresh = (k) => { // a different set, as a fresh look at Pinterest would bring
              window.NB_MOCK_CALLS.push(['feedRefresh', k]);
              const pin = (i, sig, h) => ({ id: String(700000 + i), url: `https://www.pinterest.com/pin/${700000 + i}/`, sig, w: 600, h, title: `Fresh ${i}`, saved: false });
              const d = JSON.parse(feed());
              d.feeds[k] = { at: Date.now(), more: false, pins: [pin(1, 'wall1', 800), pin(2, 'pfp1', 750), pin(3, 'outfit1', 800), pin(4, 'icons1', 600)] };
              setTimeout(() => window.nbOnFeed(JSON.stringify({ ...d, key: k })), 900); // (a second or so, as over the network)
            };
          } });
        }, HOUR);
      }
      await page.goto(URL);
      await page.evaluate(() => { document.documentElement.style.setProperty('--st', '28px'); document.documentElement.style.setProperty('--sb', '16px'); });
      await page.waitForTimeout(700);
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }] });
      const frames = (src, ms) => { const p = page.evaluate(([src, ms]) => new Promise((res) => { const f = new Function('return (' + src + ')()'); const out = []; const t0 = performance.now(); const step = () => { out.push(f()); if (performance.now() - t0 < ms) requestAnimationFrame(step); else res(out); }; requestAnimationFrame(step); }), [src, ms]); p.catch(() => {}); return p; };
      return { page, errors, touch, frames };
    };
    const forYou = async (page) => { await page.locator('#tab-ideas').click(); await page.locator('#homegrid .ideacols .card.idea').first().waitFor(); await page.waitForTimeout(700); };
    const columns = (page) => page.evaluate(() => [...document.querySelectorAll('#homegrid .ideacol')].map((c) => [...c.querySelectorAll('.card.idea')].map((x) => x.dataset.v)));
    const box = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
    // One picture on screen for the pin, every frame: the flying one or its card's, never both, never neither.
    const SEEN = `() => {
      const id = window.__pin, iv = document.querySelector('.ideaview'), img = iv && iv.querySelector('.iv-img');
      const flying = !!img && +getComputedStyle(img).opacity > 0.02;
      const cards = [...document.querySelectorAll('.grid:not(.peek) .card.idea[data-v="' + id + '"] .media')].filter((m) => m.getClientRects().length && getComputedStyle(m).visibility === 'visible');
      const r = img && img.getBoundingClientRect();
      return { flying, cards: cards.length, open: !!iv, img: r && { x: r.left, y: r.top, w: r.width, h: r.height }, orb: (() => { const o = document.querySelector('#orb'); return { shown: !o.hidden && +getComputedStyle(o).opacity > 0.05, inert: o.inert }; })() };
    }`;
    const oneEach = (fr) => fr.filter((f) => (f.flying ? 1 : 0) + f.cards !== 1);

    // ---------- NBF-01 / T01-T02: dragged down while its save finishes, and the grid drawn again meanwhile ----------
    await group(async () => {
      const { page, errors, touch, frames } = await start();
      await forYou(page);
      const id = await page.locator('#homegrid .card.idea').nth(1).getAttribute('data-v');
      await page.evaluate((id) => { window.__pin = id; window.__saves = []; NBNative.feedSave = (url) => { window.__saves.push(url); }; }, id);
      await page.locator(`#homegrid .card.idea[data-v="${id}"]`).click();
      await page.waitForTimeout(600);
      await page.locator('.ideaview [data-a="ideaSave"]').click();
      await page.waitForTimeout(100);
      assert.equal(await page.locator(`#homegrid .card.idea[data-v="${id}"] .idea-saving`).count(), 1, 'its card says Saving… in place');
      const img = await box(page, '.ideaview .iv-img');
      const watch = frames(SEEN, 1500);
      await touch('touchStart', img.cx, img.cy);
      for (let i = 1; i <= 10; i++) { await touch('touchMove', img.cx + i * 2, img.cy + i * 22); await page.waitForTimeout(16); }
      await touch('touchEnd');
      // mid-way home: the save finishes, and then the whole Ideas grid is drawn again (another feed's answer redraws it)
      await page.waitForTimeout(120);
      await page.evaluate(() => { const d = JSON.parse(NBNative.feed()); window.nbOnIdeaSaved(JSON.stringify({ url: window.__saves[0], ok: true })); d.feeds['search:elsewhere'] = { at: Date.now(), pins: [] }; window.nbOnFeed(JSON.stringify({ ...d, key: 'search:elsewhere' })); });
      const fr = await watch;
      const bad = oneEach(fr);
      assert.ok(fr.some((f) => f.flying) && fr.some((f) => !f.open), 'it flew home and the preview closed');
      assert.equal(bad.length, 0, `exactly one picture of the pin in every frame, through the save and the redraw (${bad.length} frames wrong: ${JSON.stringify(bad[0])})`);
      const after = await page.evaluate((id) => { const c = document.querySelector(`#homegrid .card.idea[data-v="${id}"]`); return { tick: !!c.querySelector('.ideatick'), saving: !!c.querySelector('.idea-saving'), shown: getComputedStyle(c.querySelector('.media')).visibility, veils: [...document.querySelectorAll('style')].filter((s) => /visibility: hidden/.test(s.textContent)).length, layers: document.querySelectorAll('.ideaview').length }; }, id);
      assert.deepEqual(after, { tick: true, saving: false, shown: 'visible', veils: 0, layers: 0 }, 'it lands saved, visible, with nothing left behind');
      // a late or repeated save answer changes nothing
      await page.evaluate(() => window.nbOnIdeaSaved(JSON.stringify({ url: window.__saves[0], ok: true })));
      assert.equal(await page.locator(`#homegrid .card.idea[data-v="${id}"] .ideatick`).count(), 1, 'a repeated save answer adds no second tick');
      // the hand-off: the picture's last frame sits exactly over the card (≤ 1px)
      const last = fr.filter((f) => f.flying).at(-1).img, card = await box(page, `#homegrid .card.idea[data-v="${id}"] .media`);
      const off = Math.max(Math.abs(last.x - card.x), Math.abs(last.y - card.y), Math.abs(last.w - card.w), Math.abs(last.h - card.h));
      assert.ok(off <= 1, `it parks exactly on its card (${off.toFixed(2)}px)`);
      // a failed save stays retryable
      await page.locator('#homegrid .card.idea').nth(2).click(); await page.waitForTimeout(600);
      await page.locator('.ideaview [data-a="ideaSave"]').click(); await page.waitForTimeout(80);
      await page.evaluate(() => window.nbOnIdeaSaved(JSON.stringify({ url: window.__saves.at(-1), ok: false, message: 'No connection' })));
      await page.waitForTimeout(80);
      assert.equal(await page.locator('.ideaview [data-a="ideaSave"]').count(), 1, 'a failed save can be tried again');
      await page.evaluate(() => nbBack()); await page.waitForTimeout(700);
      assert.deepEqual(errors, [], 'no page errors');
      ok('NBF-01 one picture through save, redraw and hand-off (T01, T02)');
      await page.close();
    });

    // ---------- NBF-01 / T03-T04: closed while still opening; its card gone; NBF-06 the + with it ----------
    await group(async () => {
      const { page, errors, frames } = await start();
      await forYou(page);
      const id = await page.locator('#homegrid .card.idea').nth(0).getAttribute('data-v');
      await page.evaluate((id) => { window.__pin = id; }, id);
      const watch = frames(SEEN, 1300);
      await page.locator(`#homegrid .card.idea[data-v="${id}"]`).click();
      await page.waitForTimeout(150);
      await page.evaluate(() => nbBack()); // straight back, mid-way out
      const fr = await watch;
      const moving = fr.filter((f) => f.img);
      let jump = 0;
      for (let i = 1; i < moving.length; i++) { const a = moving[i - 1].img, b = moving[i].img; jump = Math.max(jump, Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2), Math.abs(a.w - b.w)); }
      assert.ok(jump < 60, `turning back mid-way carries on from where the picture is (largest step ${jump.toFixed(1)}px)`);
      assert.equal(oneEach(fr).length, 0, 'one picture in every frame, out and back');
      // NBF-06: the + rises while the picture goes home, and can't be pressed until it has gone
      const rising = fr.filter((f) => f.open && f.orb.shown);
      assert.ok(rising.length > 3, `the + comes back during the same move (${rising.length} frames before the picture lands)`);
      assert.ok(rising.every((f) => f.orb.inert), 'and can’t be pressed while the picture still owns the screen');
      assert.equal(await page.locator('#orb').evaluate((o) => !o.hidden && !o.inert), true, 'usable once it has landed');
      // T04: its card disappears while it is open (Not for me elsewhere, a new set): it goes without flying to another
      await page.locator('#homegrid .card.idea').nth(1).click(); await page.waitForTimeout(600);
      const gone = await page.evaluate(() => window.__pin = document.querySelector('.ideaview') && [...document.querySelectorAll('#homegrid .card.idea')][1].dataset.v);
      await page.evaluate((gone) => { const d = JSON.parse(NBNative.feed()); d.feeds.all.pins = d.feeds.all.pins.filter((p) => p.id !== gone); window.nbOnFeed(JSON.stringify({ ...d, key: 'all' })); }, gone);
      await page.waitForTimeout(200);
      await page.evaluate(() => nbBack()); await page.waitForTimeout(700);
      const left = await page.evaluate(() => ({ layers: document.querySelectorAll('.ideaview').length, veils: [...document.querySelectorAll('style')].filter((s) => /visibility: hidden/.test(s.textContent)).length, hidden: [...document.querySelectorAll('#homegrid .card.idea .media')].filter((m) => getComputedStyle(m).visibility !== 'visible').length }));
      assert.deepEqual(left, { layers: 0, veils: 0, hidden: 0 }, 'with no card to go to, it simply goes; nothing stays hidden');
      // T03: rapid open/close cycles leave one usable list
      for (let i = 0; i < 4; i++) { await page.locator('#homegrid .card.idea').nth(i % 3).click(); await page.waitForTimeout(60 + i * 40); await page.evaluate(() => nbBack()); await page.waitForTimeout(90); }
      await page.waitForTimeout(700);
      assert.equal(await page.locator('.ideaview').count(), 0, 'rapid open and close: nothing left open');
      await page.locator('#homegrid .card.idea').nth(0).click(); await page.waitForTimeout(500);
      assert.equal(await page.locator('.ideaview').count(), 1, 'and the next tap opens a picture as normal');
      await page.evaluate(() => nbBack()); await page.waitForTimeout(700);
      assert.deepEqual(errors, [], 'no page errors');
      ok('NBF-01/06 interrupted return, missing card, the + returning with it (T03, T04, T12)');
      await page.close();
    });

    // ---------- T05: reduced motion ----------
    await group(async () => {
      const { page, errors } = await start({ reduced: true });
      await forYou(page);
      await page.locator('#homegrid .card.idea').nth(0).click(); await page.waitForTimeout(200);
      await page.evaluate(() => nbBack()); await page.waitForTimeout(200);
      const left = await page.evaluate(() => ({ layers: document.querySelectorAll('.ideaview').length, veils: [...document.querySelectorAll('style')].filter((s) => /visibility: hidden/.test(s.textContent)).length, orb: !document.querySelector('#orb').hidden && !document.querySelector('#orb').inert }));
      assert.deepEqual(left, { layers: 0, veils: 0, orb: true }, 'reduced motion: closes at once, card shown, + usable');
      assert.deepEqual(errors, [], 'no page errors');
      ok('T05 reduced motion ends in the right state');
      await page.close();
    });

    // ---------- NBF-02 / T06-T08: what is being read stays; only asking replaces it ----------
    await group(async () => {
      const { page, errors } = await start({ stale: true });
      await page.locator('#tab-ideas').click();
      await page.waitForFunction(() => document.querySelectorAll('#homegrid .ideacols .card.idea').length > 0, null, { polling: 'raf' });
      const first = await columns(page);
      await page.waitForTimeout(700);
      assert.ok((await page.evaluate(() => window.NB_MOCK_CALLS)).some((c) => c[0] === 'feedRefresh' && c[1] === 'all'), 'old ideas are rechecked when For you opens');
      assert.equal(await page.locator('.ideas-refresh.turning').count(), 0, 'quietly: the New ideas button doesn’t turn for a recheck');
      // watch the visible order for three seconds while the recheck answers with another set and more pages come
      const snaps = [];
      for (let i = 0; i < 15; i++) { snaps.push(await columns(page)); await page.waitForTimeout(200); }
      const keeps = (a, b) => a.every((col, i) => b[i].slice(0, col.length).join() === col.join());
      assert.ok(snaps.every((s) => keeps(first, s)), 'the set on screen never changes by itself: same pins, same order, same columns');
      for (let i = 1; i < snaps.length; i++) assert.ok(keeps(snaps[i - 1], snaps[i]), 'later pins only ever join the bottom');
      await page.locator('#homescroll').evaluate((l) => { l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
      await page.waitForTimeout(600);
      const ids = (await columns(page)).flat();
      assert.ok(ids.some((v) => v.startsWith('7000')), 'the recheck’s fresh pins join at the bottom');
      assert.equal(new Set(ids).size, ids.length, 'no pin twice');
      // a save answer never redraws the feed
      await page.evaluate(() => { document.querySelectorAll('#homegrid .card.idea').forEach((c) => { c.dataset.kept = '1'; }); const p = JSON.parse(NBNative.feed()).feeds.all.pins[0]; window.nbOnIdeaSaved(JSON.stringify({ url: p.url, ok: true })); });
      assert.equal(await page.locator('#homegrid .card.idea:not([data-kept])').count(), 0, 'a save answer changes its card in place, nothing is redrawn');
      // T06: a search is asked for, then left before it answers: its answer (and a late error) can't touch For you
      await page.evaluate(() => { window.__held = []; NBNative.feedRefresh = (k) => window.__held.push(k); });
      await page.locator('#homescroll').evaluate((l) => { l.scrollTop = 0; });
      await page.locator('.idea-query').fill('cats'); await page.locator('.idea-query').press('Enter');
      await page.waitForTimeout(300);
      await page.evaluate(() => nbBack()); await page.waitForTimeout(300);
      const before = await columns(page), toasts = await page.locator('.toast').count();
      await page.evaluate(() => { const d = JSON.parse(NBNative.feed()); d.feeds['search:cats'] = { at: Date.now(), pins: [] }; window.nbOnFeed(JSON.stringify({ ...d, key: 'search:cats' })); window.nbOnFeed(JSON.stringify({ feeds: {}, key: 'search:cats', error: 'Couldn’t reach Pinterest.' })); });
      await page.waitForTimeout(300);
      assert.deepEqual(await columns(page), before, 'a search answered after leaving it leaves For you as it was');
      assert.equal(await page.locator('.toast').count(), toasts, 'and its late error says nothing on this screen');
      // T07: New ideas is one deliberate replacement
      await page.evaluate(() => { window.__held = []; NBNative.feedReload = (k) => { window.NB_MOCK_CALLS.push(['feedReload', k]); const d = JSON.parse(NBNative.feed()); d.feeds[k].pins = d.feeds[k].pins.slice(0, 3).reverse(); d.feeds[k].more = false; setTimeout(() => window.nbOnFeed(JSON.stringify({ ...d, key: k })), 120); }; });
      await page.locator('.ideas-refresh').click();
      assert.equal(await page.locator('.ideas-refresh.turning').count(), 1, 'New ideas shows it is working');
      await page.waitForTimeout(2200);
      assert.equal((await columns(page)).flat().length, 3, 'and replaces the set once its answer is in');
      assert.equal(await page.locator('.ideas-refresh.turning').count(), 0, 'then rests');
      assert.deepEqual(errors, [], 'no page errors');
      ok('NBF-02 For you keeps what is shown; rechecks append, asking replaces once; late answers stay out (T06, T07, T08)');
      await page.close();
    });

    // ---------- NBF-03 / NBF-04 / NBF-05: picking one card ----------
    await group(async () => {
      const { page, errors, touch, frames } = await start();
      await page.locator('#homescroll').evaluate((l) => { l.scrollTop = 300; }); await page.waitForTimeout(300);
      // cards fully on screen, the first one to hold having a neighbour on each side of it
      const ids = await page.evaluate(() => [...document.querySelectorAll('#homegrid > .card[data-a="open"]')].filter((c) => { const r = c.getBoundingClientRect(); return r.top > 120 && r.bottom < 600; }).map((c) => c.dataset.v));
      const rects = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#homegrid > .card')].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).map((c) => { const r = c.getBoundingClientRect(); return [c.dataset.v || c.dataset.stack, [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10)]; })));
      const base = await rects();
      const c = await box(page, `#homegrid > .card[data-v="${ids[1]}"]`);
      const watch = frames(`() => {
        const bar = document.querySelector('#selbar'), st = document.querySelector('#selstack'), s = NBSurface.state(), plus = document.querySelector('#morphsurface svg');
        const content = bar && !bar.hidden ? Math.max(...[...bar.children].map((k) => +getComputedStyle(k).opacity)) : 0;
        const card = document.querySelector('#homegrid > .card[data-v="${ids[1]}"]'), r = card.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(card).transform);
        return { out: s.out, riding: bar.classList.contains('riding'), inert: bar.inert, plus: s.out && plus ? +getComputedStyle(plus).opacity : 0, content, stack: st ? +getComputedStyle(st).opacity * (st.disabled ? 1 : -1) : null, count: (document.querySelector('#selcount') || {}).textContent, card: [r.left, r.top, r.width, r.height], scaled: m.a };
      }`, 1600);
      await touch('touchStart', c.cx, c.cy); await page.waitForTimeout(700); await touch('touchEnd');
      const fr = await watch;
      const shown = fr.filter((f) => f.count === '1 selected');
      assert.ok(shown.length > 10, `one card picked, the bar out (${fr.length} frames, ${JSON.stringify(fr.at(-1))}, ids ${ids})`);
      // NBF-03: Stack (needs two) is as dim on the way as at rest
      const lit = fr.filter((f) => f.stack !== null && f.content > 0.05 && f.stack > 0.5 * f.content + 0.02);
      // NBF-04: never an empty shape: the + stays until the bar’s contents take over, and the two never both show fully
      const morph = fr.filter((f) => f.out && f.riding);
      const empty = morph.filter((f) => Math.max(f.plus, f.content) < 0.3);
      // NBF-05: the picked card and its neighbours keep their places and their gaps
      const moved = fr.filter((f) => Math.abs(f.card[2] - c.w) > 1 || Math.abs(f.card[3] - c.h) > 1 || Math.abs(f.scaled - 1) > 0.001);
      const verdicts = [
        [lit.length === 0, `NBF-03 Stack is never brighter than disabled while one card is picked (${lit.length} frames; worst ${JSON.stringify(lit[0])})`],
        [morph.length > 4 && empty.length === 0, `NBF-04 something shows in every frame of the + becoming the bar (${empty.length} of ${morph.length} frames empty: ${JSON.stringify(empty[0])})`],
        [moved.length === 0, `NBF-05 held and picked, the card keeps its own size (${moved.length} frames grown; worst ${JSON.stringify(moved[0] && { card: moved[0].card, scaled: moved[0].scaled })})`]
      ];
      if (process.env.NB_ALL) for (const [good, msg] of verdicts) console.log(`  ${good ? 'pass' : 'FAIL'}: ${msg.split(' (')[0]}${good ? '' : ' (' + msg.split(' (').slice(1).join(' (')}`);
      for (const [good, msg] of verdicts) assert.ok(good, msg);
      assert.equal(await page.locator('#selstack').isDisabled(), true, 'and it is disabled');
      assert.ok(morph.every((f) => Math.min(f.plus, f.content) < 0.35), `the + and the bar hand over rather than overlap (${JSON.stringify(morph.map((f) => [+f.plus.toFixed(2), +f.content.toFixed(2)]))})`);
      assert.ok(morph.every((f) => f.inert), 'the bar can’t be pressed until it has arrived');
      const now = await rects();
      for (const [k, r] of Object.entries(base)) assert.deepEqual(now[k], r, `card ${k} has not moved`);
      const ring = await page.locator(`#homegrid > .card[data-v="${ids[1]}"]`).evaluate((e) => { const b = getComputedStyle(e, '::before'); return { inset: [b.top, b.right, b.bottom, b.left].join(' '), outline: getComputedStyle(e).outlineStyle, ring: /inset/.test(b.boxShadow) }; });
      assert.deepEqual(ring, { inset: '0px 0px 0px 0px', outline: 'none', ring: true }, 'its ring is drawn inside its own edges');
      // two picked: Stack lights up, and the count, look and action agree
      await page.locator(`#homegrid > .card[data-v="${ids[2]}"]`).click(); await page.waitForTimeout(300);
      assert.equal(await page.locator('#selcount').textContent(), '2 selected');
      assert.equal(await page.locator('#selstack').evaluate((b) => !b.disabled && +getComputedStyle(b).opacity === 1), true, 'two picked: Stack is on');
      await page.locator(`#homegrid > .card[data-v="${ids[2]}"]`).click(); await page.waitForTimeout(300);
      assert.equal(await page.locator('#selstack').evaluate((b) => b.disabled && Math.abs(+getComputedStyle(b).opacity - 0.5) < 0.01), true, 'back to one: off again, at once');
      await page.evaluate(() => { document.querySelector('#selstack').click(); });
      assert.equal(await page.evaluate(() => document.querySelectorAll('#homegrid .stackcard').length), 0, 'a disabled Stack does nothing even when clicked directly');
      await page.evaluate(() => nbBack()); await page.waitForTimeout(600);
      const back = await rects();
      for (const [k, r] of Object.entries(base)) assert.deepEqual(back[k], r, `unpicked, card ${k} is where it was`);
      // T10: hold and let go again at once, a few times: one bar, no stray layers
      for (let i = 0; i < 3; i++) { await touch('touchStart', c.cx, c.cy); await page.waitForTimeout(650); await touch('touchEnd'); await page.waitForTimeout(90 + i * 60); await page.evaluate(() => nbBack()); await page.waitForTimeout(120); }
      await page.waitForTimeout(800);
      assert.deepEqual(await page.evaluate(() => ({ bar: !document.querySelector('#selbar').hidden, riding: document.querySelectorAll('.riding').length, surface: NBSurface.state().out, orb: !document.querySelector('#orb').hidden })), { bar: false, riding: 0, surface: false, orb: true }, 'repeated hold and cancel ends as the + alone');
      assert.deepEqual(errors, [], 'no page errors');
      ok('NBF-03/04/05 Stack dim from the first frame, no empty shape, picked cards keep their space (T09, T10, T11)');
      await page.close();
    });

    // ---------- NBF-08 / T14: Newest reads across the top, pinned first, and keeps its places ----------
    await group(async () => {
      const { page, errors, touch } = await start();
      // where each card sits, in Newest order: [title, column, top]
      const places = () => page.evaluate(() => { const st = JSON.parse(NBNative.state()); const x0 = document.querySelector('#homegrid').getBoundingClientRect().left + 20; return [...document.querySelectorAll('#homegrid > .card')].map((c) => { const r = c.getBoundingClientRect(); return [(st.items.find((x) => x.id === c.dataset.v) || {}).title || c.dataset.stack, r.left > x0 + 60 ? 1 : 0, Math.round(r.top)]; }).sort((a, b) => a[2] - b[2] || a[1] - b[1]); });
      const newest = () => page.evaluate(() => { const st = JSON.parse(NBNative.state()); return st.items.filter((x) => !x.deletedAt).sort((a, b) => Date.parse(b.importedAt) - Date.parse(a.importedAt)).map((x) => x.title); });
      // pin one note (as in the recording: a pinned note, then the newest saves)
      await page.locator('#homegrid > .card:has(.notecard)').first().evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
      const note = await box(page, '#homegrid > .card:has(.notecard)');
      await touch('touchStart', note.cx, note.cy); await page.waitForTimeout(700); await touch('touchEnd'); await page.waitForTimeout(400);
      await page.locator('#selpin').click(); await page.waitForTimeout(900);
      await page.locator('#homescroll').evaluate((l) => { l.scrollTop = 0; }); await page.waitForTimeout(300);
      const order = await newest(), pinned = await page.locator('#homegrid > .card:has(.notecard) .notecard .t').first().textContent();
      const p0 = await places();
      const first = p0.slice(0, 3).map((x) => x[0]);
      assert.equal(first[0].toLowerCase(), pinned.toLowerCase(), 'the pinned note comes first');
      const rest = order.filter((t) => t.toLowerCase() !== pinned.toLowerCase());
      assert.deepEqual([p0[1][0], p0[2][0]].sort(), rest.slice(0, 2).sort(), 'the two newest sit at the top beside it, not down the column under it');
      assert.ok(p0[0][1] !== p0[1][1] || p0[0][1] !== p0[2][1], 'the top row uses both columns');
      // each card goes to the shorter column in Newest order: a card never sits above one newer than it in its column
      for (const c of [0, 1]) { const col = p0.filter((x) => x[1] === c).map((x) => x[0]); const idx = col.map((t) => [pinned.toLowerCase(), ...rest.map((x) => x.toLowerCase())].indexOf(String(t).toLowerCase())); assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `column ${c + 1} reads newest to oldest`); }
      // re-entry and late pictures change nothing
      await page.locator('#tab-notes').click(); await page.waitForTimeout(700); await page.locator('#tab-recent').click(); await page.waitForTimeout(900);
      await page.locator('#homescroll').evaluate((l) => { l.scrollTop = 0; }); await page.waitForTimeout(200);
      assert.deepEqual(await places(), p0, 'leaving and coming back: every card in the same place');
      await page.evaluate(() => document.querySelectorAll('#homegrid img').forEach((i) => { const s = i.src; i.src = ''; i.src = s; }));
      await page.waitForTimeout(600);
      assert.deepEqual(await places(), p0, 'pictures arriving again move nothing (their shapes are kept)');
      // one more save arrives: it takes the top, the rest keep their columns' order
      await page.evaluate(() => { const r = JSON.parse(NBNative.addNote('')); NBNative.update(r.id, JSON.stringify({ title: 'Fresh note', html: '<p>New</p>' })); nbOnState(NBNative.state()); });
      await page.waitForTimeout(900);
      await page.locator('#homescroll').evaluate((l) => { l.scrollTop = 0; }); await page.waitForTimeout(200);
      const p1 = await places();
      assert.equal(p1.findIndex((x) => x[0] === 'Fresh note') <= 2, true, 'a new save lands in the top row');
      assert.equal(p1.filter((x) => x[0] === 'Fresh note').length, 1, 'once');
      assert.deepEqual(errors, [], 'no page errors');
      ok('NBF-08 Newest across the top, pinned first, stable on re-entry and decode (T14)');
      await page.close();
    });

    // ---------- NBF-07 / T13: taps, holds, scrolls and a cancelled touch on For you ----------
    await group(async () => {
      const { page, errors, touch } = await start();
      await forYou(page);
      // a pin wholly on screen (below the search line, above the +)
      const visible = () => page.evaluate(() => { const c = [...document.querySelectorAll('#homegrid .card.idea')].map((e) => e.getBoundingClientRect()).find((r) => r.top + r.height / 2 > 150 && r.top + r.height / 2 < innerHeight - 120); return { cx: c.left + c.width / 2, cy: c.top + c.height / 2 }; });
      const c = await visible();
      const opened = async () => { const n = await page.locator('.ideaview').count(); if (n) { await page.evaluate(() => nbBack()); await page.waitForTimeout(650); } return n; };
      await touch('touchStart', c.cx, c.cy); await page.waitForTimeout(90); await touch('touchEnd'); await page.waitForTimeout(500);
      assert.equal(await opened(), 1, 'a still, short tap opens it, once');
      await touch('touchStart', c.cx, c.cy); for (let i = 1; i <= 8; i++) { await touch('touchMove', c.cx, c.cy - i * 12); await page.waitForTimeout(16); } await touch('touchEnd'); await page.waitForTimeout(500);
      assert.equal(await opened(), 0, 'a scroll doesn’t open a pin on release');
      await touch('touchStart', c.cx, c.cy); await page.waitForTimeout(60); await touch('touchCancel'); await page.waitForTimeout(200);
      const c2 = await visible();
      await touch('touchStart', c2.cx, c2.cy); await page.waitForTimeout(90); await touch('touchEnd'); await page.waitForTimeout(500);
      assert.equal(await opened(), 1, 'after a cancelled touch the next tap works');
      // straight after a picture has flown home (with its save landing on the way), the next tap works
      await page.evaluate(() => { NBNative.feedSave = (url) => setTimeout(() => window.nbOnIdeaSaved(JSON.stringify({ url, ok: true })), 300); });
      await page.locator('#homegrid .card.idea').nth(0).click(); await page.waitForTimeout(500);
      await page.locator('.ideaview [data-a="ideaSave"]').click(); await page.waitForTimeout(60);
      await page.evaluate(() => nbBack());
      await page.waitForTimeout(450);
      const c3 = await visible();
      await touch('touchStart', c3.cx, c3.cy); await page.waitForTimeout(110); await touch('touchEnd'); await page.waitForTimeout(500);
      assert.equal(await opened(), 1, 'a tap just after a return opens the next picture');
      // a long hold (as at 6.95–7.6 s in the recording): what this browser does is recorded, not judged
      await touch('touchStart', c3.cx, c3.cy); await page.waitForTimeout(650); await touch('touchEnd'); await page.waitForTimeout(500);
      console.log(`  (a 650 ms hold on a pin here ${await opened() ? 'opens it' : 'does nothing'}; pins have no hold action)`);
      assert.deepEqual(errors, [], 'no page errors');
      ok('NBF-07 tap, scroll, cancel and tap-after-return behave (T13)');
      await page.close();
    });

    if (failed.length) { console.log('Passed:\n  ' + passed.join('\n  ') + '\nFailed:\n  ' + failed.join('\n  ')); process.exitCode = 1; } else console.log('Continuity fixes passed:\n  ' + passed.join('\n  '));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
