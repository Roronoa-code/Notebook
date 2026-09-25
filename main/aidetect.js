// Tells how likely a picture is to be AI-made, on this PC (onnxruntime on the graphics card when it
// works, otherwise the processor). Used by the Pinterest panel to quietly hide AI-made pins.
// Nothing is sent anywhere: the picture is only looked at here.
//
// Two detectors: a quick one looks at every picture; only pictures it's fairly sure about get a second
// opinion from a stronger one, and a pin counts as AI-made only if both agree. Tested on 150 AI and 334
// real pictures: about 6 in 10 AI pictures caught, about 1 in 100 real photos wrongly flagged.
const fs = require('fs');
const path = require('path');

const IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
const QUICK = { // SwinV2, Apache 2.0 (haywoodsloan/ai-image-detector-deploy, as LPX55/detection-model-1-ONNX)
  file: 'LPX55/detection-model-1-ONNX/onnx/model.onnx',
  inputs: [{ size: 256, kernel: 'cubic', ...IMAGENET }],
  score: (out) => { const e0 = Math.exp(out[0]), e1 = Math.exp(out[1]); return e0 / (e0 + e1); } // label 0 = artificial
};
const STRONG = { // SigLIP2 + DINOv2, MIT (Bombek1/ai-image-detector-siglip-dinov2), converted to ONNX for Notebook
  file: 'Notebook/ai-detector-strong/model.onnx',
  inputs: [{ size: 384, kernel: 'linear', mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] }, { size: 392, kernel: 'cubic', ...IMAGENET }],
  score: (out) => out[0]
};
const SURE = 0.9;   // each detector must be at least this sure
const HIDE_AT = 0.9; // the combined score (below) hides a pin from here
const VERSION = 2;   // bump when the scoring changes, so remembered answers are worked out again
// Ideas can afford to be stricter: a real pin wrongly left out just makes room for another one.
const STRICT = { sure: 0.5, quickAlone: 0.8 };

const sessions = {};
async function load(modelsDir, M) {
  if (sessions[M.file] !== undefined) return sessions[M.file];
  const ort = require('onnxruntime-node');
  const file = path.join(modelsDir, M.file);
  if (!fs.existsSync(file)) { sessions[M.file] = null; return null; }
  for (const ep of ['dml', 'cpu']) {
    try { sessions[M.file] = { ort, s: await ort.InferenceSession.create(file, { executionProviders: [ep] }) }; return sessions[M.file]; } catch (e) { if (ep === 'cpu') throw e; }
  }
}

async function run(modelsDir, M, bytes) {
  const got = await load(modelsDir, M);
  if (!got) return null;
  const { ort, s } = got;
  const sharp = require('sharp');
  const feeds = {};
  for (let k = 0; k < M.inputs.length; k++) {
    const { size: S, kernel, mean, std } = M.inputs[k];
    const { data } = await sharp(Buffer.from(bytes)).removeAlpha().resize(S, S, { fit: 'fill', kernel }).raw().toBuffer({ resolveWithObject: true });
    const f = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) f[c * S * S + i] = (data[i * 3 + c] / 255 - mean[c]) / std[c];
    feeds[s.inputNames[k]] = new ort.Tensor('float32', f, [1, 3, S, S]);
  }
  return M.score((await s.run(feeds))[s.outputNames[0]].data);
}

// bytes: an image file's bytes. Returns a score from 0 to 1; HIDE_AT and above means AI-made.
// With `strict` (STRICT), the second opinion is asked from 0.5 and the answer compares with 0.5, not HIDE_AT.
async function score(modelsDir, bytes, strict) {
  const sure = strict ? strict.sure : SURE, alone = strict ? strict.quickAlone : 0.99, line = strict ? strict.sure : HIDE_AT;
  const quick = await run(modelsDir, QUICK, bytes);
  if (quick == null) { const e = new Error('The AI-picture detector is not on this PC yet.'); e.missing = true; throw e; }
  if (quick < sure) return quick;
  const strong = await run(modelsDir, STRONG, bytes);
  // Without the stronger detector, only pictures the quick one is very sure about count.
  if (strong == null) return quick >= alone ? quick : Math.min(quick, line - 0.01);
  return Math.min(quick, strong);
}

module.exports = { score, HIDE_AT, VERSION, STRICT, QUICK, STRONG, run };
