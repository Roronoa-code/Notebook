// Build plan A3 check: puts the 40 test images into a separate test library, recognises them with the
// real models, and lists the suggested outfit groups and matching sets (with contact sheets to rate).
// Usage: node scripts/eval-suggestions.js   (needs the models and test set in D:\Notebook Tools)
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Library } = require('../main/library');
const { Scanner } = require('../main/scanner');
const { suggestions } = require('../main/suggest');

const TOOLS = process.env.NOTEBOOK_TOOLS || 'D:/Notebook Tools';
const SET = path.join(TOOLS, 'testset', 'set');
const EVAL = path.join(TOOLS, 'testset', 'eval-library');

(async () => {
  fs.rmSync(EVAL, { recursive: true, force: true });
  const lib = await Library.openOrCreate(EVAL);
  const files = [SET, path.join(TOOLS, 'testset', 'pool')].flatMap((d) => fs.readdirSync(d).filter((f) => /\.(jpg|png)$/.test(f)).map((f) => path.join(d, f)));
  await lib.importFiles(files, null);
  const scanner = new Scanner({
    modelsDir: path.join(TOOLS, 'models'),
    fork: (file) => { const c = fork(file, [], { stdio: 'inherit' }); return { on: (e, fn) => c.on(e, fn), postMessage: (m) => c.send(m), kill: () => c.kill() }; },
    onProgress: (s) => { if (s.state === 'scanning' && s.done % 10 === 0) console.log(`recognising ${s.done}/${s.total}`); },
    onChanged: () => {}
  });
  await scanner.start(lib);
  scanner.stop();
  const emb = await scanner.embeddings(lib);
  const name = (id) => lib.data.items.find((i) => i.id === id).originalName;
  const out = suggestions(lib.data.items, emb, {}).map((g) => ({ kind: g.kind, name: g.name, files: g.ids.map(name) }));
  fs.writeFileSync(path.join(TOOLS, 'testset', 'suggestions.json'), JSON.stringify(out, null, 1));
  for (const g of out) console.log(`${g.kind.padEnd(8)} ${g.name.padEnd(22)} ${g.files.join(', ')}`);
  console.log(`\n${out.filter((g) => g.kind === 'outfits').length} outfit groups, ${out.filter((g) => g.kind === 'set').length} matching sets`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
