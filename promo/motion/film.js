// The renderer: loads the app's screens, photos and fonts, then renders any frame on demand.
// Each frame is several exposures averaged (motion blur, and anti-aliasing from sub-pixel jitter),
// then the flat layer (hud.js) and the finish (colour fringe, halftone corners, grain, letterbox).
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { TTFLoader } from './vendor/TTFLoader.js';
import { Font } from './vendor/FontLoader.js';
import * as K from './kit.js';
import { buildShots } from './shots.js';
import { drawHud, post } from './hud.js';

const T = window.Timeline;
const SCREENS = ['desktop-all', 'desktop-paste', 'desktop-search', 'desktop-open', 'phone-home', 'phone-grid', 'phone-ideas', 'phone-board'];
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const image = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not load ' + src)); i.src = src; });

async function boot() {
  const scale = Number(new URLSearchParams(location.search).get('scale') || 1);
  const W = Math.round(T.W * scale), H = Math.round(T.H * scale);
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); document.body.appendChild(renderer.domElement);

  const faces = [new FontFace('Figtree', 'url(/renderer/fonts/figtree-latin-wght-normal.woff2)', { weight: '300 900' }), new FontFace('Anton', 'url(/renderer/fonts/anton-latin-400-normal.woff2)'), new FontFace('IBM Plex Mono', 'url(/renderer/fonts/ibm-plex-mono-latin-500-normal.woff2)', { weight: '100 900' })];
  for (const f of faces) { await f.load(); document.fonts.add(f); }

  const loader = new THREE.TextureLoader();
  const load = (url) => loader.loadAsync(url).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; });
  const list = await (await fetch('/photos.json')).json();
  const photos = await Promise.all(list.map(async (p, i) => ({ ...p, tex: await load(`/photo/${i}.jpg`) })));
  const byName = new Map(photos.map((p) => [p.name, p]));
  const screens = {};
  await Promise.all(SCREENS.map(async (n) => { screens[n] = await load(`/screens/${n}.png`); }));
  const cards = await (await fetch('/screens/desktop-cards.json')).json();
  const icon = await image('/build/icon.png');
  const font3d = new Font(await new TTFLoader().loadAsync('/fonts/figtree-black.ttf'));
  const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  // The paste screen out of focus (behind the Save button), and All with the lifted cards' spaces empty.
  const paste = screens['desktop-paste'].image, all = screens['desktop-all'].image;
  const screenBlur = K.drawTex(paste.width / 2, paste.height / 2, (ctx, w, h) => { ctx.filter = 'blur(10px) brightness(.8)'; ctx.drawImage(paste, -20, -20, w + 40, h + 40); });
  const k = all.width / cards.width;
  const screenHoles = K.drawTex(all.width, all.height, (ctx) => {
    ctx.drawImage(all, 0, 0);
    for (const c of cards.cards) if (byName.has(c.title)) {
      ctx.fillStyle = '#0B0B0B'; K.rr(ctx, c.x * k - 2, c.y * k - 2, c.w * k + 4, c.h * k + 4, 18 * k); ctx.fill();
      ctx.strokeStyle = 'rgba(157,123,255,.35)'; ctx.setLineDash([10 * k, 8 * k]); ctx.lineWidth = 2 * k; K.rr(ctx, c.x * k + 6, c.y * k + 6, c.w * k - 12, c.h * k - 12, 14 * k); ctx.stroke(); ctx.setLineDash([]);
    }
  });

  const A = {
    env, photos, cards, icon, font3d, screenBlur, screenHoles,
    photo: (n) => { const p = byName.get(n); if (!p) throw new Error('No photo called ' + n); return p; },
    photoByName: (n) => byName.get(n),
    screen: (n) => { if (!screens[n]) throw new Error('No screen ' + n); return screens[n]; }
  };
  const shots = buildShots(A);

  // Motion blur accumulation and the finish.
  const rtSub = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
  const rtAcc = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.PlaneGeometry(2, 2);
  const addMat = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, w: { value: 1 } }, vertexShader: QUAD_VS, fragmentShader: 'uniform sampler2D t; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb * w, 1.0); }', blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const addScene = new THREE.Scene(); addScene.add(new THREE.Mesh(quad, addMat));
  const hudCanvas = K.canvas(W, H), hudCtx = hudCanvas.getContext('2d'), hudTex = new THREE.CanvasTexture(hudCanvas);
  hudTex.colorSpace = THREE.NoColorSpace; hudTex.minFilter = THREE.LinearFilter; hudTex.generateMipmaps = false;
  const postMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: rtAcc.texture }, tHud: { value: hudTex }, uScene: { value: 1 }, uCA: { value: 0 }, uVig: { value: 0.5 }, uLB: { value: 0 }, uHalf: { value: 0 }, uGrain: { value: 0.05 }, uTime: { value: 0 }, uFlash: { value: new THREE.Vector4() }, uRes: { value: new THREE.Vector2(W, H) }, uScale: { value: scale } },
    vertexShader: QUAD_VS,
    fragmentShader: `
      uniform sampler2D tScene, tHud; uniform float uScene, uCA, uVig, uLB, uHalf, uGrain, uTime, uScale; uniform vec4 uFlash; uniform vec2 uRes; varying vec2 vUv;
      vec3 tone(vec3 c){ vec3 x = max(c - 0.8, 0.0); return min(c, 0.8) + x / (1.0 + x * 1.8); }
      vec3 srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 uv = vUv, d = uv - 0.5; vec3 col = vec3(0.0);
        if (uScene > 0.5) {
          float k = uCA * 0.0045 * length(d) * 2.0;
          col = vec3(texture2D(tScene, uv - d * k).r, texture2D(tScene, uv).g, texture2D(tScene, uv + d * k).b);
          col = srgb(tone(col));
          float v = smoothstep(0.95, 0.25, length(d * vec2(1.0, 0.9))); col *= mix(1.0, v, uVig);
          float e = smoothstep(0.42, 0.78, length(d * vec2(1.25, 1.0))); vec2 g = fract(uv * uRes / (9.0 * uScale)) - 0.5;
          float dotm = 1.0 - smoothstep(e * 0.42, e * 0.42 + 0.08, length(g));
          col = mix(col, vec3(0.23, 0.16, 0.48), dotm * uHalf * e);
        }
        vec4 h = texture2D(tHud, uv); col = mix(col, h.rgb, h.a);
        col = mix(col, uFlash.rgb, uFlash.a);
        col += (hash(floor(uv * uRes / uScale) + fract(uTime) * 311.0) - 0.5) * uGrain;
        float lb = uLB * 0.12; if (uv.y < lb || uv.y > 1.0 - lb) col = vec3(0.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false
  });
  const postScene = new THREE.Scene(); postScene.add(new THREE.Mesh(quad, postMat));

  function renderFrame(f) {
    const t = f / T.FPS, shot = T.shotAt(t), sh = shots[shot.id], ex = T.exposure(t), P = post(t);
    renderer.setRenderTarget(rtAcc); renderer.setClearColor(0x000000, 1); renderer.clear();
    if (sh && P.scene) {
      const n = ex.samples;
      for (let i = 0; i < n; i++) {
        const ti = n > 1 ? Math.min(shot.end - 1e-4, Math.max(shot.start, t + ((i + 0.5) / n - 0.5) * ex.shutter / T.FPS)) : t;
        sh.update(ti);
        if (n > 1) sh.cam.setViewOffset(W, H, halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5, W, H);
        renderer.setRenderTarget(rtSub); renderer.clear(); renderer.render(sh.scene, sh.cam);
        addMat.uniforms.t.value = rtSub.texture; addMat.uniforms.w.value = 1 / n;
        renderer.setRenderTarget(rtAcc); renderer.autoClear = false; renderer.render(addScene, quadCam); renderer.autoClear = true;
      }
      sh.cam.clearViewOffset(); sh.update(t);
    }
    hudCtx.setTransform(scale, 0, 0, scale, 0, 0); drawHud(hudCtx, t, A, shots); hudTex.needsUpdate = true;
    const u = postMat.uniforms;
    u.uScene.value = P.scene ? 1 : 0; u.uCA.value = P.ca; u.uVig.value = P.vig; u.uLB.value = P.lb; u.uHalf.value = P.half; u.uGrain.value = P.grain; u.uTime.value = f * 0.618; u.uFlash.value.set(...P.flash);
    renderer.setRenderTarget(null); renderer.render(postScene, quadCam);
    return renderer.domElement.toDataURL('image/png');
  }
  window.renderFrame = renderFrame;
  window.filmReady = true;
}

boot().catch((e) => { console.error(e); window.filmError = String(e && e.stack || e); });
