// The bottom-right action area is one thing with a few shapes: the + orb (nothing going on), a message pill (the
// orb saying something), the picking bar (cards picked), the boards (cards being carried: a compact pill that opens
// into every board when the finger is right over it) and a small form (a board's options, a new board, a Pinterest
// idea...): everything that appears down here comes out of the +. Changing shape,
// one liquid surface (surface.js) travels from the old box to the new one: what sat in the old box fades as the
// surface leaves it, what belongs in the new one fades in only once the surface is nearly there, and nothing ever
// shows outside the surface. A change of plan mid-way carries on from wherever the surface is. The orb's purple
// and plus belong to its own shape only, so while cards are picked or carried the + never shows.
// Away (an open item, the header picture, a small form): the orb drops out of the way and rises back after.
window.NBDock = (ctx) => {
  const { $ } = ctx;
  const Sf = window.NBSurface;
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = getComputedStyle(document.documentElement).getPropertyValue('--ease').trim();
  const RADIUS = { pick: 28, drag: 30, boards: 26, pill: 30, form: 28 };
  let shape = 'orb', pill = null, orbAnim = null, z = 11, leftOrb = false; // leftOrb: this journey began as the +
  const riders = new Map(); // element → { box, span } for everything riding the surface just now
  const orb = () => $('#orb');
  const elOf = (k) => (k === 'pick' ? $('#selbar') : k === 'drag' ? $('#shelfmini') : k === 'boards' ? $('#shelf') : k === 'form' ? $('#formsheet') : k === 'pill' ? pill : null);
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h);

  // What rides the surface is drawn whole: its own layout, scaled down to fit inside the surface and centred in it,
  // so it grows and shrinks with the shape and no edge ever slices through a word or a button. Hand-off by position
  // alone (continuous however often the plan changes): what the surface is leaving fades out over the first half of
  // the way, what it is going to fades in over the second, so the two never share pixels and the shape is never
  // empty for long. Tiny scaled content stays hidden.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function paintRiders() {
    const cur = Sf.state().cur;
    if (!cur) return;
    const r = Math.max(0, Math.min(cur.r, cur.w / 2, cur.h / 2)), dest = elOf(shape);
    let coming = 0, going = 0;
    for (const [el, rd] of riders) {
      const b = rd.box, near = clamp01(1 - dist(cur, b) / rd.span);
      const s = Math.min(1, cur.w / b.w, cur.h / b.h);
      const tx = cur.x + (cur.w - b.w * s) / 2 - b.x, ty = cur.y + (cur.h - b.h * s) / 2 - b.y;
      const show = rd.keep ? 1 : (el === dest ? Sf.fade(0.52, 0.88, near) : Sf.fade(0.52, 1, near)) * Sf.fade(0.3, 0.6, s);
      el.style.setProperty('--content', show.toFixed(3));
      if (el === dest) coming = show; else going = Math.max(going, show);
      el.style.transform = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${s.toFixed(4)})`;
      // The surface's own outline in the content's (unscaled) frame: only its rounded corners ever trim anything.
      const l = (cur.x - b.x - tx) / s, t = (cur.y - b.y - ty) / s;
      el.style.clipPath = `inset(${t.toFixed(1)}px ${(b.w - l - cur.w / s).toFixed(1)}px ${(b.h - t - cur.h / s).toFixed(1)}px ${l.toFixed(1)}px round ${(r / s).toFixed(1)}px)`;
    }
    // The + itself hands over on the same progress: leaving the orb it stays until the new contents come in (they
    // rise as it goes, so the shape is never empty); heading back it returns as the old contents leave.
    const plus = 1 - Math.min(1, 2 * (shape === 'orb' ? going : leftOrb ? coming : 1)); // (gone by the time the other is half there: never both)
    document.getElementById('morphsurface')?.style.setProperty('--plus', Math.max(cur.f * cur.f, plus).toFixed(3));
  }
  function ride(el, radius) {
    if (!el) return null;
    if (!riders.has(el)) {
      el.getAnimations().forEach((a) => a.cancel()); // (a small form that was still sinking away)
      delete el.dataset.leaving;
      el.hidden = false;
      el.classList.add('riding');
      el.inert = true;
      el.style.setProperty('--content', '0');
    }
    el.style.transform = 'none'; // measured where it will rest
    const box = Sf.box(el.getBoundingClientRect(), radius, 0);
    el.style.transformOrigin = '0 0';
    riders.set(el, { box, span: Math.max(160, dist(box, Sf.orb())) });
    return box;
  }
  function unride(el, keep) {
    riders.delete(el);
    el.classList.remove('riding');
    el.style.removeProperty('--content');
    el.style.clipPath = ''; el.style.transform = ''; el.style.transformOrigin = '';
    el.inert = !keep;
    if (keep) return;
    el.hidden = true;
    if (el === pill) { pill.remove(); pill = null; }
  }
  // Where the orb is drawn right now (it may still be rising back into place).
  function orbBox() {
    const o = orb();
    if (o.hidden || !o.getAnimations().length) return Sf.orb();
    const r = o.getBoundingClientRect();
    return r.width ? Sf.box(r, r.width / 2, 1) : Sf.orb();
  }
  function hideOrb() { const o = orb(); if (orbAnim) { orbAnim.cancel(); orbAnim = null; } o.getAnimations().forEach((a) => a.cancel()); o.hidden = true; o.inert = true; }
  function showOrb() { const o = orb(); o.hidden = false; o.inert = false; o.style.visibility = ''; }

  // The surface glides to `key`'s box, from wherever it is (or from the shape on screen, or from `from`: a small
  // form becoming a message).
  function morph(key, from) {
    const was = shape;
    shape = key;
    leftOrb = was === 'orb' || (leftOrb && Sf.state().out); // (a change of plan mid-way keeps the + where it was)
    let start = null;
    if (!Sf.state().out) {
      if (from) { start = ride(from, RADIUS.form); z = 8; }
      else { z = 11; start = elOf(was) ? ride(elOf(was), RADIUS[was]) : orbBox(); }
    }
    hideOrb();
    const el = elOf(key), target = el ? ride(el, RADIUS[key]) : Sf.orb();
    // Each content's "near" is measured along this journey: the new shape's from where the surface starts (or is),
    // the old shapes' from their own box to the new one, so the old is gone by half way and the new begins there.
    const at = start || Sf.state().cur || target;
    for (const [r, rd] of riders) rd.span = Math.max(40, r === el ? dist(at, target) : dist(rd.box, target));
    const face = key === 'orb';
    if (calm()) { if (start) Sf.glide(target, { owner: 'dock', from: start, z, face }); arrive(); return; }
    Sf.glide(target, { owner: 'dock', from: start || target, z, face, step: paintRiders, done: arrive });
    paintRiders();
  }
  function arrive() {
    const el = elOf(shape);
    leftOrb = false;
    document.getElementById('morphsurface')?.style.removeProperty('--plus');
    for (const r of [...riders.keys()]) unride(r, r === el);
    if (shape === 'orb') showOrb();
    Sf.rest();
  }

  // Go to a shape: 'orb', 'pill', 'pick', 'drag' (the boards pill), 'boards' (the open shelf), 'form' or 'away'. `instant`: no motion (the orb is becoming a screen).
  function to(key, { instant = false } = {}) {
    if (key === shape) return;
    if (key === 'away') {
      const moving = Sf.state().out || riders.size > 0;
      shape = 'away';
      if (moving) { Sf.rest(); for (const r of [...riders.keys()]) unride(r, false); hideOrb(); return; }
      if (pill) { pill.remove(); pill = null; }
      for (const k of ['pick', 'drag', 'boards', 'form']) { const e = elOf(k); if (e && !e.hidden) e.hidden = true; }
      const o = orb();
      if (o.hidden) return;
      if (instant || calm()) { hideOrb(); return; }
      o.inert = true;
      o.getAnimations().forEach((a) => a.cancel());
      orbAnim = o.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(30px) scale(.6)' }], { duration: 200, easing: ease, fill: 'forwards' });
      orbAnim.onfinish = () => { orbAnim = null; if (shape === 'away') hideOrb(); };
      return;
    }
    if (shape === 'away' && key === 'orb') {
      shape = 'orb';
      if (orbAnim) { orbAnim.cancel(); orbAnim = null; }
      showOrb();
      if (!instant && !calm()) orb().animate([{ opacity: 0, transform: 'translateY(30px) scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.34,1.3,.5,1)' }); // rises back, landing softly
      return;
    }
    morph(key, null);
  }
  // What the screen wants: a message stays until it folds into the orb, unless something else takes its place.
  const want = (key) => { if (key === 'orb' && shape === 'pill') return; to(key); };

  // A message as the orb itself: a pill as wide as its words, where the orb is. `from`: the open form that becomes the
  // message (deleting a board). Returns the pill, or null while the orb is away or is a form that stays open (the
  // caller shows a plain message above it instead).
  function say(html, { from = null } = {}) {
    if ((shape === 'away' || shape === 'form') && !from) return null;
    const box = $('#toastbox');
    const out = Sf.state().out;
    const old = shape === 'pill' && pill && !out ? Sf.box(pill.getBoundingClientRect(), RADIUS.pill, 0) : null;
    if (!pill) {
      box.innerHTML = '<div class="toast orbtoast" role="status" hidden><div class="words"></div></div>';
      pill = box.firstElementChild;
    }
    pill.querySelector('.words').innerHTML = html;
    if (shape !== 'pill') { morph('pill', from && !out ? from : null); return pill; }
    // already a message: it changes width from where it is, its new words showing all the way (within the surface)
    if (calm()) return pill;
    riders.delete(pill);
    const target = ride(pill, RADIUS.pill);
    riders.get(pill).keep = true;
    Sf.glide(target, { owner: 'dock', from: old || target, z, step: paintRiders, done: arrive });
    paintRiders();
    return pill;
  }
  const fold = () => { if (shape === 'pill') to('orb'); };
  // A message gone at once: the orb is simply back.
  function drop() {
    if (shape !== 'pill') return;
    Sf.rest();
    for (const r of [...riders.keys()]) unride(r, false);
    if (pill) { pill.remove(); pill = null; }
    shape = 'orb'; showOrb();
  }

  return { to, want, say, fold, drop, shape: () => shape, moving: () => Sf.state().out || riders.size > 0, pill: () => pill };
};
