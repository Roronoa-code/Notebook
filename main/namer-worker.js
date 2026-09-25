// Background process that names pictures (started by namer.js, closed when there's nothing left to name).
// A small picture-and-language model (Qwen3-VL 2B, compressed) on the processor, a few threads only,
// one picture at a time. Nothing here uses the internet.
const os = require('os');

const ID = 'onnx-community/Qwen3-VL-2B-Instruct-ONNX';
const PROMPT = 'Give this picture a short, specific title of 2 to 5 words, like a Pinterest pin name, in British English. Say plainly what the main subject is. Reply with the title only.';
const port = process.parentPort || { on: (e, fn) => process.on('message', (data) => fn({ data })), postMessage: (m) => process.send(m) };
let T = null, loaded = null;

function load(modelsDir) {
  if (loaded) return loaded;
  loaded = (async () => {
    T = await import('@huggingface/transformers');
    T.env.cacheDir = modelsDir; T.env.localModelPath = modelsDir; T.env.allowRemoteModels = false;
    const threads = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 4)));
    const dtype = { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4' };
    return { processor: await T.AutoProcessor.from_pretrained(ID), model: await T.Qwen3VLForConditionalGeneration.from_pretrained(ID, { dtype, device: 'cpu', session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } }) };
  })();
  return loaded;
}

// The checks use a stand-in (NOTEBOOK_FAKE_RECOGNISER) that names from the file name.
const fake = (hint) => (/outfit|shirt|coat/i.test(hint) ? 'Black coat and jeans' : /wall|lake/i.test(hint) ? 'Calm blue lake' : /icon|logo/i.test(hint) ? 'White bird icon' : 'Short-haired portrait');

port.on('message', async ({ data }) => {
  const { id, file, hint, modelsDir } = data;
  if (process.env.NOTEBOOK_FAKE_RECOGNISER) return port.postMessage({ id, ok: true, name: fake(hint) });
  try {
    const { processor, model } = await load(modelsDir);
    const img = await T.RawImage.read(file);
    const k = 448 / Math.max(img.width, img.height);
    const image = await img.resize(Math.max(28, Math.round(img.width * k)), Math.max(28, Math.round(img.height * k)));
    const text = processor.apply_chat_template([{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: PROMPT }] }], { add_generation_prompt: true });
    const inputs = await processor(text, image);
    const out = await model.generate({ ...inputs, max_new_tokens: 16, do_sample: false });
    const name = processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0];
    port.postMessage({ id, ok: true, name });
  } catch (err) {
    port.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
});
