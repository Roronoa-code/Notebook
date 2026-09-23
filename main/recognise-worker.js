// Background process for recognition (started by scanner.js with Electron's utilityProcess, or as a
// plain Node child in the checks). Loads the models once, then looks at one picture at a time, so the
// app itself never stutters. Nothing here uses the internet.
const R = require('./recognise');

let M = null;
const port = process.parentPort || { on: (e, fn) => process.on('message', (data) => fn({ data })), postMessage: (m) => process.send(m) };

// The checks can use a stand-in (NOTEBOOK_FAKE_RECOGNISER=1) that answers from the original file name,
// so they run quickly and without the models or a graphics card.
function fake(hint, styles) {
  const n = String(hint || '').toLowerCase();
  const main = /outfit|shirt|coat/.test(n) ? 'outfit' : /wall|sky|lake/.test(n) ? 'wallpaper' : /icon|logo/.test(n) ? 'icon' : /face|pfp|portrait/.test(n) ? 'profile picture' : 'other';
  return { type: { main, extra: [], scores: { [main]: 0.9 } }, colours: main === 'outfit' ? [{ name: 'black', hex: '#141414', share: 0.6 }] : [{ name: 'blue', hex: '#2c5abe', share: 0.5 }], styles: main === 'outfit' ? styles.slice(0, 2) : undefined, embedding: [1, 0, 0].map((x, i) => x + (n.length % (i + 3)) * 0.05) };
}

port.on('message', async ({ data }) => {
  const { id, cmd, file, styles, modelsDir, hint } = data;
  if (process.env.NOTEBOOK_FAKE_RECOGNISER) return port.postMessage({ id, ok: true, device: 'stand-in', result: cmd === 'hello' ? null : fake(hint, styles) });
  try {
    if (!M) M = await R.load(modelsDir);
    if (cmd === 'hello') return port.postMessage({ id, ok: true, device: M.device });
    const result = await R.analyse(M, file, styles);
    port.postMessage({ id, ok: true, result, device: M.device });
  } catch (err) {
    port.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err), missingModels: /not found locally/i.test(String(err && err.message)) });
  }
});
