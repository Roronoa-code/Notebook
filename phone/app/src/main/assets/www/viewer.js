// The open photo or video: one picture you handle directly, in one place. Which gestures work depends
// on the state, so they never fight:
//   viewing      sideways: the previous / next picture of the grid it came from · down: back into its
//                card · up: Details & boards · pinch or double-tap: zoom (photos)
//   zoomed       one finger pans, two pinch, double-tap or Back zooms back out; the sheet steps aside
//   details open the picture sits small above the sheet; drag down, tap it or Done to close the sheet
// Android Back: zoomed → zoom out, details open → close them, otherwise back to the grid.
// Everything settles with the same spring, and a new touch catches it wherever it is.
window.NBViewer = (() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SLOP = 8, GAP = 18;
  let active = null; // the wired screen's controls: { back() }

  // A spring on a few numbers at once (px, or the zoom factor). `state` is changed in place, so a new
  // gesture can stop it and carry on from exactly where it is.
  function spring(state, target, vel, paint, done, { k = 340, d = 34 } = {}) {
    if (reduced()) { Object.assign(state, target); paint(); if (done) done(); return () => {}; }
    const v = {};
    for (const key in target) v[key] = (vel && vel[key]) || 0;
    let last = performance.now(), frame = 0;
    const step = (now) => {
      const dt = Math.min(32, now - last) / 1000; last = now;
      let rest = true;
      for (const key in target) {
        v[key] += (-k * (state[key] - target[key]) - d * v[key]) * dt;
        state[key] += v[key] * dt;
        const eps = key === 's' ? 0.0008 : 0.35;
        if (Math.abs(state[key] - target[key]) > eps || Math.abs(v[key]) > eps * 30) rest = false;
      }
      if (rest) { Object.assign(state, target); frame = 0; paint(); if (done) done(); return; }
      paint();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); frame = 0; };
  }

  // opt: { id, list: ids to swipe through (in grid order), peek(id) → html of that picture at rest,
  //        go(id, carry) → shows that item in place (carry: where its picture is mid-slide, and how fast),
  //        close() → back to the grid, under() → the screen beneath, carry }
  function wire(root, opt) {
    const stage = root.querySelector('.media-screen .stage');
    if (!stage) { active = null; return; }
    const media = stage.querySelector('.vbox') || stage.querySelector('img');
    const scrim = root.querySelector('.scrim'), sheet = root.querySelector('.sheet'), back = root.querySelector('.lbback');
    const head = sheet.querySelector('.dhead'), body = sheet.querySelector('.media-body');
    const zoomable = media.tagName === 'IMG';
    const at = opt.list.indexOf(opt.id);
    const near = { '-1': at > 0 ? opt.list[at - 1] : null, 1: at >= 0 && at < opt.list.length - 1 ? opt.list[at + 1] : null };

    const z = { s: 1, x: 0, y: 0 };        // zoom
    const m = { w: 0, dx: 0, dy: 0 };      // sideways swipe; drag to dismiss
    const h = { v: 0 };                    // sheet height while it moves
    let open = false, stop = () => {}, stopSheet = () => {}, peeks = null, base = null, leaving = false;

    const paint = () => {
      const k = Math.max(0, m.dy), shrink = Math.max(0.6, 1 - k / 1200);
      media.style.transform = z.s === 1 && !m.w && !m.dx && !m.dy && !z.x && !z.y ? '' : `translate3d(${(z.x + m.w + m.dx).toFixed(1)}px,${(z.y + m.dy).toFixed(1)}px,0) scale(${(z.s * shrink).toFixed(4)})`;
      if (peeks) for (const [dir, el] of peeks) el.style.transform = `translate3d(${(+dir * (innerWidth + GAP) + m.w).toFixed(1)}px,0,0)`;
      scrim.style.opacity = k ? Math.max(0, 1 - k / 320).toFixed(3) : '';
      const chrome = k ? Math.max(0, 1 - k / 50).toFixed(3) : '';
      sheet.style.opacity = chrome; back.style.opacity = chrome;
      // Keep Back available while zoomed so getting out never depends on discovering a gesture.
      const zoomed = z.s > 1.01;
      if (zoomed !== root.classList.contains('zoomed')) {
        root.classList.toggle('zoomed', zoomed);
        for (const el of [sheet]) {
          el.getAnimations().forEach((a) => a.cancel());
          if (!reduced()) el.animate([{ opacity: zoomed ? 1 : 0 }, { opacity: zoomed ? 0 : 1 }], { duration: 180, easing: 'ease-out', fill: zoomed ? 'forwards' : 'none' });
          else el.style.visibility = zoomed ? 'hidden' : '';
        }
      }
    };
    const paintSheet = () => { sheet.style.height = h.v.toFixed(1) + 'px'; };

    // Where the picture sits untransformed, for zoom limits.
    const measure = () => { const was = media.style.transform; media.style.transform = 'none'; const r = media.getBoundingClientRect(); media.style.transform = was; return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height }; };
    // The zoom's resting place: never smaller than the screen allows, never showing past the picture's edges.
    function limits(s, x, y) {
      const b = base || (base = measure()), W = innerWidth, H = innerHeight;
      const lim = (off, size, c, span) => { if (size * s <= span) return (span / 2 - c) * (s > 1 ? 1 : 0); return Math.min(size * s / 2 - c, Math.max(span - (c + size * s / 2), off)); };
      return { s, x: lim(x, b.w, b.cx, W), y: lim(y, b.h, b.cy, H) };
    }
    const zoomTo = (s, px, py, vel) => {
      const b = base || (base = measure());
      const cx = px - b.cx, cy = py - b.cy, r = s / z.s;
      const t = s <= 1 ? { s: 1, x: 0, y: 0 } : limits(s, cx - (cx - z.x) * r, cy - (cy - z.y) * r);
      stop(); stop = spring(z, t, vel, paint);
    };

    // The sheet: closed (just its title bar) or open (note, boards and actions, as tall as they need).
    const sheetHeights = () => {
      const was = sheet.style.height, wasOpen = sheet.classList.contains('open'), wasMoving = sheet.classList.contains('moving');
      const bodyH = body.style.height;
      sheet.style.height = ''; body.style.height = ''; sheet.classList.remove('open', 'moving');
      const closed = sheet.getBoundingClientRect().height;
      sheet.classList.add('open');
      const full = sheet.getBoundingClientRect().height;
      sheet.classList.toggle('open', wasOpen); sheet.classList.toggle('moving', wasMoving); sheet.style.height = was; body.style.height = bodyH;
      return { closed, full };
    };
    // While it moves, its contents keep their open layout and the sheet uncovers them from the top
    // (the actions come into view last, never squeezed in under the title).
    const moving = (closed, full) => { sheet.classList.add('moving'); body.style.height = Math.max(0, full - closed).toFixed(1) + 'px'; };
    function setOpen(next, vel = 0) {
      const { closed, full } = sheetHeights();
      if (!sheet.style.height) h.v = open ? full : closed;
      open = next;
      head.setAttribute('aria-expanded', String(next));
      body.inert = !next;
      moving(closed, full);
      stopSheet();
      stopSheet = spring(h, { v: next ? full : closed }, { v: vel }, paintSheet, () => {
        sheet.style.height = ''; body.style.height = ''; sheet.classList.remove('moving'); sheet.classList.toggle('open', next);
        if (!next && sheet.contains(document.activeElement)) document.activeElement.blur();
      }, { k: 420, d: 42 });
    }
    let headDragged = 0; // when a drag on the title bar ended: the tap the browser may add straight after isn't a toggle
    head.addEventListener('click', () => { if (performance.now() - headDragged < 350) return; setOpen(!open); });
    sheet.querySelector('[data-close-details]').addEventListener('click', () => setOpen(false));
    body.inert = true;
    // Drag the sheet by its title bar.
    let sheetDrag = null;
    head.addEventListener('pointerdown', (e) => { const { closed, full } = sheetHeights(); stopSheet(); sheetDrag = { y: e.clientY, h: sheet.getBoundingClientRect().height, closed, full, moved: false, samples: [[e.clientY, e.timeStamp]] }; head.setPointerCapture(e.pointerId); });
    head.addEventListener('pointermove', (e) => {
      if (!sheetDrag) return;
      const dy = e.clientY - sheetDrag.y;
      if (!sheetDrag.moved && Math.abs(dy) < SLOP) return;
      sheetDrag.moved = true;
      sheetDrag.samples.push([e.clientY, e.timeStamp]); if (sheetDrag.samples.length > 5) sheetDrag.samples.shift();
      moving(sheetDrag.closed, sheetDrag.full);
      h.v = rubber(sheetDrag.h - dy, sheetDrag.closed, sheetDrag.full); paintSheet();
    });
    const sheetEnd = (e) => {
      if (!sheetDrag) return;
      const d = sheetDrag; sheetDrag = null;
      if (!d.moved) return; // a tap: the click toggles it
      headDragged = performance.now();
      const v = velocity(d.samples);
      setOpen(e.type === 'pointerup' && (Math.abs(v) > 500 ? v < 0 : h.v > (d.closed + d.full) / 2), -v);
    };
    head.addEventListener('pointerup', sheetEnd);
    head.addEventListener('pointercancel', sheetEnd);

    const rubber = (v, lo, hi) => (v < lo ? lo - (lo - v) * 0.3 : v > hi ? hi + (v - hi) * 0.3 : v);
    const velocity = (samples) => { const a = samples[0], b = samples[samples.length - 1]; return b && a && b[1] > a[1] ? ((b[0] - a[0]) / (b[1] - a[1])) * 1000 : 0; }; // px per second

    // Neighbours shown beside the picture while swiping.
    function showPeeks() {
      if (peeks) return;
      peeks = new Map();
      for (const dir of ['-1', '1']) {
        if (!near[dir]) continue;
        const wrap = document.createElement('div');
        wrap.innerHTML = opt.peek(near[dir]);
        const el = wrap.firstElementChild;
        stage.append(el);
        peeks.set(dir, el);
      }
      paint();
    }
    const dropPeeks = () => { if (peeks) for (const el of peeks.values()) el.remove(); peeks = null; };

    // ---------- touches on the picture ----------
    const pts = new Map();
    let g = null, lastTap = { t: 0, x: 0, y: 0 }, draggedAt = 0;
    const mid = () => { const [a, b = a] = [...pts.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
    function begin() {
      const c = mid();
      g = { mode: pts.size > 1 && zoomable && !open ? 'pinch' : z.s > 1.01 ? 'pan' : Math.abs(m.w) > 0.5 ? 'swipe' : 'pending', x: c.x, y: c.y, d: c.d, z: { ...z }, m: { ...m }, h: sheet.getBoundingClientRect().height, samples: [[c.x, c.y, performance.now()]], moved: false };
    }
    stage.addEventListener('pointerdown', (e) => {
      if (leaving || e.target.closest('.vbar, .vsound') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stop(); // caught mid-settle: carry on from here
      [media, scrim, sheet, back].forEach((x) => x.getAnimations().forEach((a) => a.finish())); // or mid-opening
      if (pts.size === 1) base = measure();
      begin();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = mid(), dx = c.x - g.x, dy = c.y - g.y;
      g.samples.push([c.x, c.y, performance.now()]); if (g.samples.length > 5) g.samples.shift();
      if (!g.moved && Math.hypot(dx, dy) < SLOP && Math.abs(c.d - g.d) < SLOP) return;
      g.moved = true;
      if (g.mode === 'pending') {
        if (open) g.mode = dy > 0 && Math.abs(dy) > Math.abs(dx) ? 'sheet' : 'none';
        else if (Math.abs(dx) > Math.abs(dy)) { g.mode = 'swipe'; showPeeks(); }
        else if (dy > 0) { g.mode = 'dismiss'; const u = opt.under(); if (u) u.style.visibility = ''; }
        else g.mode = 'sheet';
        g.x = c.x; g.y = c.y; // the move starts from here, so nothing jumps by the slop
        return;
      }
      if (g.mode === 'pinch') {
        const b = base, s = Math.max(0.8, Math.min(5, g.z.s * c.d / Math.max(1, g.d)));
        const gx = g.x - b.cx, gy = g.y - b.cy, r = s / g.z.s;
        z.s = s; z.x = (c.x - b.cx) - (gx - g.z.x) * r; z.y = (c.y - b.cy) - (gy - g.z.y) * r;
      } else if (g.mode === 'pan') {
        const t = limits(z.s, g.z.x + dx, g.z.y + dy);
        z.x = t.x + (g.z.x + dx - t.x) * 0.3; z.y = t.y + (g.z.y + dy - t.y) * 0.3; // a little give past the edges
      } else if (g.mode === 'swipe') {
        m.w = g.m.w + (near[-Math.sign(dx) || 1] ? dx : dx * 0.3);
      } else if (g.mode === 'dismiss') {
        m.dx = dx * 0.8; m.dy = Math.max(-20, dy);
      } else if (g.mode === 'sheet') {
        const { closed, full } = g.sheetH || (g.sheetH = sheetHeights());
        stopSheet(); moving(closed, full);
        h.v = rubber(g.h - dy, closed, full); paintSheet();
        return;
      } else return;
      paint();
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!g) return;
      const cancelled = e.type === 'pointercancel';
      const gone = g; const [a, b] = [gone.samples[0], gone.samples[gone.samples.length - 1]];
      const dt = b[2] - a[2], vx = dt > 0 ? (b[0] - a[0]) / dt * 1000 : 0, vy = dt > 0 ? (b[1] - a[1]) / dt * 1000 : 0;
      if (pts.size) { begin(); return; } // one finger lifted from a pinch: carry on with the other
      g = null;
      if (gone.moved) draggedAt = performance.now();
      if (!gone.moved) { tap(e); return; }
      if (gone.mode === 'pinch' || gone.mode === 'pan') {
        const t = z.s < 1.02 ? { s: 1, x: 0, y: 0 } : limits(Math.min(4, z.s), z.x, z.y);
        stop(); stop = spring(z, t, gone.mode === 'pan' ? { x: vx * 0.5, y: vy * 0.5 } : null, paint);
      } else if (gone.mode === 'swipe') {
        const dir = m.w < 0 ? 1 : -1, id = near[dir];
        const go = !cancelled && id && (Math.abs(m.w) > innerWidth * 0.22 || Math.abs(vx) > 600) && Math.sign(vx || -dir) !== dir;
        stop();
        // The next picture takes over at once, from exactly where it is on screen, and settles in; a new
        // flick can catch it on the way.
        if (go) opt.go(id, { w: m.w + dir * (innerWidth + GAP), v: vx });
        else stop = spring(m, { w: 0 }, { w: vx }, paint, dropPeeks);
      } else if (gone.mode === 'dismiss') {
        if (!cancelled && (m.dy > 110 || vy > 500)) { leaving = true; paint(); opt.close(); return; }
        stop(); stop = spring(m, { dx: 0, dy: 0 }, { dx: vx, dy: vy }, paint, () => { const u = opt.under(); if (u && !leaving) u.style.visibility = 'hidden'; });
      } else if (gone.mode === 'sheet') {
        const { closed, full } = gone.sheetH || sheetHeights();
        setOpen(!cancelled && (Math.abs(vy) > 500 ? vy < 0 : h.v > (closed + full) / 2), -vy);
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    // After a drag, the tap the browser may add at the end is not a tap (a video would pause).
    stage.addEventListener('click', (e) => { if (performance.now() - draggedAt < 350) { e.stopPropagation(); e.preventDefault(); } }, true);

    function tap(e) {
      const now = performance.now();
      if (open) { setOpen(false); return; }
      if (!zoomable) return;
      if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap.t = 0;
        zoomTo(z.s > 1.01 ? 1 : 2.5, e.clientX, e.clientY);
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }

    // Arrived by a swipe: carry on the slide from where the picture was.
    if (opt.carry) { m.w = opt.carry.w; showPeeks(); stop = spring(m, { w: 0 }, { w: opt.carry.v }, paint, dropPeeks, { k: 420, d: 42 }); }

    active = {
      root,
      // Android Back, in order: zoom out, close the details, then (false) leave.
      back() {
        if (z.s > 1.01) { zoomTo(1, 0, 0); return true; }
        if (open) { setOpen(false); return true; }
        leaving = true;
        return false;
      }
    };
  }

  const back = () => !!(active && active.root.isConnected && active.back());
  return { wire, back, spring };
})();
