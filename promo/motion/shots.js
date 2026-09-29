// The twelve shots. Each is a scene, a camera and update(t): given a time in seconds it places everything,
// with no memory of earlier frames (so any frame can be rendered on its own, in any order).
import * as THREE from 'three';
import * as K from './kit.js';

const T = window.Timeline;
const { clamp, lerp, range, smooth, outCubic, inCubic, inOutCubic, outExpo, inExpo, outBack, spring, rng } = T;
const { C } = K;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const bump = (t, a, b) => Math.sin(range(t, a, b) * Math.PI);

function camera(fov = 40) { return new THREE.PerspectiveCamera(fov, T.W / T.H, 0.05, 200); }
function aim(c, pos, look, { up = V(0, 1, 0), roll = 0, fov } = {}) {
  c.position.copy(pos); c.up.copy(up).normalize(); c.lookAt(look); if (roll) c.rotateZ(roll);
  if (fov && c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
}
function stage(A, bg, env = 0.4) {
  const s = new THREE.Scene(); s.background = typeof bg === 'string' ? new THREE.Color(bg) : bg;
  s.environment = A.env; s.environmentIntensity = env;
  return s;
}
function keyLights(s, { key = 2.4, keyPos = V(-3, 6, 3), keyCol = '#EFE9FF', rimCol = C.accent, rim = 18, rimPos = V(3, 2, -2), fill = 0.45 } = {}) {
  const k = new THREE.DirectionalLight(keyCol, key); k.position.copy(keyPos); s.add(k);
  const r = new THREE.PointLight(rimCol, rim, 14, 1.4); r.position.copy(rimPos); s.add(r);
  s.add(new THREE.HemisphereLight('#8f82c9', '#050407', fill));
  return { k, r };
}
function surface(A, size, { seed = 3, base = 16, tint = [0, -1, 5], rough = 0.85, repeat = 5 } = {}) {
  const R = rng(seed);
  const c = K.noiseCanvas(512, 512, { scale: 48, seed, fn: (n) => { const speck = R() > 0.9965 ? 38 * R() : 0; const v = base + n * 14 + speck; return [v + tint[0], v + tint[1], v + tint[2], 255]; } });
  const t = K.tex(c, { repeat: true }); t.repeat.set(repeat, repeat);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: t, roughness: rough, metalness: 0.1 }));
  m.rotation.x = -Math.PI / 2;
  return m;
}
function gradientBg(top, bottom, glowAt = null, glowCol = 'rgba(157,123,255,.28)', size = 1.0) {
  return K.drawTex(960, 540, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(1, bottom); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (glowAt) { const r = ctx.createRadialGradient(glowAt[0] * w, glowAt[1] * h, 0, glowAt[0] * w, glowAt[1] * h, w * 0.55 * size); r.addColorStop(0, glowCol); r.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = r; ctx.fillRect(0, 0, w, h); }
  });
}
// Something lying on the desk: wrap (position, turn) > inner (laid flat). Its shadow sits on the desk.
function flat(obj, x, y, z, yaw, { sw, sh, shadowOpacity = 0.55 } = {}) {
  const wrap = new THREE.Group(), inner = new THREE.Group();
  inner.add(obj); inner.rotation.x = -Math.PI / 2; wrap.add(inner);
  wrap.position.set(x, y, z); wrap.rotation.y = yaw;
  let sh0 = null;
  if (sw) { sh0 = K.shadow(sw, sh, { opacity: shadowOpacity }); sh0.rotation.x = -Math.PI / 2; sh0.rotation.z = yaw; sh0.position.set(x + 0.07, 0.002, z + 0.09); }
  return { wrap, inner, shadow: sh0, base: { x, y, z, yaw } };
}

// ——— 1. Desk: top-down, the phone and the things you saved; notifications pop off the phone; the tumble.
function desk(A) {
  const s = stage(A, '#0b0a0e', 0.3), cam = camera(38);
  s.add(surface(A, 40, { seed: 3 }));
  keyLights(s, { key: 2.6, keyPos: V(-2.5, 6, 1.8), rim: 14, rimPos: V(2.4, 1.4, -1.2) });
  const items = [];
  const put = (obj, x, z, yaw, w, h, lift = 0.004) => { const f = flat(obj, x, lift, z, yaw, { sw: w, sh: h }); s.add(f.wrap); s.add(f.shadow); items.push(f); return f; };
  const layout = [
    ['Mustard scarf outfit', -1.62, -0.3, 0.24, 1.05], ['Aurora wallpaper', 1.5, -0.62, -0.2, 0.82], ['Red beanie outfit', -1.25, 1.12, -0.33, 1.0],
    ['Pink pier wallpaper', 1.35, 0.98, 0.3, 0.98], ['Strawberries icon', -2.75, 0.55, 0.5, 0.74], ['Look up city', 2.75, 0.12, -0.12, 0.9],
    ['Star trails wallpaper', -2.8, -1.25, -0.2, 0.9], ['Sunglasses and daisies outfit', 2.55, -1.55, 0.18, 0.95], ['Golden profile portrait', 0.05, 1.7, 0.12, 0.78],
    ['Ring of light icon', -0.2, -2.05, -0.3, 0.8]
  ];
  layout.forEach(([name, x, z, yaw, w], i) => { const p = A.photo(name), h = w * p.h / p.w; put(K.card(p.tex, w, h, { r: 0.05 }), x, z, yaw, w, h, 0.004 + i * 0.0015); });
  // A note, as the app draws one.
  const note = K.drawTex(560, 420, (ctx, w, h) => {
    ctx.fillStyle = C.surface; K.rr(ctx, 0, 0, w, h, 26); ctx.fill();
    K.mono(ctx, 'NOTE · OUTFITS', 34, 58, 18, C.muted);
    ctx.fillStyle = C.ink; ctx.font = `700 44px ${K.FONT.sans}`; ctx.fillText('Autumn capsule', 34, 124);
    ctx.font = `400 30px ${K.FONT.sans}`; ctx.fillStyle = C.ink2;
    ['• Need brown loafers', '• Cream knit (the chunky one)', '• Chest 27in, want it in black'].forEach((l, i) => ctx.fillText(l, 34, 196 + i * 56));
  });
  const noteMesh = new THREE.Mesh(K.rrGeo(1.12, 0.84, 0.05), new THREE.MeshStandardMaterial({ map: note, emissiveMap: note, emissive: new THREE.Color(0.6, 0.6, 0.6), roughness: 0.6 }));
  put(noteMesh, 0.95, -1.75, -0.1, 1.12, 0.84, 0.02);
  const ph = K.phone(A.screen('phone-home'));
  const phoneF = put(ph, 0.02, 0.08, -0.08, 0.8, 1.68, 0.05);
  const cur = K.cursor(); cur.scale.setScalar(0.3);
  const curF = flat(cur, 0.72, 0.09, 0.42, 0.5); curF.inner.rotation.set(-1.1, 0.25, 0.4); s.add(curF.wrap); items.push(curF);

  // Notifications that pop off the phone.
  const icon = A.icon;
  const notes = [
    ['Saved from TikTok', 'Orange parka → Outfits', 1.25, V(-0.42, 0.62, -0.32), -0.1],
    ['3 Pinterest ideas saved', 'Wallpapers · Icons', 1.583, V(0.5, 0.95, 0.12), 0.08],
    ['Synced with Mani’s PC', '40 items · just now', 1.917, V(-0.18, 1.3, 0.55), -0.05]
  ].map(([title, body, t0, to, roll]) => {
    const g = K.glassPanel(1.9, 0.46, 0.13, (ctx, w, h) => {
      const s2 = h / 221;
      ctx.drawImage(icon, 26 * s2, 34 * s2, 150 * s2, 150 * s2);
      ctx.fillStyle = C.ink; ctx.font = `700 ${46 * s2}px ${K.FONT.sans}`; ctx.fillText('Notebook', 206 * s2, 92 * s2);
      K.mono(ctx, 'NOW', w - 36 * s2, 88 * s2, 26 * s2, C.muted, { align: 'right' });
      ctx.fillStyle = C.ink; ctx.font = `600 ${40 * s2}px ${K.FONT.sans}`; ctx.fillText(title, 206 * s2, 146 * s2);
      ctx.fillStyle = C.lilac; ctx.font = `400 ${34 * s2}px ${K.FONT.sans}`; ctx.fillText(body, 206 * s2, 192 * s2);
    }, { depth: 0.06, color: '#1d1830' });
    s.add(g);
    return { g, t0, to, roll, spin: V(0, 0, 0) };
  });
  // Tumble: each thing lifts and turns its own way.
  const R = rng(11);
  const tumble = items.map(() => ({ delay: R() * 0.35, h: 1.6 + R() * 3.2, dx: (R() - 0.5) * 3, dz: (R() - 0.5) * 2.5, ax: V(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), spin: 2 + R() * 4 }));
  const path = new THREE.CatmullRomCurve3([V(0.05, 3.3, 0.4), V(1.3, 2.7, 2.2), V(0.7, 1.55, 3.4), V(-1.5, 1.0, 2.7)]);
  const q = new THREE.Quaternion();

  function update(t) {
    ph.userData.face.material.map = A.screen(t < 1.6 ? 'phone-home' : 'phone-grid');
    const tu = clamp((t - 3.0) / 1.5);
    items.forEach((f, i) => {
      const k = tumble[i], a = clamp((t - 3.0 - k.delay) / 1.2), e = inCubic(a);
      f.wrap.position.set(f.base.x + k.dx * e, f.base.y + k.h * e, f.base.z + k.dz * e);
      f.wrap.quaternion.setFromAxisAngle(V(0, 1, 0), f.base.yaw).multiply(q.setFromAxisAngle(k.ax, k.spin * e));
      if (f.shadow) { f.shadow.material.opacity = 0.55 * (1 - clamp(e * 3)); f.shadow.position.x = f.base.x + 0.07 + k.dx * e; f.shadow.position.z = f.base.z + 0.09 + k.dz * e; }
    });
    notes.forEach((n, i) => {
      const a = range(t, n.t0, n.t0 + 0.9), sp = spring(a, 2.3, 5.2);
      n.g.visible = t >= n.t0;
      const from = V(phoneF.base.x, 0.08, phoneF.base.z);
      n.g.position.lerpVectors(from, n.to, sp);
      n.g.scale.setScalar(lerp(0.2, 1, sp));
      n.g.rotation.set(-Math.PI / 2 + 0.3 * sp, 0, n.roll + (1 - sp) * 0.4);
      const e = inCubic(clamp((t - 3.0 - i * 0.08) / 1.1));
      n.g.position.add(V((i - 1) * 2.2 * e, 3.5 * e, 2.4 * e));
      n.g.rotation.x += e * 1.6; n.g.rotation.z += e * (i - 1) * 1.2;
    });
    // Camera: slow top-down drift, then the swoop, then the whip.
    if (t < 3) {
      const u = inOutCubic(range(t, 0, 3)), a = lerp(-0.14, 0.06, u);
      aim(cam, V(lerp(0.3, 0.05, u), lerp(4.2, 3.3, u), lerp(0.75, 0.4, u)), V(0, 0, 0.1), { up: V(Math.sin(a), 0, -Math.cos(a)), fov: 38 });
    } else {
      const u = inOutCubic(range(t, 3, 4.2)), pos = path.getPoint(u), look = V(0, 0, 0.1).lerp(V(0, 0.9, 0), u);
      const w = inExpo(range(t, 4.18, 4.5)) * 1.7, dir = look.clone().sub(pos).applyAxisAngle(V(0, 1, 0), w);
      aim(cam, pos, pos.clone().add(dir), { up: V(0, 0, -1).lerp(V(0, 1, 0), smooth(u)), roll: Math.sin(u * Math.PI) * 0.55 + tu * 0.1, fov: 38 });
    }
  }
  return { scene: s, cam, update };
}

// ——— 2. Office: the PC. The cursor flies to the paste bar, the glass Save button, the board bursts out.
function office(A) {
  const s = stage(A, '#09080c', 0.35), cam = camera(38);
  const floor = surface(A, 24, { seed: 7, base: 13, rough: 0.55, repeat: 4 }); s.add(floor);
  const wallT = K.drawTex(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0b0a0f'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.28, h * 0.32, 0, w * 0.28, h * 0.32, w * 0.42); g.addColorStop(0, 'rgba(190,168,255,.42)'); g.addColorStop(0.5, 'rgba(120,92,230,.14)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(210,196,255,.07)'; for (let i = 0; i < 4; i++) ctx.fillRect(w * 0.12 + i * 70, h * 0.08, 46, h * 0.5);
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshBasicMaterial({ map: wallT })); wall.position.set(0, 3.2, -2.4); s.add(wall);
  keyLights(s, { key: 1.6, keyPos: V(-4, 5, 4), rim: 26, rimPos: V(2.6, 3.2, -1.2) });
  const scr = new THREE.PointLight('#bba6ff', 6, 5, 1.6); scr.position.set(0, 2.9, 2.6); s.add(scr);
  const mon = K.monitor(A.screen('desktop-paste')); s.add(mon);
  const screenGlow = K.glow(6, '#8f73ff', 0.35); screenGlow.rotation.x = -Math.PI / 2; screenGlow.position.set(0, 0.006, 0.9); s.add(screenGlow);
  // Keyboard with a drawn key grid.
  const keysT = K.drawTex(1024, 300, (ctx, w, h) => { ctx.fillStyle = '#16151b'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#22212a'; for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) { K.rr(ctx, 14 + c * 66.5, 14 + r * 56, 58, 48, 8); ctx.fill(); } });
  const kb = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.045, 0.62), [0, 0, 1, 0, 0, 0].map((f) => new THREE.MeshStandardMaterial(f ? { map: keysT, roughness: 0.6 } : { color: 0x141318, roughness: 0.5 })));
  kb.position.set(0, 0.024, 1.05); s.add(kb);
  const ph = K.phone(A.screen('phone-grid')); const phF = flat(ph, 2.15, 0.05, 0.95, -0.35, { sw: 0.8, sh: 1.68 }); s.add(phF.wrap); s.add(phF.shadow);
  // Saved photos floating round the screen.
  const R = rng(21), floaters = [
    ['Aurora wallpaper', -2.7, 2.35, 0.7], ['Hat and guitar outfit', 2.55, 2.55, 0.3], ['Strawberries icon', -3.0, 0.95, 1.5], ['Pink galaxy wallpaper', 2.9, 1.15, 1.35],
    ['Escalator city', -1.9, 2.95, -0.6], ['Late sun portrait', 1.95, 0.65, 2.1], ['Stripes icon', 0.5, 3.0, 0.8]
  ].map(([n, x, y, z]) => { const p = A.photo(n), w = 0.55 + R() * 0.3, c = K.card(p.tex, w, w * p.h / p.w); c.position.set(x, y, z); c.userData.b = { x, y, z, ph: R() * 6, ry: (R() - 0.5) * 0.8, rz: (R() - 0.5) * 0.5 }; s.add(c); return c; });
  const cur = K.cursor(); s.add(cur);
  // The glass Save button.
  const faceSave = (saved) => (ctx, w, h) => {
    const k = h / 307;
    ctx.strokeStyle = C.lilac; ctx.lineWidth = 7 * k; ctx.lineCap = 'round';
    const lx = 78 * k, ly = h / 2; ctx.save(); ctx.translate(lx, ly); ctx.rotate(-Math.PI / 4);
    K.rr(ctx, -40 * k, -15 * k, 46 * k, 30 * k, 15 * k); ctx.stroke(); K.rr(ctx, -6 * k, -15 * k, 46 * k, 30 * k, 15 * k); ctx.stroke(); ctx.restore();
    ctx.fillStyle = saved ? C.lilac : C.ink2; ctx.font = `500 ${31 * k}px ${K.FONT.mono}`; ctx.fillText('tiktok.com/@mani/video/74…', 140 * k, h / 2 + 11 * k);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(640 * k, 60 * k, 3 * k, h - 120 * k);
    ctx.fillStyle = saved ? C.lilac : C.ink; ctx.font = `800 ${128 * k}px ${K.FONT.sans}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(saved ? 'Saved' : 'Save', 880 * k, h / 2 + 6 * k);
    if (saved) { ctx.strokeStyle = C.lilac; ctx.lineWidth = 12 * k; ctx.beginPath(); ctx.moveTo(1040 * k, 150 * k); ctx.lineTo(1062 * k, 176 * k); ctx.lineTo(1098 * k, 126 * k); }
  };
  const save = K.glassPanel(2.3, 0.64, 0.32, [faceSave(false), faceSave(true)], { depth: 0.16, color: '#221b3a', px: 480 });
  save.position.set(0, 1.35, 0.9); s.add(save);
  const ringM = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.0, 96), new THREE.MeshBasicMaterial({ color: C.lilac, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ringM.position.set(0, 1.35, 0.95); s.add(ringM);
  const saveGlow = K.glow(4.2, '#7d5cff', 0.55); saveGlow.position.set(0, 1.35, 0.7); s.add(saveGlow);
  // The board's cards, ready to lift out of the screen, and the screen with their spaces left empty.
  const cardsInfo = A.cards.cards.filter((c) => A.photoByName(c.title));
  const holes = A.screenHoles;
  const lifted = cardsInfo.map((c, i) => {
    const p = A.photoByName(c.title), w = (c.w / 1600) * 3.2, h = (c.h / 1000) * 2.0;
    const m = K.card(p.tex, w, h, { r: 0.025, glow: 0.6 }); const at = K.onScreen(c.x + c.w / 2, c.y + c.h / 2); at.z = 0.045;
    m.position.copy(at); m.visible = false; s.add(m);
    const R2 = rng(40 + i), out = V(at.x * 0.9 + (R2() - 0.5) * 1.6, (at.y - 1.35) * 0.8 + (R2() - 0.3) * 1.2, 3.2 + R2() * 2.4);
    return { m, at, out, t0: 7.95 + i * 0.05, spin: V((R2() - 0.5) * 5, (R2() - 0.5) * 6, (R2() - 0.5) * 4) };
  });
  const extra = ['Canyon wallpaper', 'Blue peak wallpaper', 'Red beanie outfit', 'Jellyfish icon', 'Old alley city', 'Deep wave wallpaper', 'Auburn portrait', 'Curves icon', 'Puffer by the lake outfit', 'Lighthouse wallpaper'].map((n, i) => {
    const p = A.photo(n), w = 0.5 + (i % 3) * 0.12, m = K.card(p.tex, w, w * p.h / p.w, { glow: 0.6 }); m.visible = false; s.add(m);
    const R2 = rng(90 + i), a = (i / 10) * Math.PI * 2 + R2() * 0.4;
    return { m, at: V(0, 1.35, 0.1), out: V(Math.cos(a) * (2.2 + R2() * 1.6), 1.35 + Math.sin(a) * (1.4 + R2()), 1.8 + R2() * 2.6), t0: 8.1 + i * 0.035, spin: V((R2() - 0.5) * 6, (R2() - 0.5) * 6, (R2() - 0.5) * 6) };
  });
  const cpath = new THREE.CatmullRomCurve3([V(-3.8, 3.1, 2.8), V(-2.5, 2.2, 2.3), V(-1.7, 2.65, 1.3), V(-1.1, 1.92, 0.32)]);
  const paste = K.onScreen(160, 192);

  function update(t) {
    const face = mon.userData.face.material;
    face.map = t < 6.5 ? A.screen('desktop-paste') : t < 7.5 ? A.screenBlur : t < 7.95 ? A.screen('desktop-all') : holes;
    floaters.forEach((c, i) => { const b = c.userData.b; c.position.set(b.x + Math.sin(t * 0.7 + b.ph) * 0.12, b.y + Math.sin(t * 0.9 + b.ph) * 0.1, b.z); c.rotation.set(Math.sin(t * 0.5 + b.ph) * 0.2, b.ry + Math.sin(t * 0.6 + i) * 0.25, b.rz); c.visible = t < 7.5; });
    save.visible = ringM.visible = saveGlow.visible = t >= 6.5 && t < 7.5;
    // Cursor
    if (t < 6.5) {
      const u = inOutCubic(range(t, 4.75, 6.3)), p = cpath.getPoint(u);
      p.y += Math.sin(t * 5) * 0.015 * (1 - u);
      cur.position.copy(t > 6.3 ? paste.clone().add(V(0.14, -0.1, 0.24)) : p);
      cur.rotation.set(0.2 - u * 0.15, 0.5 - u * 0.4, 0.15 + Math.sin(t * 3) * 0.08);
      cur.scale.setScalar(0.3);
      cur.visible = t >= 4.75;
    } else if (t < 7.5) {
      const u = outCubic(range(t, 6.55, 6.95)), press = bump(t, 7.0, 7.14), back = inCubic(range(t, 7.15, 7.5));
      cur.position.lerpVectors(V(1.7, 0.5, 1.8), V(0.6, 1.2, 1.13), u).add(V(0.3 * back, -0.25 * back, 0.3 * back - press * 0.06));
      cur.rotation.set(0.1, -0.35, 0.25 - press * 0.1); cur.scale.setScalar(0.3); cur.visible = true;
    } else cur.visible = false;
    // Save button
    if (save.visible) {
      const u = outCubic(range(t, 6.5, 7.5)), press = bump(t, 7.0, 7.22);
      save.rotation.set(-0.05 + press * 0.04, lerp(0.3, 0.08, u), 0);
      save.scale.setScalar(1 - press * 0.07); save.position.z = 0.9 - press * 0.05;
      save.userData.show(t >= 7.04 ? 1 : 0);
      const r = range(t, 7.0, 7.45); ringM.visible = r > 0 && r < 1; ringM.scale.set(1.2 + outCubic(r) * 1.6, 0.4 + outCubic(r) * 1.2, 1); ringM.material.opacity = (1 - r) * 0.9;
      saveGlow.material.opacity = 0.35 + bump(t, 7.0, 7.4) * 0.8;
    }
    // Cards burst out of the screen
    for (const L of [...lifted, ...extra]) {
      const a = range(t, L.t0, L.t0 + 1.1), e = outCubic(a);
      L.m.visible = t >= L.t0 && t < 9;
      L.m.position.lerpVectors(L.at, L.out, e); L.m.position.y -= 0.6 * a * a;
      L.m.rotation.set(L.spin.x * e * 0.5, L.spin.y * e * 0.5, L.spin.z * e * 0.5);
    }
    // Camera
    if (t < 6.5) {
      const u = inOutCubic(range(t, 4.6, 6.5)), land = 1 - outExpo(range(t, 4.5, 5.05));
      const pos = V(-2.6, 1.25, 4.6).lerp(V(-1.45, 1.8, 2.45), u), look = V(-0.6, 1.5, 0).lerp(V(-1.15, 1.95, 0), u);
      const dir = look.clone().sub(pos).applyAxisAngle(V(0, 1, 0), -1.4 * land * land);
      aim(cam, pos, pos.clone().add(dir), { roll: lerp(0.12, 0.02, u) + land * 0.25, fov: 38 });
    } else if (t < 7.5) {
      const u = outCubic(range(t, 6.5, 7.5)), shake = bump(t, 7.0, 7.12) * 0.02;
      aim(cam, V(0.55, 1.52, 4.1).lerp(V(0.18, 1.42, 3.55), u).add(V(0, shake, 0)), V(0.05, 1.33, 0.9), { roll: -0.03, fov: 32 });
    } else {
      const u = inOutCubic(range(t, 7.5, 9));
      aim(cam, V(2.7, 0.55, 3.6).lerp(V(1.95, 0.72, 3.0), u), V(-0.3, 1.3, 0), { roll: lerp(-0.09, -0.03, u), fov: 36 });
    }
  }
  return { scene: s, cam, update };
}

// ——— 3. Macro: the stroke draws round the parka; the labels the app found pop up.
function macro(A) {
  const s = stage(A, '#08070b', 0.45), cam = camera(36);
  s.add(surface(A, 30, { seed: 9, base: 12, repeat: 6 }));
  keyLights(s, { key: 1.3, keyPos: V(-2, 5, 3), rim: 16, rimPos: V(2, 1.5, -2), fill: 0.3 });
  const p = A.photo('Orange parka outfit'), W = 3.0, H = W * p.h / p.w;
  const photo = flat(K.card(p.tex, W, H, { r: 0.08, glow: 0.42 }), 0, 0.01, 0, 0, { sw: W, sh: H }); s.add(photo.wrap); s.add(photo.shadow);
  const uv = (u, v, y = 0.05) => V((u - 0.5) * W, y, -(v - 0.5) * H);
  const pts = [];
  for (let i = 0; i <= 44; i++) { const k = i / 44, a = -0.5 + k * Math.PI * 2 * 1.1, r = 1 + 0.05 * Math.sin(k * 17); pts.push(uv(0.49 + Math.cos(a) * 0.27 * r, 0.7 + Math.sin(a) * 0.13 * r, 0.05 + 0.01 * Math.sin(k * 9))); }
  pts.push(uv(0.84, 0.52), uv(0.9, 0.36), uv(0.82, 0.24));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const SEG = 420, RAD = 8;
  const stroke = new THREE.Mesh(new THREE.TubeGeometry(curve, SEG, 0.03, RAD, false), new THREE.MeshBasicMaterial({ color: '#C8B6FF', toneMapped: false })); s.add(stroke);
  const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, SEG, 0.085, RAD, false), new THREE.MeshBasicMaterial({ color: '#7a5cff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); s.add(halo);
  const pen = K.cursor(); s.add(pen);
  const chip = (text, dot) => {
    const w = 0.34 + text.length * 0.115;
    return K.glassPanel(w, 0.36, 0.18, (ctx, cw, ch) => {
      const k = ch / 173; let x = 40 * k;
      if (dot === 'check') { ctx.strokeStyle = C.accent; ctx.lineWidth = 9 * k; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, 88 * k); ctx.lineTo(x + 18 * k, 108 * k); ctx.lineTo(x + 48 * k, 66 * k); ctx.stroke(); x += 72 * k; }
      else if (dot) { ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(x + 18 * k, ch / 2, 18 * k, 0, Math.PI * 2); ctx.fill(); x += 56 * k; }
      ctx.fillStyle = C.ink; ctx.font = `600 ${70 * k}px ${K.FONT.sans}`; ctx.textBaseline = 'middle'; ctx.fillText(text, x, ch / 2 + 4 * k);
    }, { depth: 0.05, color: '#1c1a24' });
  };
  const chips = [['Outfit', 'check', 0.12, 9.6], ['Orange', '#D9892E', 0.36, 9.85], ['Parka', null, 0.6, 10.1], ['Streetwear', C.accent, 0.84, 10.35]].map(([txt, dot, at, t0]) => {
    const g = chip(txt, dot); s.add(g);
    const i = [0.12, 0.36, 0.6, 0.84].indexOf(at);
    return { g, base: uv(1.04 + (i % 2) * 0.12, 0.92 - i * 0.21, 0.42 + i * 0.04), t0 };
  });

  function update(t) {
    const pr = inOutCubic(range(t, 9.35, 10.35));
    const n = Math.floor(pr * SEG) * RAD * 6;
    stroke.geometry.setDrawRange(0, n); halo.geometry.setDrawRange(0, n);
    const head = curve.getPointAt(Math.max(0.0001, pr));
    const off = inCubic(range(t, 10.4, 10.9));
    pen.position.copy(head).add(V(0.05 + off * 2, 0.02 + off * 1.5, 0.02 - off));
    pen.rotation.set(-0.9, 0.4, 0.3 + Math.sin(t * 7) * 0.05); pen.scale.setScalar(0.42);
    pen.visible = t < 10.9;
    chips.forEach((c) => {
      const sp = spring(range(t, c.t0, c.t0 + 0.8), 2.3, 5);
      c.g.visible = t >= c.t0;
      c.g.position.copy(c.base).add(V(0, -0.3 * (1 - sp), 0));
      c.g.scale.setScalar(Math.max(0.001, sp));
      c.g.lookAt(cam.position); c.g.rotateZ((1 - sp) * 0.5);
    });
    const follow = curve.getPointAt(clamp(pr * 0.95));
    const a = (t - 9.25) * 0.35;
    const fpos = follow.clone().add(V(-1.6 * Math.cos(a) + 0.2, 1.05, 2.0 * Math.cos(a * 0.7))), flook = follow.clone().add(V(0.25, 0, -0.25));
    const m = inOutCubic(range(t, 10.3, 11.0));
    aim(cam, fpos.lerp(V(0.9, 4.4, 3.6), m), flook.lerp(V(0.45, 0, 0.1), m), { roll: lerp(0.18, 0, m), fov: lerp(34, 38, m) });
  }
  return { scene: s, cam, update };
}

// ——— 4. Board: overhead, a real-looking board; the ribbon sweeps through and lifts the cards it passes.
function board(A) {
  const s = stage(A, '#09080c', 0.45), cam = camera(40);
  s.add(surface(A, 40, { seed: 5, base: 11, repeat: 7 }));
  keyLights(s, { key: 2.0, keyPos: V(-3, 7, 2), rim: 24, rimPos: V(0, 2.5, -2) });
  const cols = [-2.24, -1.12, 0, 1.12, 2.24], top = [-3.3, -3.55, -3.2, -3.5, -3.3], cards = [];
  let k = 0;
  while (Math.min(...top) < 5.2 && k < 60) {
    const ci = top.indexOf(Math.min(...top)), p = A.photos[(k * 7) % A.photos.length], w = 1.0, h = w * p.h / p.w;
    const f = flat(K.card(p.tex, w, h, { r: 0.05 }), cols[ci], 0.01, top[ci] + h / 2, 0, { sw: w, sh: h, shadowOpacity: 0.5 });
    s.add(f.wrap); s.add(f.shadow); cards.push(f); top[ci] += h + 0.12; k++;
  }
  const title = K.drawTex(1400, 300, (ctx, w, h) => { ctx.fillStyle = C.ink; ctx.font = `400 230px ${K.FONT.poster}`; ctx.textBaseline = 'alphabetic'; ctx.fillText('ALL ITEMS', 0, 250); K.mono(ctx, '40 ITEMS', 1130, 250, 40, C.muted); });
  const tm = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), new THREE.MeshBasicMaterial({ map: title, transparent: true, toneMapped: false }));
  tm.rotation.x = -Math.PI / 2; tm.position.set(-0.6, 0.01, -4.05); s.add(tm);
  const curve = new THREE.CatmullRomCurve3([V(-5.5, 0.5, 4.6), V(-2.6, 0.85, 2.9), V(-0.6, 0.5, 1.9), V(1.2, 0.95, 1.1), V(1.7, 0.7, -0.3), V(0.6, 1.15, -1.1), V(-0.4, 0.8, -0.3), V(0.3, 0.6, 0.6), V(1.6, 0.9, -1.4), V(2.9, 0.7, -2.9), V(6, 0.9, -4.8)], false, 'centripetal');
  const rib = K.ribbon(curve, { segments: 600, width: 0.34, twist: 5 }); s.add(rib);
  function update(t) {
    const hp = inOutCubic(range(t, 11.25, 12.9)), head = curve.getPointAt(clamp(hp, 0.0001, 1));
    rib.userData.reveal(Math.max(0, hp - 0.6), hp);
    for (const f of cards) {
      const d2 = (f.base.x - head.x) ** 2 + (f.base.z - head.z) ** 2, lift = Math.exp(-d2 / 0.9) * 0.55 * (hp > 0 && hp < 1 ? 1 : 0);
      f.wrap.position.y = 0.01 + lift; f.inner.rotation.set(-Math.PI / 2 + lift * 0.5, lift * 0.4, 0);
      f.shadow.material.opacity = 0.5 * (1 - lift);
    }
    const u = inOutCubic(range(t, 11.25, 13));
    const pos = V(-2.8, 4.9, 5.4).lerp(V(2.4, 4.3, -0.2), u), look = head.clone().lerp(V(0.3, 0, 0), 0.45);
    aim(cam, pos, look, { roll: lerp(-0.22, 0.12, u), fov: 40 });
  }
  return { scene: s, cam, update };
}

// ——— 5. Ideas: pins fly in, then "so many ideas." in puffy 3D.
function ideas(A) {
  const s = stage(A, gradientBg('#0f0c18', '#060508', [0.5, 0.45], 'rgba(130,100,255,.30)', 1.1), 0.5), cam = camera(38);
  keyLights(s, { key: 1.7, keyPos: V(2, 3, 5), rim: 40, rimPos: V(-1, 2, -3), fill: 0.45 });
  const back = new THREE.PointLight('#b39dff', 30, 12, 1.2); back.position.set(2.5, -1.5, 2); s.add(back);
  const R = rng(55), cloud = new THREE.Group(); s.add(cloud);
  const pins = A.photos.filter((p) => p.board !== 'Icons').slice(0, 26).map((p, i) => {
    let x, y, z;
    do { x = (R() - 0.5) * 11; y = (R() - 0.5) * 6.4; z = -4.5 + R() * 5.5; } while (Math.abs(x) < 2.9 && Math.abs(y) < 1.8 && z > -2.5);
    const w = 0.8 + R() * 0.45, c = K.card(p.tex, w, w * p.h / p.w, { glow: 0.55 }); cloud.add(c);
    const to = V(x, y, z), from = to.clone().normalize().multiplyScalar(14).add(V(0, 0, 4));
    return { c, to, from, t0: 13.0 + i * 0.028, r0: V((R() - 0.5) * 6, (R() - 0.5) * 6, (R() - 0.5) * 6), r1: V((R() - 0.5) * 0.5, (R() - 0.5) * 0.7, (R() - 0.5) * 0.4) };
  });
  const words = [['so', C.accent, 0.85, V(-1.8, 1.05, 0.6), 13.5], ['many', '#B7A0FF', 1.5, V(0.1, -0.02, 0), 14.0], ['ideas.', '#E2D9FF', 1.0, V(1.25, -1.3, 0.45), 14.5]].map(([txt, col, size, at, t0]) => {
    const g = K.word3d(A.font3d, txt, size, col); g.position.copy(at); s.add(g); return { g, at, t0 };
  });
  function update(t) {
    cloud.rotation.y = (t - 13) * 0.1;
    for (const p of pins) {
      const a = range(t, p.t0, p.t0 + 0.75), e = outExpo(a);
      p.c.visible = t >= p.t0; p.c.position.lerpVectors(p.from, p.to, e);
      p.c.position.y += Math.sin(t * 1.3 + p.t0 * 9) * 0.06;
      p.c.rotation.set(lerp(p.r0.x, p.r1.x, e), lerp(p.r0.y, p.r1.y, e) + Math.sin(t + p.t0) * 0.1, lerp(p.r0.z, p.r1.z, e));
    }
    words.forEach((w, i) => {
      const sp = spring(range(t, w.t0, w.t0 + 0.9), 2.2, 4.6);
      w.g.visible = t >= w.t0; w.g.scale.setScalar(Math.max(0.001, sp));
      w.g.rotation.set(Math.sin(t * 1.4 + i) * 0.08, (1 - sp) * 1.3 + Math.sin(t * 0.9 + i) * 0.12, (1 - sp) * -0.4 + Math.sin(t * 1.1 + i * 2) * 0.04);
    });
    const u = inOutCubic(range(t, 13, 14.8)), push = inExpo(range(t, 14.85, 15.4));
    const pos = V(0.7, 0.45, 11).lerp(V(0.2, 0.05, 8.3), u); pos.z = lerp(pos.z, 0.7, push); pos.x = lerp(pos.x, 0.25, push);
    aim(cam, pos, V(0, 0, 0), { roll: lerp(0.05, -0.03, u) + push * 0.2, fov: 38 });
  }
  return { scene: s, cam, update };
}

// ——— 6. Sky: the phone floats in violet haze; "Anywhere." behind it; the info card comes up later (HUD).
function sky(A) {
  const s = stage(A, gradientBg('#1a1530', '#07060a', [0.72, 0.12], 'rgba(205,189,255,.35)', 0.9), 0.8), cam = camera(38);
  keyLights(s, { key: 2.6, keyPos: V(3, 4, 5), rim: 30, rimPos: V(-2, 1, -2), fill: 0.7 });
  const fog = K.tex(K.noiseCanvas(256, 256, { scale: 42, octaves: 5, seed: 12, fn: (n, x, y) => { const d = Math.hypot(x - 0.5, y - 0.5) * 2; const a = Math.max(0, (n - 0.35) * 2.2) * Math.max(0, 1 - d * d) * 255; return [255, 255, 255, a]; } }));
  const R = rng(77);
  const clouds = Array.from({ length: 18 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: fog, color: R() > 0.5 ? '#5b4f8f' : '#352d58', transparent: true, opacity: 0.25 + R() * 0.35, depthWrite: false }));
    const sz = 4 + R() * 6; m.scale.set(sz * 1.6, sz, 1);
    m.userData = { x: (R() - 0.5) * 16, y: (R() - 0.5) * 7 - 0.5, z: -12 + R() * 12, v: 0.4 + R() * 0.8, ph: R() * 6 }; s.add(m); return m;
  });
  const rayT = K.drawTex(64, 512, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, { srgb: false });
  const rays = [0, 1, 2, 3].map((i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5 + i * 0.3, 14), new THREE.MeshBasicMaterial({ map: rayT, color: '#cbb9ff', transparent: true, opacity: 0.05 + i * 0.015, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.set(4.5 - i * 1.3, 3.5, -6); m.rotation.z = 0.55 + i * 0.07; s.add(m); return m; });
  const ph = K.phone(A.screen('phone-grid')); ph.scale.setScalar(1.3); s.add(ph);
  const phGlow = K.glow(4, '#8b6cff', 0.35); phGlow.position.z = -0.4; s.add(phGlow);
  const any = K.flatWord('Anywhere.', { font: `800 200px ${K.FONT.sans}`, color: C.ink, height: 1.3 }); any.position.set(0, 0.25, -1.5); s.add(any);
  const pc = K.flatWord('on your PC', { font: `700 200px ${K.FONT.sans}`, color: C.accent, height: 0.3, spacing: -0.005 }); pc.position.set(-2.05, -0.72, -1.2); s.add(pc);
  const pho = K.flatWord('on your phone', { font: `700 200px ${K.FONT.sans}`, color: C.accent, height: 0.3, spacing: -0.005 }); pho.position.set(2.2, -0.72, -1.2); s.add(pho);
  const reveal = (w, t0, gap, rise) => w.userData.letters.forEach((m, i) => { const a = outCubic(range(Tnow, t0 + i * gap, t0 + i * gap + 0.45)); m.position.y = -rise * (1 - a); m.material.opacity = a; m.visible = a > 0; });
  let Tnow = 0;
  function update(t) {
    Tnow = t; const lt = t - 15.667;
    clouds.forEach((m) => { const d = m.userData; m.position.set(d.x + Math.sin(lt * 0.3 + d.ph) * 0.4 - lt * 0.25, d.y, d.z + lt * d.v); });
    rays.forEach((m, i) => { m.material.opacity = (0.05 + i * 0.015) * (0.7 + 0.3 * Math.sin(lt * 1.3 + i)); });
    const enter = spring(range(t, 15.667, 16.5), 1.6, 4.5);
    ph.position.set(0, lerp(-2.2, 0.1, enter) + Math.sin(lt * 1.6) * 0.05, 0);
    ph.rotation.set(0.14 + Math.sin(lt * 0.8) * 0.05, Math.sin(lt * 1.05) * 0.42 - 0.12 + (1 - enter) * 0.8, Math.sin(lt * 0.9) * 0.06);
    phGlow.position.set(0, ph.position.y, -0.4);
    reveal(any, 15.8, 0.045, 0.9); reveal(pc, 16.35, 0.02, 0.3); reveal(pho, 16.5, 0.02, 0.3);
    const lift = outCubic(range(t, 17.5, 17.95));
    const u = inOutCubic(range(t, 15.667, 18.5));
    const pos = V(0, 0.1, 6.3).lerp(V(0.3, 0.2, 5.5), u); pos.y -= lift * 1.25;
    aim(cam, pos, V(0, 0.1 - lift * 1.25, 0), { fov: 38, roll: Math.sin(lt * 0.5) * 0.02 });
  }
  return { scene: s, cam, update };
}

// ——— 7. Ring: a board tile, the halftone ring round it, "sorted." slides behind; the tile opens.
function ring(A) {
  const s = stage(A, gradientBg('#110e1d', '#060508', [0.5, 0.5], 'rgba(157,123,255,.22)', 0.8), 0.7), cam = camera(36);
  keyLights(s, { key: 2.8, keyPos: V(-2, 3, 5), rim: 30, rimPos: V(2, 1, -2), fill: 0.6 });
  const outfits = A.photos.filter((p) => p.board === 'Outfits');
  const four = [outfits[1], outfits[0], outfits[7], outfits[2]];
  const faceT = K.drawTex(1150, 750, (ctx, w, h) => {
    ctx.fillStyle = C.surface; K.rr(ctx, 0, 0, w, h, 40); ctx.fill();
    four.forEach((p, i) => { const x = 36 + (i % 2) * 546, y = 36 + Math.floor(i / 2) * 256, cw = 532, ch = 244; ctx.save(); K.rr(ctx, x, y, cw, ch, 22); ctx.clip(); const img = p.tex.image, a = img.width / img.height, sw = Math.min(img.width, img.height * cw / ch), sh = sw * ch / cw; ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2.6, sw, sh, x, y, cw, ch); ctx.restore(); });
    ctx.strokeStyle = C.ink; ctx.lineWidth = 6; [[60, 612], [92, 612], [60, 644], [92, 644]].forEach(([x, y]) => { K.rr(ctx, x, y, 24, 24, 5); ctx.stroke(); });
    ctx.fillStyle = C.ink; ctx.font = `700 76px ${K.FONT.sans}`; ctx.fillText('Outfits', 150, 662);
    K.mono(ctx, '12 ITEMS', w - 44, 656, 34, C.muted, { align: 'right' });
  });
  const tile = new THREE.Group(); s.add(tile);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(K.rrShape(2.3, 1.5, 0.12), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 4, curveSegments: 12 }), new THREE.MeshPhysicalMaterial({ color: '#17161c', roughness: 0.3, metalness: 0.3, clearcoat: 1 }));
  body.position.z = -0.12; tile.add(body);
  const face = new THREE.Mesh(K.rrGeo(2.3, 1.5, 0.12), new THREE.MeshBasicMaterial({ map: faceT, toneMapped: false })); face.position.z = 0.025; tile.add(face);
  const ringM = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 6.6), new THREE.MeshBasicMaterial({ map: K.halftoneRing(1024, C.accent), transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })); s.add(ringM);
  const word = K.flatWord('sorted.', { font: `400 200px ${K.FONT.poster}`, color: C.lilac, height: 2.1, spacing: 0.02 }); word.position.set(0, 0.1, -1.8); s.add(word);
  const fan = four.map((p, i) => { const c = K.card(p.tex, 0.82, 0.82 * p.h / p.w, { glow: 0.55 }); c.visible = false; s.add(c); return c; });
  function update(t) {
    const lt = t - 18.5, inn = spring(range(t, 18.5, 19.2), 2.0, 5), out = inExpo(range(t, 19.95, 20.333));
    tile.position.set(0, 0.05 + Math.sin(lt * 1.5) * 0.04, out * 3.5);
    tile.rotation.set(lerp(0.9, 0.12, inn) + Math.sin(lt * 1.2) * 0.04 + out * 0.6, lerp(1.6, -0.28, inn) + Math.sin(lt * 0.9) * 0.08, lerp(-0.6, 0.04, inn));
    tile.scale.setScalar(lerp(0.4, 1, inn));
    const ri = outBack(range(t, 18.55, 19.0), 1.4);
    ringM.scale.setScalar(Math.max(0.001, ri) * (1 + out * 1.5));
    ringM.rotation.set(1.08 + Math.sin(lt * 1.3) * 0.12, Math.sin(lt * 1.1) * 0.35, lt * 1.9);
    ringM.position.set(0, 0, 0);
    word.position.x = lerp(5, -5, range(t, 18.55, 20.33) * 0.85 + inOutCubic(range(t, 18.55, 20.33)) * 0.15);
    fan.forEach((c, i) => {
      const a = outBack(range(t, 19.4 + i * 0.06, 19.85 + i * 0.06), 1.3), ang = (i - 1.5) * 0.42;
      c.visible = t >= 19.4 + i * 0.06;
      c.position.set(Math.sin(ang) * 1.5 * a, 0.2 + (0.9 + Math.cos(ang) * 0.4) * a, 0.15 + i * 0.02 + out * (2 + i));
      c.rotation.set(-0.1 * a + out * (i - 1.5), 0, -ang * 0.8 * a + out * 1.5 * (i - 1.5));
      c.scale.setScalar(Math.max(0.001, a));
    });
    const u = inOutCubic(range(t, 18.5, 20.1));
    aim(cam, V(0.4, 0.4, 6.9).lerp(V(0.1, 0.25, 5.6), u).add(V(0, 0, -out * 2.5)), V(0, 0.15, 0), { roll: lerp(0.07, -0.04, u), fov: 36 });
  }
  return { scene: s, cam, update };
}

// ——— 8. The real app: search, then an open photo with its labels.
function ui(A) {
  const s = stage(A, gradientBg('#0c0b12', '#050407', [0.5, 0.5], 'rgba(157,123,255,.25)', 0.9), 0.3), cam = camera(30);
  const mk = (name) => { const m = new THREE.Mesh(K.rrGeo(3.2, 2.0, 0.035), new THREE.MeshBasicMaterial({ map: A.screen(name), toneMapped: false })); s.add(m); return m; };
  const a = mk('desktop-search'), b = mk('desktop-open');
  const back = K.glow(7, '#6d4dff', 0.4); back.position.z = -0.6; s.add(back);
  function update(t) {
    const sl = outExpo(range(t, 21.0, 21.3));
    a.position.set(-4.2 * sl, 0, 0); b.position.set(4.2 * (1 - sl), 0, 0); b.visible = t >= 21.0; a.visible = sl < 1;
    const zin = outExpo(range(t, 20.333, 20.65));
    aim(cam, V(lerp(0.6, 0.05, zin) + range(t, 20.65, 21.667) * 0.08, lerp(-0.4, 0, zin), lerp(10, 4.1, zin) - range(t, 20.65, 21.667) * 0.22), V(lerp(0.3, 0.02, zin), 0, 0), { roll: lerp(-0.12, 0, zin), fov: 30 });
  }
  return { scene: s, cam, update, planes: { a, b } };
}

export function buildShots(A) {
  return { desk: desk(A), office: office(A), macro: macro(A), board: board(A), ideas: ideas(A), sky: sky(A), ring: ring(A), ui: ui(A) };
}
