// Build plan B1 check: saves 20 mixed TikTok and Pinterest links into a separate test library and checks
// every saved file plays offline (a real picture or video, read by ffprobe). Every failure must have a
// plain message. Needs the internet and the tools in D:\Notebook Tools\bin.
// Usage: node scripts/test-links.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Library } = require('../main/library');
const { Downloader } = require('../main/downloader');
const { saveLink } = require('../main/links');

const TOOLS = process.env.NOTEBOOK_TOOLS || 'D:/Notebook Tools';
const LIB = path.join(TOOLS, 'testset', 'links-library');

function playable(file) {
  try {
    const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
    const v = (out.streams || []).find((s) => s.codec_type === 'video');
    if (!v || !(v.width > 0)) return false;
    return /\.(mp4|m4v|mov|webm)$/i.test(file) ? Number(out.format.duration) > 0.5 : true;
  } catch { return false; }
}

(async () => {
  const links = JSON.parse(fs.readFileSync(path.join(TOOLS, 'testset', 'links.json'), 'utf8'));
  fs.rmSync(LIB, { recursive: true, force: true });
  const lib = await Library.openOrCreate(LIB);
  const dl = new Downloader({ binDir: path.join(TOOLS, 'bin'), tmpDir: path.join(TOOLS, 'tmp') });
  let saved = 0, silent = 0;
  for (const { kind, url } of links) {
    const t = Date.now();
    const res = await saveLink({ lib, dl, url, boardId: null });
    let line = `${kind.padEnd(16)} `;
    if (res.ok) {
      const items = res.added.map((id) => lib.item(id));
      const good = items.length && items.every((it) => playable(lib.p(it.file)));
      if (good) saved++;
      line += `${good ? 'SAVED ' : 'BROKEN'} ${items.length} file(s): ${items.map((i) => i.kind).join(',')}  "${items[0] && items[0].title}"`;
    } else {
      if (!res.error || res.error.length < 20) silent++;
      line += `FAILED "${res.error}"`;
    }
    console.log(`${line}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  const retry = lib.data.links ? lib.data.links.retry.length : 0;
  console.log(`\nB1: ${saved}/${links.length} saved and playable offline -> ${saved >= 18 && !silent ? 'PASS' : 'FAIL'} (pass 18+, a clear message for every failure)`);
  console.log(`Failures with no clear message: ${silent}. In the retry list: ${retry}.`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
