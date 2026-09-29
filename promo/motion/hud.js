// Everything drawn flat over the 3D: typed captions, the bursts and flashes, the info card, the finale words.
import * as THREE from 'three';
import * as K from './kit.js';

const T = window.Timeline;
const { clamp, lerp, range, outCubic, inCubic, inOutCubic, outExpo, inExpo, outBack, rng } = T;
const { C, FONT } = K;
const W = T.W, H = T.H;

const typed = (text, t, t0, cps) => text.slice(0, Math.max(0, Math.floor((t - t0) * cps)));
const caret = (t) => Math.floor(t * 4) % 2 === 0;

const CAPTIONS = {
  desk: '01 — EVERYTHING YOU SAVE, IN ONE PLACE', office: '02 — PASTE A LINK. THAT’S IT.', macro: '03 — RECOGNISED ON YOUR PC · OFFLINE',
  board: '04 — BOARDS FOR EVERYTHING', ideas: '05 — IDEAS PICKED FOR YOUR BOARDS', sky: '06 — SYNCS OVER YOUR HOME WI-FI',
  ring: '07 — SORTED FOR YOU', ui: '08 — THE REAL APP, NOTHING MOCKED UP'
};

function finePrint(ctx, t, id) {
  const cap = CAPTIONS[id]; if (!cap) return;
  K.mono(ctx, cap, 56, H - 44, 15, C.ink, { alpha: 0.55 });
  K.mono(ctx, 'NOTEBOOK — MOOD BOARD FOR PC + PHONE', W - 56, H - 44, 15, C.ink, { align: 'right', alpha: 0.4 });
  const f = Math.round(t * T.FPS), tc = `00:${String(Math.floor(t)).padStart(2, '0')}:${String(f % T.FPS).padStart(2, '0')}`;
  K.mono(ctx, tc, W - 56, 60, 15, C.ink, { align: 'right', alpha: 0.4 });
  K.mono(ctx, 'NB—2026', 56, 60, 15, C.ink, { alpha: 0.4 });
}

function spikes(ctx, t, t0, seed, { bg, cols, n = 110, cx = W / 2, cy = H / 2 }) {
  const a = outExpo(range(t, t0, t0 + 0.26)), R = rng(seed);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < n; i++) {
    const ang = R() * Math.PI * 2 + a * 0.08, r0 = (80 + R() * 260) * (0.6 + a * 0.8), r1 = (700 + R() * 900) * (0.55 + a * 0.7), wdt = (2 + R() * 16) * (1 - a * 0.4);
    const col = cols[Math.floor(R() * cols.length)];
    const ca = Math.cos(ang), sa = Math.sin(ang), px = -sa, py = ca;
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(cx + ca * r0 + px * wdt, cy + sa * r0 + py * wdt); ctx.lineTo(cx + ca * r1, cy + sa * r1); ctx.lineTo(cx + ca * r0 - px * wdt, cy + sa * r0 - py * wdt); ctx.closePath(); ctx.fill();
  }
}

function photoRR(ctx, img, x, y, w, h, r) {
  ctx.save(); K.rr(ctx, x, y, w, h, r); ctx.clip();
  const a = img.width / img.height, b = w / h; let sw = img.width, sh = img.height;
  if (a > b) sw = img.height * b; else sh = img.width / b;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h); ctx.restore();
}

function halftoneField(ctx, col, { step = 14, dir = 1, amt = 1 } = {}) {
  ctx.fillStyle = col;
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
    const k = clamp(((dir > 0 ? x / W : 1 - x / W) * 0.7 + (y / H) * 0.5 - 0.35) * amt);
    if (k > 0.04) { ctx.beginPath(); ctx.arc(x, y, k * step * 0.55, 0, Math.PI * 2); ctx.fill(); }
  }
}

function scribbles(ctx, seed, col, n = 26) {
  const R = rng(seed); ctx.strokeStyle = col; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    ctx.lineWidth = 1 + R() * 3; ctx.globalAlpha = 0.25 + R() * 0.45; ctx.beginPath();
    let x = R() * W, y = R() * H; ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 320; y += (R() - 0.5) * 200; ctx.quadraticCurveTo(x + (R() - 0.5) * 120, y + (R() - 0.5) * 120, x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function word(ctx, text, x, y, size, col, { weight = 800, font = FONT.sans, align = 'center', alpha = 1, spacing = -0.03 } = {}) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${size * spacing}px`;
  ctx.fillText(text, x, y); ctx.restore();
}
function wordmark(ctx, x, y, size, { col = C.ink, dot = C.accent, alpha = 1 } = {}) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.font = `800 ${size}px ${FONT.sans}`; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${-size * 0.035}px`;
  const w1 = ctx.measureText('notebook').width, w2 = ctx.measureText('.').width, x0 = x - (w1 + w2) / 2;
  ctx.fillStyle = col; ctx.fillText('notebook', x0, y); ctx.fillStyle = dot; ctx.fillText('.', x0 + w1, y); ctx.restore();
  return w1 + w2;
}

// Project a point on a 3D plane to HUD pixels.
function project(shot, v) { const p = v.clone().project(shot.cam); return [(p.x * 0.5 + 0.5) * W, (1 - (p.y * 0.5 + 0.5)) * H]; }

function highlight(ctx, a, b, t0, t, label) {
  const [x0, y0] = a, [x1, y1] = b, pad = 10, x = Math.min(x0, x1) - pad, y = Math.min(y0, y1) - pad, w = Math.abs(x1 - x0) + pad * 2, h = Math.abs(y1 - y0) + pad * 2;
  const p = outCubic(range(t, t0, t0 + 0.3)); if (p <= 0) return;
  const per = 2 * (w + h);
  ctx.save(); ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.shadowColor = C.accent; ctx.shadowBlur = 24;
  ctx.setLineDash([per * p, per]); K.rr(ctx, x, y, w, h, Math.min(18, h / 2)); ctx.stroke(); ctx.restore();
  if (label) {
    const q = outBack(range(t, t0 + 0.12, t0 + 0.45)); if (q <= 0) return;
    ctx.save(); ctx.translate(x + w + 22, y + h / 2); ctx.scale(q, q);
    ctx.font = `600 26px ${FONT.sans}`; const tw = ctx.measureText(label).width;
    ctx.fillStyle = C.accent; K.rr(ctx, 0, -24, tw + 40, 48, 24); ctx.fill();
    ctx.fillStyle = C.bg; ctx.textBaseline = 'middle'; ctx.fillText(label, 20, 1); ctx.restore();
  }
}

function captionChip(ctx, text, t, t0, cps = 26) {
  const s = typed(text, t, t0, cps); if (!s) return;
  ctx.save(); ctx.font = `700 54px ${FONT.sans}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '-1.5px';
  const full = ctx.measureText(text).width, x = W / 2 - full / 2 - 36, y = H - 150;
  ctx.fillStyle = 'rgba(21,21,21,.86)'; K.rr(ctx, x, y - 44, full + 72, 88, 44); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = C.ink; ctx.textBaseline = 'middle'; ctx.fillText(s, x + 36, y + 2);
  if (s.length < text.length || caret(t)) { const cw = ctx.measureText(s).width; ctx.fillStyle = C.accent; ctx.fillRect(x + 40 + cw, y - 26, 5, 52); }
  ctx.restore();
}

export function drawHud(ctx, t, A, shots) {
  ctx.clearRect(0, 0, W, H);
  const shot = T.shotAt(t), id = shot.id;

  if (id === 'office' && t >= 7.5) {
    const small = typed('ONE LINK LATER', t, 7.55, 28), big = typed('IT’S ON YOUR BOARD!!!', t, 7.9, 24);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30;
    K.mono(ctx, small + (small.length < 14 && caret(t) ? '▌' : ''), 84, 868, 26, C.lilac, { spacing: 0.18 });
    ctx.font = `800 92px ${FONT.sans}`; ctx.fillStyle = C.ink; if ('letterSpacing' in ctx) ctx.letterSpacing = '-3px'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(big, 78, 972);
    if (big.length && (big.length < 21 || caret(t))) { const w = ctx.measureText(big).width; ctx.fillStyle = C.accent; ctx.fillRect(88 + w, 900, 8, 80); }
    ctx.restore();
  }

  if (id === 'burst1') {
    spikes(ctx, t, 9.0, 7, { bg: '#F1ECFF', cols: [C.accent, C.violet, '#0A0A0A', C.lilac] });
    const img = A.photo('Orange parka outfit').tex.image, a = outBack(range(t, 9.0, 9.2));
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.12 + a * 0.1); ctx.scale(0.5 + a * 0.5, 0.5 + a * 0.5); photoRR(ctx, img, -150, -200, 300, 400, 22); ctx.restore();
  }

  if (id === 'flash2') {
    const a = range(t, 11.0, 11.25);
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, H);
    halftoneField(ctx, '#7B58F2', { step: 16, dir: 1, amt: 1.4 });
    const R = rng(33);
    ['Aurora wallpaper', 'Golden street city', 'Hood up outfit'].forEach((n, i) => {
      const img = A.photo(n).tex.image; ctx.save(); ctx.globalAlpha = 0.5; ctx.globalCompositeOperation = 'luminosity';
      ctx.translate(W * (0.2 + i * 0.3) + a * 120 * (i - 1), H * (0.3 + R() * 0.4)); ctx.rotate((R() - 0.5) * 0.8); photoRR(ctx, img, -170, -230, 340, 460, 18); ctx.restore();
    });
    ctx.strokeStyle = '#F2EEFF'; ctx.lineWidth = 34; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-100, H * 0.8); ctx.bezierCurveTo(W * 0.3, H * (0.2 + a * 0.2), W * 0.6, H * 0.9, W + 100, H * 0.25); ctx.stroke();
  }

  if (id === 'burst2') {
    spikes(ctx, t, 15.4, 19, { bg: C.violet, cols: ['#CDBDFF', '#F2EEFF', '#4E2FD6', '#A98CFF'], n: 130 });
    const a = outBack(range(t, 15.4, 15.62));
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(0.2 - a * 0.25); ctx.scale(0.6 + a * 0.4, 0.6 + a * 0.4);
    ctx.fillStyle = '#0B0A10'; K.rr(ctx, -95, -200, 190, 400, 30); ctx.fill();
    photoRR(ctx, A.screen('phone-grid').image, -86, -191, 172, 382, 24); ctx.restore();
  }

  if (id === 'sky' && t >= 17.5) {
    const p = outCubic(range(t, 17.5, 17.95)), ph = 390, y = H - ph * p;
    ctx.save();
    ctx.fillStyle = C.surface; K.rr(ctx, 0, y, W, ph + 60, 40); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.18)'; K.rr(ctx, W / 2 - 40, y + 16, 80, 8, 4); ctx.fill();
    word(ctx, 'One board.', 90, y + 92, 64, C.ink, { align: 'left', weight: 700 });
    const second = typed('PC and phone.', t, 17.62, 30);
    ctx.font = `700 64px ${FONT.sans}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '-1.9px';
    ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink; const pw = ctx.measureText('PC and ').width;
    ctx.fillText(second.slice(0, 7), 90, y + 164); ctx.fillStyle = C.accent; ctx.fillText(second.slice(7), 90 + pw, y + 164);
    const thumbs = [[A.screen('desktop-all').image, 'DESKTOP'], [A.screen('phone-grid').image, 'PHONE'], [A.photo('Pink galaxy wallpaper').tex.image, 'YOUR PHOTOS']];
    thumbs.forEach(([img, lab], i) => { const q = outBack(range(t, 17.7 + i * 0.08, 18.05 + i * 0.08)); if (q <= 0) return; const x = 90 + i * 246, yy = y + 214; ctx.save(); ctx.translate(x + 113, yy + 70); ctx.scale(q, q); photoRR(ctx, img, -113, -70, 226, 140, 16); ctx.restore(); K.mono(ctx, lab, x, yy + 172, 15, C.muted, { alpha: q }); });
    ctx.fillStyle = C.accent; ctx.fillRect(1180, y + 70, 64, 6);
    ['Works offline', 'No cloud. No uploads.', 'Knows what’s in each photo', 'Syncs over your home Wi-Fi', 'Saves TikTok + Pinterest links', 'Finds anything, instantly'].forEach((l, i) => {
      const s = typed('• ' + l, t, 17.75 + i * 0.1, 60); K.mono(ctx, s, 1180, y + 124 + i * 40, 24, C.ink2, { spacing: 0.04 });
    });
    ctx.restore();
  }

  if (id === 'ui' && shots.ui) {
    const S = shots.ui, pa = S.planes.a.position, pb = S.planes.b.position;
    const P = (pl, x, y) => project(S, new THREE.Vector3((x / 1600 - 0.5) * 3.2 + pl.x, (0.5 - y / 1000) * 2.0, 0.01));
    if (t < 21.0) { highlight(ctx, P(pa, 30, 226), P(pa, 290, 270), 20.62, t, 'Typed “black”'); captionChip(ctx, 'Find anything.', t, 20.55); }
    else { highlight(ctx, P(pb, 952, 412), P(pb, 1322, 446), 21.3, t, 'Found on your PC'); captionChip(ctx, 'It knows what’s in it.', t, 21.1, 40); }
  }

  if (id === 'finale') {
    if (t < 21.75) { ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, H); halftoneField(ctx, '#8662FA', { step: 18, amt: 1.2 }); }
    else if (t < 22.25) {
      ctx.fillStyle = C.lilac; ctx.fillRect(0, 0, W, H);
      halftoneField(ctx, '#B7A2FF', { step: 12, dir: -1, amt: 1.3 });
      ['Deep wave wallpaper', 'Mustard scarf outfit', 'Tunnel city'].forEach((n, i) => { const R = rng(70 + i), img = A.photo(n).tex.image; ctx.save(); ctx.globalAlpha = 0.28; ctx.globalCompositeOperation = 'multiply'; ctx.translate(W * (0.18 + i * 0.32), H * (0.35 + R() * 0.3)); ctx.rotate((R() - 0.5) * 0.9); photoRR(ctx, img, -160, -210, 320, 420, 14); ctx.restore(); });
      scribbles(ctx, 5, '#6C4CF0');
      const k = 1 + 0.25 * (1 - outExpo(range(t, 21.75, 21.95)));
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(k, k); word(ctx, 'save!!!', 0, 0, 190, '#0A0A0A'); ctx.restore();
    } else if (t < 22.583) {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      word(ctx, 'save!!!!', W / 2 - 90, H / 2, 150, C.ink);
      const b = outBack(range(t, 22.25, 22.4)); ctx.fillStyle = C.accent; const s = 64 * b; ctx.fillRect(W / 2 + 330 - s / 2, H / 2 - s / 2, s, s);
    } else if (t < 22.917) {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      const m = outExpo(range(t, 22.583, 22.72));
      ctx.fillStyle = C.accent; ctx.fillRect(lerp(W / 2 + 298, W / 2 - 250, m), H / 2 - 20, 40, 40);
      word(ctx, 'sort.', W / 2 + 60, H / 2, 150, C.ink, { alpha: m });
      K.mono(ctx, 'FIND. KEEP. SYNC.', W / 2 - 250, H / 2 + 130, 22, C.muted, { alpha: m });
    } else if (t < 23.4) {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.font = `800 820px ${FONT.sans}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '-30px'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText('notebook.').width, x = (u) => lerp(W * 0.7, W * 0.42 - tw, inOutCubic(u));
      const u0 = range(t, 22.917, 23.4), du = 0.5 / T.FPS / 0.483;
      ctx.fillStyle = C.accent;
      for (let i = 10; i >= 1; i--) { ctx.globalAlpha = 0.07; ctx.fillText('notebook.', x(clamp(u0 - i * du * 0.045)), H / 2 + 40); }
      ctx.globalAlpha = 1; ctx.fillText('notebook.', x(u0), H / 2 + 40);
      ctx.restore();
    } else {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.45); g.addColorStop(0, 'rgba(157,123,255,.16)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const k = 1 + 0.08 * (1 - outCubic(range(t, 23.4, 23.8)));
      ctx.save(); ctx.translate(W / 2, H / 2 - 20); ctx.scale(k, k); wordmark(ctx, 0, 0, 190); ctx.restore();
      const q = outCubic(range(t, 23.55, 23.85));
      K.mono(ctx, 'YOUR MOOD BOARD  ·  PC + PHONE  ·  OFFLINE', W / 2, H / 2 + 120, 22, C.ink2, { align: 'center', alpha: q, spacing: 0.2 });
    }
  }
  if (!['finale', 'burst1', 'burst2', 'flash2'].includes(id)) finePrint(ctx, t, id);
}

// Post settings per moment: flashes, letterbox, colour fringe, halftone corners, grain.
const FLASHES = [[4.46, 0.14, '#ffffff', 0.55], [7.0, 0.2, '#CDBDFF', 0.4], [9.25, 0.12, '#ffffff', 0.6], [11.25, 0.12, '#9D7BFF', 0.5], [13.0, 0.1, '#ffffff', 0.3], [15.667, 0.14, '#ffffff', 0.5], [18.5, 0.12, '#9D7BFF', 0.45], [20.333, 0.14, '#ffffff', 0.35], [23.4, 0.3, '#ffffff', 0.6]];
const HALF = { desk: 0.35, office: 0.35, macro: 0.3, board: 0.3, ideas: 0.25, sky: 0.2, ring: 0.15, ui: 0.08 };
export function post(t) {
  const id = T.shotAt(t).id, ex = T.exposure(t);
  let flash = [0, 0, 0, 0];
  for (const [t0, d, col, amt] of FLASHES) if (t >= t0 && t < t0 + d) { const c = new THREE.Color(col); flash = [c.r, c.g, c.b, amt * (1 - (t - t0) / d)]; }
  return {
    scene: !['finale', 'burst1', 'burst2', 'flash2'].includes(id),
    lb: t >= 6.2 && t < 7.5 ? outCubic(range(t, 6.2, 6.5)) : 0,
    flash, ca: ex.samples > 4 ? 1.0 : 0.3, vig: id === 'finale' ? 0.2 : 0.55, half: HALF[id] || 0, grain: 0.05
  };
}
