// Build plan A1/A2 accuracy check: runs on-PC recognition over the 40-image test set and scores it
// with the plan's rules. Needs the models (D:\Notebook Tools\models) and the set (D:\Notebook Tools\testset\set).
// Usage: node scripts/test-recognition.js   (NOTEBOOK_TOOLS=<folder> to use another tools folder)
const fs = require('fs');
const path = require('path');
const R = require('../main/recognise');

const TOOLS = process.env.NOTEBOOK_TOOLS || 'D:/Notebook Tools';
const SET = path.join(TOOLS, 'testset', 'set');
// Colour names that count as the same colour when marking (the eye would accept either).
const FAMILY = { 'light grey': 'grey', denim: 'blue', 'light blue': 'blue', navy: 'navy', khaki: 'beige', cream: 'white', tan: 'brown', mustard: 'yellow', lilac: 'purple', burgundy: 'red', olive: 'green', teal: 'green' };
const fam = (c) => FAMILY[c] || c;
const sameColour = (a, b) => fam(a) === fam(b) || (fam(a) === 'navy' && fam(b) === 'black') || (fam(a) === 'black' && fam(b) === 'navy');

(async () => {
  const truth = JSON.parse(fs.readFileSync(path.join(SET, 'truth.json'), 'utf8'));
  const t0 = Date.now();
  const M = await R.load(path.join(TOOLS, 'models'), { allowDownload: !!process.env.NOTEBOOK_ALLOW_DOWNLOAD });
  console.log(`models loaded on ${M.device} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  let typeRight = 0, colourRight = 0, styleRight = 0, outfits = 0;
  const rows = [];
  for (const t of truth) {
    const s = Date.now();
    const r = await R.analyse(M, path.join(SET, t.file));
    const labels = [r.type.main, ...r.type.extra];
    const ok = labels.includes(t.main) && labels.every((l) => l === t.main || t.extra.includes(l));
    if (ok) typeRight++;
    let colourOk = '', styleOk = '';
    if (t.colours) {
      outfits++;
      const got = (r.colours || []).map((c) => c.name);
      colourOk = got.some((g) => sameColour(g, t.colours[0])) ? 'yes' : 'no';
      if (colourOk === 'yes') colourRight++;
      styleOk = (r.styles || []).includes(t.styles[0]) ? 'yes' : 'no';
      if (styleOk === 'yes') styleRight++;
      rows.push(`${t.file.padEnd(18)} ${ok ? 'OK ' : 'NO '} ${labels.join('+').padEnd(28)} colours ${got.join(',').padEnd(24)} (${colourOk}, want ${t.colours[0]})  styles ${(r.styles || []).join(',').padEnd(24)} (${styleOk}, want ${t.styles[0]})  ${Date.now() - s}ms`);
    } else rows.push(`${t.file.padEnd(18)} ${ok ? 'OK ' : 'NO '} ${labels.join('+').padEnd(28)} want ${t.main}${t.extra.length ? ' (+' + t.extra.join(',') + ' fine)' : ''}  ${Date.now() - s}ms`);
  }
  console.log(rows.join('\n'));
  const verdict = (n, pass, fail) => (n >= pass ? 'PASS' : n < fail ? 'FAIL' : 'INCONCLUSIVE');
  console.log(`\nA1 item types: ${typeRight}/${truth.length} right -> ${verdict(typeRight, 34, 30)} (pass 34+, fail under 30)`);
  console.log(`A2 colours:    ${colourRight}/${outfits} -> ${verdict(colourRight, 16, 12)} (pass 16+, fail under 12)`);
  console.log(`A2 styles:     ${styleRight}/${outfits} in the top two -> ${verdict(styleRight, 14, 10)} (pass 14+, fail under 10)`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
