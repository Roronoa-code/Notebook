// Renders the film frame by frame in a headless browser (WebGL) and encodes it with ffmpeg, music included.
// Usage (from the Notebook folder):
//   node promo/motion/render.js                        -> promo/motion/out/notebook-motion-1920x1080.mp4
//   node promo/motion/render.js --stills 1,7.2,14      -> out/stills/still-<seconds>.png (add --scale 0.5 for quick looks)
//   node promo/motion/render.js --serve                -> a local address to open the film page yourself
// First run capture-desktop.js and capture-phone.js (they make out/screens). Needs ffmpeg on PATH.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const T = require('./timeline.js');
const Photos = require('./photos.js');
const Music = require('./music.js');
const Browser = require('./browser.js');

const HERE = __dirname, APP = path.resolve(HERE, '..', '..'), OUT = path.join(HERE, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg' };
const args = process.argv.slice(2);
const opt = (name, d = null) => { const i = args.indexOf(name); return i < 0 ? d : (args[i + 1] || ''); };

function serve() {
  const list = Photos.LIST;
  const roots = { '/renderer/': path.join(APP, 'renderer'), '/build/': path.join(APP, 'build'), '/screens/': path.join(OUT, 'screens'), '/': HERE };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/photos.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(list.map(({ name, title, board, w, h }) => ({ name, title, board, w, h })))); }
    let file;
    const m = url.match(/^\/photo\/(\d+)\.jpg$/);
    if (m) file = list[Number(m[1])] && list[Number(m[1])].file;
    else { const prefix = Object.keys(roots).find((p) => url.startsWith(p)), base = roots[prefix]; file = path.resolve(base, '.' + url.slice(prefix.length - 1)); if (!file.startsWith(path.resolve(base))) file = null; }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function openFilm(browser, address, scale) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${address}?scale=${scale}`);
  await page.waitForFunction(() => window.filmReady || window.filmError, null, { timeout: 180000 });
  const failed = await page.evaluate(() => window.filmError);
  if (failed) throw new Error(failed);
  return { page, errors };
}

(async () => {
  await Photos.ensure();
  if (!fs.existsSync(path.join(OUT, 'screens', 'desktop-cards.json'))) throw new Error('Run capture-desktop.js and capture-phone.js first (out/screens is empty).');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const address = `http://127.0.0.1:${server.address().port}/index.html`;
  if (args.includes('--serve')) { console.log('Film page:', address, '(renderFrame(n) in the console)'); return; }
  const scale = Number(opt('--scale', '1'));
  const browser = await Browser.launch(['--use-angle=swiftshader']);
  try {
    const { page, errors } = await openFilm(browser, address, scale);
    const frameAt = async (f) => Buffer.from((await page.evaluate((n) => window.renderFrame(n), f)).split(',')[1], 'base64');
    const stills = opt('--stills');
    if (stills !== null) {
      const dir = path.join(OUT, 'stills'); fs.mkdirSync(dir, { recursive: true });
      for (const sec of stills.split(',').map(Number)) { fs.writeFileSync(path.join(dir, `still-${sec.toFixed(2)}.png`), await frameAt(Math.round(sec * T.FPS))); }
      if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
      console.log('Stills in', dir);
      return;
    }
    const wav = path.join(OUT, 'music.wav'), music = Music.render();
    fs.writeFileSync(wav, Music.wav(music.left, music.right, music.rate));
    const from = Number(opt('--from', '0')), to = Number(opt('--to', String(T.DURATION)));
    const f0 = Math.round(from * T.FPS), f1 = Math.round(to * T.FPS);
    const w = Math.round(T.W * scale), h = Math.round(T.H * scale);
    const mp4 = path.join(OUT, opt('--out', `notebook-motion-${w}x${h}.mp4`));
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(T.FPS), '-c:v', 'png', '-i', '-',
      '-ss', String(from), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', mp4],
    { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    const done = new Promise((ok, bad) => ff.on('close', (code) => (code ? bad(new Error('ffmpeg exited ' + code)) : ok())));
    const started = Date.now();
    for (let f = f0; f < f1; f++) {
      const png = await frameAt(f);
      if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once('drain', ok));
      if ((f - f0) % 24 === 0) console.log(`frame ${f}/${f1}  (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    await done;
    if (errors.length) throw new Error('Page errors: ' + errors.join('; '));
    fs.writeFileSync(path.join(OUT, 'render.json'), JSON.stringify({ output: path.basename(mp4), width: w, height: h, fps: T.FPS, frames: f1 - f0, bpm: T.BPM, audioPeak: music.peak, seconds: Math.round((Date.now() - started) / 1000) }, null, 2) + '\n');
    console.log('Wrote', mp4);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
