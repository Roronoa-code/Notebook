// The orb's one liquid surface (libraries.dev Gooey "morph", ported without React, as the + arc and the tab line
// are): the orb, the board bar, the picking bar and the message pill are one shape travelling between their boxes.
// Every edge and the corner ride critically damped springs, so a change of plan mid-way (open then close, the bar
// becoming a message) carries on from exactly where the shape is, at its speed: nothing jumps, nothing restarts.
// Across runs a touch ahead of down, the approved Liquid lead. The orb's purple and plus belong to the orb's own
// shape: they show only while the surface is (nearly) the orb, so it never becomes a purple slab on its way to a bar
// and only turns purple again as it lands back in the orb. What sits on each shape fades in only once there is room.
window.NBSurface = (() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KEYS = ['x', 'y', 'w', 'h', 'r'];
  const OMEGA = { x: 19, w: 19, y: 16.5, h: 16.5, r: 18 }; // about 0.28 s to settle, no overshoot
  const FACE = 70; // how close (px, all edges together) to the orb's own box the surface is still purple
  const zero = () => ({ x: 0, y: 0, w: 0, h: 0, r: 0 });
  let el = null, cur = null, vel = zero(), to = null, raf = 0, last = 0, onStep = null, onDone = null, owner = null, home = null;

  function node() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'morphsurface'; el.hidden = true; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i class="ms-face"></i><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    document.getElementById('app').appendChild(el);
    return el;
  }
  // The orb's own box (it may be hidden while the surface stands in for it).
  function orb() {
    const sb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb')) || 0;
    return { x: innerWidth - 18 - 60, y: innerHeight - sb - 18 - 60, w: 60, h: 60, r: 30, f: 1 };
  }
  // A shape from a DOMRect (or {x, y, w, h}), its corner radius, and how much of the orb's purple it shows.
  const box = (r, radius, face = 0) => ({ x: r.left ?? r.x, y: r.top ?? r.y, w: r.width ?? r.w, h: r.height ?? r.h, r: radius, f: face });
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h);
  // How far the surface is along the way from shape `a` to shape `b` (0 at a, 1 at b), from where it really is, so
  // anything faded by it is continuous however often the plan changes.
  const near = (a, b) => { if (!cur) return 1; const d = dist(a, b); return d < 1 ? 1 : Math.max(0, Math.min(1, 1 - dist(cur, b) / d)); };
  const fade = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

  // The purple and the plus belong to the orb: they show only while the surface is heading for the orb (or is still
  // leaving it), measured as a share of this glide's way, so a fold turns purple over its last half however long it
  // is, and a message or bar that merely passes near the orb's size never turns purple. Both depend only on where the
  // surface is, so a change of plan never snaps the colour.
  let faceOk = false, faceSpan = FACE;
  // It also belongs to the orb's size: never a purple slab bigger than the orb (gone by about one and a half orbs).
  const faceGoal = () => (faceOk ? fade(0.45, 1, 1 - dist(cur, home || (home = orb())) / faceSpan) * (1 - fade(68, 90, Math.max(cur.w, cur.h))) : 0);
  function paint() {
    el.style.transform = `translate3d(${cur.x.toFixed(2)}px,${cur.y.toFixed(2)}px,0)`;
    el.style.width = Math.max(0, cur.w).toFixed(2) + 'px';
    el.style.height = Math.max(0, cur.h).toFixed(2) + 'px';
    el.style.borderRadius = Math.max(0, Math.min(cur.r, cur.w / 2, cur.h / 2)).toFixed(2) + 'px';
    el.style.setProperty('--face', cur.f.toFixed(3));
  }
  function finish() {
    raf = 0; Object.assign(cur, to); vel = zero(); cur.f = faceGoal(); paint();
    const s = onStep, d = onDone; onStep = onDone = null;
    if (s) s(); if (d) d();
  }
  // Critically damped springs, stepped in small slices so a long frame (the page busy building something) is still
  // one smooth step along the same curve, never a leap past the target.
  function frame(now) {
    let dt = Math.max(0, Math.min(0.064, (now - last) / 1000)); last = now;
    while (dt > 0) {
      const h = Math.min(dt, 0.008); dt -= h;
      for (const k of KEYS) { const w = OMEGA[k]; vel[k] += (-w * w * (cur[k] - to[k]) - 2 * w * vel[k]) * h; cur[k] += vel[k] * h; }
    }
    let still = true;
    for (const k of KEYS) if (Math.abs(cur[k] - to[k]) > 0.6 || Math.abs(vel[k]) > 12) still = false; // under a pixel: arrived
    cur.f = faceGoal();
    if (still) { finish(); return; }
    paint();
    if (onStep) onStep();
    raf = requestAnimationFrame(frame);
  }
  // glide(target, { owner, from, z, face, step, done }): `from` is where it starts when the surface isn't already out; when
  // it is, the same owner carries on from where it is (a change of mind). Another owner taking over first lets the
  // one in flight finish (its done() puts its shape in its end state). step() runs every frame (use near()), done()
  // once it has arrived.
  function glide(target, o = {}) {
    node();
    if (onDone && owner !== o.owner) { const d = onDone; onStep = onDone = null; cancelAnimationFrame(raf); raf = 0; d(); }
    owner = o.owner || null;
    home = orb(); // (the orb's place, once per glide)
    if (el.hidden || !cur) { const f = o.from || target; cur = { ...f, f: f.f || 0 }; vel = zero(); }
    to = { ...target };
    faceOk = !!o.face || cur.f > 0.01; // heading for the orb, or still showing some of it as it leaves
    faceSpan = Math.max(FACE, dist(cur, home), dist(to, home));
    onStep = o.step || null; onDone = o.done || null;
    if (o.z != null) el.style.zIndex = String(o.z);
    el.hidden = false;
    paint();
    if (reduced()) { cancelAnimationFrame(raf); finish(); return; }
    if (onStep) onStep();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function rest() { cancelAnimationFrame(raf); raf = 0; onStep = onDone = null; if (el) el.hidden = true; }
  const state = () => ({ out: !!el && !el.hidden, moving: !!raf, cur: cur && { ...cur }, to: to && { ...to }, speed: Math.hypot(vel.w, vel.h, vel.x, vel.y) });
  return { glide, rest, orb, box, near, fade, state };
})();
