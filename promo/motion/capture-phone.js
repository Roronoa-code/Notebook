// Screenshots of the real phone screens (phone/app/src/main/assets/www with its PC-preview bridge, mock.js)
// for the motion film. The same promo photos as the desktop capture; nothing in the repo is changed:
// the screens are served as they are, with the photos and a filled library handed to the bridge.
// Usage: node promo/motion/capture-phone.js   -> promo/motion/out/screens/phone-*.png
const fs = require('fs');
const path = require('path');
const http = require('http');
const Photos = require('./photos.js');
const Browser = require('./browser.js');

const WWW = path.resolve(__dirname, '..', '..', 'phone', 'app', 'src', 'main', 'assets', 'www');
const SHOTS = path.join(__dirname, 'out', 'screens');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

function serve(photos) {
  const byName = new Map(photos.map((p, i) => [`p${i}.jpg`, p.file]));
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = url.startsWith('/promo/') ? byName.get(url.slice(7)) : path.resolve(WWW, '.' + url);
    if (!file || (!url.startsWith('/promo/') && !file.startsWith(WWW)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(file);
    // Let the init script fill the bridge's library before the screens read it.
    if (url === '/mock.js') body = Buffer.from(String(body).replace('  window.NB_MOCK_CALLS = [];', '  if (window.__promoFill) window.__promoFill(db, feed, pin);\n  window.NB_MOCK_CALLS = [];'));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// Runs in the page before mock.js: the promo library, boards named as on the PC.
function fill(list) {
  window.__promoFill = (db, feed, pin) => {
    const now = new Date().toISOString(), names = ['Outfits', 'Wallpapers', 'Icons', 'Profile pictures', 'City'];
    db.boards = names.map((name, i) => ({ id: 'b' + i, name, updatedAt: now }));
    db.items = list.map((p, i) => ({ id: 'i' + i, kind: 'photo', title: p.title, file: `../promo/p${i}.jpg`, thumb: `../promo/p${i}.jpg`, w: p.w, h: p.h, boards: ['b' + names.indexOf(p.board)], importedAt: now, updatedAt: now, deletedAt: null }));
    db.sync = { paired: true, pcName: 'Mani’s PC', lastSync: now };
    window.NB_FEED = '../promo/';
    const ideas = list.filter((p) => p.board !== 'Icons').map((p, i) => pin(i + 1, `p${list.indexOf(p)}`, p.w, p.h, p.title));
    feed.feeds = { all: { more: false, pins: ideas.slice(4).concat(ideas.slice(0, 4)) }, b0: { more: false, pins: ideas.filter((x, i) => i % 2 === 0) } };
  };
}

(async () => {
  const photos = Photos.mixed(await Photos.ensure());
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve(photos);
  const browser = await Browser.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(fill, photos.map((p) => ({ title: p.title, board: p.board, w: p.w, h: p.h })));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForTimeout(1500);
    const shot = async (name) => { await page.waitForTimeout(1200); await page.screenshot({ path: path.join(SHOTS, `phone-${name}.png`) }); console.log('shot', name); };
    await shot('home');
    // A quick flick lifts the items panel (as a finger would), showing the mood board.
    const cdp = await page.context().newCDPSession(page);
    const flick = async (fromY, toY) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: fromY }] });
      for (let i = 1; i <= 3; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y: fromY + ((toY - fromY) * i) / 3 }] }); await page.waitForTimeout(8); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await flick(700, 640);
    await shot('grid');
    await page.evaluate(() => document.querySelector('#tab-ideas').click());
    await page.waitForTimeout(800);
    await shot('ideas');
    await page.evaluate(() => document.querySelector('#tab-recent').click());
    await flick(300, 700);
    await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector('#tab-recent').click());
    await page.waitForTimeout(500);
    await page.locator('.pill[data-pill="0"]').click();
    if (!(await page.locator('#boardgrid').count())) await page.locator('.pill[data-pill="0"]').click();
    await shot('board');
    await page.locator('#boardgrid .card').nth(1).click();
    await shot('photo');
    await page.keyboard.press('Escape').catch(() => {});
    await page.goBack().catch(() => {});
    await page.evaluate(() => { history.back(); });
    await page.waitForTimeout(1200);
    await page.locator('#nav-sync').click({ timeout: 5000 }).catch(() => page.evaluate(() => document.querySelector('#nav-sync').click()));
    await shot('sync');
    console.log(errors.length ? 'Page errors:\n' + errors.join('\n') : 'No page errors.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
