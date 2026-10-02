// Surfaces that come out of the control that opened them (vendor/liquid.js holds the approved Liquid geometry).
//   drop:  a menu under its button (Sort). Liquid: the button's edge swells into a bead, a neck forms and snaps,
//          the bead springs open into the menu.
// It runs on one progress number p (0 shut, 1 open), so reversing mid-way carries on from where it is.
// (Panels that grow out of the orb ride its one surface: surface.js.)
window.NBFluid = (() => {
  const L = window.NBLiquid, NS = 'http://www.w3.org/2000/svg';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const closeCurve = L.cubicBezier(...L.FLUID_CLOSE_CURVE);

  // Runs el.__p towards `to`, painting every frame; finishes with done().
  function run(el, to, ms, curve, paint, done) {
    const s = el.__f || (el.__f = { p: 0, raf: 0 });
    cancelAnimationFrame(s.raf);
    const from = s.p, dur = ms * Math.min(1, Math.abs(to - from));
    if (reduced() || dur < 1) { s.p = to; paint(s.p); if (done) done(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.max(0, Math.min(1, (now - t0) / dur));
      s.p = t === 1 ? to : from + (to - from) * curve(t);
      paint(s.p);
      if (t < 1) s.raf = requestAnimationFrame(step);
      else if (done) done();
    };
    s.raf = requestAnimationFrame(step);
  }

  // ---- drop ----
  function drop(menu, trigger, open, done) {
    let s = menu.__drop;
    if (!s) {
      const m = menu.getBoundingClientRect(), r = trigger.getBoundingClientRect();
      const svg = document.createElementNS(NS, 'svg'), id = 'j' + Math.random().toString(36).slice(2, 7);
      svg.setAttribute('class', 'joinsvg'); svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = `<defs><clipPath id="${id}"><rect/></clipPath></defs><g clip-path="url(#${id})"><path/></g>`;
      menu.parentNode.appendChild(svg);
      s = menu.__drop = {
        svg, path: svg.querySelector('path'), rect: svg.querySelector('rect'), m, trigger,
        local: { x: r.left - m.left, y: r.top - m.top, width: r.width, height: r.height },
        tr: Math.min(r.width, r.height) / 2, ink: menu.firstElementChild ? [...menu.children] : []
      };
    }
    const paint = (p) => {
      const { m, local, tr } = s;
      menu.style.visibility = p <= 0 ? 'hidden' : 'visible';
      const shape = L.dropShape(local, tr, m.width, m.height, p, 16), motion = L.fluidMotion(p);
      menu.style.clipPath = `path('${shape.draw()}')`;
      s.path.setAttribute('d', shape.draw(m.left, m.top));
      const j = shape.join;
      if (j) { s.rect.setAttribute('x', m.left + j.x); s.rect.setAttribute('y', m.top + j.y); s.rect.setAttribute('width', j.width); s.rect.setAttribute('height', j.height); }
      s.svg.style.visibility = j && p > 0 ? 'visible' : 'hidden';
      for (const el of s.ink) { el.style.opacity = motion.opacity; el.style.transform = `translateY(${motion.rise}px)`; }
      s.trigger.classList.toggle('joining', p > 0 && p < .44);
    };
    const timing = L.FLUID_TIMING.menu.full;
    run(menu, open ? 1 : 0, open ? timing.openMs : timing.closeMs, open ? L.fluidOpen : closeCurve, paint, () => {
      if (!open) { s.svg.remove(); s.trigger.classList.remove('joining'); menu.__drop = null; menu.__f = null; }
      if (done) done();
    });
  }

  return { drop };
})();
