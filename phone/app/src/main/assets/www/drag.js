// Picking and carrying cards on every grid (screen changes and sheets: motion.js; flicking through stacks: stacks.js).
//   hold still        the card lifts under the finger (one firm tick); keep still and a moment later it is picked,
//                     the finger still down (the picking bar comes up)
//   hold, then move   it is carried: a small bundle of it (and of everything picked) follows the finger exactly,
//                     drawn above everything, and it leaves the grid (the cards below glide up into its place).
//                     Let go anywhere and it goes back into its place. To stack, rest on a card until its ring fills
//                     (it is ready to take them) and let go there. To file, go right onto the boards pill where the +
//                     is: it opens into every board; let go on one. A second finger scrolls the list meanwhile, and
//                     resting near the top or bottom edge scrolls it too.
//   move at once      sideways on a stack flicks through it; otherwise the tabs or the list take it, as always
// One gesture owns a touch from start to finish and follows only its finger. Everything is measured in the screen's
// own coordinates, and drop targets are fixed boxes (never whatever happens to be under the finger), so a highlight
// can't flicker and what lights up is what you drop on.
window.NBDrag = (ctx) => {
  const { S, app, tick } = ctx;
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOLD = 250, PICK = 520, SLOP = 10, EXIT = 12, DWELL = 420; // resting this long on a card makes it ready to stack onto
  const OFF = [{ x: 0, y: 0, r: 0 }, { x: 7, y: 7, r: 2 }, { x: -7, y: 9, r: -2 }]; // behind the front card: an edge always shows
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- picking ----------
  const cardIds = (c) => (c.classList.contains('stackcard') ? [...c.querySelectorAll('.fanitem')].map((b) => b.dataset.v) : [c.dataset.v]);
  function startSelect(c) { S.select = new Set(); tick(); toggleSelect(c); }
  function toggleSelect(c) {
    const ids = cardIds(c), on = !ids.every((id) => S.select.has(id));
    ids.forEach((id) => (on ? S.select.add(id) : S.select.delete(id)));
    markSelection(); ctx.updateChrome();
  }
  function markSelection() {
    app.querySelectorAll('.grid:not(.peek) .card').forEach((c) => {
      const on = !!S.select && cardIds(c).every((id) => S.select.has(id));
      c.classList.toggle('sel', on);
      if (S.select) c.setAttribute('aria-pressed', String(on)); else c.removeAttribute('aria-pressed');
    });
  }
  const pickedCards = () => app.querySelectorAll('.grid:not(.peek) .card.sel').length;
  function endSelect() { S.select = null; markSelection(); ctx.updateChrome(); }

  // ---------- the boards: a compact pill where the + is while carrying; right over it, it opens into every board,
  // big enough to aim at, the one you're over named above them ----------
  function showShelf(ids) {
    const shelf = ctx.$('#shelf'), mini = ctx.$('#shelfmini'), db = ctx.db(), set = new Set(ids);
    const here = db.items.filter((it) => set.has(it.id)).flatMap((it) => it.boards || []);
    const pins = window.nbPinned ? window.nbPinned() : [];
    const list = [...db.boards].sort((a, b) => (pins.includes(a.id) ? pins.indexOf(a.id) : 999) - (pins.includes(b.id) ? pins.indexOf(b.id) : 999));
    const rows = Math.max(1, Math.ceil(list.length / 5)), cols = Math.max(1, Math.ceil(list.length / rows));
    shelf.innerHTML = `<div class="shelflane" aria-hidden="true"><span id="shelfname"></span></div><div class="shelftiles" style="--cols:${cols}">${list.map((b) => {
      const pic = db.items.find((it) => !it.deletedAt && (it.boards || []).includes(b.id) && (it.thumb || (it.kind === 'photo' && it.file)));
      const name = ctx.esc(b.name);
      return `<div class="shelftile${here.includes(b.id) ? ' here' : ''}" data-board="${b.id}" data-name="${name}"><span class="mini">${cover(b, pic)}</span><span class="tn">${name}</span></div>`;
    }).join('')}</div>`;
    const few = list.slice(0, list.length > 5 ? 4 : 5);
    mini.innerHTML = few.map((b) => `<span class="mc">${cover(b, db.items.find((it) => !it.deletedAt && (it.boards || []).includes(b.id) && (it.thumb || (it.kind === 'photo' && it.file))))}</span>`).join('') + (list.length > few.length ? `<span class="more">+${list.length - few.length}</span>` : '');
    S.dragging = true; S.shelfOpen = false; ctx.updateChrome(); // the picking bar (or the orb) becomes the boards pill
  }
  const cover = (b, pic) => (pic ? `<img src="${ctx.url(pic.thumb || pic.file)}" alt="" decoding="async">` : `<b>${ctx.esc((b.name.trim()[0] || '').toUpperCase())}</b>`);
  // Where the full shelf and its boards will be (laid out unseen for a moment), for aiming as soon as it opens.
  function measureShelf() {
    const shelf = ctx.$('#shelf');
    shelf.hidden = false; shelf.style.visibility = 'hidden';
    const box = shelf.getBoundingClientRect();
    const tiles = [...shelf.querySelectorAll('.shelftile')].map((t) => ({ kind: 'board', el: t, r: t.getBoundingClientRect(), id: t.dataset.board, name: t.dataset.name }));
    shelf.hidden = true; shelf.style.visibility = '';
    return { box, tiles };
  }
  function setOpen(on) {
    if (C.open === on) return;
    C.open = on; S.shelfOpen = on; C.openAt = performance.now();
    C.floorTo = on ? C.full.top : C.mini.top; // the bundle moves up out of the way as the shelf opens
    tick();
    ctx.updateChrome();
  }

  // ---------- carrying ----------
  let C = null;              // what is being carried (one thing at a time)
  const landing = new Set(); // bundles still on their way home or into a board: done at once if a new carry starts
  // A face's pose: its top-left corner (screen px), turn and scale, drawn with its origin at the top-left.
  const poseCss = (p) => `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) rotate(${p.r.toFixed(2)}deg) scale(${p.s.toFixed(4)})`;
  // Where a face sits in the bundle (relative to the finger), turned about its own middle.
  function localPose(f, s) {
    const w = f.w * s, h = f.h * s, a = f.o.r * Math.PI / 180;
    const cx = -C.g.x * s + f.o.x + w / 2, cy = -C.g.y * s + f.o.y + h / 2;
    return { x: cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), y: cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a), r: f.o.r, s };
  }
  // A soft limit: the bundle eases to a stop against the shelf or an edge (the finger still chooses the target).
  const soft = (v, limit, k) => (v <= limit - k ? v : limit - k + k * (1 - Math.exp(-(v - (limit - k)) / k)));

  function startCarry(g) {
    finishLandings();
    const lead = g.card;
    const lift = new DOMMatrix(getComputedStyle(lead).transform).a || 1; // how far it had lifted
    const swollen = lead.classList.contains('held'); // (its picture had swelled inside its frame)
    lead.classList.remove('held');
    lead.style.transition = 'none'; lead.style.translate = ''; lead.style.transform = '';
    const r = lead.getBoundingClientRect();
    const picked = S.select && S.select.size ? [...g.grid.querySelectorAll(':scope > .card.sel')].filter((c) => c !== lead) : [];
    const cards = [lead, ...picked];
    const ids = [...new Set(cards.flatMap(cardIds).concat(S.select && S.select.size ? [...S.select] : []))];
    const scroller = lead.closest('.screen'), root = getComputedStyle(document.documentElement);
    C = {
      grid: g.grid, scroller, scroll0: scroller ? scroller.scrollTop : 0, lead, cards, ids,
      g: { x: g.x0 - r.left, y: g.y0 - r.top }, W: r.width, H: r.height,
      s0: lift, s: lift, vs: 0, sTo: clamp((150 / Math.max(r.width, r.height)) * 1.05, 0.36, 1),
      fx: g.x, fy: g.y, vx: 0, lastX: g.x, lastT: performance.now(), tilt: 0, vt: 0, target: null, raf: 0, zoneSince: 0, faces: [],
      top: parseFloat(root.getPropertyValue('--st')) || 0
    };
    // the bundle, above everything (even the shelf)
    const layer = document.createElement('div');
    layer.className = 'dragbundle'; layer.setAttribute('aria-hidden', 'true');
    C.layer = layer;
    cards.slice(0, 3).forEach((c, k) => {
      const cr = k ? c.getBoundingClientRect() : r;
      const el = faceOf(c, cr);
      el.style.zIndex = String(3 - k);
      if (k) el.classList.add('rear');
      layer.appendChild(el);
      // the ones behind start exactly on their own card and gather into place, taking the front card's shape so
      // just an edge of each shows
      const o = k ? { x: cr.left - g.x + C.g.x * lift, y: cr.top - g.y + C.g.y * lift, r: 0 } : { ...OFF[0] };
      C.faces.push({ el, card: c, w: cr.width, h: cr.height, hTo: k ? r.height : cr.height, o, oTo: OFF[k], v: { x: 0, y: 0, r: 0, h: 0 } });
    });
    if (ids.length > 1) {
      const n = document.createElement('span');
      n.className = 'dragcount'; n.textContent = String(ids.length);
      layer.appendChild(n); C.count = n;
    }
    app.appendChild(layer);
    if (swollen && !calm()) C.faces[0].el.querySelectorAll('.media > img').forEach((i) => i.animate([{ transform: 'scale(1.05)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' }));
    // They are in the bundle now, not in the grid: the cards below each one glide up into its place, and the finger
    // aims at where everything will be.
    const after = closeUp(C, cards);
    void lead.offsetWidth; lead.style.transition = '';
    window.nbHap('soft');
    showShelf(ids);
    { const m = ctx.$('#shelfmini'), t = m.style.transform; m.style.transform = 'none'; C.mini = m.getBoundingClientRect(); m.style.transform = t; } // where it rests (it may still be growing out of the +)
    const full = measureShelf();
    C.full = full.box; C.tiles = full.tiles;
    C.open = false; C.floor = C.floorTo = C.mini.top;
    C.slots = [...after].filter(([c]) => !c.classList.contains('idea')).map(([c, r]) => ({ kind: 'card', el: c, r }));
    C.shifted = after.shifted;
    paint();
    C.raf = requestAnimationFrame(frame);
  }
  // A card's copy for carrying: the same look (a picked card keeps its mark), without its buttons.
  function faceOf(card, r) {
    const el = card.cloneNode(true);
    ['data-a', 'id', 'style', 'aria-pressed', 'aria-label'].forEach((a) => el.removeAttribute(a));
    el.classList.remove('held', 'carried', 'droptarget');
    el.classList.add('dragface');
    el.querySelectorAll('[data-a]').forEach((x) => x.removeAttribute('data-a'));
    el.style.width = r.width + 'px'; el.style.height = r.height + 'px';
    return el;
  }

  // Everything about the bundle's look comes from here: the finger, the lift, the gather and the lean.
  function paint() {
    const s = C.s, lead = localPose(C.faces[0], s), small = localPose(C.faces[0], C.sTo);
    // how far it reaches around the finger once small, so it can be kept on screen and above the shelf; the limits
    // come in as it shrinks (a big card just picked up is never pushed about)
    const top = small.y - (C.count ? 18 : 0), bottom = small.y + C.H * C.sTo + 12, left = small.x - 9, right = small.x + C.W * C.sTo + (C.count ? 18 : 9);
    const floor = C.floor - 10;
    let py = soft(C.fy + bottom, floor, 40) - bottom;
    py = -soft(-(py + top), -(C.top + 6), 30) - top;
    let px = soft(C.fx + right, innerWidth - 6, 24) - right;
    px = -soft(-(px + left), -6, 24) - left;
    const k = clamp((C.s0 - s) / (C.s0 - C.sTo || 1), 0, 1);
    C.px = C.fx + (px - C.fx) * k; C.py = C.fy + (py - C.fy) * k;
    C.layer.style.transform = `translate3d(${C.px.toFixed(1)}px,${C.py.toFixed(1)}px,0) rotate(${C.tilt.toFixed(2)}deg)`;
    for (const f of C.faces) f.el.style.transform = poseCss(localPose(f, s));
    if (C.count) C.count.style.transform = `translate(${(lead.x + C.W * s - 16).toFixed(1)}px,${(lead.y - 16).toFixed(1)}px)`;
  }
  // Springs for the lift, the gather and the lean, and the list scrolling at the edges. The finger itself is direct.
  function frame(now) {
    if (!C) return;
    const dt = Math.max(0, Math.min(0.032, (now - (C.t || now)) / 1000)); C.t = now;
    const spring = (o, k, v, vk, to, w) => { v[vk] += (-w * w * (o[k] - to) - 2 * w * v[vk]) * dt; o[k] += v[vk] * dt; };
    spring(C, 's', C, 'vs', C.sTo, 20);
    for (const f of C.faces) {
      for (const k of ['x', 'y', 'r']) spring(f.o, k, f.v, k, f.oTo[k], 17);
      if (Math.abs(f.h - f.hTo) > 0.1 || Math.abs(f.v.h) > 0.5) { spring(f, 'h', f.v, 'h', f.hTo, 17); f.el.style.height = f.h.toFixed(1) + 'px'; }
    }
    spring(C, 'tilt', C, 'vt', clamp(C.vx * 5, -5, 5), 12); // a small lean into the direction of travel
    C.vfl = C.vfl || 0; spring(C, 'floor', C, 'vfl', C.floorTo, 18);
    C.vx *= Math.pow(0.02, dt); // the finger's speed fades once it stops sending moves
    if (C.open && !C.target && now - C.openAt > 200) resolve(); // the shelf is open now: the board under a still finger lights up
    // rested on a card long enough: it is ready to take them (its ring has filled)
    if (C.target && C.target.kind === 'card' && !C.armed && now - C.since >= DWELL) { C.armed = true; C.target.el.classList.add('droptarget'); window.nbHap('soft'); }
    // a second finger's flick carries on for a moment
    if (C.fling && C.scroller) { const before = C.scroller.scrollTop; C.scroller.scrollTop -= C.fling * dt * 1000; C.fling *= Math.pow(0.04, dt); if (Math.abs(C.fling) < 0.02 || C.scroller.scrollTop === before) C.fling = 0; resolve(); }
    edgeScroll(now);
    paint();
    C.raf = requestAnimationFrame(frame);
  }
  // Holding it near the top or bottom edge scrolls the list, faster the closer it is. The bottom zone sits just
  // above the shelf, and the list only starts moving after a moment there.
  function edgeScroll(now) {
    const sc = C.scroller;
    if (!sc) return;
    const r = sc.getBoundingClientRect(), top = Math.max(r.top, 0) + 90, floor = Math.min(r.bottom, innerHeight, (C.open ? C.full.top : C.mini.top) - 12), bottom = floor - 70;
    const zone = C.fy < top ? -1 : C.fy > bottom && C.fy < floor ? 1 : 0;
    if (!zone) { C.zoneSince = 0; return; }
    if (!C.zoneSince) C.zoneSince = now;
    if (now - C.zoneSince < 350) return;
    const depth = zone < 0 ? (top - C.fy) / 90 : (C.fy - bottom) / 70, before = sc.scrollTop;
    sc.scrollTop += zone * Math.min(18, 4 + depth * 14);
    if (sc.scrollTop !== before) resolve();
  }
  // The one drop target. The current one stays until the finger is clearly out of it. The boards pill opens when the
  // finger is right over it and folds away once the finger clearly leaves the open shelf.
  const inside = (r, x, y, m) => x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
  function resolve() {
    const x = C.fx, y = C.fy, t = C.target, ds = C.scroller ? C.scroller.scrollTop - C.scroll0 : 0;
    // the list moving under a still finger is not resting on a card: the rest starts again once it stops
    if (ds !== C.ds) { C.ds = ds; C.since = performance.now(); C.armed = false; if (t && t.kind === 'card') { t.el.classList.remove('droptarget', 'dropnear'); void t.el.offsetWidth; t.el.classList.add('dropnear'); } } // (its ring empties and fills again)
    if (!C.open && inside(C.mini, x, y, 12)) setOpen(true);
    else if (C.open && y < C.full.top - 30) setOpen(false);
    const moved = (r) => ({ left: r.left, right: r.right, top: r.top - ds, bottom: r.bottom - ds }); // cards move with the list
    let next = null;
    // (a board can be chosen once the shelf has opened enough to see it)
    if (C.open) next = y >= C.full.top - 4 && performance.now() - C.openAt > 200 ? (t && t.kind === 'board' && inside(t.r, x, y, 6) ? t : C.tiles.find((b) => inside(b.r, x, y, 0))) || null : null;
    else if (!inside(C.mini, x, y, 12)) next = (t && t.kind === 'card' && inside(moved(t.r), x, y, EXIT) ? t : C.slots.find((c) => inside(moved(c.r), x, y, 0))) || null;
    if (next === t) return;
    if (t) t.el.classList.remove('hot', 'dropnear', 'droptarget');
    C.target = next; C.armed = false; C.since = performance.now();
    if (next) { if (next.kind === 'board') { next.el.classList.add('hot'); tick(); } else next.el.classList.add('dropnear'); } // a card only gets ready after a rest (frame)
    const name = ctx.$('#shelfname');
    if (name) { name.textContent = next && next.kind === 'board' ? next.name : ''; name.parentNode.classList.toggle('on', !!(next && next.kind === 'board')); }
  }
  function move(x, y, time) {
    const dt = Math.max(1, time - C.lastT);
    C.vx = C.vx * 0.5 + ((x - C.lastX) / dt) * 0.5;
    C.lastX = x; C.lastT = time; C.fx = x; C.fy = y;
    paint(); // straight away: the bundle never waits for the next frame
    resolve();
  }

  // ---------- letting go: every way a carry can end comes through here ----------
  // 'drop' lands on a board, or on a card that is ready; anything else, and 'cancel' (the system took the touch, Back,
  // the app went away), goes back home. Nothing looks done before the change has actually been made.
  function endCarry(how) {
    const c = C;
    if (!c) return;
    C = null;
    cancelAnimationFrame(c.raf);
    const t = how === 'drop' && c.target && (c.target.kind === 'board' || c.armed) ? c.target : null;
    if (c.target) c.target.el.classList.remove('hot', 'dropnear', 'droptarget');
    // from here the copies move on their own, in screen coordinates, from exactly where they are drawn
    const m = new DOMMatrix(getComputedStyle(c.layer).transform);
    for (const f of c.faces) {
      const q = m.multiply(new DOMMatrix(getComputedStyle(f.el).transform));
      f.from = { x: q.e, y: q.f, s: Math.hypot(q.a, q.b), r: Math.atan2(q.b, q.a) * 180 / Math.PI };
      f.el.style.transform = poseCss(f.from);
    }
    c.layer.style.transform = 'none';
    if (c.count) c.count.remove();
    landing.add(c);
    S.dragging = false; S.shelfOpen = false; // the shelf's part is over: what the drop says (a message) takes the bottom area from here
    let ok = false;
    if (t && t.kind === 'board' && ctx.actions().fileTo(c.ids, t.id)) { ok = true; intoTile(c, t.el.querySelector('.mini').getBoundingClientRect()); }
    else if (t && t.kind === 'card') {
      const stackId = ctx.actions().stackIds([...new Set(c.ids.concat(cardIds(t.el)))], c.ids[0]);
      if (stackId) { ok = true; converge(c.faces, stackId, () => finish(c), c); }
    }
    if (!ok) home(c);
    if (ok && S.select) endSelect(); // filed or stacked: the picking is done
    ctx.updateChrome(); // not dropped on anything: the shelf turns back into the picking bar (or the orb)
  }
  // The copies go and every card is whole again, in the same frame.
  function finish(c) {
    if (c.finished) return;
    c.finished = true;
    landing.delete(c);
    cancelAnimationFrame(c.raf2);
    if (c.reveal) c.reveal.style.visibility = '';
    c.layer.remove();
    c.cards.forEach((card) => {
      card.classList.remove('carried');
      if (c.popIn && !calm()) card.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' }); // filed: back in its place
    });
  }
  // The cards below each carried one glide up into its place, within their own column (the grid's own layout
  // never changes, so nothing hops from one column to the other and the page never jumps). Returns where every card
  // shown will be (for aiming), with `shifted`: card → its glide.
  function closeUp(c, gone) {
    const all = [...c.grid.querySelectorAll(':scope > .card')], rects = new Map(all.map((x) => [x, x.getBoundingClientRect()]));
    const heads = [...c.grid.querySelectorAll(':scope > .dategroup')].map((h) => h.getBoundingClientRect().top);
    const after = new Map(), shifted = new Map();
    for (const x of all) {
      if (gone.includes(x)) continue;
      const r = rects.get(x);
      let dy = 0;
      for (const g of gone) { const q = rects.get(g); if (Math.abs(q.left - r.left) < 2 && q.top < r.top && !heads.some((h) => h > q.top && h < r.top)) dy += q.height + 12; }
      after.set(x, dy ? new DOMRect(r.left, r.top - dy, r.width, r.height) : r);
      if (dy && !calm()) shifted.set(x, x.animate([{ transform: 'none' }, { transform: `translateY(${-dy}px)` }], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }));
    }
    gone.forEach((x) => x.classList.add('carried'));
    after.shifted = shifted;
    return after;
  }
  // Their places open up again: the cards below glide back down, from wherever they are.
  function reopen(c) {
    for (const [card, a] of c.shifted || []) { if (!card.isConnected) continue; const from = getComputedStyle(card).transform; a.cancel(); c.shifted.set(card, card.animate([{ transform: from }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' })); }
  }
  function finishLandings() { for (const c of [...landing]) finish(c); }
  // Filed: the bundle shrinks into the board it was dropped on (the cards themselves stay where they are).
  function intoTile(c, tile) {
    reopen(c); c.popIn = true; // filed, and still here: their places open again as the copies go into the board, and they come back
    const cx = tile.left + tile.width / 2, cy = tile.top + tile.height / 2, t0 = performance.now(), ms = calm() ? 0 : 240;
    const step = (now) => {
      const k = ms ? Math.max(0, Math.min(1, (now - t0) / ms)) : 1, e = k * k * (3 - 2 * k);
      for (const f of c.faces) {
        const s = f.from.s * (1 - 0.8 * e), mx = f.from.x + (f.w * f.from.s) / 2, my = f.from.y + (f.h * f.from.s) / 2;
        f.el.style.transform = poseCss({ x: mx + (cx - mx) * e - (f.w * s) / 2, y: my + (cy - my) * e - (f.h * s) / 2, r: f.from.r * (1 - e), s });
        f.el.style.opacity = String(1 - e * e);
      }
      if (k < 1) c.raf2 = requestAnimationFrame(step); else finish(c);
    };
    c.raf2 = requestAnimationFrame(step);
  }
  // Not dropped on anything: each copy flies back into its own card, measured every frame (the list may have
  // scrolled, and may still be moving), and hands over to it the moment it lands exactly on it.
  function home(c) {
    reopen(c);
    if (calm()) { finish(c); return; }
    let p = 0, v = 0, last = performance.now();
    const w = 17;
    const step = (now) => {
      const dt = Math.max(0, Math.min(0.032, (now - last) / 1000)); last = now;
      v += (-w * w * (p - 1) - 2 * w * v) * dt; p = Math.min(1, p + v * dt);
      // done once every copy is within half a pixel of its card: then it is exactly on it, and hands over
      const far = Math.max(...c.faces.map((f) => { const r = f.card.getBoundingClientRect(); return (1 - p) * Math.hypot(r.left - f.from.x, r.top - f.from.y); }));
      const done = far < 0.5, e = done ? 1 : p;
      for (const f of c.faces) {
        const r = f.card.getBoundingClientRect(), s = r.width / f.w;
        f.el.style.transform = poseCss({ x: f.from.x + (r.left - f.from.x) * e, y: f.from.y + (r.top - f.from.y) * e, s: f.from.s + (s - f.from.s) * e, r: f.from.r * (1 - e) });
        if (f.h !== f.hTo || f.hTo !== r.height / s) f.el.style.height = (f.h + (r.height / s - f.h) * e).toFixed(1) + 'px';
      }
      if (done) finish(c); else c.raf2 = requestAnimationFrame(step);
    };
    c.raf2 = requestAnimationFrame(step);
  }
  // Stacked: the copies fly into the new stack's place together and hand over to it as they land (the stack stays
  // hidden until then; its neighbours make their one move meanwhile). Also used by Stack in the picking bar.
  // faces: [{ el, from: pose, w }]
  function converge(faces, stackId, done, owner) {
    const stack = app.querySelector(`.grid .stackcard[data-stack="${CSS.escape(stackId)}"]`);
    if (owner) owner.reveal = stack;
    if (!stack || calm()) { if (stack) stack.style.visibility = ''; if (done) done(); return; }
    stack.style.visibility = 'hidden';
    const fan = stack.querySelector('.fan') || stack, t0 = performance.now(), ms = 300;
    const step = (now) => {
      const k = Math.max(0, Math.min(1, (now - t0) / ms)), e = 1 - Math.pow(1 - k, 3), r = fan.getBoundingClientRect();
      faces.forEach((f, i) => {
        const s1 = r.width / f.w, h0 = f.h ?? f.el.offsetHeight;
        f.el.classList.add('rear');
        f.el.style.height = (h0 + (r.height / s1 - h0) * e).toFixed(1) + 'px';
        f.el.style.transform = poseCss({ x: f.from.x + (r.left - f.from.x) * e, y: f.from.y + (r.top - f.from.y) * e, s: f.from.s + (s1 - f.from.s) * e, r: f.from.r * (1 - e) + (i ? (i % 2 ? 5 : -5) * e : 0) });
        if (i) f.el.style.opacity = String(1 - clamp((k - 0.55) / 0.45, 0, 1));
      });
      if (k < 1) { if (owner) owner.raf2 = requestAnimationFrame(step); else requestAnimationFrame(step); return; }
      stack.style.visibility = '';
      if (owner) owner.reveal = null;
      if (done) done();
    };
    if (owner) owner.raf2 = requestAnimationFrame(step); else requestAnimationFrame(step);
  }
  // Stack in the picking bar: copies of the picked cards, where they are, to fly into the new stack.
  function lift(cards) {
    const layer = document.createElement('div');
    layer.className = 'dragbundle'; layer.setAttribute('aria-hidden', 'true');
    const faces = cards.map((c, i) => {
      const r = c.getBoundingClientRect(), el = faceOf(c, r);
      el.style.zIndex = String(cards.length - i);
      el.style.transform = poseCss({ x: r.left, y: r.top, r: 0, s: 1 });
      layer.appendChild(el);
      return { el, w: r.width, h: r.height, from: { x: r.left, y: r.top, r: 0, s: 1 } };
    });
    app.appendChild(layer);
    return { faces, remove: () => layer.remove() };
  }

  // ---------- the gesture on a grid ----------
  let G = null;
  const touchOf = (list, id) => { for (const t of list) if (t.identifier === id) return t; return null; };
  function wireGrid(grid) {
    if (grid.dataset.wired) return;
    grid.dataset.wired = '1';
    grid.addEventListener('touchstart', (e) => {
      if (G) { // carrying: a second finger scrolls the list (the bundle stays with the first one)
        if (G.mode === 'drag' && C && G.sid == null) { const t2 = [...e.changedTouches].find((x) => x.identifier !== G.id); if (t2) { G.sid = t2.identifier; G.sy = t2.clientY; G.st = e.timeStamp; G.sv = 0; C.fling = 0; } }
        return;
      }
      if (e.touches.length > 1) return; // one finger owns it
      const t = e.changedTouches[0];
      const card = e.target.closest('.card:not(.idea)'), stack = e.target.closest('.stackcard');
      G = { grid, id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, mode: 'maybe', card, stack, hold: 0, pick: 0 };
      S.gesture = null;
      ctx.clearSwallow();
      if (stack && ctx.stacks.busy(stack)) { ctx.stacks.begin(stack); G.mode = 'caught'; S.gesture = 'stack'; return; } // a stack still settling: caught where it is
      if (card && !card.closest('#bingrid')) {
        const g = G;
        g.hold = setTimeout(() => { // held still: it lifts under the finger, ready to be moved
          if (G !== g || g.mode !== 'maybe') return;
          g.mode = 'held'; S.gesture = 'lift'; window.nbHap('heavy');
          const r = card.getBoundingClientRect();
          card.style.transformOrigin = `${(g.x0 - r.left).toFixed(0)}px ${(g.y0 - r.top).toFixed(0)}px`;
          card.classList.add('held');
          if (S.select) { if (!cardIds(card).every((id) => S.select.has(id))) toggleSelect(card); return; } // picking already: it joins
          g.pick = setTimeout(() => { if (G === g && g.mode === 'held') { window.nbHap('heavy'); startSelect(card); } }, PICK - HOLD); // still held: picked
        }, HOLD);
      }
    }, { passive: true });
    grid.addEventListener('touchmove', (e) => {
      const g = G;
      if (!g || g.grid !== grid) return;
      if (g.sid != null && C && C.scroller) {
        const t2 = touchOf(e.touches, g.sid);
        if (t2) {
          const d = t2.clientY - g.sy, dt = Math.max(1, e.timeStamp - g.st);
          g.sy = t2.clientY; g.st = e.timeStamp; g.sv = g.sv * 0.4 + (d / dt) * 0.6;
          if (d) { C.scroller.scrollTop -= d; resolve(); }
          if (e.cancelable) e.preventDefault();
        }
      }
      const t = touchOf(e.touches, g.id);
      if (!t) return;
      const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
      g.x = t.clientX; g.y = t.clientY;
      if (g.mode === 'held' || g.mode === 'drag') {
        if (e.cancelable) e.preventDefault(); // the page doesn't scroll while a card is held
        if (g.mode === 'drag') { if (C) move(t.clientX, t.clientY, e.timeStamp); return; }
        if (Math.hypot(dx, dy) < SLOP) { g.card.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`; return; } // it stays under the finger
        clearTimeout(g.pick);
        g.mode = 'drag'; S.gesture = 'drag';
        startCarry(g);
        return;
      }
      if (g.mode === 'caught' || g.mode === 'stack') { if (e.cancelable) e.preventDefault(); g.mode = 'stack'; ctx.stacks.move(g.stack, dx, e.timeStamp); return; }
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      clearTimeout(g.hold);
      if (g.stack && !S.select && Math.abs(dx) > Math.abs(dy) * 1.2) { g.mode = 'stack'; S.gesture = 'stack'; ctx.stacks.begin(g.stack); ctx.stacks.move(g.stack, dx, e.timeStamp); return; }
      G = null; // a scroll or a tab swipe: not ours
    }, { passive: false });
    const end = (e) => {
      const g = G;
      if (!g || g.grid !== grid) return;
      const t = touchOf(e.changedTouches, g.id);
      if (!t) { if (g.sid != null && touchOf(e.changedTouches, g.sid)) { g.sid = null; if (C) C.fling = g.sv; } return; } // the scrolling finger lifted: the list glides on a little
      G = null;
      clearTimeout(g.hold); clearTimeout(g.pick);
      setTimeout(() => { S.gesture = null; }, 0);
      const cancelled = e.type === 'touchcancel';
      if (g.mode === 'held') { // let go without moving: it settles back (picked already if held long enough); the lift is not also a tap
        const c = g.card;
        c.style.translate = '';
        c.classList.remove('held');
        setTimeout(() => { if (!c.classList.contains('held')) c.style.transformOrigin = ''; }, 400);
        ctx.swallowClick();
      } else if (g.mode === 'drag') { ctx.swallowClick(); endCarry(cancelled ? 'cancel' : 'drop'); }
      else if (g.mode === 'stack' || g.mode === 'caught') { ctx.swallowClick(); ctx.stacks.end(g.stack, t.clientX - g.x0, e.timeStamp, cancelled || g.mode === 'caught'); }
    };
    grid.addEventListener('touchend', end, { passive: true });
    grid.addEventListener('touchcancel', end, { passive: true });
  }
  // Back mid-carry, or the app went to the background: it all goes home, and the picking stays.
  function cancel() {
    const g = G;
    G = null;
    if (g) { clearTimeout(g.hold); clearTimeout(g.pick); if (g.mode === 'held') { g.card.classList.remove('held'); g.card.style.translate = ''; } setTimeout(() => { S.gesture = null; }, 0); }
    if (C) { endCarry('cancel'); return true; }
    return false;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });

  return { wireGrid, cardIds, startSelect, toggleSelect, markSelection, endSelect, pickedCards, cancel, converge, lift, carrying: () => !!C };
};
