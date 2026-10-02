// One purple orb replaces the bottom bar. Tap it and it becomes a new note. Hold it and the actions fan out along
// the arc your thumb sweeps: slide onto one and let go (one continuous gesture), or let go where you are and tap one.
// The name of the one you're on shows in a single label above the arc, clear of every button and of your thumb's path.
window.NBFan = (ctx) => {
  const { app, hap } = ctx;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = 'cubic-bezier(.22,1,.36,1)';
  const orb = () => app.querySelector('#orb');
  let items = [], scrim = null, label = null, open = false, dragging = false, hot = -1, timer = 0, down = null, centres = [], openedAt = 0;

  // Buttons sit on an arc close to the orb, spaced so they never touch (48px buttons, at least 55px apart).
  function place(list) {
    const n = list.length, span = 92, step = n === 1 ? 0 : span / (n - 1);
    const R = n === 1 ? 110 : Math.max(112, 56 / (2 * Math.sin((step * Math.PI) / 360)));
    return list.map((it, i) => { const a = (92 + i * step) * Math.PI / 180; return { x: Math.round(R * Math.cos(a)), y: -Math.round(R * Math.sin(a)) }; });
  }
  // Liquid (libraries.dev Gooey, Morph, ported without React; approved): the actions pour out of the orb as one
  // liquid and bead off; closing, they run back in. The surfaces are blobs in one goo-filtered layer under the
  // orb; the buttons above them only carry the crisp icons and take the taps.
  const OPEN = { duration: 620, step: 45, easing: 'cubic-bezier(.34,1.3,.5,1)' }, CLOSE = { duration: 420, step: 45, easing: 'cubic-bezier(.5,0,.3,1)' };
  let goo = null, blobs = [];
  const moveTo = (els, from, to, i, n, t, opening) => els.forEach((el) => {
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = to;
    if (reduced()) return;
    el.animate([{ transform: from }, { transform: to }], { duration: t.duration, delay: (opening ? i : n - 1 - i) * t.step, easing: t.easing, fill: 'backwards' });
  });
  function openFan() {
    if (open) return;
    open = true; hot = -1; openedAt = performance.now();
    const list = ctx.items(), pos = place(list);
    scrim = document.createElement('div'); scrim.className = 'fanscrim'; scrim.dataset.a = 'closeFan';
    app.insertBefore(scrim, orb());
    goo = document.createElement('div'); goo.className = 'fangoo'; goo.setAttribute('aria-hidden', 'true');
    goo.innerHTML = '<i class="gorb"></i>' + list.map(() => '<i class="gdrop"></i>').join('');
    app.insertBefore(goo, orb());
    blobs = [...goo.querySelectorAll('.gdrop')];
    items = list.map((it, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fan-item'; b.dataset.id = it.id; b.setAttribute('aria-label', it.label);
      b.innerHTML = it.icon;
      app.appendChild(b);
      const to = `translate(${pos[i].x}px,${pos[i].y}px)`;
      moveTo([b, blobs[i]], 'translate(0px,0px)', to, i, list.length, OPEN, true);
      // the icon shows once its drop has left the orb
      if (!reduced()) b.querySelector('svg').animate([{ opacity: 0 }, { opacity: 0, offset: .3 }, { opacity: 1 }], { duration: OPEN.duration, delay: i * OPEN.step, fill: 'backwards' });
      return b;
    });
    label = document.createElement('div'); label.className = 'fanlabel'; label.setAttribute('aria-hidden', 'true');
    // above the highest button: the orb's centre (18 + 30 from the bottom), the arc, half a button and a gap
    label.style.bottom = `calc(var(--sb) + ${48 + Math.max(...pos.map((p) => -p.y)) + 26 + 14}px)`;
    app.appendChild(label);
    if (!reduced()) scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: ease });
    const or = orb().getBoundingClientRect(), oc = { x: or.left + or.width / 2, y: or.top + or.height / 2 };
    centres = pos.map((p) => ({ x: oc.x + p.x, y: oc.y + p.y })); // where they will rest, not where they are mid-flight
    orb().classList.add('open'); orb().setAttribute('aria-expanded', 'true');
    hap('soft');
  }
  // `now`: the chosen action becomes a screen of its own (a new note), so the arc goes at once instead of running
  // back into the orb over it.
  function closeFan(chosen, now) {
    if (!open) return;
    open = false; dragging = false; hot = -1;
    const gone = items, s = scrim; items = []; scrim = null;
    if (label) { const l = label; label = null; if (reduced() || now) l.remove(); else l.animate([{ opacity: getComputedStyle(l).opacity }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).onfinish = () => l.remove(); }
    orb().classList.remove('open'); orb().setAttribute('aria-expanded', 'false');
    const g = goo, drops = blobs; goo = null; blobs = [];
    if (now) { gone.forEach((b) => b.remove()); if (g) g.remove(); if (s) s.remove(); return; }
    drops.forEach((d) => d.classList.remove('hot'));
    gone.forEach((b, i) => {
      b.inert = true; b.classList.remove('hot');
      if (reduced()) { b.remove(); return; }
      // everything runs back into the orb from wherever it is now (a quick close mid-opening turns round)
      const fromB = getComputedStyle(b).transform, fromD = getComputedStyle(drops[i]).transform;
      moveTo([b], fromB === 'none' ? 'translate(0px,0px)' : fromB, 'translate(0px,0px)', i, gone.length, CLOSE, false);
      moveTo([drops[i]], fromD === 'none' ? 'translate(0px,0px)' : fromD, 'translate(0px,0px)', i, gone.length, CLOSE, false);
      b.querySelector('svg').animate([{ opacity: +getComputedStyle(b.querySelector('svg')).opacity }, { opacity: 0, offset: .45 }, { opacity: 0 }], { duration: CLOSE.duration, delay: (gone.length - 1 - i) * CLOSE.step, fill: 'forwards' });
    });
    const last = CLOSE.duration + (gone.length - 1) * CLOSE.step + 30;
    setTimeout(() => { gone.forEach((b) => b.remove()); if (g) g.remove(); }, reduced() ? 0 : last);
    if (s) { if (reduced()) s.remove(); else s.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: ease, fill: 'forwards' }).onfinish = () => s.remove(); }
  }
  // The nearest button within reach of the finger; back over the orb itself means none.
  function nearest(x, y) {
    let best = -1, d = 62;
    centres.forEach((c, i) => { const k = Math.hypot(c.x - x, c.y - y); if (k < d) { d = k; best = i; } });
    return best;
  }
  function setHot(i) {
    if (i === hot) return;
    hot = i;
    items.forEach((b, k) => b.classList.toggle('hot', k === i));
    blobs.forEach((d, k) => d.classList.toggle('hot', k === i));
    if (label) { label.textContent = i >= 0 ? items[i].getAttribute('aria-label') : ''; label.classList.toggle('on', i >= 0); }
    if (i >= 0) hap('soft');
  }
  const commit = (b) => { const id = b.dataset.id; b.__rect = b.getBoundingClientRect(); window.nbFanOrigin = b; closeFan(b, id === 'addNote'); ctx.run(id); };

  function wire() {
    const o = orb();
    o.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button > 0) return;
      o.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, wasOpen: open, far: false };
      clearTimeout(timer);
      if (!open) timer = setTimeout(() => { openFan(); dragging = true; }, 200);
    });
    o.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 14) down.far = true;
      if (!dragging && down.far) { clearTimeout(timer); if (!open) openFan(); dragging = true; }
      if (dragging) setHot(nearest(e.clientX, e.clientY));
    });
    const up = (e) => {
      if (!down) return;
      clearTimeout(timer);
      const d = down; down = null;
      if (dragging) {
        dragging = false;
        const b = items[hot];
        if (b && e.type === 'pointerup') commit(b);
        else if (d.far || e.type !== 'pointerup') closeFan(); // slid off every action: nothing chosen
        return; // held and let go in place: the actions stay out to be tapped
      }
      if (e.type !== 'pointerup') return;
      if (d.wasOpen) closeFan();
      else { o.__rect = o.getBoundingClientRect(); window.nbFanOrigin = o; ctx.tap(); } // a tap: the orb becomes a new note
    };
    // The orb acts on the lift (pointerup); the browser's own tap that follows would land on whatever the orb just
    // made under the finger (the new note's text, bringing up the keyboard): it is not wanted.
    o.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    o.addEventListener('pointerup', up);
    o.addEventListener('pointercancel', up);
    o.addEventListener('click', (e) => { if (e.detail === 0 && !open) { window.nbFanOrigin = o; ctx.tap(); } }); // keyboard: a tap
    // The actions pour out from under the finger that opened them: the lift of that same press must not choose one
    // (it landed on Camera, which opened the camera on every tap).
    app.addEventListener('click', (e) => { const b = e.target.closest('.fan-item'); if (b && open && performance.now() - openedAt > 350) commit(b); });
  }
  return { wire, open: openFan, close: () => closeFan(), isOpen: () => open };
};
