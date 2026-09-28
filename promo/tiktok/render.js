// Renders the advert frame by frame (not a screen recording) and encodes it with ffmpeg.
// Usage: node promo/tiktok/render.js            -> out/notebook-tiktok-1440x2560.mp4
//        node promo/tiktok/render.js --stills 1,6.5,10   -> out/still-<seconds>.png only
//        node promo/tiktok/render.js --serve    -> preview player at the printed address
// Pictures come from NOTEBOOK_PROMO_MEDIA (default D:\Notebook Tools\testset\candidates).
// Needs Microsoft Edge (as the phone-screen tests do) and ffmpeg on PATH.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const Film = require('./film.js');
const Music = require('./music.js');

const HERE = __dirname, APP = path.resolve(HERE, '..', '..'), OUT = path.join(HERE, 'out');
const MEDIA = process.env.NOTEBOOK_PROMO_MEDIA || 'D:/Notebook Tools/testset/candidates';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] || ''); };

function serve() {
  const roots = { '/renderer/': path.join(APP, 'renderer'), '/media/': MEDIA, '/': HERE };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const prefix = Object.keys(roots).find((p) => url.startsWith(p));
    const base = roots[prefix], file = path.resolve(base, '.' + url.slice(prefix.length - 1));
    if (!file.startsWith(path.resolve(base)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const address = `http://127.0.0.1:${server.address().port}/index.html`;
  if (args.includes('--serve')) { console.log('Preview:', address); return; }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(address);
    await page.waitForFunction(() => window.filmReady || window.filmError, null, { timeout: 60000 });
    const failed = await page.evaluate(() => window.filmError);
    if (failed) throw new Error(failed);
    const stills = opt('--stills');
    if (stills !== null) {
      for (const sec of stills.split(',').map(Number)) {
        const b64 = await page.evaluate((f) => window.renderFrame(f), Math.round(sec * Film.FPS));
        fs.writeFileSync(path.join(OUT, `still-${sec.toFixed(2)}.png`), Buffer.from(b64, 'base64'));
      }
      console.log('Stills written to', OUT);
      return;
    }
    const wav = path.join(OUT, 'music.wav'), music = Music.render();
    fs.writeFileSync(wav, Music.wav(music.samples, music.rate));
    const mp4 = path.join(OUT, 'notebook-tiktok-1440x2560.mp4'), total = Math.round(Film.DURATION * Film.FPS);
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(Film.FPS), '-c:v', 'png', '-i', '-',
      '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', mp4],
    { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    const done = new Promise((ok, bad) => ff.on('close', (code) => (code ? bad(new Error('ffmpeg exited ' + code)) : ok())));
    for (let f = 0; f < total; f++) {
      const png = Buffer.from(await page.evaluate((n) => window.renderFrame(n), f), 'base64');
      if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once('drain', ok));
      if (f % 60 === 0) console.log(`frame ${f}/${total}`);
    }
    ff.stdin.end();
    await done;
    if (errors.length) throw new Error('Page errors: ' + errors.join('; '));
    fs.writeFileSync(path.join(OUT, 'render.json'), JSON.stringify({ output: path.basename(mp4), width: 1440, height: 2560, fps: Film.FPS, frames: total, bpm: Film.BPM, audioSamplePeak: music.peak, media: MEDIA }, null, 2) + '\n');
    console.log('Wrote', mp4);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
