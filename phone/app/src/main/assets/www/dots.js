// Press and hold the name at the top: its dots shiver, then scatter and pull themselves together into the
// Header picture panel. Close it and the dots fly back and spell the picture again; choose a new picture and
// they settle straight into the new one, so the header is never left blank. Every dot is a particle on a
// spring (a canvas, one per open).
// A dotted photo is drawn from the very same dots at rest, so resting, pressed and released always show the
// same subject: the dots are the parts of the photo that stand out from its background, placed exactly
// where the photo shows them (cropped to fill its box, like the plain photo).
window.NBDots = (ctx) => {
  const { S, hap } = ctx;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const home = () => ctx.home();
  let P = null, canvas = null, g = null, raf = 0, state = 'idle', t0 = 0, press = { x: 0, y: 0 }, dpr = 1, W = 0, H = 0;
  const cache = new Map(); // picture → its dots, 0..1 within the picture's own box

  const rand = (() => { let a = 1234567; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const maniEl = () => home().querySelector('#mani');
  const coverEl = () => maniEl().querySelector('.cover');
  // The box a cover photo fills (the name's box, less its side margins).
  const coverBox = () => { const r = maniEl().getBoundingClientRect(); return { w: Math.max(1, r.width - 24), h: Math.max(1, r.height) }; };

  function maniDots() {
    const m = window.NB_MANI_DOTS, pts = [];
    for (let i = 0; i < m.p.length; i += 2) pts.push([m.p[i] / m.w, m.p[i + 1] / m.h, 1]);
    return { key: 'mani', pts, w: m.w, h: m.h, cover: false };
  }
  // A photo's dots for a box of w × h: the photo is cropped to fill the box (object-fit: cover, after any
  // crop set on the PC), sampled every 4px, and a dot kept wherever it differs clearly from the photo's
  // background (estimated from its edges). Dark subjects on light grounds and light on dark both survive.
  function photoDots(src, crop, w, h) {
    const key = `${src}|${crop}|${Math.round(w)}x${Math.round(h)}`;
    if (cache.has(key)) return cache.get(key);
    const job = new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        try {
          const [cx, cy, cw, ch] = crop ? crop.split(',').map(Number) : [0, 0, 1, 1];
          const iw = im.naturalWidth * cw, ih = im.naturalHeight * ch, k = Math.max(w / iw, h / ih);
          const sw = w / k, sh = h / k, sx = im.naturalWidth * cx + (iw - sw) / 2, sy = im.naturalHeight * cy + (ih - sh) / 2;
          const pitch = 4, cols = Math.max(1, Math.floor(w / pitch)), rows = Math.max(1, Math.floor(h / pitch));
          const c = document.createElement('canvas'); c.width = cols; c.height = rows;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(im, sx, sy, sw, sh, 0, 0, cols, rows);
          const d = x.getImageData(0, 0, cols, rows).data, lum = new Float32Array(cols * rows);
          for (let i = 0; i < lum.length; i++) lum[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
          let bg = 0, nb = 0;
          for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) if (yy < 2 || xx < 2 || yy >= rows - 2 || xx >= cols - 2) { bg += lum[yy * cols + xx]; nb++; }
          bg /= nb || 1;
          const diff = Array.from(lum, (v) => Math.abs(v - bg)), sorted = diff.slice().sort((a, b) => a - b);
          const cut = Math.max(0.07, sorted[Math.floor(sorted.length * 0.5)]), strong = Math.max(cut * 1.8, sorted[Math.floor(sorted.length * 0.8)]);
          const pts = [];
          for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) {
            const v = diff[yy * cols + xx];
            if (v > cut) pts.push([(xx + 0.5) / cols, (yy + 0.5) / rows, v > strong ? 1 : 0.55]);
          }
          resolve({ key, pts, w, h, cover: true });
        } catch (e) { resolve(maniDots()); } // pixels not readable: use the name's dots
      };
      im.onerror = () => resolve(maniDots());
      im.src = src;
    });
    cache.set(key, job);
    return job;
  }
  // The dots of the picture showing now.
  function sample() {
    const cov = coverEl();
    if (!cov) return Promise.resolve(maniDots());
    const b = coverBox();
    return photoDots(cov.dataset.src || cov.src, cov.dataset.crop || '', b.w, b.h);
  }

  // A dotted cover at rest: the photo's dots, drawn once (and again if the box changes size).
  const INK = '#F3F0E8', PURPLE = '#9D6BFF', DOT = 1.55;
  function paintCover() {
    const cov = coverEl();
    if (!cov || cov.tagName !== 'CANVAS') return;
    const b = coverBox(), r = Math.min(2, devicePixelRatio || 1);
    sample().then((s) => {
      if (!cov.isConnected) return;
      cov.width = Math.round(b.w * r); cov.height = Math.round(b.h * r);
      const x = cov.getContext('2d');
      x.setTransform(r, 0, 0, r, 0, 0);
      // The same placement the moving dots use (a photo fills its box; the name's dots keep their proportions).
      const k = s.cover ? 0 : Math.min(b.w / s.w, b.h / s.h), bw = s.cover ? b.w : s.w * k, bh = s.cover ? b.h : s.h * k, ox = (b.w - bw) / 2, oy = (b.h - bh) / 2;
      for (const lvl of [1, 0.55]) {
        x.globalAlpha = lvl; x.fillStyle = INK; x.beginPath();
        for (const p of s.pts) if (p[2] === lvl) x.rect(ox + p[0] * bw, oy + p[1] * bh, DOT, DOT);
        x.fill();
      }
    });
  }

  // The picture's box on the page (relative to the panel), as the eye sees it.
  function pictureRect(s, panel) {
    const r = maniEl().getBoundingClientRect(), p = panel.getBoundingClientRect();
    if (s.cover) return { x: r.left - p.left + 12, y: r.top - p.top, w: r.width - 24, h: r.height };
    const k = Math.min(r.width / s.w, r.height / s.h), w = s.w * k, h = s.h * k;
    return { x: r.left - p.left + (r.width - w) / 2, y: r.top - p.top + (r.height - h) / 2, w, h };
  }

  // A point `t` (0..1) round a rounded rectangle, pushed `inset` in.
  function around(t, w, h, rad, inset) {
    const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset, r = Math.max(2, rad - inset);
    const seg = [x1 - x0 - 2 * r, (Math.PI * r) / 2, y1 - y0 - 2 * r, (Math.PI * r) / 2, x1 - x0 - 2 * r, (Math.PI * r) / 2, y1 - y0 - 2 * r, (Math.PI * r) / 2];
    const total = seg.reduce((a, b) => a + b, 0);
    let d = (t % 1) * total, i = 0;
    while (d > seg[i]) { d -= seg[i]; i++; }
    const f = d / seg[i];
    switch (i) {
      case 0: return [x0 + r + f * seg[0], y0];
      case 1: { const a = -Math.PI / 2 + f * Math.PI / 2; return [x1 - r + r * Math.cos(a), y0 + r + r * Math.sin(a)]; }
      case 2: return [x1, y0 + r + f * seg[2]];
      case 3: { const a = f * Math.PI / 2; return [x1 - r + r * Math.cos(a), y1 - r + r * Math.sin(a)]; }
      case 4: return [x1 - r - f * seg[4], y1];
      case 5: { const a = Math.PI / 2 + f * Math.PI / 2; return [x0 + r + r * Math.cos(a), y1 - r + r * Math.sin(a)]; }
      case 6: return [x0, y1 - r - f * seg[6]];
      default: { const a = Math.PI + f * Math.PI / 2; return [x0 + r + r * Math.cos(a), y0 + r + r * Math.sin(a)]; }
    }
  }

  // kind: 0 frame dot, 1 lattice dot, 2 spare (fades on arrival), 3 not needed by the new picture (fades on return)
  function build(s, panel) {
    const rect = pictureRect(s, panel), n = s.pts.length, pr = panel.getBoundingClientRect();
    W = pr.width; H = pr.height;
    const o = { x: new Float32Array(n), y: new Float32Array(n), ox: new Float32Array(n), oy: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), tx: new Float32Array(n), ty: new Float32Array(n), kind: new Uint8Array(n), delay: new Float32Array(n), a: new Float32Array(n), a0: new Float32Array(n) };
    for (let i = 0; i < n; i++) { o.ox[i] = o.x[i] = rect.x + s.pts[i][0] * rect.w; o.oy[i] = o.y[i] = rect.y + s.pts[i][1] * rect.h; o.a[i] = o.a0[i] = s.pts[i][2] ?? 1; }
    // Targets: a dotted frame (3 rows), then a faint lattice inside; whatever is left over fades out on arrival.
    const rad = 28, pitch = 3.2, rows = 3, frame = Math.floor((2 * (W + H) / pitch) * rows * 0.75);
    const lattice = [];
    for (let yy = 22; yy < H - 20; yy += 8) for (let xx = 22; xx < W - 20; xx += 8) lattice.push([xx + ((yy / 8) % 2) * 4, yy]);
    const targets = [];
    const perRow = Math.floor(frame / rows);
    for (let i = 0; i < perRow * rows; i++) { const row = Math.floor(i / perRow), [x, y] = around((i % perRow) / perRow, W, H, rad, 6 + row * 3.4); targets.push([x, y, 0]); }
    for (const l of lattice) targets.push([l[0], l[1], 1]);
    // Pair dots with targets by position so they flow as one sheet rather than crossing each other.
    const order = [...Array(n).keys()].sort((a, b) => (o.oy[a] * 0.7 + o.ox[a]) - (o.oy[b] * 0.7 + o.ox[b]));
    targets.sort((a, b) => (a[1] * 0.7 + a[0]) - (b[1] * 0.7 + b[0]));
    order.forEach((idx, k) => {
      const t = targets[Math.min(k, targets.length - 1)];
      if (k < targets.length) { o.tx[idx] = t[0]; o.ty[idx] = t[1]; o.kind[idx] = t[2]; }
      else { o.tx[idx] = rand() * W; o.ty[idx] = rand() * H; o.kind[idx] = 2; }
      o.delay[idx] = rand() * 130;
    });
    P = o; P.n = n;
  }
  // Chose another picture: the dots' way home now leads to the new picture's dots.
  function retarget(s, panel) {
    const rect = pictureRect(s, panel), m = s.pts.length;
    if (!P || !m) return;
    const order = [...Array(P.n).keys()].sort((a, b) => (P.oy[a] * 0.7 + P.ox[a]) - (P.oy[b] * 0.7 + P.ox[b]));
    const pts = s.pts.slice().sort((a, b) => (a[1] * rect.h * 0.7 + a[0] * rect.w) - (b[1] * rect.h * 0.7 + b[0] * rect.w));
    order.forEach((idx, k) => {
      const p = pts[Math.floor((k * m) / P.n)];
      P.ox[idx] = rect.x + p[0] * rect.w; P.oy[idx] = rect.y + p[1] * rect.h; P.a0[idx] = p[2] ?? 1;
      if (P.kind[idx] === 2 || (P.n > m && k % Math.ceil(P.n / m) !== 0)) P.kind[idx] = 3;
    });
  }

  function mountCanvas(panel) {
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas = document.createElement('canvas');
    canvas.className = 'dotcanvas';
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    panel.appendChild(canvas);
    g = canvas.getContext('2d');
  }

  // ---- drawing ----
  function drawBatches(colour, hot) {
    for (const [lo, hi] of [[0.9, 1.01], [0.45, 0.9], [0.02, 0.45]]) {
      g.fillStyle = hot && lo > 0.9 ? PURPLE : colour;
      g.globalAlpha = lo > 0.9 ? 1 : (lo + hi) / 2;
      g.beginPath();
      for (let i = 0; i < P.n; i++) if (P.a[i] >= lo && P.a[i] < hi) g.rect(P.x[i], P.y[i], DOT, DOT);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  function draw(now) {
    const dt = t0 ? Math.max(0, Math.min(0.034, (now - t0) / 1000)) : 0.016; t0 = now;
    const el = now - start;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const n = P.n;
    let settled = 0;
    if (state === 'charge') {
      // Held: the same dots in the same places shiver, a bounded few pixels, and warm to purple. The subject stays.
      const c = Math.max(0, Math.min(1, (now - chargeAt) / 460)), amp = c * 2.2;
      for (let i = 0; i < n; i++) { P.x[i] = P.ox[i] + (rand() - 0.5) * amp; P.y[i] = P.oy[i] + (rand() - 0.5) * amp; }
      drawBatches(c > 0.55 ? PURPLE : INK, false);
      return true;
    }
    const opening = state === 'open';
    for (let i = 0; i < n; i++) {
      const life = el - P.delay[i];
      let x = P.x[i], y = P.y[i], vx = P.vx[i], vy = P.vy[i];
      const tx = opening ? P.tx[i] : P.ox[i], ty = opening ? P.ty[i] : P.oy[i];
      if (life > (opening ? 150 : 0)) {
        const k = opening ? 105 : 120, c = opening ? 13 : 15;
        vx += (k * (tx - x) - c * vx) * dt; vy += (k * (ty - y) - c * vy) * dt;
      } else { vx *= 1 - 3 * dt; vy *= 1 - 3 * dt; }
      x += vx * dt; y += vy * dt;
      P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy;
      if (Math.abs(tx - x) < 1.2 && Math.abs(ty - y) < 1.2 && Math.abs(vx) + Math.abs(vy) < 40) settled++;
      // brightness: the frame stays bright, the lattice softens, spares fade away once they have arrived;
      // on the way back every dot returns to the picture's own brightness
      let a;
      if (opening) { const arrived = Math.max(0, Math.min(1, (el - 500) / 350)); a = P.kind[i] === 0 ? 1 : P.kind[i] === 1 ? 1 - 0.72 * arrived : 1 - arrived; }
      else { const back = Math.max(0, Math.min(1, (el - 60) / 260)); a = P.kind[i] === 3 ? 1 - back : P.kind[i] === 2 ? back * P.a0[i] : P.a0[i]; }
      P.a[i] = a;
    }
    drawBatches(opening ? '#C9B3FF' : INK, opening);
    return (settled < n * 0.93 || el < (opening ? 580 : 320)) && el < (opening ? 700 : 450);
  }

  let start = 0, chargeAt = 0, finished = null;
  function loop(now) {
    raf = 0;
    if (!canvas) return;
    if (draw(now)) raf = requestAnimationFrame(loop); else { const f = finished; finished = null; if (f) f(); }
  }
  const run = () => { if (!raf) { t0 = 0; raf = requestAnimationFrame(loop); } };

  // ---- the panel ----
  const panelEl = () => home().querySelector('#coverpanel');
  // The panel is as tall as what it holds, never past the bottom of the screen.
  function fit(panel) {
    panel.style.maxHeight = Math.max(260, home().clientHeight - 110) + 'px';
  }

  // The panel's contents go in before anything is measured, so the dots' box is the panel's real size.
  function prepare(panel) {
    panel.querySelector('.covertiles').innerHTML = ctx.tiles();
    panel.querySelector('.coverseg').innerHTML = ctx.seg();
    panel.hidden = false; fit(panel);
  }
  function startCharge(x, y) {
    if (reduced() || state !== 'idle' || S.cover) return;
    chargeWanted = true;
    sample().then((s) => {
      if (!s || state !== 'idle' || !chargeWanted) return;
      const panel = panelEl(); if (!panel) return;
      prepare(panel); panel.classList.add('charging');
      build(s, panel); mountCanvas(panel);
      const pr = panel.getBoundingClientRect(); press = { x: x - pr.left, y: y - pr.top };
      maniEl().classList.add('dotsafe');
      state = 'charge'; chargeAt = performance.now(); start = chargeAt; run();
    });
  }
  let chargeWanted = false;
  function cancelCharge() {
    chargeWanted = false;
    if (state !== 'charge') return;
    teardown();
  }
  function teardown() {
    cancelAnimationFrame(raf); raf = 0;
    if (canvas) canvas.remove();
    canvas = g = P = null; state = 'idle';
    const panel = panelEl();
    if (panel && !S.cover) { panel.hidden = true; panel.classList.remove('charging', 'open'); }
    const m = home() && maniEl(); if (m) m.classList.remove('dotsafe');
  }

  // The choices appear once, as the box forms, and stay put until the panel closes.
  function formed(panel) {
    if (panel.classList.contains('formed')) return;
    panel.classList.add('formed');
    if (reduced()) return;
    [...panel.querySelectorAll('.coverhead, .tile, .coverseg')].forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 180, delay: Math.min(i, 3) * 10, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }));
  }
  function open() {
    const panel = panelEl(), scroller = home();
    if (!panel || S.cover) return;
    S.cover = true;
    scroller.classList.add('locked');
    if (scroller.scrollTop) scroller.scrollTop = 0;
    if (state !== 'charge') prepare(panel);
    ctx.dim(true);
    const finish = () => { panel.classList.add('open'); panel.classList.remove('charging'); state = 'open'; formed(panel); };
    if (reduced()) { state = 'idle'; if (canvas) teardown(); finish(); maniEl().classList.add('dotsafe'); hap('success'); return; }
    const begin = (s) => {
      if (!S.cover) return;
      if (!P) { build(s, panel); mountCanvas(panel); maniEl().classList.add('dotsafe'); }
      // burst outwards from the finger, then everything pulls together into the box
      for (let i = 0; i < P.n; i++) {
        const dx = P.x[i] - press.x, dy = P.y[i] - press.y, d = Math.hypot(dx, dy) || 1, sp = 260 + rand() * 520;
        P.vx[i] = (dx / d) * sp + (rand() - 0.5) * 240; P.vy[i] = (dy / d) * sp * 0.8 - rand() * 320;
      }
      hap('heavy');
      state = 'open'; start = performance.now(); t0 = 0;
      finished = finish;
      run();
      // the box and its choices appear as the dots arrive, and are usable from then on
      setTimeout(() => { if (S.cover) formed(panel); }, 120);
    };
    if (P) begin(null); else sample().then(begin);
  }

  function close(changed) {
    const panel = panelEl();
    if (!panel || !S.cover) return;
    S.cover = false;
    ctx.dim(false);
    panel.classList.remove('formed', 'open');
    const scroller = home();
    const done = () => { panel.hidden = true; panel.classList.remove('charging'); maniEl().classList.remove('dotsafe'); if (canvas) canvas.remove(); canvas = g = P = null; state = 'idle'; scroller.classList.remove('locked'); };
    if (reduced() || !P) { done(); return; }
    // spelling the picture again: every dot goes back to its place in it, then the real picture takes over
    state = 'close'; start = performance.now(); finished = null;
    for (let i = 0; i < P.n; i++) { P.delay[i] = rand() * 90; P.vx[i] += (rand() - 0.5) * 120; P.vy[i] += (rand() - 0.5) * 120; }
    const land = () => {
      finished = () => { maniEl().classList.remove('dotsafe'); canvas && canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).finished.then(done, done); if (!canvas) done(); };
      run();
    };
    run();
    if (!changed) { land(); return; }
    // A new picture: the dots already heading home turn towards its dots as soon as they are known.
    sample().then((s) => { if (state !== 'close' || S.cover || !P) return; retarget(s, panel); start = performance.now(); land(); });
  }
  // Leaving Home while it is open: no ceremony.
  function closeNow() {
    if (!S.cover && state === 'idle') return;
    S.cover = false; chargeWanted = false; ctx.dim(false);
    cancelAnimationFrame(raf); raf = 0; if (canvas) canvas.remove(); canvas = g = P = null; state = 'idle';
    const h = home(); if (h) { const p = panelEl(); if (p) { p.hidden = true; p.classList.remove('formed', 'open', 'charging'); } maniEl().classList.remove('dotsafe'); h.classList.remove('locked'); }
  }
  return { startCharge, cancelCharge, open, close, closeNow, paintCover, isOpen: () => S.cover };
};
