// The board wheel on Home: a loop, about five boards showing, fading out towards the edges.
// app.js owns the state and passes it in through `ctx`.
window.NBWheel = (ctx) => {
  const { S, N, tick } = ctx;
  const STEP = 58;
  const count = () => ctx.wheel().length;
  const looped = () => count() >= 5;
  const wrapIndex = (x) => ((Math.round(x) % count()) + count()) % count();
  const focusIndex = () => (looped() ? wrapIndex(S.pos) : Math.max(0, Math.min(count() - 1, Math.round(S.pos))));
  function circ(k, pos) {
    if (!looped()) return k - pos;
    const n = count();
    let d = (((k - pos) % n) + n) % n;
    if (d > n / 2) d -= n;
    return d;
  }
  function layoutPills() {
    const stack = ctx.home() && ctx.home().querySelector('#stack');
    if (!stack) return;
    stack.querySelectorAll('.pill').forEach((el) => {
      const d = circ(+el.dataset.pill, S.pos), a = Math.abs(d);
      el.style.transform = `translateY(${(d * STEP).toFixed(1)}px) scale(${(1 - Math.min(a, 3) * 0.04).toFixed(3)})`;
      el.style.opacity = a >= 2.6 ? '0' : Math.max(0, 1 - a * 0.28 - Math.max(0, a - 1.8) * 0.9).toFixed(3);
      el.style.setProperty('--glow', Math.max(0, 0.22 - a * 0.09).toFixed(3)); // the middle board is lit
      el.style.zIndex = String(10 - Math.round(a));
      el.style.pointerEvents = a > 2.2 ? 'none' : 'auto';
    });
  }
  // Spins the wheel to a board. The position itself is animated (not each pill), so on a loop every
  // board moves round in the same direction and nothing ever slides the wrong way across the middle.
  let spinFrame = 0;
  function settle(target) {
    if (!looped()) target = Math.max(0, Math.min(count() - 1, target));
    cancelAnimationFrame(spinFrame);
    const start = S.pos, dist = target - start;
    if (Math.abs(dist) < 0.001) { S.pos = target; layoutPills(); return; }
    const dur = Math.min(900, 340 + 190 * Math.sqrt(Math.abs(dist)));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { S.pos = target; layoutPills(); return; }
    const t0 = performance.now();
    let lastFocus = focusIndex();
    const ease = (t) => 1 - Math.pow(1 - t, 3); // quick start, gentle landing
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      S.pos = start + dist * ease(t);
      layoutPills();
      const f = focusIndex();
      if (f !== lastFocus) { lastFocus = f; tick(); } // a tick for every board that passes the middle
      if (t < 1) spinFrame = requestAnimationFrame(step);
      else { S.pos = target; layoutPills(); N.setPref('wheel', String(wrapIndex(S.pos))); }
    };
    spinFrame = requestAnimationFrame(step);
  }
  function rebuildWheel() {
    const stack = ctx.home() && ctx.home().querySelector('#stack');
    if (!stack) return;
    stack.classList.add('drag');
    stack.innerHTML = ctx.pillsHTML();
    layoutPills();
    void stack.offsetWidth;
    stack.classList.remove('drag');
  }
  // Drag follows your finger; letting go snaps to the nearest board (a quick flick carries on a few).
  function wireWheel(root) {
    const stack = root.querySelector('#stack');
    let y0 = 0, pos0 = 0, lastY = 0, lastT = 0, vel = 0, moved = false, lastFocus = 0;
    stack.addEventListener('touchstart', (e) => {
      cancelAnimationFrame(spinFrame); // catching the wheel mid-spin stops it where it is
      y0 = lastY = e.touches[0].clientY; lastT = e.timeStamp; pos0 = S.pos; vel = 0; moved = false; lastFocus = focusIndex();
    }, { passive: true });
    stack.addEventListener('touchmove', (e) => {
      const y = e.touches[0].clientY;
      if (Math.abs(y - y0) > 6) moved = true;
      const dt = Math.max(1, e.timeStamp - lastT);
      vel = 0.7 * vel + 0.3 * ((lastY - y) / STEP / dt);
      lastY = y; lastT = e.timeStamp;
      S.pos = pos0 + (y0 - y) / STEP;
      if (!looped()) S.pos = Math.max(-0.4, Math.min(count() - 0.6, S.pos));
      layoutPills();
      const f = focusIndex();
      if (f !== lastFocus) { lastFocus = f; tick(); }
    }, { passive: true });
    const end = (e) => {
      if (!moved) return;
      // A flick keeps going in the same direction: faster flicks travel further.
      const recent = e && e.timeStamp - lastT < 80 ? vel : 0;
      const fling = Math.max(-6, Math.min(6, recent * 220));
      settle(Math.round(S.pos + fling));
      stack.dataset.swiped = '1';
      setTimeout(() => { stack.dataset.swiped = ''; }, 80);
    };
    stack.addEventListener('touchend', end, { passive: true });
    stack.addEventListener('touchcancel', end, { passive: true });
    stack.addEventListener('wheel', (e) => { e.preventDefault(); settle(Math.round(S.pos) + Math.sign(e.deltaY)); }, { passive: false });
    stack.addEventListener('click', (e) => {
      const el = e.target.closest('.pill');
      if (!el || stack.dataset.swiped) return;
      const k = +el.dataset.pill;
      if (k !== focusIndex()) { settle(Math.round(S.pos + circ(k, S.pos))); return; }
      const b = ctx.wheel()[k];
      if (b.isNew) { ctx.openForm('newBoard'); return; }
      ctx.go('board', { board: b.id }, 'push');
    });
  }
  return { layoutPills, settle, rebuildWheel, wireWheel, circ };
};
