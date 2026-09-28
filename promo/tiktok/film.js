/* Notebook TikTok advert. state = evaluate(frame, fps); draw(canvas, state, assets).
 * Every frame is a pure function of its number (no clocks, no randomness), so frames can be rendered in any order.
 * Timing is on a 128 BPM beat grid shared with music.js. Design space 1080 x 1920, scaled uniformly (1440 x 2560 export). */
(function (root, factory) {
  const M = typeof module === 'object' && module.exports ? require('./motion-core.js') : root.MotionCore;
  const api = factory(M);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Film = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  if (!M) throw new Error('Load motion-core.js before film.js');
  const {clamp, lerp, progress, smootherstep, cubicBezier} = M;
  const W = 1080, H = 1920, FPS = 30, BPM = 128, B = 60 / BPM, DURATION = 17;
  const P = (t, beat, beats) => progress(t, beat * B, beats * B); // progress measured in beats
  // Notebook's own curves (renderer/styles.css, phone motion.js), plus a sharper snap for beat hits.
  const ease = cubicBezier(.22, 1, .36, 1);
  const snap = cubicBezier(.12, .9, .2, 1);
  const spring = cubicBezier(.34, 1.45, .64, 1);

  // Pictures (h / w ratios are fixed here so layout never depends on the loaded files).
  const ITEMS = {
    g0: {file: 'outfit_05.jpg', r: 1.34, match: true}, g1: {file: 'wallpaper_17.jpg', r: .78},
    g2: {file: 'outfit_24.jpg', r: 1.3}, g3: {file: 'outfit_09.jpg', r: 1.38, match: true},
    g4: {file: 'wallpaper_22.jpg', r: .76}, g5: {file: 'outfit_11.jpg', r: 1.22, match: true},
    g6: {file: 'outfit_41.jpg', r: 1.3}, g7: {file: 'outfit_20.jpg', r: 1.34, match: true},
    g8: {file: 'wallpaper_18.jpg', r: .8}, g9: {file: 'outfit_06.jpg', r: 1.4, match: true},
    nw: {file: 'outfit_26.jpg', r: 1.33, match: true}
  };
  const COLW = 474, GAP = 20, COLX = [56, 550], TOP = 600;
  function columns(left, right) {
    const out = {};
    [left, right].forEach((col, c) => { let y = TOP; for (const id of col) { const h = COLW * ITEMS[id].r; out[id] = {x: COLX[c], y, width: COLW, height: h, radius: 28}; y += h + GAP; } });
    return out;
  }
  const LAYOUT_A = columns(['g0', 'g2', 'g4', 'g5', 'g8'], ['g1', 'g3', 'g6', 'g7', 'g9']);
  const LAYOUT_B = columns(['nw', 'g0', 'g2', 'g4', 'g5', 'g8'], ['g1', 'g3', 'g6', 'g7', 'g9']);
  const LAYOUT_C = columns(['nw', 'g0', 'g5'], ['g3', 'g7', 'g9']);
  // Hook pile: [centre x, centre y, width, rotation, beat it lands on].
  const PILE = {g0: [400, 960, 470, -.12, -.4], g1: [690, 860, 430, .1, 1], g2: [560, 1230, 450, .07, 2], g3: [790, 1250, 400, -.09, 3], g4: [300, 1290, 380, .12, 3.5]};
  const HOOK = [{word: 'SCREENSHOTS.', beat: -.4}, {word: 'PINS.', beat: 1}, {word: 'TIKTOKS.', beat: 2}, {word: 'EVERYWHERE.', beat: 3, accent: true}];
  const PILL = {x: 56, y: 470, width: 968, height: 96, radius: 48};
  const LINK = 'pin.it/2Qx8hVb', QUERY = 'black streetwear';
  const PHONE = {s: 500 / 1080, x: 290, y: 540 - 560 * (500 / 1080)};
  const PHONE_CLIP = {x: 0, y: 560, width: 1080, height: 1083 / (500 / 1080), radius: 64 / (500 / 1080)};
  // Sections (in beats). Captions hard-cut on the beat and slam in word by word.
  const CAPTIONS = [
    {id: 'board', from: 4, to: 8, title: 'ALL IN ONE BOARD.', sub: 'Photos, videos and notes on your PC.'},
    {id: 'save', from: 8, to: 14, title: 'PASTE A LINK.', sub: 'TikTok or Pinterest. Saved in a second.'},
    {id: 'recognise', from: 14, to: 20, title: 'IT KNOWS WHAT’S IN IT.', sub: 'Worked out on your PC. No cloud.'},
    {id: 'find', from: 20, to: 26, title: 'FIND ANYTHING.', sub: 'Search what’s inside the pictures.'},
    {id: 'phone', from: 26, to: 31, title: 'NOW ON YOUR PHONE.', sub: 'Syncs over your home Wi-Fi.'}
  ];
  const CHIPS = [{label: 'Outfit', beat: 15}, {label: 'Black', swatch: '#111111', beat: 16}, {label: 'Streetwear', beat: 17}];
  const END = 31;

  const lerpRect = (a, b, u) => ({x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), width: lerp(a.width, b.width, u), height: lerp(a.height, b.height, u), radius: lerp(a.radius, b.radius, u)});
  const slam = (t, beat, beats = .35) => ({u: t >= beat * B ? snap(P(t, beat, beats)) : -1}); // -1 = not yet on screen

  function evaluate(frame, fps = FPS) {
    M.finite(frame, 'frame'); M.finite(fps, 'fps');
    if (fps <= 0) throw new RangeError('fps must be > 0');
    const t = clamp(frame / fps, 0, DURATION), beat = t / B;
    const s = {t, beat, end: beat >= END};
    if (s.end) {
      s.word = spring(P(t, END, .6)); s.dot = spring(P(t, END + 1, .5));
      s.sub = snap(P(t, END + 1.5, .5)); s.micro = snap(P(t, END + 2, .5));
      return s;
    }
    const gather = beat >= 4;
    const paste = spring(P(t, 10.5, 1.1));
    const filter = snap(P(t, 23, .75)) * (1 - ease(P(t, 26, 1.25)));
    const push = ease(P(t, 14, .75)) * (1 - ease(P(t, 20, .75)));
    const drift = push * .06 * P(t, 14.75, 5.25); // slow push while the labels land
    const phone = ease(P(t, 26, 1.25));
    const k = .4 + drift; // close-up zoom: 1.4x, creeping to 1.46x
    s.camera = {s: 1 + k * push + (PHONE.s - 1) * phone, x: (540 - 293 * (1 + k)) * push + PHONE.x * phone, y: (930 - 915 * (1 + k)) * push + PHONE.y * phone};
    s.clip = phone > 0 ? lerpRect({x: 0, y: 0, width: W, height: H, radius: 0}, PHONE_CLIP, phone) : null;
    s.bezel = snap(P(t, 26.75, .5));
    s.scroll = 620 * smootherstep(P(t, 27.5, 3.25)); // the board scrolls inside the phone

    s.hook = gather ? null : {words: HOOK.filter(h => beat >= h.beat).slice(-1).map(h => ({...h, ...slam(t, h.beat, .4)}))};
    s.cards = Object.keys(ITEMS).map((id, index) => {
      const item = ITEMS[id];
      let rect, rotation = 0, alpha = 1, scale = 1, image = 1;
      if (id === 'nw') {
        rect = lerpRect(PILL, LAYOUT_B.nw, paste);
        alpha = beat >= 10.5 ? 1 : 0;
        image = snap(P(t, 11, .5));
      } else {
        rect = lerpRect(LAYOUT_A[id], LAYOUT_B[id], paste);
        if (item.match) rect = lerpRect(rect, LAYOUT_C[id], filter);
        else { alpha = 1 - filter; scale = 1 - .08 * filter; }
        const p = PILE[id];
        if (p) {
          const land = snap(P(t, p[4], .4)), g = ease(P(t, 4 + index * .12, 1.25));
          const from = {x: p[0] - p[2] / 2, y: p[1] - p[2] * item.r / 2, width: p[2], height: p[2] * item.r, radius: 30};
          rect = lerpRect(from, rect, g);
          rotation = p[3] * (1 - g);
          scale *= lerp(1.4, 1, land);
          alpha *= beat >= p[4] ? 1 : 0;
        } else {
          const u = ease(P(t, 4.5 + (index - 5) * .15, .9));
          alpha *= u > 0 ? 1 : 0; rect = {...rect, y: rect.y - (1 - u) * 1400};
        }
        alpha *= 1 - .88 * push; // one focus during the close-up
      }
      return {id, file: item.file, rect, rotation, alpha: clamp(alpha), scale, image};
    });

    const typedLink = beat < 10.5 ? Math.floor(LINK.length * P(t, 8.75, 1.25)) : 0;
    const typedQuery = Math.floor(QUERY.length * P(t, 21, 1.5));
    const typing = (beat >= 8.5 && beat < 10.5) || (beat >= 20.75 && beat < 23);
    s.pill = {
      rect: PILL, alpha: clamp(snap(P(t, 5, .5)) * (1 - push) * (1 - phone)),
      press: 1 - .05 * Math.sin(Math.PI * P(t, 10.25, .4)), search: snap(P(t, 20.5, .25)),
      text: beat < 20.5 ? LINK.slice(0, typedLink) : QUERY.slice(0, typedQuery),
      caret: typing && Math.floor(beat * 2) % 2 === 0
    };
    s.captions = CAPTIONS.filter(c => beat >= c.from && beat < c.to).map(c => ({
      id: c.id, words: c.title.split(' ').map((_, i) => slam(t, c.from + i * .25, .35).u), sub: snap(P(t, c.from + 1, .5))
    }));
    const chipsOut = snap(P(t, 20, .25));
    s.chips = CHIPS.map(c => ({u: beat >= c.beat ? spring(P(t, c.beat, .5)) : 0, alpha: (beat >= c.beat ? 1 : 0) * (1 - chipsOut)}));
    return s;
  }

  /* ---------- drawing ---------- */
  const C = {bg: '#0A0A0A', ink: '#F2F2F2', ink2: '#C8C8C8', muted: '#9A9A9A', accent: '#9D7BFF', surface: '#151515', surface2: '#1C1C1C', line: 'rgba(255,255,255,.09)'};
  const F = {body: 'Figtree, sans-serif', poster: 'Anton, Impact, sans-serif', mono: '"IBM Plex Mono", monospace'};
  function rr(ctx, r) { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.width, r.height, Math.max(0, Math.min(r.radius, r.width / 2, r.height / 2))); }
  function font(ctx, size, weight, family, spacing = 0) { ctx.font = `${weight} ${size}px ${family}`; ctx.letterSpacing = `${spacing}px`; }
  function fitSize(ctx, text, size, weight, family, maxWidth) {
    font(ctx, size, weight, family);
    return Math.min(size, Math.floor(size * maxWidth / ctx.measureText(text).width));
  }
  function icon(ctx, kind, x, y, size, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24); ctx.translate(-12, -12);
    ctx.strokeStyle = color; ctx.lineWidth = 2.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const paths = {
      link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
      search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M21 21l-4.3-4.3'],
      home: ['M3 10.5L12 3l9 7.5', 'M5 9.5V20h14V9.5'],
      plus: ['M12 5v14', 'M5 12h14'],
      sync: ['M21 12a9 9 0 0 1-15.5 6.2L3 16', 'M3 12A9 9 0 0 1 18.5 5.8L21 8', 'M21 3v5h-5', 'M3 21v-5h5']
    };
    for (const d of paths[kind]) ctx.stroke(new Path2D(d));
    ctx.restore();
  }
  function cover(ctx, img, r) {
    const ir = img.naturalHeight / img.naturalWidth, rr2 = r.height / r.width;
    let sw = img.naturalWidth, sh = img.naturalHeight;
    if (ir > rr2) sh = sw * rr2; else sw = sh / rr2;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, r.x, r.y, r.width, r.height);
  }
  function background(ctx, assets) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (assets.grain) { ctx.save(); const p = ctx.createPattern(assets.grain, 'repeat'); p.setTransform(new DOMMatrix().scale(160 / assets.grain.naturalWidth)); ctx.fillStyle = p; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  }
  function drawCard(ctx, c, assets) {
    if (c.alpha <= 0) return;
    const r = c.rect, cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    ctx.save(); ctx.globalAlpha *= c.alpha;
    ctx.translate(cx, cy); ctx.rotate(c.rotation); ctx.scale(c.scale, c.scale); ctx.translate(-cx, -cy);
    if (c.rotation) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 22; }
    rr(ctx, r); ctx.fillStyle = C.surface2; ctx.fill(); ctx.shadowColor = 'transparent';
    if (c.image > 0) { ctx.clip(); ctx.globalAlpha *= c.image; cover(ctx, assets.images[c.file], r); }
    ctx.restore();
  }
  function drawPill(ctx, p) {
    if (p.alpha <= 0) return;
    const r = p.rect, cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    ctx.save(); ctx.globalAlpha *= p.alpha; ctx.translate(cx, cy); ctx.scale(p.press, p.press); ctx.translate(-cx, -cy);
    rr(ctx, r); ctx.fillStyle = C.surface2; ctx.fill(); ctx.strokeStyle = p.caret || p.text ? 'rgba(157,123,255,.7)' : C.line; ctx.lineWidth = 2; ctx.stroke();
    ctx.save(); ctx.globalAlpha *= 1 - p.search; icon(ctx, 'link', r.x + 50, cy, 34, C.muted); ctx.restore();
    ctx.save(); ctx.globalAlpha *= p.search; icon(ctx, 'search', r.x + 50, cy, 34, C.muted); ctx.restore();
    ctx.textBaseline = 'middle';
    const tx = r.x + 88;
    font(ctx, 36, 600, F.body);
    if (p.text) { ctx.fillStyle = C.ink; ctx.fillText(p.text, tx, cy + 1); }
    else { ctx.fillStyle = C.muted; ctx.fillText(p.search > .5 ? 'Search' : 'Paste a TikTok or Pinterest link', tx, cy + 1); }
    if (p.caret) { const w = p.text ? ctx.measureText(p.text).width : 0; ctx.fillStyle = C.accent; ctx.fillRect(tx + w + 3, cy - 22, 4, 44); }
    ctx.restore();
  }
  // A word that lands: scales down from 1.3 while it fades up. u = -1 means not on screen yet.
  function slamText(ctx, text, x, base, u, color, shadow) {
    if (u < 0) return;
    const m = ctx.measureText(text), cx = x + m.width / 2, cy = base - m.actualBoundingBoxAscent / 2;
    ctx.save(); ctx.globalAlpha *= Math.min(1, .4 + u * 2.5); ctx.translate(cx, cy); ctx.scale(lerp(1.3, 1, u), lerp(1.3, 1, u)); ctx.translate(-cx, -cy);
    if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 50; }
    ctx.fillStyle = color; ctx.fillText(text, x, base); ctx.restore();
  }
  function drawHook(ctx, hook) {
    if (!hook) return;
    for (const h of hook.words) {
      const size = fitSize(ctx, h.word, 300, 400, F.poster, 820); // 820 x 1.3 slam still fits the frame
      font(ctx, size, 400, F.poster); ctx.textBaseline = 'alphabetic';
      const x = (W - ctx.measureText(h.word).width) / 2;
      slamText(ctx, h.word, x, 1080 + size * .36, h.u, h.accent ? C.accent : C.ink, true);
    }
  }
  function drawCaption(ctx, c) {
    const cap = CAPTIONS.find(x => x.id === c.id), words = cap.title.split(' ');
    const size = fitSize(ctx, cap.title, 132, 400, F.poster, 936);
    font(ctx, size, 400, F.poster); ctx.textBaseline = 'alphabetic';
    const space = ctx.measureText(' ').width;
    let x = 72;
    words.forEach((w, i) => { slamText(ctx, w, x, 340, c.words[i], i === words.length - 1 ? C.accent : C.ink, false); x += ctx.measureText(w).width + space; });
    if (c.sub > 0) { ctx.save(); ctx.globalAlpha = c.sub; font(ctx, 38, 600, F.body); ctx.fillStyle = C.ink2; ctx.fillText(cap.sub, 74, 408 + (1 - c.sub) * 20); ctx.restore(); }
  }
  function drawChips(ctx, chips) {
    font(ctx, 38, 700, F.body);
    const widths = CHIPS.map(c => ctx.measureText(c.label).width + 68 + (c.swatch ? 44 : 0));
    let x = (W - widths.reduce((a, b) => a + b, 0) - 16 * (CHIPS.length - 1)) / 2;
    chips.forEach((chip, i) => {
      const w = widths[i], h = 88, y = 1410, cx = x + w / 2, cy = y + h / 2;
      if (chip.alpha > 0) {
        ctx.save(); ctx.globalAlpha = chip.alpha; ctx.translate(cx, cy + (1 - chip.u) * 40); ctx.scale(.6 + .4 * chip.u, .6 + .4 * chip.u); ctx.translate(-cx, -cy);
        rr(ctx, {x, y, width: w, height: h, radius: 44}); ctx.fillStyle = i === 2 ? C.accent : C.surface; ctx.fill();
        if (i !== 2) { ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; ctx.stroke(); }
        let tx = x + 34;
        if (CHIPS[i].swatch) { ctx.beginPath(); ctx.arc(tx + 13, cy, 14, 0, Math.PI * 2); ctx.fillStyle = CHIPS[i].swatch; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke(); tx += 44; }
        font(ctx, 38, 700, F.body); ctx.fillStyle = i === 2 ? C.bg : C.ink; ctx.textBaseline = 'middle'; ctx.fillText(CHIPS[i].label, tx, cy + 1);
        ctx.restore();
      }
      x += w + 16;
    });
  }
  function screenRect(cam, r) { return {x: cam.x + r.x * cam.s, y: cam.y + r.y * cam.s, width: r.width * cam.s, height: r.height * cam.s, radius: r.radius * cam.s}; }
  function drawPhoneNav(ctx, screen, alpha) {
    const w = screen.width * .78, h = 92, x = screen.x + (screen.width - w) / 2, y = screen.y + screen.height - h - 34;
    ctx.save(); ctx.globalAlpha = alpha;
    rr(ctx, {x, y, width: w, height: h, radius: 46}); ctx.fillStyle = 'rgba(21,21,21,.94)'; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
    rr(ctx, {x: x + 10, y: y + 10, width: 150, height: h - 20, radius: 36}); ctx.fillStyle = C.ink; ctx.fill();
    icon(ctx, 'home', x + 48, y + h / 2, 28, C.bg); font(ctx, 26, 700, F.body); ctx.fillStyle = C.bg; ctx.textBaseline = 'middle'; ctx.fillText('Home', x + 72, y + h / 2 + 1);
    icon(ctx, 'search', x + 205, y + h / 2, 28, C.ink2);
    ctx.beginPath(); ctx.arc(x + 280, y + h / 2, 36, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill(); icon(ctx, 'plus', x + 280, y + h / 2, 30, C.bg);
    icon(ctx, 'sync', x + 350, y + h / 2, 28, C.ink2);
    ctx.restore();
  }
  function drawEnd(ctx, s) {
    ctx.textBaseline = 'alphabetic';
    font(ctx, 200, 800, F.body, -4); const word = 'notebook', ww = ctx.measureText(word).width, dotW = ctx.measureText('.').width;
    const x = (W - ww - dotW) / 2, base = 930, cx = W / 2, cy = base - 70;
    ctx.save(); ctx.globalAlpha = Math.min(1, s.word * 3); ctx.translate(cx, cy); ctx.scale(lerp(1.5, 1, s.word), lerp(1.5, 1, s.word)); ctx.translate(-cx, -cy);
    ctx.fillStyle = C.ink; ctx.fillText(word, x, base); ctx.restore();
    if (s.dot > 0) { ctx.save(); const dx = x + ww + dotW / 2, dy = base - 20; ctx.translate(dx, dy); ctx.scale(s.dot, s.dot); ctx.translate(-dx, -dy); ctx.fillStyle = C.accent; font(ctx, 200, 800, F.body, -4); ctx.fillText('.', x + ww, base); ctx.restore(); }
    ctx.textAlign = 'center';
    ctx.save(); ctx.globalAlpha = s.sub; font(ctx, 48, 700, F.body); ctx.fillStyle = C.ink; ctx.fillText('Your mood board, on PC and phone.', W / 2, 1030 + (1 - s.sub) * 24); ctx.restore();
    ctx.save(); ctx.globalAlpha = s.micro; font(ctx, 28, 500, F.mono, 28 * .14); ctx.fillStyle = C.muted; ctx.fillText('WINDOWS  ·  ANDROID  ·  WORKS OFFLINE', W / 2, 1106); ctx.restore();
    ctx.textAlign = 'left';
  }
  function draw(canvas, s, assets) {
    const ctx = canvas.getContext('2d');
    const k = Math.min(canvas.width / W, canvas.height / H);
    ctx.setTransform(k, 0, 0, k, (canvas.width - W * k) / 2, (canvas.height - H * k) / 2);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    background(ctx, assets);
    if (s.end) { drawEnd(ctx, s); return canvas; }
    const cam = s.camera;
    const screen = s.clip && screenRect(cam, s.clip);
    if (screen && s.bezel > 0) {
      ctx.save(); ctx.globalAlpha = s.bezel; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 80; ctx.shadowOffsetY = 30;
      rr(ctx, {x: screen.x - 16, y: screen.y - 16, width: screen.width + 32, height: screen.height + 32, radius: screen.radius + 16});
      ctx.fillStyle = '#101010'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    }
    ctx.save();
    if (screen) { rr(ctx, screen); ctx.clip(); if (s.bezel > 0) { ctx.globalAlpha = s.bezel; background(ctx, assets); ctx.globalAlpha = 1; } }
    ctx.transform(cam.s, 0, 0, cam.s, cam.x, cam.y - s.scroll * cam.s);
    drawPill(ctx, s.pill);
    const order = s.cards.filter(c => c.id !== 'nw').concat(s.cards.filter(c => c.id === 'nw'));
    for (const c of order) drawCard(ctx, c, assets);
    ctx.restore();
    if (screen && s.bezel > 0) drawPhoneNav(ctx, screen, s.bezel);
    drawHook(ctx, s.hook);
    for (const c of s.captions) drawCaption(ctx, c);
    drawChips(ctx, s.chips);
    return canvas;
  }
  return Object.freeze({evaluate, draw, W, H, FPS, BPM, B, DURATION, END, ITEMS, CAPTIONS, CHIPS, LAYOUT_A, LAYOUT_B, LAYOUT_C, PILE});
});
