// Motion and touch on the phone screens: screen changes (photos fly between their card and the screen),
// the items panel's spring, swipe down to close, flicking through stacks and press-and-hold to pick.
// app.js owns the state and passes it in through `ctx`.
window.NBMotion = (ctx) => {
  const { S, app, tick } = ctx;

  // Transform and opacity stay on compositor layers; clipping a whole frosted screen repaints it.
  const EASE = 'cubic-bezier(.2,.75,.25,1)', DUR = 460;

  // An open photo or video is an overlay on the screen underneath: the picture itself grows out of
  // its card (and shrinks back into it), the backdrop fades, and nothing else moves.
  const cardOf = (screen) => screen.querySelector(`[data-a="open"][data-v="${CSS.escape(S.item || '')}"] .media`);
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
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR * 0.8, easing: 'ease-out' });
    el.querySelector('.sheet').animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], o);
    el.querySelector('.lbback').animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], o);
    if (media && onScreen(r)) {
      card.style.visibility = 'hidden';
      const a = media.animate([{ transform: overRect(media, r) }, { transform: 'none' }], o);
      a.onfinish = a.oncancel = () => { card.style.visibility = ''; };
    } else if (media) media.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], o);
    return scrim.getAnimations()[0];
  }
  function lightboxClose(el, under) {
    const media = mediaOf(el), scrim = el.querySelector('.scrim');
    const card = cardOf(under), r = card && card.getBoundingClientRect();
    const o = { duration: DUR, easing: EASE, fill: 'forwards' };
    const from = media ? media.style.transform || 'none' : 'none';
    stillVideo(el);
    scrim.animate([{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }], o);
    chromeOf(el).forEach((c) => c.animate([{ opacity: getComputedStyle(c).opacity }, { opacity: 0 }], { duration: 160, fill: 'forwards' }));
    let a;
    if (media && onScreen(r)) {
      card.style.visibility = 'hidden';
      a = media.animate([{ transform: from }, { transform: overRect(media, r) }], o);
    } else a = (media || scrim).animate([{ transform: from, opacity: 1 }, { transform: from + ' scale(.85)', opacity: 0 }], o);
    a.onfinish = () => { if (card) card.style.visibility = ''; el.remove(); };
    el.style.pointerEvents = 'none';
  }

  function animateSwap(oldEl, el, kind) {
    const stage = ctx.$('#stage');
    if (!oldEl || oldEl === el) return;
    oldEl.inert = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { if (oldEl !== ctx.home()) oldEl.remove(); else oldEl.style.visibility = 'hidden'; return; }
    const back = kind === 'unzoom' || kind === 'pop';
    if (back) stage.insertBefore(el, oldEl); // the screen being left stays on top while it goes
    const o = { duration: DUR, easing: EASE };
    const card = (kind === 'zoom' ? oldEl : el).querySelector(`[data-a="open"][data-v="${CSS.escape(S.item || '')}"]`);
    const rect = card?.getBoundingClientRect();
    const scale = rect ? Math.min(rect.width / innerWidth, rect.height / innerHeight) : .84;
    const origin = rect ? `translate(${rect.x + rect.width / 2 - innerWidth / 2}px,${rect.y + rect.height / 2 - innerHeight / 2}px) scale(${scale})` : 'translateY(70px) scale(.84)';
    let outAnim;
    if (kind === 'zoom' && el.classList.contains('media-screen')) {
      // The screen underneath stays put (kept, just hidden once covered, so swiping down can show it again).
      outAnim = lightboxOpen(el, oldEl);
      outAnim.onfinish = () => { if (ctx.current() === el) oldEl.style.visibility = 'hidden'; };
      return;
    } else if (kind === 'unzoom' && oldEl.classList.contains('media-screen')) {
      lightboxClose(oldEl, el);
      return;
    } else if (kind === 'zoom') {
      // Notes (or a card that's off screen): the screen grows out of the card over Home.
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
      el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
      outAnim = oldEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' });
    }
    oldEl.style.pointerEvents = 'none';
    outAnim.onfinish = () => { if (oldEl !== ctx.home()) oldEl.remove(); else oldEl.style.visibility = 'hidden'; oldEl.style.pointerEvents = ''; }; // Home is kept, just hidden
  }

  // The items panel's two resting places: down under the boards, or up under the top bar.
  const liftStops = () => ({ up: (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--st')) || 0) + 58, down: parseFloat(app.style.getPropertyValue('--hero')) || 560 });
  const liftY = (el) => new DOMMatrix(getComputedStyle(el).transform).m42;
  let liftFrame = 0;
  function paintLift(el, y) {
    const { up, down } = liftStops();
    el.style.transform = `translateY(${y.toFixed(1)}px)`;
    ctx.home().querySelector('#topglass').style.opacity = Math.max(0, Math.min(1, (down - y) / (down - up))).toFixed(3);
  }
  // A small spring: a hard flick arrives fast and bounces a little past, a gentle one just settles.
  function springLift(el, to, v0) {
    cancelAnimationFrame(liftFrame);
    let y = liftY(el), v = v0 || 0, last = performance.now();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) y = to;
    const step = (now) => {
      const dt = Math.min(32, now - last) / 1000; last = now;
      const a = -210 * (y - to) - 24 * v; // stiffness, damping (slightly under-damped)
      v += a * dt; y += v * dt;
      if (Math.abs(y - to) < 0.4 && Math.abs(v) < 8) { liftFrame = 0; el.style.transform = ''; ctx.home().querySelector('#topglass').style.opacity = ''; return; }
      paintLift(el, y);
      liftFrame = requestAnimationFrame(step);
    };
    liftFrame = requestAnimationFrame(step);
  }
  function setLift(v, velocity) {
    S.lift = v;
    const el = ctx.home() && ctx.home().querySelector('#lift');
    if (!el) return;
    const from = liftY(el);
    el.classList.toggle('up', v);
    ctx.home().querySelector('#topglass').classList.toggle('on', v);
    el.querySelector('.grip').setAttribute('aria-label', v ? 'Lower items' : 'Lift items up');
    if (!v) el.scrollTop = 0;
    paintLift(el, from); // start the spring from wherever the panel is now
    springLift(el, v ? liftStops().up : liftStops().down, velocity);
  }

  function wireHome(root) {
    const lift = root.querySelector('#lift');
    let y0 = 0, start = 0, dragging = false, caught = false, samples = [];
    lift.addEventListener('touchstart', (e) => {
      caught = !!liftFrame; cancelAnimationFrame(liftFrame); liftFrame = 0; // a finger catches it mid-spring
      y0 = e.touches[0].clientY; start = liftY(lift); dragging = false; samples = [{ y: y0, t: e.timeStamp }];
    }, { passive: true });
    lift.addEventListener('touchmove', (e) => {
      const y = e.touches[0].clientY, dy = y - y0;
      samples.push({ y, t: e.timeStamp }); if (samples.length > 6) samples.shift();
      if (!dragging) {
        // Down: any drag moves it. Up: only a pull-down from the very top of the list (otherwise it scrolls).
        if (S.gesture || Math.abs(dy) < 6 || (S.lift && (lift.scrollTop > 0 || dy < 0))) return;
        dragging = true;
      }
      const { up, down } = liftStops();
      let to = start + (y - y0);
      if (to < up) to = up - (up - to) * 0.25; // rubbery past the ends
      if (to > down) to = down + (to - down) * 0.3;
      paintLift(lift, to);
    }, { passive: true });
    const end = () => {
      if (!dragging) { if (caught) setLift(S.lift); return; } // caught but not dragged: carry on to where it was going
      dragging = false;
      const a = samples[0], b = samples[samples.length - 1];
      const v = b && a && b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0; // px per second, + is down
      const { up, down } = liftStops(), y = liftY(lift);
      const goUp = Math.abs(v) > 350 ? v < 0 : y < (up + down) / 2;
      setLift(goUp, v);
    };
    lift.addEventListener('touchend', end, { passive: true });
    lift.addEventListener('touchcancel', end, { passive: true });
    lift.addEventListener('wheel', (e) => { if (!S.lift && e.deltaY > 0) setLift(true); else if (S.lift && lift.scrollTop <= 0 && e.deltaY < 0) setLift(false); }, { passive: true });
  }

  // On every grid: flick a stack sideways to go through it; press and hold a card to start picking.
  // The tap the browser makes at the end of a flick or long press is swallowed (only that one).
  let swallow = 0;
  const takeSwallowed = () => { if (!swallow) return false; clearTimeout(swallow); swallow = 0; return true; };
  const swallowClick = () => { clearTimeout(swallow); swallow = setTimeout(() => { swallow = 0; }, 300); };
  // Press and hold a card: it lifts. Drag it onto another card (or a stack) and let go to stack them;
  // let go without moving to start picking instead. A sideways flick on a stack goes through it.
  function wireGrid(grid) {
    if (grid.dataset.wired) return;
    grid.dataset.wired = '1';
    let x0 = 0, y0 = 0, t0 = 0, mode = null, stack = null, topEl = null, hold = 0, target = null, over = null;
    const reset = (c) => { c.style.transition = ''; c.style.transform = ''; c.style.zIndex = ''; c.classList.remove('lifted'); };
    grid.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return;
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY; t0 = e.timeStamp; mode = 'maybe'; S.gesture = null; over = null;
      clearTimeout(swallow); swallow = 0; // a new touch means the last gesture's stray tap never came
      target = e.target.closest('.card');
      stack = e.target.closest('.stackcard');
      topEl = stack && [...stack.querySelectorAll('.fanitem')].find((b) => !b.style.pointerEvents);
      clearTimeout(hold);
      if (target && !S.select && !target.closest('#bingrid')) hold = setTimeout(() => {
        mode = 'lift'; S.gesture = 'lift'; tick();
        target.classList.add('lifted');
        target.style.zIndex = '20';
        target.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1.3)';
        target.style.transform = 'scale(1.06)';
      }, 420);
    }, { passive: true });
    grid.addEventListener('touchmove', (e) => {
      if (!mode) return;
      const t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (mode === 'lift' || mode === 'drag') {
        e.preventDefault(); // the page doesn't scroll while a card is held
        if (mode === 'lift' && Math.hypot(dx, dy) < 6) return;
        mode = 'drag';
        target.style.transition = 'none';
        target.style.transform = `translate(${dx}px,${dy}px) scale(1.06) rotate(${(dx / 30).toFixed(2)}deg)`;
        target.style.pointerEvents = 'none';
        const under = document.elementFromPoint(t.clientX, t.clientY);
        target.style.pointerEvents = '';
        const next = under && under.closest('.grid .card');
        const hit = next && next !== target ? next : null;
        if (hit !== over) { if (over) over.classList.remove('droptarget'); if (hit) { hit.classList.add('droptarget'); tick(); } over = hit; }
        return;
      }
      if (mode === 'maybe') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        clearTimeout(hold);
        if (stack && topEl && !S.select && Math.abs(dx) > Math.abs(dy) * 1.2) { mode = 'stack'; S.gesture = 'stack'; topEl.style.transition = 'none'; }
        else { mode = null; return; }
      }
      topEl.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    }, { passive: false });
    const end = (e) => {
      clearTimeout(hold);
      const was = mode; mode = null;
      setTimeout(() => { S.gesture = null; }, 0);
      if (was === 'lift') { swallowClick(); reset(target); startSelect(target); return; } // held still: start picking
      if (was === 'drag') {
        swallowClick();
        const card = target, onto = over;
        if (onto) {
          onto.classList.remove('droptarget');
          // Drop: the card shrinks into the middle of the one it was dropped on (its rect already includes the drag), then they become one stack.
          const a = card.getBoundingClientRect(), b = onto.getBoundingClientRect();
          card.style.transition = 'transform .2s ease-in, opacity .2s';
          card.style.transform = `translate(${b.x + b.width / 2 - (a.x + a.width / 2)}px,${b.y + b.height / 2 - (a.y + a.height / 2)}px) scale(.5)`;
          const ids = cardIds(card).concat(cardIds(onto));
          setTimeout(() => { reset(card); ctx.actions().stackIds(ids); }, 190);
        } else {
          card.style.transition = 'transform .35s cubic-bezier(.2,.9,.3,1.15)';
          card.style.transform = '';
          setTimeout(() => reset(card), 360);
        }
        return;
      }
      if (was !== 'stack') return;
      swallowClick();
      const dx = (e.changedTouches[0] || {}).clientX - x0, v = dx / Math.max(1, e.timeStamp - t0);
      const el = topEl, st = stack;
      if (Math.abs(dx) > 60 || Math.abs(v) > 0.45) {
        if (dx < 0) {
          // Next: the top card flies off to the left, then tucks in at the back.
          el.style.transition = 'transform .18s ease-out';
          el.style.transform = `translateX(${-1.3 * el.offsetWidth}px) rotate(-14deg)`;
          setTimeout(() => { el.style.transition = ''; el.style.transform = ''; ctx.turnStack(st, 1); }, 170);
        } else { el.style.transition = ''; el.style.transform = ''; ctx.turnStack(st, -1); } // previous: the back card comes to the front
      } else { el.style.transition = ''; el.style.transform = ''; }
    };
    grid.addEventListener('touchend', end, { passive: true });
    grid.addEventListener('touchcancel', end, { passive: true });
  }

  // Picking: tap cards (a stack counts as all of its pictures), then Stack.
  const cardIds = (c) => (c.classList.contains('stackcard') ? [...c.querySelectorAll('.fanitem')].map((b) => b.dataset.v) : [c.dataset.v]);
  function startSelect(c) { S.select = new Set(); tick(); toggleSelect(c); }
  function toggleSelect(c) {
    const ids = cardIds(c), on = !ids.every((id) => S.select.has(id));
    ids.forEach((id) => (on ? S.select.add(id) : S.select.delete(id)));
    markSelection(); ctx.updateChrome();
  }
  function markSelection() {
    app.querySelectorAll('.grid .card').forEach((c) => {
      const on = !!S.select && cardIds(c).every((id) => S.select.has(id));
      c.classList.toggle('sel', on);
      c.setAttribute('aria-pressed', S.select ? String(on) : '');
      if (!S.select) c.removeAttribute('aria-pressed');
    });
  }
  const pickedCards = () => app.querySelectorAll('.grid .card.sel').length;
  function endSelect() { S.select = null; markSelection(); ctx.updateChrome(); }

  // Swipe down on an open photo or video to go back: only the picture follows the finger (shrinking a
  // little) while the backdrop fades to the screen underneath; let go past the line, or flick, and it
  // flies back into its card from wherever it is. Otherwise it springs back.
  function wireDismiss(root) {
    const stage = root.querySelector('.media-screen .stage');
    if (!stage) return;
    const media = mediaOf(root), scrim = root.querySelector('.scrim');
    let y0 = 0, x0 = 0, dx = 0, dy = 0, active = false, dragging = false, samples = [];
    stage.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      // Leave the video's position line and sound button alone.
      if (e.touches.length > 1 || e.target.closest('.vbar, .vsound')) { active = false; return; }
      active = true; dragging = false; y0 = t.clientY; x0 = t.clientX; dx = dy = 0; samples = [{ y: y0, t: e.timeStamp }];
    }, { passive: true });
    stage.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.touches[0];
      dx = t.clientX - x0; dy = t.clientY - y0;
      samples.push({ y: t.clientY, t: e.timeStamp }); if (samples.length > 5) samples.shift();
      if (!dragging) {
        if (dy < 10 || Math.abs(dy) < Math.abs(dx)) return;
        dragging = true;
        [media, scrim, ...chromeOf(root)].forEach((x) => x.getAnimations().forEach((a) => a.finish()));
        const under = root.previousElementSibling;
        if (under) under.style.visibility = '';
        y0 = t.clientY - 10; dy = 10;
      }
      const k = Math.max(0, dy);
      media.style.transform = `translate(${(dx * 0.7).toFixed(1)}px,${k.toFixed(1)}px) scale(${Math.max(0.6, 1 - k / 1200).toFixed(4)})`;
      scrim.style.opacity = Math.max(0, 1 - k / 320).toFixed(3);
      const fade = Math.max(0, 1 - k / 70).toFixed(3);
      chromeOf(root).forEach((c) => { c.style.opacity = fade; });
    }, { passive: true });
    const end = () => {
      if (!active || !dragging) { active = false; return; }
      active = false; dragging = false;
      const a = samples[0], b = samples[samples.length - 1];
      const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px per ms, + is down
      if (dy > 110 || v > 0.5) { ctx.actions().back(); return; }
      const o = { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.12)' };
      media.animate([{ transform: media.style.transform }, { transform: 'none' }], o);
      scrim.animate([{ opacity: scrim.style.opacity }, { opacity: 1 }], o);
      chromeOf(root).forEach((c) => c.animate([{ opacity: c.style.opacity }, { opacity: 1 }], o));
      media.style.transform = ''; scrim.style.opacity = '';
      chromeOf(root).forEach((c) => { c.style.opacity = ''; });
      const under = root.previousElementSibling;
      setTimeout(() => { if (under && ctx.current() === root) under.style.visibility = 'hidden'; }, 330);
    };
    stage.addEventListener('touchend', end, { passive: true });
    stage.addEventListener('touchcancel', end, { passive: true });
  }

  return { animateSwap, setLift, wireHome, wireGrid, wireDismiss, markSelection, toggleSelect, endSelect, takeSwallowed, pickedCards };
};
