// Motion and touch on the phone screens: screen changes (photos fly between their card and the screen),
// the items panel's spring, swipe down to close, flicking through stacks and press-and-hold to pick.
// app.js owns the state and passes it in through `ctx`.
window.NBMotion = (ctx) => {
  const { S, app, tick } = ctx;

  // Transform and opacity stay on compositor layers; clipping a whole frosted screen repaints it.
  const EASE = 'cubic-bezier(.2,.75,.25,1)', DUR = 460;

  // Photos and videos fly between their card and the open screen, so it reads as the same thing
  // moving rather than one screen swapping for another. Returns null when there's nothing to fly.
  let flight = null;
  function mediaFlight(itemScreen, homeScreen, opening) {
    const it = ctx.db().items.find((x) => x.id === S.item);
    const card = homeScreen.querySelector(`[data-a="open"][data-v="${CSS.escape(S.item || '')}"] .media`);
    const target = itemScreen.querySelector('.stage img, .stage video');
    if (!it || !card || !target) return null;
    const c = card.getBoundingClientRect(), box = target.getBoundingClientRect();
    if (!c.width || !box.width || c.bottom < 0 || c.top > innerHeight) return null;
    const ar = it.w && it.h ? it.w / it.h : c.width / c.height;
    const w = Math.min(box.width, box.height * ar), h = w / ar;
    const t = { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2 };
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.width = w + 'px'; ghost.style.height = h + 'px';
    const img = document.createElement('img');
    img.src = card.querySelector('img')?.src || ctx.url(it.thumb);
    ghost.append(img);
    app.append(ghost);
    const small = { transform: `translate(${c.x}px,${c.y}px) scale(${c.width / w},${c.height / h})`, borderRadius: `${20 * w / c.width}px / ${20 * h / c.height}px` };
    const big = { transform: `translate(${t.x}px,${t.y}px)`, borderRadius: '22px' };
    card.style.opacity = '0'; target.style.opacity = '0';
    Object.assign(ghost.style, opening ? big : small); // where it rests if it has to wait for the full photo
    const anim = ghost.animate(opening ? [small, big] : [big, small], { duration: DUR, easing: EASE });
    const done = () => { target.style.opacity = ''; card.style.opacity = ''; ghost.remove(); if (flight === anim) flight = null; };
    // Opening: keep the small copy up until the full photo is ready, so it never flashes.
    anim.onfinish = () => { if (opening && target.tagName === 'IMG') target.decode().catch(() => {}).then(done); else done(); };
    anim.oncancel = done;
    flight = anim;
    return anim;
  }

  function animateSwap(oldEl, el, kind) {
    const stage = ctx.$('#stage');
    if (!oldEl || oldEl === el) return;
    if (flight) flight.finish(); // a new move starts from where things really are
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
    const sheet = (kind === 'zoom' ? el : oldEl).querySelector('.sheet');
    const fly = (kind === 'zoom' || kind === 'unzoom') && (kind === 'zoom' ? mediaFlight(el, oldEl, true) : mediaFlight(oldEl, el, false));
    if (kind === 'zoom' && fly) {
      // Home stays where it is and sinks back slightly; the dark screen fades in behind the flying photo.
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR * 0.7, easing: 'ease-out' });
      sheet?.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], o);
      outAnim = oldEl.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.96)', opacity: .6 }], o);
    } else if (kind === 'unzoom' && fly) {
      el.animate([{ transform: 'scale(.96)', opacity: .6 }, { transform: 'none', opacity: 1 }], o);
      sheet?.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], o);
      outAnim = oldEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR * 0.7, easing: 'ease-in', fill: 'forwards' });
      outAnim.onfinish = null;
      const wait = oldEl.animate([{ visibility: 'visible' }, { visibility: 'visible' }], o); // remove only once the photo has landed
      wait.onfinish = () => oldEl.remove();
      oldEl.style.pointerEvents = 'none';
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
  function wireGrid(grid) {
    if (grid.dataset.wired) return;
    grid.dataset.wired = '1';
    let x0 = 0, y0 = 0, t0 = 0, mode = null, stack = null, topEl = null, hold = 0, held = false, target = null;
    grid.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return;
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY; t0 = e.timeStamp; mode = 'maybe'; held = false; S.gesture = null;
      target = e.target.closest('.card');
      stack = e.target.closest('.stackcard');
      topEl = stack && [...stack.querySelectorAll('.fanitem')].find((b) => !b.style.pointerEvents);
      clearTimeout(hold);
      if (target && !S.select && !target.closest('#bingrid')) hold = setTimeout(() => { mode = null; held = true; startSelect(target); }, 480);
    }, { passive: true });
    grid.addEventListener('touchmove', (e) => {
      if (!mode) return;
      const t = e.touches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (mode === 'maybe') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        clearTimeout(hold);
        if (stack && topEl && !S.select && Math.abs(dx) > Math.abs(dy) * 1.2) { mode = 'stack'; S.gesture = 'stack'; topEl.style.transition = 'none'; }
        else { mode = null; return; }
      }
      topEl.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    }, { passive: true });
    const end = (e) => {
      clearTimeout(hold);
      if (held) { held = false; swallowClick(); } // the lift of a long press isn't a tap
      if (mode !== 'stack') { mode = null; return; }
      mode = null; swallowClick();
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
      setTimeout(() => { S.gesture = null; }, 0);
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
  function endSelect() { S.select = null; markSelection(); ctx.updateChrome(); }

  // Swipe down on an open photo or video to go back: it follows the finger, shrinking a little,
  // with Home showing behind it; let go past the line (or flick) and it flies back into its card.
  function wireDismiss(root) {
    const stage = root.querySelector('.media-screen .stage');
    if (!stage) return;
    let y0 = 0, x0 = 0, t0 = 0, dy = 0, active = false, dragging = false;
    stage.addEventListener('touchstart', (e) => {
      const t = e.touches[0], v = stage.querySelector('video');
      // Leave the video's own controls (bottom of the player) alone.
      if (e.touches.length > 1 || (v && t.clientY > v.getBoundingClientRect().bottom - 70)) { active = false; return; }
      active = true; dragging = false; y0 = t.clientY; x0 = t.clientX; t0 = e.timeStamp; dy = 0;
    }, { passive: true });
    stage.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.touches[0];
      dy = t.clientY - y0;
      if (!dragging) {
        if (dy < 10 || Math.abs(dy) < Math.abs(t.clientX - x0)) return;
        dragging = true;
        root.getAnimations().forEach((x) => x.finish());
        if (ctx.home() && ctx.home() !== root && S.prev !== 'board' && S.prev !== 'search') ctx.home().style.visibility = '';
      }
      const k = Math.max(0, dy);
      root.style.transform = `translateY(${k}px) scale(${Math.max(0.82, 1 - k / 1800)})`;
      root.style.borderRadius = Math.min(28, k / 5) + 'px';
      root.style.overflow = 'hidden';
    }, { passive: true });
    const end = (e) => {
      if (!active || !dragging) { active = false; return; }
      active = false; dragging = false;
      const v = dy / Math.max(1, e.timeStamp - t0);
      if (dy > 110 || v > 0.6) { ctx.actions().back(); return; }
      const back = root.animate([{ transform: root.style.transform, borderRadius: root.style.borderRadius }, { transform: 'none', borderRadius: '0px' }], { duration: 300, easing: 'cubic-bezier(.2,.9,.3,1.15)' });
      root.style.transform = ''; root.style.borderRadius = '';
      back.onfinish = () => { if (ctx.home() && ctx.home() !== root && ctx.current() === root) ctx.home().style.visibility = 'hidden'; };
    };
    stage.addEventListener('touchend', end, { passive: true });
    stage.addEventListener('touchcancel', end, { passive: true });
  }


  return { animateSwap, setLift, wireHome, wireGrid, wireDismiss, markSelection, toggleSelect, endSelect, takeSwallowed };
};
