// Motion on the phone screens: screen changes (photos fly between their card and the screen, notes and boards
// open out of what you tapped), floating sheets, the Home header and the tap that follows a long press.
// (Picking and carrying cards: drag.js. Stacks: stacks.js. The bottom action area: dock.js. An open photo: viewer.js.)
// app.js owns the state and passes it in through `ctx`.
window.NBMotion = (ctx) => {
  const { S, tick } = ctx;

  // Transform and opacity stay on compositor layers; clipping a whole frosted screen repaints it.
  // The same timing as the stylesheet's --ease and --t-screen.
  const tokens = getComputedStyle(document.documentElement);
  const EASE = tokens.getPropertyValue('--ease').trim(), DUR = parseFloat(tokens.getPropertyValue('--t-screen'));
  const FAST = parseFloat(tokens.getPropertyValue('--t-fast')), NORMAL = parseFloat(tokens.getPropertyValue('--t-normal'));
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

  // Reversing a sheet starts at the position currently on screen, including a held drag. A sheet that is riding the
  // bottom surface (becoming a message) is the dock's to move.
  function showSheet(el, on, done) {
    if (el.classList.contains('riding')) return;
    if (on ? !el.hidden && !el.dataset.leaving : el.hidden || el.dataset.leaving) return;
    const scrim = el.id === 'popscrim', style = getComputedStyle(el);
    const from = el.hidden ? { opacity: 0, transform: scrim ? 'none' : 'translateY(28px) scale(.97)' }
      : { opacity: style.opacity, transform: style.transform };
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = '';
    if (on) { delete el.dataset.leaving; el.hidden = false; }
    else el.dataset.leaving = '1';
    el.inert = !on;
    const finish = () => { if (!on) { el.hidden = true; delete el.dataset.leaving; } el.inert = false; if (done) done(); };
    if (calm()) { finish(); return; }
    const y = new DOMMatrix(from.transform === 'none' ? undefined : from.transform).m42;
    const to = on ? { opacity: 1, transform: 'none' } : { opacity: 0, transform: scrim ? 'none' : `translateY(${y + 28}px) scale(.97)` };
    const a = el.animate([from, to], { duration: on ? NORMAL : FAST, easing: EASE, fill: 'both' });
    a.onfinish = () => { finish(); a.cancel(); };
  }

  // An open photo or video is an overlay on the screen underneath: the picture itself grows out of
  // its card (and shrinks back into it), the backdrop fades, and nothing else moves.
  const cardOf = (screen) => screen.querySelector(`.grid:not(.peek) [data-a="open"][data-v="${CSS.escape(S.item || '')}"] .media`);
  const onScreen = (r) => r && r.width && r.bottom > 0 && r.top < innerHeight;
  // The transform that puts `media` (at its untransformed place) exactly over `r`.
  function overRect(media, r) {
    const was = media.style.transform;
    media.style.transform = 'none';
    const m = media.getBoundingClientRect();
    media.style.transform = was;
    return `translate(${(r.x + r.width / 2 - (m.x + m.width / 2)).toFixed(1)}px,${(r.y + r.height / 2 - (m.y + m.height / 2)).toFixed(1)}px) scale(${(r.width / m.width).toFixed(4)})`;
  }
  // What moves: the photo, or a video's whole box (showing its still picture while it moves).
  const mediaOf = (el) => el.querySelector('.stage .vbox') || el.querySelector('.stage img');
  const stillVideo = (el) => { const v = el.querySelector('.vbox video'); if (v) { v.pause(); el.querySelector('.vbox').classList.remove('live'); } };
  const chromeOf = (el) => [...el.querySelectorAll('.sheet, .lbback')];
  function lightboxOpen(el, under) {
    const media = mediaOf(el), scrim = el.querySelector('.scrim');
    const card = cardOf(under), r = card && card.getBoundingClientRect();
    const o = { duration: DUR, easing: EASE };
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FAST * 0.6, easing: EASE });
    el.querySelector('.sheet').animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { ...o, delay: DUR * 0.35, fill: 'backwards' });
    // Back fades in once the backdrop covers the screen underneath (never on top of its header).
    el.querySelector('.lbback').animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { ...o, delay: DUR * 0.35, fill: 'backwards' });
    if (media && onScreen(r)) {
      card.style.visibility = 'hidden';
      const a = media.animate([{ transform: overRect(media, r) }, { transform: 'none' }], o);
      a.onfinish = a.oncancel = () => { card.style.visibility = ''; };
    } else if (media) media.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], o);
    return scrim.getAnimations()[0];
  }
  // After swiping through pictures, the one being closed may be off screen in the grid: the grid
  // scrolls (instantly, while still covered) so it can fly back into its card.
  function revealCard(under) {
    const card = cardOf(under), r = card && card.getBoundingClientRect();
    if (!card || onScreen(r)) return;
    const scroller = card.closest('.screen');
    if (scroller) scroller.scrollTop += r.top - innerHeight * 0.25;
  }
  function lightboxClose(el, under) {
    const media = mediaOf(el), scrim = el.querySelector('.scrim');
    revealCard(under);
    const card = cardOf(under), r = card && card.getBoundingClientRect();
    const o = { duration: DUR, easing: EASE, fill: 'forwards' };
    const from = media ? media.style.transform || 'none' : 'none';
    stillVideo(el);
    const backdrop = getComputedStyle(scrim).opacity;
    scrim.animate([{ opacity: backdrop }, { opacity: backdrop, offset: 0.8 }, { opacity: 0 }], o);
    chromeOf(el).forEach((c) => c.animate([{ opacity: getComputedStyle(c).opacity }, { opacity: 0 }], { duration: FAST, fill: 'forwards' }));
    let a;
    if (media && onScreen(r)) {
      card.style.visibility = 'hidden';
      a = media.animate([{ transform: from }, { transform: overRect(media, r) }], o);
    } else a = (media || scrim).animate([{ transform: from, opacity: 1 }, { transform: from + ' scale(.85)', opacity: 0 }], o);
    a.onfinish = () => { if (card) card.style.visibility = ''; el.remove(); };
    el.style.pointerEvents = 'none';
  }

  // A short-lived picture of something that has just gone (binned, deleted, moved to another column): drawn where it
  // was, inside the same scroller, so it moves with the page. The real change has already been made; this is only
  // how it looks leaving.
  function ghost(el, r, host) {
    const hr = host.getBoundingClientRect(), g = el.cloneNode(true);
    g.classList.add('ghost'); g.removeAttribute('data-a'); g.removeAttribute('id'); g.setAttribute('aria-hidden', 'true'); g.inert = true;
    g.querySelectorAll('[data-a], [id]').forEach((n) => { n.removeAttribute('data-a'); n.removeAttribute('id'); });
    Object.assign(g.style, { position: 'absolute', left: (r.left - hr.left + host.scrollLeft) + 'px', top: (r.top - hr.top + host.scrollTop) + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', pointerEvents: 'none', zIndex: '-1', animation: 'none' }); // (under the cards closing the gap)
    host.appendChild(g);
    return g;
  }
  const hostOf = (el) => el.closest('.screen') || el.parentNode;
  // How far along the standard curve (--ease) a glide is at time share t: when a card that is making room has left a
  // place, so what comes back into that place can arrive exactly then (no pile-up, no waiting hole).
  const curve = (() => { const [x1, y1, x2, y2] = (EASE.match(/[-\d.]+/g) || [0.22, 1, 0.36, 1]).map(Number); const b = (a1, a2, u) => 3 * a1 * u * (1 - u) ** 2 + 3 * a2 * u * u * (1 - u) + u ** 3; return (t) => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (b(x1, x2, m) < t) lo = m; else hi = m; } return b(y1, y2, (lo + hi) / 2); }; })();

  // When a grid's contents change (added, binned, stacked, synced, cards carried off it), every card is traced by its
  // id from where it is drawn now (mid-glide included) to its new place: cards that stay glide there; cards that
  // leave are drawn leaving where they were (shrinking and fading) while the others close the gap, so the grid never
  // flashes empty; cards that change column cross-fade (they never fly diagonally over the others); new ones grow in
  // their already-reserved place at once. A card coming back while its leaving picture is still on screen (a quick
  // Undo) grows back from that picture. `skip(card)`: a card something else is bringing in (a new stack its cards
  // are flying into) keeps still. Returns every shown card's new place (before any of the gliding), for aiming at.
  function flipGrid(grid, mutate, skip) {
    const still = calm() || grid.classList.contains('anim');
    const key = (c) => (c.classList.contains('stackcard') ? 's:' + c.dataset.stack : 'i:' + c.dataset.v);
    const before = new Map(), gone = grid.__ghosts || (grid.__ghosts = new Map()), host = hostOf(grid);
    if (!still) for (const c of grid.querySelectorAll(':scope > .card')) {
      const r = c.getBoundingClientRect();
      if (!r.width) continue; // not shown (carried off): it has no place to come from
      before.set(key(c), { r, c, own: true });
      c.querySelectorAll('.fanitem').forEach((f) => before.set('i:' + f.dataset.v, { r, c, own: false }));
    }
    mutate();
    const after = new Map(), now = new Set();
    for (const c of grid.querySelectorAll(':scope > .card')) {
      const r = c.getBoundingClientRect();
      now.add(key(c)); c.querySelectorAll('.fanitem').forEach((f) => now.add('i:' + f.dataset.v));
      if (r.width) after.set(c, r);
    }
    if (still) { for (const g of gone.values()) g.remove(); gone.clear(); return after; }
    const near = (r) => r.bottom > -200 && r.top < innerHeight + 200;
    // Leaving: drawn where they were, then gone.
    for (const [k, b] of before) {
      if (!b.own || now.has(k) || !near(b.r) || gone.has(k)) continue;
      if (b.c.classList.contains('stackcard') && [...b.c.querySelectorAll('.fanitem')].some((f) => now.has('i:' + f.dataset.v))) continue; // unstacked: its cards are still here
      const g = ghost(b.c, b.r, host);
      gone.set(k, g);
      g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.82)' }], { duration: NORMAL, easing: EASE, fill: 'forwards' })
        .onfinish = () => { g.remove(); if (gone.get(k) === g) gone.delete(k); };
    }
    // Where every card that glides is at each moment, to know when a returning card's place is free.
    const gliding = [];
    for (const [c, r1] of after) { const b = before.get(key(c)); if (b && Math.abs(b.r.left - r1.left) <= r1.width / 2 && Math.abs(b.r.top - r1.top) > 1) gliding.push({ r1, dy: b.r.top - r1.top, dx: b.r.left - r1.left }); }
    const freeAt = (r) => {
      for (let t = 0; t <= 1; t += 0.05) {
        const k = 1 - curve(t);
        if (!gliding.some((g) => { const x = Math.max(0, Math.min(r.right, g.r1.right + g.dx * k) - Math.max(r.left, g.r1.left + g.dx * k)), y = Math.max(0, Math.min(r.bottom, g.r1.bottom + g.dy * k) - Math.max(r.top, g.r1.top + g.dy * k)); return x * y > 0.4 * r.width * r.height; })) return t;
      }
      return 1;
    };
    for (const [c, r1] of after) {
      if (skip && skip(c)) continue;
      const k = key(c);
      let r0 = before.get(k)?.r, back = null;
      if (!r0 && c.classList.contains('stackcard')) { const f = [...c.querySelectorAll('.fanitem')].find((x) => before.has('i:' + x.dataset.v)); if (f) r0 = before.get('i:' + f.dataset.v).r; }
      if (!r0 && gone.has(k)) { back = gone.get(k); r0 = back.getBoundingClientRect(); } // Undo while it was still leaving
      if (!near(r1) && (!r0 || !near(r0))) { if (back) { back.remove(); gone.delete(k); } continue; }
      if (back) {
        const o = +getComputedStyle(back).opacity;
        back.getAnimations().forEach((a) => a.cancel()); back.remove(); gone.delete(k);
        const sx = r0.width / r1.width, sy = r0.height / r1.height;
        c.animate([{ opacity: Math.max(o, 0.2), transformOrigin: '0 0', transform: `translate(${r0.left - r1.left}px,${r0.top - r1.top}px) scale(${sx},${sy})` }, { opacity: 1, transformOrigin: '0 0', transform: 'none' }], { duration: NORMAL, easing: EASE });
      } else if (r0) {
        const dx = r0.left - r1.left, dy = r0.top - r1.top;
        if (Math.abs(dx) > r1.width / 2) { // another column: it fades in here as its picture fades out there
          const g = ghost(c, r0, host);
          g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FAST, easing: EASE, fill: 'forwards' }).onfinish = () => g.remove();
          c.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: NORMAL, delay: Math.round(freeAt(r1) * NORMAL * 0.6), easing: EASE, fill: 'backwards' });
        } else if (Math.abs(dx) + Math.abs(dy) > 1) c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: NORMAL, easing: EASE });
      } else { // new or back: it grows into its place at once, above the cards still sliding out of the way (no gap)
        c.style.zIndex = '2';
        c.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(.97)', offset: 0.45 }, { opacity: 1, transform: 'none' }], { duration: NORMAL, easing: EASE }).onfinish = () => { c.style.zIndex = ''; };
      }
    }
    return after;
  }

  // The rail of boards changes (pinned to the front, made, deleted, put back): every pile glides from where it was
  // drawn to its new place, keeping the rail where it was scrolled (when it gets shorter the browser pulls it back,
  // and the piles glide through that too, instead of jumping a whole slot); a deleted board is drawn leaving where it
  // was, a new one grows in.
  function flipRail(rail, mutate) {
    const before = new Map([...rail.querySelectorAll('.pile')].map((p) => [p.dataset.v || 'new', { r: p.getBoundingClientRect(), p }]));
    const keep = rail.scrollLeft;
    mutate();
    rail.scrollLeft = keep;
    if (calm()) return;
    const host = hostOf(rail), seen = new Set();
    for (const p of rail.querySelectorAll('.pile')) {
      const id = p.dataset.v || 'new', b = before.get(id);
      seen.add(id);
      if (!b) { p.animate([{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'none' }], { duration: NORMAL + 80, easing: 'cubic-bezier(.34,1.18,.5,1)' }); continue; }
      const dx = b.r.left - p.getBoundingClientRect().left;
      if (Math.abs(dx) > 1) p.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: NORMAL + 80, easing: 'cubic-bezier(.34,1.18,.5,1)' });
    }
    for (const [id, b] of before) {
      if (seen.has(id) || b.r.right < 0 || b.r.left > innerWidth) continue;
      const g = ghost(b.p, b.r, host);
      g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.8)' }], { duration: NORMAL, easing: EASE, fill: 'forwards' }).onfinish = () => g.remove();
    }
  }

  // Binned from an open photo: it drops away towards the bottom as the backdrop clears.
  function lightboxBin(el) {
    const media = mediaOf(el), scrim = el.querySelector('.scrim');
    stillVideo(el);
    const o = { duration: DUR, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' };
    scrim.animate([{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }], { duration: DUR, easing: EASE, fill: 'forwards' });
    chromeOf(el).forEach((c) => c.animate([{ opacity: getComputedStyle(c).opacity }, { opacity: 0 }], { duration: FAST, fill: 'forwards' }));
    const a = (media || scrim).animate([{ transform: media ? media.style.transform || 'none' : 'none', opacity: 1 }, { transform: 'translateY(45vh) scale(.25) rotate(-10deg)', opacity: 0 }], o);
    a.onfinish = () => el.remove();
    el.style.pointerEvents = 'none';
  }

  // A note opens out of its card: the whole note screen starts drawn at the card's size and place and grows to the
  // screen, then folds back into the card, landing exactly on it (it slows down into it; the card appears in the
  // same frame the note goes). Its own controls arrive once it has nearly filled the screen, and leave first. A
  // change of mind mid-way turns it round from where it is.
  function zoomAt(rect, radius, e) {
    const W = innerWidth, H = innerHeight, s0 = rect.width / W, s = s0 + (1 - s0) * e;
    const crop = Math.max(0, H - rect.height / s0) * (1 - e), rr = (radius / s0) * (1 - e);
    return { transform: `translate(${(rect.left * (1 - e)).toFixed(1)}px,${(rect.top * (1 - e)).toFixed(1)}px) scale(${s.toFixed(4)})`, clipPath: `inset(0px 0px ${crop.toFixed(1)}px 0px round ${rr.toFixed(1)}px)` };
  }
  function noteMorph(note, rect, opening, radius = 20) {
    const z = note.__zoom;
    const e = z && z.anim ? Math.max(0, Math.min(1, z.anim.effect.getComputedTiming().progress ?? (z.opening ? 1 : 0))) : opening ? 0 : 1;
    if (z && z.real) z.real.cancel();
    note.style.transformOrigin = '0 0';
    const span = Math.abs((opening ? 1 : 0) - e) || 1;
    const anim = note.animate([zoomAt(rect, radius, e), zoomAt(rect, radius, opening ? 1 : 0)], { duration: DUR * Math.max(0.4, span), easing: EASE, fill: 'forwards' });
    // eased progress of this run → the note's overall openness, for a later turn-round
    const prog = { effect: { getComputedTiming: () => { const p = anim.effect.getComputedTiming().progress ?? 1; return { progress: e + ((opening ? 1 : 0) - e) * p }; } } };
    note.__zoom = { anim: prog, opening, real: anim };
    note.querySelectorAll('.sheet, .lbback, .kindpill, .notebar').forEach((x) => {
      x.getAnimations().forEach((a) => a.cancel());
      x.animate(opening ? [{ opacity: 0 }, { opacity: 0, offset: .55 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0, offset: .35 }, { opacity: 0 }], { duration: DUR * Math.max(0.4, span), easing: 'linear', fill: 'both' });
    });
    anim.addEventListener('finish', () => { if (note.__zoom && note.__zoom.real === anim) note.__zoom = null; });
    return anim;
  }

  // Binned from an open note: the same drop as a binned photo, back towards the collection.
  function noteBin(note) {
    note.style.transformOrigin = '50% 30%';
    const a = note.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(45vh) scale(.25) rotate(-10deg)', opacity: 0 }], { duration: DUR, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
    note.style.pointerEvents = 'none';
    a.onfinish = () => note.remove();
  }

  // Screens that open out of something (a board's cover, Search and Sync's buttons, a new note out of the orb) share
  // one progress number, 0 closed to 1 open, so a change of mind mid-way turns round from exactly where it is.
  // `look(screen, under)` draws one progress: { paint(p), end() }. One owner: the opening screen is an opaque shell
  // growing from the source; its contents arrive only once the shell is nearly full size (no clipped words), and
  // leave first on the way back.
  function route(oldEl, el, kind, look) {
    const L = window.NBLiquid, opening = kind === 'open', screen = opening ? el : oldEl, under = opening ? oldEl : el;
    const st = screen.__route || (screen.__route = { p: opening ? 0 : 1, raf: 0 });
    cancelAnimationFrame(st.raf);
    if (st.end) st.end();
    const lk = look(screen, under);
    st.end = lk.end;
    screen.style.zIndex = '1';
    screen.classList.add('route-morph');
    oldEl.style.pointerEvents = 'none';
    const paint = (p) => { st.p = p; lk.paint(Math.max(0, Math.min(1, p))); };
    const done = () => {
      st.raf = 0; lk.end(); st.end = null;
      screen.style.clipPath = ''; screen.style.removeProperty('--route-content-opacity'); screen.classList.remove('route-morph'); screen.style.zIndex = ''; under.style.opacity = ''; screen.__route = null;
      if (opening) { if (ctx.current() === screen) oldEl.style.visibility = 'hidden'; }
      else if (oldEl !== ctx.home()) oldEl.remove(); else oldEl.style.visibility = 'hidden';
      if (lk.after) lk.after(opening);
    };
    const from = st.p, to = opening ? 1 : 0, ms = (opening ? DUR + 40 : DUR - 40) * Math.max(0.35, Math.abs(to - from));
    if (calm()) { paint(to); done(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.max(0, Math.min(1, (now - t0) / ms));
      paint(from + (to - from) * (opening ? L.fluidOpen(t) : 1 - Math.pow(1 - t, 3)));
      if (t < 1) st.raf = requestAnimationFrame(step); else done();
    };
    paint(from);
    st.raf = requestAnimationFrame(step);
  }
  const inset = (r, W, H, rad) => `inset(${r.top.toFixed(1)}px ${(W - r.right).toFixed(1)}px ${(H - r.bottom).toFixed(1)}px ${r.left.toFixed(1)}px round ${rad.toFixed(1)}px)`;
  const lerpRect = (a, W, H, p) => ({ left: a.left * (1 - p), top: a.top * (1 - p), right: a.right + (W - a.right) * p, bottom: a.bottom + (H - a.bottom) * p });

  // A board opens out of its pile: the pile's cover grows into the page and dissolves into it, the page's own
  // title and pictures arrive once there is room, and Home dims evenly underneath (no strips of it left behind).
  const coverLook = (source) => (screen, under) => {
    const W = innerWidth, H = innerHeight, r = source.getBoundingClientRect();
    const pic = source.querySelector('.pile-img, .pile-ph');
    const pr = pic ? pic.getBoundingClientRect() : r, rad = pic ? parseFloat(getComputedStyle(pic).borderRadius) || 10 : 16;
    const ghost = (pic || source).cloneNode(true);
    ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true'); ghost.classList.add('route-ghost', 'coverghost');
    Object.assign(ghost.style, { position: 'fixed', left: '0', top: '0', margin: '0', zIndex: '8', pointerEvents: 'none', transform: 'none', inset: 'auto' });
    ctx.app.appendChild(ghost);
    source.style.visibility = 'hidden';
    return {
      paint(p) {
        const e = 1 - (1 - p) ** 2, b = lerpRect(pr, W, H, e), round = rad * (1 - e); // the shell gets to full size early
        screen.style.clipPath = inset(b, W, H, round);
        Object.assign(ghost.style, { left: b.left.toFixed(1) + 'px', top: b.top.toFixed(1) + 'px', width: (b.right - b.left).toFixed(1) + 'px', height: (b.bottom - b.top).toFixed(1) + 'px', borderRadius: round.toFixed(1) + 'px', opacity: (1 - smooth(0, 0.45, p)).toFixed(3) });
        screen.style.setProperty('--route-content-opacity', smooth(0.74, 1, p).toFixed(3)); // once it holds all of the page's words
        under.style.opacity = (1 - 0.6 * smooth(0, 0.6, p)).toFixed(3);
      },
      end() { ghost.remove(); source.style.visibility = ''; }
    };
  };
  // Search and Sync grow from their header button as a liquid circle. The opaque surface opens first; its contents
  // arrive only after there is room, so no word is cut by the moving edge.
  const liquidLook = (source) => (screen, under) => {
    const r = source.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const r0 = Math.min(r.width, r.height) / 2, far = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 2;
    const ghost = source.cloneNode(true);
    ghost.removeAttribute('id'); ghost.setAttribute('aria-hidden', 'true'); ghost.classList.add('route-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', zIndex: '8', pointerEvents: 'none' });
    ctx.app.appendChild(ghost);
    source.style.visibility = 'hidden';
    return {
      paint(q) {
        const spread = Math.min(1, q / 0.55);
        screen.style.clipPath = `circle(${(r0 + (far - r0) * spread).toFixed(1)}px at ${cx.toFixed(1)}px ${cy.toFixed(1)}px)`;
        const shade = Math.round(11 + 11 * (1 - q));
        screen.style.background = `url(img/grain-soft.png) repeat 0 0 / 160px, rgb(${shade} ${shade} ${shade})`;
        screen.style.setProperty('--route-content-opacity', String(Math.max(0, Math.min(1, (q - 0.55) / 0.3))));
        ghost.style.opacity = String(1 - spread);
        under.style.opacity = String(1 - Math.min(1, q / 0.08));
      },
      end() { ghost.remove(); source.style.visibility = ''; screen.style.background = ''; }
    };
  };
  // A new note out of the orb: the round button opens up into the note, one opaque shell growing from the orb's own
  // circle. Its purple and small plus fade before it has grown much (the plus never grows); the note's words and
  // controls arrive once it nearly fills the screen. An untouched note folds back into the orb the same way.
  const orbLook = () => (screen, under) => {
    const W = innerWidth, H = innerHeight, o = window.NBSurface.orb();
    const r = { left: o.x, top: o.y, right: o.x + o.w, bottom: o.y + o.h };
    const face = document.createElement('div');
    face.className = 'growface'; face.setAttribute('aria-hidden', 'true');
    face.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" style="left:${(o.x + o.w / 2 - 14).toFixed(1)}px;top:${(o.y + o.h / 2 - 14).toFixed(1)}px"><path d="M12 5v14M5 12h14"/></svg>`;
    screen.appendChild(face);
    return {
      paint(p) {
        const e = 1 - (1 - p) ** 2;
        screen.style.clipPath = inset(lerpRect(r, W, H, e), W, H, 30 * (1 - e));
        face.style.opacity = (1 - smooth(0, 0.14, e)).toFixed(3); // purple only while it is still about the orb's size
        screen.style.setProperty('--route-content-opacity', smooth(0.8, 1, p).toFixed(3));
        under.style.opacity = '';
      },
      end() { face.remove(); },
      after(opening) { if (!opening) ctx.orbBack(); }
    };
  };

  // Runs fn (which moves `el` in the page) and puts back every scroll position inside it.
  function keepScroll(el, fn) {
    const saved = [el, ...el.querySelectorAll('.rail, .grid, .covertiles')].map((n) => [n, n.scrollTop, n.scrollLeft]);
    fn();
    for (const [n, top, left] of saved) { if (n.scrollTop !== top) n.scrollTop = top; if (n.scrollLeft !== left) n.scrollLeft = left; }
  }

  function animateSwap(oldEl, el, kind) {
    const stage = ctx.$('#stage');
    if (!oldEl || oldEl === el) return;
    oldEl.inert = true;
    if (calm() && !['grow', 'open', 'close'].includes(kind)) { if (oldEl !== ctx.home()) oldEl.remove(); else oldEl.style.visibility = 'hidden'; return; }
    const back = kind === 'unzoom' || kind === 'pop' || kind === 'close' || kind === 'binned';
    // The screen being left stays on top while it goes. Only move the one returned to if it isn't already
    // underneath: moving an element in the page throws away its scroll positions (the board rail's included).
    if (back && el.compareDocumentPosition(oldEl) !== Node.DOCUMENT_POSITION_FOLLOWING) keepScroll(el, () => stage.insertBefore(el, oldEl));
    const o = { duration: DUR, easing: EASE };
    if (kind === 'open' || kind === 'close') {
      const source = S.origin && S.origin.isConnected ? S.origin : null;
      S.origin = null;
      if (source && source.getBoundingClientRect().width) { route(oldEl, el, kind, source.dataset.route === 'liquid' ? liquidLook(source) : coverLook(source)); return; }
      kind = kind === 'open' ? 'push' : 'pop';
    }
    if (kind === 'grow') { route(oldEl, el, 'open', orbLook()); return; }
    const card = (kind === 'zoom' ? oldEl : el).querySelector(`.grid:not(.peek) [data-a="open"][data-v="${CSS.escape(S.item || '')}"]`);
    const rect = card?.getBoundingClientRect();
    const scale = rect ? Math.min(rect.width / innerWidth, rect.height / innerHeight) : .84;
    const origin = rect ? `translate(${rect.x + rect.width / 2 - innerWidth / 2}px,${rect.y + rect.height / 2 - innerHeight / 2}px) scale(${scale})` : 'translateY(70px) scale(.84)';
    let outAnim;
    if (kind === 'zoom' && el.classList.contains('media-screen')) {
      // The screen underneath stays put (kept, just hidden once covered, so swiping down can show it again).
      outAnim = lightboxOpen(el, oldEl);
      outAnim.onfinish = () => { if (ctx.current() === el) oldEl.style.visibility = 'hidden'; };
      return;
    } else if (kind === 'binned' && oldEl.classList.contains('media-screen')) {
      lightboxBin(oldEl);
      return;
    } else if (kind === 'binned' && oldEl.classList.contains('note-screen')) {
      noteBin(oldEl);
      return;
    } else if (kind === 'unzoom' && oldEl.classList.contains('media-screen')) {
      lightboxClose(oldEl, el);
      return;
    } else if (kind === 'unzoom' && oldEl.classList.contains('note-screen') && (!onScreen(rect) || oldEl.__route) && oldEl.dataset.draft) {
      route(oldEl, el, 'close', orbLook()); // an untouched new note goes back into the orb it came from
      return;
    } else if ((kind === 'zoom' || kind === 'unzoom') && onScreen(rect)) {
      // Notes: the note itself grows out of its card and folds back into it. The screen underneath stays put.
      const note = kind === 'zoom' ? el : oldEl;
      if (note.__route) { cancelAnimationFrame(note.__route.raf); if (note.__route.end) note.__route.end(); note.__route = null; note.classList.remove('route-morph'); note.style.clipPath = ''; note.style.removeProperty('--route-content-opacity'); }
      card.style.visibility = 'hidden';
      const fold = noteMorph(note, rect, kind === 'zoom');
      if (kind === 'zoom') {
        fold.onfinish = () => { fold.cancel(); note.style.transformOrigin = ''; card.style.visibility = ''; if (ctx.current() === el) oldEl.style.visibility = 'hidden'; };
      } else {
        fold.onfinish = () => { card.style.visibility = ''; note.remove(); };
        oldEl.style.pointerEvents = 'none';
      }
      fold.oncancel = () => { if (!note.__zoom || note.__zoom.real === fold) card.style.visibility = ''; }; // turned round: the card stays hidden under it
      return;
    } else if (kind === 'zoom') {
      // A card that's off screen: the screen rises into place over the one underneath.
      el.animate([{ transform: origin, opacity: .25 }, { transform: 'none', opacity: 1 }], o);
      outAnim = oldEl.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.96)', opacity: .6 }], o);
    } else if (kind === 'unzoom') {
      el.animate([{ transform: 'scale(.96)', opacity: .6 }, { transform: 'none', opacity: 1 }], o);
      outAnim = oldEl.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: origin }], o);
    } else if (kind === 'push') {
      el.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], o);
      outAnim = oldEl.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-22%)', opacity: 0.4 }], o);
    } else if (kind === 'pop') {
      el.animate([{ transform: 'translateX(-22%)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], o);
      outAnim = oldEl.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], o);
    } else {
      // A plain change: the old screen clears before the new one arrives, so two headlines never overlap.
      el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: NORMAL, delay: FAST * 0.6, easing: EASE, fill: 'backwards' });
      outAnim = oldEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FAST * 0.6, easing: 'linear', fill: 'forwards' });
    }
    oldEl.style.pointerEvents = 'none';
    outAnim.onfinish = () => { if (oldEl !== ctx.home()) oldEl.remove(); else oldEl.style.visibility = 'hidden'; oldEl.style.pointerEvents = ''; }; // Home is kept, just hidden
  }

  // Home: the name at the top sinks and fades as you scroll, and the tab bar gets a rule once it sticks. Press and
  // hold the name to change its picture. Pull down from the very top and a sync button drops; let go past the
  // line and it syncs. The board rail ticks as each pile passes.
  function wireHome(root) {
    const mast = root.querySelector('#mast'), bar = root.querySelector('#tabsbar'), rail = root.querySelector('#rail');
    const top = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0;
    let frame = 0, pile = 0;
    root.addEventListener('scroll', () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = root.scrollTop, k = Math.min(1, y / 260);
        mast.style.opacity = (1 - k * 0.9).toFixed(3);
        bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= top() + 1);
      });
    }, { passive: true });
    rail.addEventListener('scroll', () => { const k = Math.round(rail.scrollLeft / 146); if (k !== pile) { pile = k; tick(); } }, { passive: true });
    // Hold a board to rename, pin or delete it.
    let railHold = 0, railHeld = false, rx = 0, ry = 0;
    rail.addEventListener('touchstart', (e) => {
      const p = e.target.closest('.pile[data-v]'); clearTimeout(railHold); if (!p || e.touches.length > 1) return;
      rx = e.touches[0].clientX; ry = e.touches[0].clientY;
      railHeld = false; railHold = setTimeout(() => { railHold = 0; railHeld = true; swallowClick(); window.nbHap('heavy'); S.board = p.dataset.v; ctx.actions().editBoard(); }, 420);
    }, { passive: true });
    rail.addEventListener('touchmove', (e) => { if (railHold && Math.hypot(e.touches[0].clientX - rx, e.touches[0].clientY - ry) > 8) { clearTimeout(railHold); railHold = 0; } }, { passive: true });
    rail.addEventListener('touchend', () => { if (railHeld) { railHeld = false; swallowClick(); } clearTimeout(railHold); railHold = 0; }, { passive: true });

    // Pull down from the very top: a small purple button drops from the top edge and turns as you pull; past the
    // line it fills and ticks; let go to sync. Nothing on the page stretches.
    const ind = ctx.$('#pullind');
    let y0 = null, x0 = 0, dy = 0, armed = false, hold = 0, held = false;
    const drop = (d) => {
      const p = Math.min(1, d / 64);
      ind.style.opacity = Math.min(1, d / 30).toFixed(3); // a tiny accidental pull shows only a faint tip at the top edge
      ind.style.transform = `translate(-50%, ${(-64 + d * 1.15).toFixed(1)}px) rotate(${(p * 300).toFixed(0)}deg) scale(${(0.7 + 0.3 * p).toFixed(3)})`;
      ind.style.setProperty('--p', (p * p).toFixed(3)); // eases into the colour rather than switching
      ind.classList.toggle('armed', p >= 1);
    };
    root.addEventListener('touchstart', (e) => {
      x0 = e.touches[0].clientX;
      y0 = root.scrollTop <= 0 && !e.target.closest('#rail') && !S.select && !ctx.coverOpen() ? e.touches[0].clientY : null; dy = 0; armed = false;
      clearTimeout(hold);
      if (e.target.closest('#mani') && !ctx.coverOpen()) { ctx.dots.startCharge(e.touches[0].clientX, e.touches[0].clientY); held = false; hold = setTimeout(() => { hold = 0; y0 = null; held = true; ctx.actions().cover(); }, 460); }
    }, { passive: true });
    root.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (hold && (Math.abs(t.clientY - (y0 === null ? t.clientY : y0)) > 10 || Math.abs(t.clientX - x0) > 10)) { clearTimeout(hold); hold = 0; ctx.dots && ctx.dots.cancelCharge(); }
      if (y0 === null || S.gesture) return;
      const d = t.clientY - y0;
      if (root.scrollTop > 0 || d <= 0) { if (dy) { dy = 0; drop(0); } return; }
      clearTimeout(hold); hold = 0; ctx.dots && ctx.dots.cancelCharge();
      dy = Math.min(110, d * 0.55); drop(dy);
      if ((dy >= 64) !== armed) { armed = dy >= 64; if (armed) window.nbHap('soft'); }
    }, { passive: true });
    const release = () => {
      // The finger that opened the picture panel is still down: its lift must not also choose a picture now under it.
      if (held) { held = false; swallowClick(); }
      clearTimeout(hold); hold = 0;
      if (hold === 0 && ctx.dots) ctx.dots.cancelCharge();
      if (y0 === null) return;
      y0 = null;
      const fire = armed, from = dy; armed = false; dy = 0;
      if (from) {
        ind.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1), opacity .25s, background-color .3s, border-color .3s, color .3s';
        ind.style.setProperty('--p', fire ? '1' : '0');
        ind.style.transform = `translate(-50%, ${fire ? 30 : -64}px) rotate(${fire ? 360 : 0}deg) scale(${fire ? 1 : .7})`;
        setTimeout(() => { ind.style.opacity = '0'; setTimeout(() => { ind.style.transition = ''; ind.classList.remove('armed'); ind.style.removeProperty('--p'); }, 260); }, fire ? 700 : 120);
      }
      if (fire) ctx.actions().pullSync();
    };
    root.addEventListener('touchend', release, { passive: true });
    root.addEventListener('touchcancel', release, { passive: true });
  }

  // The tap the browser makes at the end of a long press, a carry or a flick is swallowed (only that one).
  let swallow = 0;
  const takeSwallowed = () => { if (!swallow) return false; clearTimeout(swallow); swallow = 0; return true; };
  const swallowClick = () => { clearTimeout(swallow); swallow = setTimeout(() => { swallow = 0; }, 300); };
  const clearSwallow = () => { clearTimeout(swallow); swallow = 0; }; // a new touch means the last gesture's stray tap never came

  // Floating sheets (small forms, a pin): drag one down and it follows the finger; far or fast enough and it
  // closes, otherwise it settles back. Typing in a field is left alone.
  function wirePops(els, close) {
    for (const el of els) {
      // Scrollable sheets must leave their body to the browser. Only an explicit drag handle may dismiss them.
      const handle = el.querySelector('[data-pop-drag]') || (el.id === 'addsheet' ? el : null);
      if (!handle) continue;
      let y0 = null, dy = 0, dragging = false, samples = [];
      const start = (y, time) => {
        const from = getComputedStyle(el).transform;
        el.getAnimations().forEach((a) => a.cancel());
        el.style.transform = from;
        dy = new DOMMatrix(from).m42;
        y0 = y - dy; dragging = false; samples = [[y, time]];
      };
      const move = (y, e) => {
        if (y0 === null) return;
        if (!dragging) {
          if (Math.abs(y - y0) < 8) return;
          if (y < y0) { end(true); return; } // upwards: not a dismiss
          dragging = true;
          if (e.pointerId !== undefined) handle.setPointerCapture(e.pointerId);
        }
        if (e.cancelable) e.preventDefault();
        dy = y - y0;
        samples.push([y, e.timeStamp]); if (samples.length > 5) samples.shift();
        el.style.transform = `translateY(${(dy < 0 ? dy * 0.2 : dy).toFixed(1)}px)`;
      };
      const end = (cancelled) => {
        if (y0 === null) return;
        y0 = null;
        if (!dragging) { el.style.transform = ''; return; }
        dragging = false;
        swallowClick(); // the tap the browser adds after a drag isn't a tap on a row
        const a = samples[0], b = samples[samples.length - 1], v = b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;
        if (!cancelled && (dy > 70 || v > 0.5)) { close(); return; }
        const from = el.style.transform;
        el.style.transform = '';
        if (!calm()) el.animate([{ transform: from }, { transform: 'none' }], { duration: NORMAL, easing: EASE });
      };
      handle.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary || e.button !== 0 || el.dataset.leaving) return;
        start(e.clientY, e.timeStamp);
      });
      handle.addEventListener('pointermove', (e) => move(e.clientY, e));
      handle.addEventListener('pointerup', () => end(false));
      handle.addEventListener('pointercancel', () => end(true));
    }
  }

  return { showSheet, flipGrid, flipRail, wirePops, animateSwap, wireHome, takeSwallowed, swallowClick, clearSwallow };
};
