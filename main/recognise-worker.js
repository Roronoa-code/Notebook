// Background process for recognition (started by scanner.js with Electron's utilityProcess, or as a
// plain Node child in the checks). Loads the models once, then looks at one picture at a time, so the
// app itself never stutters. Nothing here uses the internet.
const R = require('./recognise');
const AI = require('./aidetect');

let M = null;
const port = process.parentPort || { on: (e, fn) => process.on('message', (data) => fn({ data })), postMessage: (m) => process.send(m) };

// The checks can use a stand-in (NOTEBOOK_FAKE_RECOGNISER=1) that answers from the original file name,
// so they run quickly and without the models or a graphics card.
function fake(hint, styles) {
  const n = String(hint || '').toLowerCase();
  const main = /outfit|shirt|coat/.test(n) ? 'outfit' : /wall|sky|lake/.test(n) ? 'wallpaper' : /icon|logo/.test(n) ? 'icon' : /face|pfp|portrait/.test(n) ? 'profile picture' : 'other';
  // Captions (for names) only when a check asks for them, so item titles in other checks stay put.
  const caption = process.env.NOTEBOOK_FAKE_CAPTIONS ? { outfit: 'A man wearing a black coat and jeans standing on a street.', wallpaper: 'A calm lake under a blue sky in the background.', icon: 'A white bird on a blue circle.', 'profile picture': 'A woman with short hair smiling.' }[main] : undefined;
  return { caption, type: { main, extra: [], scores: { [main]: 0.9 } }, colours: main === 'outfit' ? [{ name: 'black', hex: '#141414', share: 0.6 }] : [{ name: 'blue', hex: '#2c5abe', share: 0.5 }], styles: main === 'outfit' ? styles.slice(0, 2) : undefined, embedding: [1, 0, 0].map((x, i) => x + (n.length % (i + 3)) * 0.05) };
}

port.on('message', async ({ data }) => {
  const { id, cmd, file, styles, modelsDir, hint } = data;
  // "Is this picture AI-made?" (the Pinterest panel). Only the small detector is loaded for this.
  if (cmd === 'aicheck') {
    if (process.env.NOTEBOOK_FAKE_RECOGNISER) return port.postMessage({ id, ok: true, score: process.env.NOTEBOOK_FAKE_AI === 'some' ? (data.bytes.length % 3 === 0 ? 1 : 0) : process.env.NOTEBOOK_FAKE_AI ? 1 : 0 });
    try { return port.postMessage({ id, ok: true, score: data.strict === 'quick' ? await AI.run(modelsDir, AI.QUICK, data.bytes) : await AI.score(modelsDir, data.bytes, data.strict ? AI.STRICT : undefined) }); } catch (err) { return port.postMessage({ id, ok: false, error: err.message, missing: !!err.missing }); }
  }
  // The stand-in's fingerprint for a picture's bytes: eight numbers from a hash of them (different pictures differ).
  if (cmd === 'embed' && process.env.NOTEBOOK_FAKE_RECOGNISER) { const v = [...require('crypto').createHash('sha256').update(data.bytes).digest().subarray(0, 8)].map((x) => x - 127.5), n = Math.hypot(...v); return port.postMessage({ id, ok: true, embedding: v.map((x) => x / n) }); }
  if (process.env.NOTEBOOK_FAKE_RECOGNISER && cmd === 'types') return port.postMessage({ id, ok: false, error: 'not in the stand-in' });
  if (process.env.NOTEBOOK_FAKE_RECOGNISER) return port.postMessage({ id, ok: true, device: 'stand-in', result: cmd === 'hello' ? null : fake(hint, styles) });
  try {
    // A fingerprint only needs the picture model: no waiting for the rest (Ideas stays quick).
    if (cmd === 'embed') return port.postMessage({ id, ok: true, embedding: await R.embedBytes(M || await R.loadClip(modelsDir), data.bytes) });
    if (!M) M = await R.load(modelsDir);
    if (cmd === 'hello') return port.postMessage({ id, ok: true, device: M.device });
    if (cmd === 'types') return port.postMessage({ id, ok: true, result: data.embs.map((e) => R.typeOf(M, e)) });
    const result = await R.analyse(M, file, styles);
    port.postMessage({ id, ok: true, result, device: M.device });
  } catch (err) {
    port.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err), missingModels: /not found locally/i.test(String(err && err.message)) });
  }
});
