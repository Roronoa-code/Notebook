// Tells how likely a picture is to be AI-made, on this PC (onnxruntime on the graphics card when it
// works, otherwise the processor). Used by the Pinterest panel to quietly hide AI-made pins.
// Nothing is sent anywhere: the picture is only looked at here.
const fs = require('fs');
const path = require('path');

// The detector in use: an ONNX image classifier, its input size and colour normalisation, and which
// output means "AI-made". Kept in one place so a better model can be swapped in.
const MODEL = {
  file: 'LPX55/detection-model-1-ONNX/onnx/model.onnx', // SwinV2, Apache 2.0 (haywoodsloan/ai-image-detector-deploy)
  size: 256, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], kernel: 'cubic',
  score: (out) => { const e0 = Math.exp(out[0]), e1 = Math.exp(out[1]); return e0 / (e0 + e1); } // label 0 = artificial
};
// How sure it must be before a pin is hidden. Chosen on test pictures so that real photos are almost
// never hidden (about 1 in 100), at the cost of letting some AI pictures through.
const HIDE_AT = 0.99;

let session = null;
async function load(modelsDir) {
  if (session) return session;
  const ort = require('onnxruntime-node');
  const file = path.join(modelsDir, MODEL.file);
  if (!fs.existsSync(file)) { const e = new Error('The AI-picture detector is not on this PC yet.'); e.missing = true; throw e; }
  for (const ep of ['dml', 'cpu']) {
    try { session = { ort, s: await ort.InferenceSession.create(file, { executionProviders: [ep] }), device: ep }; return session; } catch (e) { if (ep === 'cpu') throw e; }
  }
}

// bytes: an image file's bytes. Returns the chance (0 to 1) that it's AI-made.
async function score(modelsDir, bytes) {
  const { ort, s } = await load(modelsDir);
  const sharp = require('sharp');
  const S = MODEL.size;
  const { data } = await sharp(Buffer.from(bytes)).removeAlpha().resize(S, S, { fit: 'fill', kernel: MODEL.kernel }).raw().toBuffer({ resolveWithObject: true });
  const f = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) f[c * S * S + i] = (data[i * 3 + c] / 255 - MODEL.mean[c]) / MODEL.std[c];
  const res = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, S, S]) });
  return MODEL.score(res[s.outputNames[0]].data);
}

module.exports = { score, HIDE_AT, MODEL };
