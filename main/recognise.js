// On-PC recognition (build plan A1/A2). Runs fully offline once the models are on disk:
// - what a picture is (outfit, wallpaper, icon, profile picture, other): a main label plus extra labels,
// - for outfits: the clothes' colours (clothing pixels only, never the background) and the top styles,
// - a fingerprint (CLIP embedding) used for suggested groups and matching sets (A3).
// Plain Node, no Electron: runs in a background process (recognise-worker.js) and in the checks.

const TYPES = {
  outfit: ['a photo of an outfit', 'a person wearing an outfit', 'a mirror selfie showing clothes', 'a flat lay of clothes', 'street style fashion photo', 'clothes on a hanger', 'a t-shirt'],
  wallpaper: ['a phone wallpaper', 'a desktop wallpaper', 'a landscape photo of nature', 'an abstract colourful background', 'a starry night sky', 'a simple gradient background'],
  icon: ['an app icon', 'a flat vector icon', 'an icon with rounded corners', 'a logo on a plain background', 'a set of app icons'],
  'profile picture': ['a profile picture', 'a portrait headshot of a person', 'a close-up of a face', 'an avatar', 'an anime character avatar', 'a passport photo'],
  other: ['a screenshot of a website', 'a screenshot of text', 'a photo of food', 'a meme with text', 'a ticket or receipt', 'a document',
    'a photo of a gaming PC setup', 'a photo of a desk with a computer and monitors', 'a photo inside a computer case with RGB fans', 'a photo of a graphics card',
    'a photo of a room', 'a product photo of an object', 'a photo of a car', 'a photo of a figurine or toy', 'a photo of a gadget']
};
// Bump when TYPES changes: what each picture is gets worked out again from its fingerprint (quick; no re-scan).
const TYPES_VERSION = 2;
const DEFAULT_STYLES = ['streetwear', 'minimal', 'smart casual', 'sporty', 'techwear', 'vintage', 'y2k', 'formal'];
const STYLE_PROMPTS = {
  streetwear: ['a streetwear outfit', 'hoodie, sneakers and baggy jeans streetwear', 'urban street style clothes'],
  minimal: ['a minimalist outfit', 'a clean minimal outfit in neutral colours', 'simple plain clothes'],
  'smart casual': ['a smart casual outfit', 'a blazer with jeans, smart casual', 'a neat casual office outfit'],
  sporty: ['a sporty outfit', 'athletic sportswear', 'a tracksuit and trainers'],
  techwear: ['a techwear outfit', 'black technical utility clothing with straps', 'functional futuristic techwear'],
  vintage: ['a vintage outfit', 'retro clothes from the past', 'old fashioned vintage style clothing'],
  y2k: ['a y2k outfit', 'early 2000s fashion, low rise and bright colours', 'y2k aesthetic clothes'],
  formal: ['a formal outfit', 'a suit and tie', 'an elegant formal dress']
};
// Clothing parts from the clothes-finding model (the face, hair, skin and background are ignored).
const CLOTHES = new Set(['Hat', 'Upper-clothes', 'Skirt', 'Pants', 'Dress', 'Belt', 'Left-shoe', 'Right-shoe', 'Bag', 'Scarf']);
// Named colours people actually use for clothes (sRGB).
const NAMED = {
  black: [20, 20, 22], white: [240, 240, 238], grey: [128, 128, 128], 'light grey': [196, 196, 196], navy: [28, 36, 72], blue: [44, 90, 190],
  'light blue': [150, 190, 230], denim: [75, 105, 145], green: [40, 130, 60], olive: [100, 105, 50], khaki: [190, 175, 130], beige: [220, 205, 175],
  cream: [245, 235, 210], brown: [110, 70, 40], tan: [180, 140, 95], red: [200, 30, 40], burgundy: [110, 20, 40], pink: [240, 150, 180],
  purple: [110, 60, 160], lilac: [190, 160, 220], yellow: [240, 210, 40], mustard: [200, 160, 40], orange: [240, 130, 30], teal: [20, 130, 130]
};

let T = null, loaded = null;
const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const softmax = (xs) => { const m = Math.max(...xs), e = xs.map((x) => Math.exp(x - m)), s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };

// sRGB -> CIE Lab, so colour distances match what eyes see.
function lab([r, g, b]) {
  const f = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
}
const NAMED_LAB = Object.entries(NAMED).map(([name, rgb]) => ({ name, rgb, lab: lab(rgb) }));
const nearestName = (l) => NAMED_LAB.reduce((best, c) => { const d = (c.lab[0] - l[0]) ** 2 + (c.lab[1] - l[1]) ** 2 + (c.lab[2] - l[2]) ** 2; return d < best.d ? { d, c } : best; }, { d: Infinity, c: null }).c;
const hex = (rgb) => '#' + rgb.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

// A few main colours from a list of pixels: k-means in Lab, then named. `share` is the fraction of pixels.
function palette(pixels, k = 4, minShare = 0.12) {
  if (pixels.length < 50) return [];
  const step = Math.max(1, Math.floor(pixels.length / 6000));
  const pts = []; for (let i = 0; i < pixels.length; i += step) pts.push({ rgb: pixels[i], lab: lab(pixels[i]) });
  let centres = [];
  for (let i = 0; i < k; i++) centres.push(pts[Math.floor(((i + 0.5) / k) * pts.length)].lab.slice());
  const assign = new Array(pts.length).fill(0);
  for (let it = 0; it < 12; it++) {
    pts.forEach((p, i) => { let b = 0, bd = Infinity; centres.forEach((c, j) => { const d = (c[0] - p.lab[0]) ** 2 + (c[1] - p.lab[1]) ** 2 + (c[2] - p.lab[2]) ** 2; if (d < bd) { bd = d; b = j; } }); assign[i] = b; });
    centres = centres.map((c, j) => { const m = pts.filter((_, i) => assign[i] === j); if (!m.length) return c; return [0, 1, 2].map((d) => m.reduce((s, p) => s + p.lab[d], 0) / m.length); });
  }
  const groups = new Map();
  pts.forEach((p, i) => {
    const name = nearestName(centres[assign[i]]).name;
    const g = groups.get(name) || { name, n: 0, sum: [0, 0, 0] };
    g.n++; g.sum = g.sum.map((s, d) => s + p.rgb[d]);
    groups.set(name, g);
  });
  return [...groups.values()].map((g) => ({ name: g.name, hex: hex(g.sum.map((s) => s / g.n)), share: +(g.n / pts.length).toFixed(3) }))
    .filter((g) => g.share >= minShare).sort((a, b) => b.share - a.share).slice(0, 3);
}

const CLIP = 'Xenova/clip-vit-large-patch14';
// The graphics card (DirectML) when it works, otherwise the processor.
const tryDevices = async (make) => { let last; for (const device of ['dml', 'cpu']) { try { return { m: await make(device), device }; } catch (e) { last = e; } } throw last; };

// Just the picture fingerprint model (what Ideas needs), loaded once; the full set below reuses it.
let clipLoaded = null;
function loadClip(modelsDir, { allowDownload = false } = {}) {
  if (clipLoaded) return clipLoaded;
  clipLoaded = (async () => {
    T = await import('@huggingface/transformers');
    T.env.cacheDir = modelsDir;
    T.env.localModelPath = modelsDir;
    T.env.allowRemoteModels = allowDownload; // offline by default: nothing is fetched once the models are here
    const vis = await tryDevices((device) => T.CLIPVisionModelWithProjection.from_pretrained(CLIP, { device, dtype: 'fp32' }));
    return { vis: vis.m, device: vis.device, processor: await T.AutoProcessor.from_pretrained(CLIP) };
  })();
  clipLoaded.catch(() => { clipLoaded = null; });
  return clipLoaded;
}

// Loads the models (once). `modelsDir` is where they were downloaded (e.g. D:\Notebook Tools\models).
async function load(modelsDir, { allowDownload = false } = {}) {
  if (loaded) return loaded;
  loaded = (async () => {
    const C = await loadClip(modelsDir, { allowDownload });
    const vis = { m: C.vis, device: C.device }, processor = C.processor;
    const txt = await T.CLIPTextModelWithProjection.from_pretrained(CLIP, { device: vis.device, dtype: 'fp32' });
    const tokenizer = await T.AutoTokenizer.from_pretrained(CLIP);
    const seg = await tryDevices((device) => T.pipeline('image-segmentation', 'Xenova/segformer_b2_clothes', { device }));
    const embedText = async (texts) => {
      const inputs = tokenizer(texts, { padding: true, truncation: true });
      const { text_embeds } = await txt(inputs);
      const d = text_embeds.dims[1];
      return texts.map((_, i) => norm(Array.from(text_embeds.data.slice(i * d, (i + 1) * d))));
    };
    // One averaged text direction per label (a few phrasings each is more reliable than one).
    const labelVectors = async (prompts) => {
      const out = {};
      for (const [label, list] of Object.entries(prompts)) {
        const vs = await embedText(list);
        out[label] = norm(vs[0].map((_, d) => vs.reduce((s, v) => s + v[d], 0) / vs.length));
      }
      return out;
    };
    // The captioning model (a sentence about the picture, for its name). Optional: without it, nothing is renamed.
    let cap = null;
    try {
      const CAP = 'onnx-community/Florence-2-base-ft';
      cap = { model: await T.Florence2ForConditionalGeneration.from_pretrained(CAP, { device: vis.device, dtype: 'fp32' }), processor: await T.AutoProcessor.from_pretrained(CAP) };
    } catch { /* not downloaded: pictures keep their titles */ }
    return { vis: vis.m, processor, seg: seg.m, cap, embedText, labelVectors, device: vis.device, typeVecs: await labelVectors(TYPES), styleVecs: {} };
  })();
  return loaded;
}

async function styleVectors(M, styles) {
  const missing = styles.filter((s) => !M.styleVecs[s]);
  if (missing.length) Object.assign(M.styleVecs, await M.labelVectors(Object.fromEntries(missing.map((s) => [s, STYLE_PROMPTS[s] || [`a ${s} outfit`, `${s} style clothes`, `${s} fashion`]]))));
  return styles.map((s) => M.styleVecs[s]);
}

async function embedImage(M, image) {
  const inputs = await M.processor(image);
  const { image_embeds } = await M.vis(inputs);
  return norm(Array.from(image_embeds.data));
}

// A fingerprint for a picture given as bytes (the Ideas feed ranks pins with it).
async function embedBytes(M, bytes) {
  const image = await T.RawImage.fromBlob(new Blob([bytes]));
  return (await embedImage(M, image)).map((x) => +x.toFixed(4));
}

const scoresFor =(emb, vecs, names) => { const p = softmax(names.map((n, i) => 100 * dot(emb, vecs[i]))); return Object.fromEntries(names.map((n, i) => [n, +p[i].toFixed(4)])); };

// What a picture is, from its fingerprint: a main label, plus extra labels close enough to be a fair second reading.
function typeOf(M, emb) {
  const names = Object.keys(TYPES);
  const scores = scoresFor(emb, names.map((n) => M.typeVecs[n]), names);
  const ranked = names.slice().sort((a, b) => scores[b] - scores[a]);
  const main = ranked[0];
  return { main, extra: ranked.slice(1).filter((n) => scores[n] >= 0.2 && scores[n] >= scores[main] * 0.35), scores };
}

// Looks at one picture. `styles` is the user's style list.
async function analyse(M, file, styles = DEFAULT_STYLES) {
  const image = await T.RawImage.read(file);
  const emb = await embedImage(M, image);
  const type = typeOf(M, emb), { main, extra } = type;
  const out = { type, embedding: emb.map((x) => +x.toFixed(4)) };
  if (M.cap) {
    const inputs = await M.cap.processor(image, M.cap.processor.construct_prompts('<CAPTION>'));
    const ids = await M.cap.model.generate({ ...inputs, max_new_tokens: 40 });
    out.caption = String(M.cap.processor.post_process_generation(M.cap.processor.batch_decode(ids, { skip_special_tokens: false })[0], '<CAPTION>', image.size)['<CAPTION>'] || '').trim();
  }
  const rgbOf = (img) => { const px = []; const c = img.channels; for (let i = 0; i < img.width * img.height; i++) px.push([img.data[i * c], img.data[i * c + 1], img.data[i * c + 2]]); return px; };
  if (main === 'outfit' || extra.includes('outfit')) {
    // Colours from the clothes only: the clothes-finding model marks clothing pixels; everything else is ignored.
    const parts = await M.seg(image);
    const small = image.width * image.height > 400 * 400 ? await image.resize(Math.round(image.width * 400 / Math.max(image.width, image.height)), Math.round(image.height * 400 / Math.max(image.width, image.height))) : image;
    const rgb = await small.rgb();
    const mask = new Uint8Array(rgb.width * rgb.height);
    let box = [Infinity, Infinity, -1, -1];
    for (const p of parts) {
      if (!CLOTHES.has(p.label)) continue;
      const m = p.mask.width === rgb.width ? p.mask : await p.mask.resize(rgb.width, rgb.height);
      for (let i = 0; i < mask.length; i++) if (m.data[i] > 127) { mask[i] = 1; const x = i % rgb.width, y = (i / rgb.width) | 0; box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]; }
    }
    const px = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) px.push([rgb.data[i * 3], rgb.data[i * 3 + 1], rgb.data[i * 3 + 2]]);
    out.colours = palette(px);
    // Style from the clothes (cropped to them when found), against the user's own list.
    let styleEmb = emb;
    if (box[2] > box[0] + 20 && box[3] > box[1] + 20) {
      const sx = image.width / rgb.width, sy = image.height / rgb.height;
      const crop = await image.crop([Math.floor(box[0] * sx), Math.floor(box[1] * sy), Math.ceil(box[2] * sx), Math.ceil(box[3] * sy)]);
      styleEmb = norm((await embedImage(M, crop)).map((x, i) => x * 0.7 + emb[i] * 0.3));
    }
    const sv = await styleVectors(M, styles);
    const ss = scoresFor(styleEmb, sv, styles);
    out.styles = styles.slice().sort((a, b) => ss[b] - ss[a]).slice(0, 2);
    out.styleScores = ss;
  } else {
    // Everything else: the picture's own main colours (used for matching sets).
    const small = await (await image.resize(160, Math.max(1, Math.round(160 * image.height / image.width)))).rgb();
    out.colours = palette(rgbOf(small), 4, 0.1);
  }
  return out;
}

module.exports = { load, loadClip, analyse, embedBytes, typeOf, TYPES_VERSION, palette, lab, TYPES, DEFAULT_STYLES, NAMED };
