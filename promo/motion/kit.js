// Building blocks for the film: textures drawn on canvases, rounded cards, the phone, the monitor, glass pills,
// the 3D cursor, puffy 3D words, ribbons. Everything is made in code; the only pictures are the app's own
// screens and the mood-board photos.
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { TextGeometry } from './vendor/TextGeometry.js';

export const C = {
  bg: '#0A0A0A', deep: '#050505', surface: '#151515', surface2: '#1C1C1C', ink: '#F2F2F2', ink2: '#C8C8C8', muted: '#9A9A9A',
  accent: '#9D7BFF', lilac: '#CDBDFF', pale: '#E9E2FF', violet: '#6C4CF0', night: '#0D0B14'
};
export const FONT = { sans: 'Figtree, sans-serif', poster: 'Anton, Impact, sans-serif', mono: '"IBM Plex Mono", monospace' };

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function tex(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
export function drawTex(w, h, draw, opts) { const c = canvas(w, h); draw(c.getContext('2d'), w, h); return tex(c, opts); }

export function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Seeded value noise (fbm) for the desk, clouds and paper.
export function noiseCanvas(w, h, { scale = 64, octaves = 4, seed = 1, fn } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
  const G = 256, grid = new Float32Array(G * G); let s = seed * 9973;
  for (let i = 0; i < G * G; i++) { s = (s * 16807) % 2147483647; grid[i] = s / 2147483647; }
  const at = (x, y) => grid[((y & (G - 1)) * G) + (x & (G - 1))];
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0, a = 0.5, f = 1 / scale;
    for (let o = 0; o < octaves; o++) { n += a * vn(x * f, y * f); a *= 0.5; f *= 2; }
    const [r, g, b, al] = fn(n, x / w, y / h), i = (y * w + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = al;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function rrShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
export function rrGeo(w, h, r, seg = 8) {
  const g = new THREE.ShapeGeometry(rrShape(w, h, r), seg), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  return g;
}

// A texture showing the picture "object-fit: cover" in a w:h frame.
export function cover(t, aspect) {
  const c = t.clone(), img = t.image, a = img.width / img.height;
  if (a > aspect) { c.repeat.set(aspect / a, 1); c.offset.set((1 - aspect / a) / 2, 0); } else { c.repeat.set(1, a / aspect); c.offset.set(0, (1 - a / aspect) / 2); }
  c.needsUpdate = true;
  return c;
}

// Photo material: lit (so 3D light plays on it) but mostly self-lit, so the pictures stay true in a dark set.
export function photoMat(map, glow = 0.5) {
  return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color(glow, glow, glow), roughness: 0.72, metalness: 0, envMapIntensity: 0.25 });
}

// A mood-board card: the photo with the app's rounded corners, on a thin dark edge.
export function card(map, w, h, { r = 0.06, glow = 0.5, edge = true } = {}) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(rrGeo(w, h, r), photoMat(cover(map, w / h), glow));
  g.add(face);
  if (edge) { const back = new THREE.Mesh(rrGeo(w + 0.024, h + 0.024, r + 0.012), new THREE.MeshStandardMaterial({ color: 0x0b0a0f, roughness: 0.5, side: THREE.DoubleSide })); back.position.z = -0.006; g.add(back); }
  g.userData = { w, h, face };
  return g;
}

let shadowT = null;
export function shadow(w, h, { soft = 0.35, opacity = 0.6 } = {}) {
  if (!shadowT) shadowT = drawTex(256, 256, (ctx) => { ctx.filter = 'blur(22px)'; ctx.fillStyle = '#000'; rr(ctx, 48, 48, 160, 160, 26); ctx.fill(); }, { srgb: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * (1 + soft * 1.6), h * (1 + soft * 1.6)), new THREE.MeshBasicMaterial({ map: shadowT, color: 0x000000, transparent: true, opacity, depthWrite: false }));
  m.renderOrder = -1;
  return m;
}

let glowT = null;
export function glowTex() {
  if (!glowT) glowT = drawTex(256, 256, (ctx) => { const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256); }, { srgb: false });
  return glowT;
}
export function glow(size, color, opacity = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: glowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  return m;
}

// The phone: dark metal body with the real phone screen.
export function phone(screen) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.8, 1.68, 0.09, 5, 0.1), new THREE.MeshPhysicalMaterial({ color: 0x1b1a21, metalness: 0.75, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
  g.add(body);
  const face = new THREE.Mesh(rrGeo(0.745, 1.616, 0.085), new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }));
  face.position.z = 0.0455; g.add(face);
  const island = new THREE.Mesh(rrGeo(0.19, 0.052, 0.026), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  island.position.set(0, 0.765, 0.0462); g.add(island);
  const glass = new THREE.Mesh(rrGeo(0.745, 1.616, 0.085), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, clearcoat: 1 }));
  glass.position.z = 0.047; g.add(glass);
  g.userData = { face };
  return g;
}

// The PC monitor with the real desktop screen (screen 3.2 x 2.0, centre 1.35 above the desk).
export function monitor(screen) {
  const g = new THREE.Group(), dark = new THREE.MeshPhysicalMaterial({ color: 0x141319, metalness: 0.6, roughness: 0.35, clearcoat: 0.5 });
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(3.3, 2.1, 0.07, 4, 0.03), dark); bezel.position.set(0, 1.35, 0); g.add(bezel);
  const face = new THREE.Mesh(rrGeo(3.2, 2.0, 0.02), new THREE.MeshBasicMaterial({ map: screen, toneMapped: false })); face.position.set(0, 1.35, 0.0365); g.add(face);
  const neck = new THREE.Mesh(new RoundedBoxGeometry(0.28, 1.0, 0.07, 3, 0.02), dark); neck.position.set(0, 0.5, -0.12); g.add(neck);
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.04, 0.62, 3, 0.018), dark); base.position.set(0, 0.02, -0.05); g.add(base);
  g.userData = { face };
  return g;
}
// A point on the monitor's screen from the desktop screenshot's CSS pixels (1600 x 1000).
export const onScreen = (x, y) => new THREE.Vector3((x / 1600 - 0.5) * 3.2, 1.35 + (0.5 - y / 1000) * 2.0, 0.04);

// A glass pill or rounded panel with a face drawn on a canvas.
export function glassPanel(w, h, r, drawFace, { depth = 0.08, color = '#1a1628', px = 480 } = {}) {
  const g = new THREE.Group();
  const bevel = Math.min(depth * 0.45, h * 0.12);
  const geo = new THREE.ExtrudeGeometry(rrShape(w - bevel * 2, h - bevel * 2, Math.max(0.001, r - bevel)), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 18 });
  geo.translate(0, 0, -depth / 2);
  const body = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.16, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, emissive: new THREE.Color(color).multiplyScalar(0.35), iridescence: 0.25 }));
  g.add(body);
  const faces = drawFace ? [].concat(drawFace) : [];
  const planes = faces.map((draw) => {
    const t = drawTex(Math.round(w * px), Math.round(h * px), (ctx, cw, ch) => draw(ctx, cw, ch));
    const m = new THREE.Mesh(rrGeo(w - bevel, h - bevel, r), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false }));
    m.position.z = depth / 2 + bevel + 0.003; g.add(m); return m;
  });
  planes.forEach((p, i) => { p.visible = i === 0; });
  g.userData = { body, planes, show: (i) => planes.forEach((p, k) => { p.visible = k === i; }) };
  return g;
}

// The cursor: the violet 3D pointer that clicks, draws and flies through the film.
export function cursor() {
  const s = new THREE.Shape();
  const P = [[0, 0], [0, -1.0], [0.25, -0.77], [0.44, -1.18], [0.6, -1.11], [0.41, -0.71], [0.73, -0.71]];
  s.moveTo(...P[0]); P.slice(1).forEach((p) => s.lineTo(...p)); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 5, curveSegments: 4 });
  geo.translate(-0.02, 0.05, -0.07);
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(C.accent), roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.1, emissive: new THREE.Color('#3b2a8c'), emissiveIntensity: 0.6, sheen: 0.6, sheenColor: new THREE.Color('#ffffff') }));
  const g = new THREE.Group(); g.add(m); g.scale.setScalar(0.34);
  return g;
}

// Puffy 3D words (the "so many" moment).
export function word3d(font, text, size, color, { depth = 0.2 } = {}) {
  const geo = new TextGeometry(text, { font, size, depth: size * depth, curveSegments: 10, bevelEnabled: true, bevelThickness: size * 0.16, bevelSize: size * 0.075, bevelSegments: 8 });
  geo.computeBoundingBox(); const b = geo.boundingBox;
  geo.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.26, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color('#ffffff'), emissive: new THREE.Color(color).multiplyScalar(0.12) }));
  const g = new THREE.Group(); g.add(m); g.userData = { width: b.max.x - b.min.x };
  return g;
}

// A flat word made of one plane per letter, so letters can rise one by one.
export function flatWord(text, { font = `800 200px ${FONT.sans}`, color = C.ink, height = 1, spacing = -0.02 } = {}) {
  const g = new THREE.Group(), meas = canvas(8, 8).getContext('2d'); meas.font = font;
  const px = 200, scale = height / px, letters = [];
  const widths = [...text].map((ch) => meas.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) * scale + spacing * (text.length - 1);
  let x = -total / 2;
  [...text].forEach((ch, i) => {
    const w = widths[i], cw = Math.ceil(w + 40), ch2 = Math.ceil(px * 1.5);
    const t = drawTex(cw, ch2, (ctx) => { ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(ch, 20, ch2 / 2); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(cw * scale, ch2 * scale), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
    const cx = x + (cw * scale) / 2 - 20 * scale;
    m.position.x = cx; m.userData.x = cx; g.add(m); letters.push(m);
    x += w * scale + spacing;
  });
  g.userData = { letters, width: total };
  return g;
}

// A flat ribbon along a curve, drawn progressively with setDrawRange.
export function ribbon(curve, { segments = 360, width = 0.3, twist = 3, color = C.accent } = {}) {
  const pos = [], idx = [], up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const u = i / segments, p = curve.getPointAt(u), tn = curve.getTangentAt(u);
    let side = new THREE.Vector3().crossVectors(tn, up).normalize();
    side.applyAxisAngle(tn, Math.sin(u * Math.PI * twist) * 1.2);
    const w = width * (0.35 + 0.65 * Math.sin(Math.min(1, u * 8) * Math.PI / 2));
    pos.push(p.x + side.x * w / 2, p.y + side.y * w / 2, p.z + side.z * w / 2, p.x - side.x * w / 2, p.y - side.y * w / 2, p.z - side.z * w / 2);
    if (i < segments) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, roughness: 0.3, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color('#ffffff'), emissive: new THREE.Color(color).multiplyScalar(0.3) }));
  m.userData = { segments, reveal: (a, b = 1) => { const s0 = Math.floor(a * segments), s1 = Math.floor(b * segments); geo.setDrawRange(s0 * 6, Math.max(0, s1 - s0) * 6); } };
  return m;
}

// Halftone dots in a ring (the reference's ring, in the accent colour).
export function halftoneRing(size = 1024, color = C.accent) {
  return drawTex(size, size, (ctx) => {
    const c = size / 2, step = size / 110; ctx.fillStyle = color;
    for (let y = step / 2; y < size; y += step) for (let x = step / 2; x < size; x += step) {
      const d = Math.hypot(x - c, y - c) / c;
      const band = Math.max(0, 1 - Math.abs(d - 0.86) / 0.07), fade = Math.max(0, 1 - Math.abs(d - 0.74) / 0.16) * 0.55;
      const k = Math.max(band, fade);
      if (k > 0.03) { ctx.beginPath(); ctx.arc(x, y, Math.min(step * 0.62, k * step * 0.62), 0, Math.PI * 2); ctx.fill(); }
    }
  });
}

export function mono(ctx, text, x, y, size, color, { align = 'left', spacing = 0.12, alpha = 1 } = {}) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.font = `500 ${size}px ${FONT.mono}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${size * spacing}px`;
  ctx.fillText(text, x, y); ctx.restore();
}
