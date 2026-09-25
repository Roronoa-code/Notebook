// The Pinterest panel (build plan B2): the real Pinterest website inside the app, signed in as you
// (its own saved session, separate from everything else), with "Save to library". Nothing is saved
// unless you press Save or choose "Save to Notebook" on a pin. The rest of the app stays offline.
const path = require('path');
const fs = require('fs');
const { WebContentsView, Menu, shell, app, ipcMain } = require('electron');
const { attachAdFilter } = require('./adfilter');
const { HIDE_AT, VERSION: AI_VERSION } = require('./aidetect');

const HOME = 'https://www.pinterest.com/';
const PARTITION = 'persist:pinterest';
const pinOf = (url) => { try { const u = new URL(url); return /pinterest\.|^pin\.it$/.test(u.hostname) && /^\/pin\/[\w-]+/.test(u.pathname) ? `https://www.pinterest.com${u.pathname.match(/^\/pin\/[\w-]+/)[0]}/` : null; } catch { return null; } };
// Sign-in pages Pinterest opens in a pop-up (Google, Apple, Facebook): allowed in a small window with the same session.
const SIGN_IN = /(^|\.)(pinterest\.[a-z.]+|google\.com|accounts\.google\.com|appleid\.apple\.com|facebook\.com)$/i;

// The panel reopens where you left it (even after a restart). Only Pinterest pages are remembered.
const lastFile = () => path.join(app.getPath('userData'), 'pinterest-last.json');
const isPinterest = (url) => { try { return /(^|\.)pinterest\.[a-z.]+$/i.test(new URL(url).hostname); } catch { return false; } };
function lastPage() { try { const u = JSON.parse(fs.readFileSync(lastFile(), 'utf8')).url; return isPinterest(u) ? u : HOME; } catch { return HOME; } }

// AI-made pins: each pin picture shown is checked once on this PC and the answer remembered (by the
// picture's fingerprint in its address). Pins found to be AI-made are hidden, and taken out of what
// Pinterest sends next time. The setting and answers live in pinterest-ai.json in the app's folder.
const aiFile = () => path.join(app.getPath('userData'), 'pinterest-ai.json');
const signatureOf = (url) => { const m = /\/([0-9a-f]{32})\.(?:jpe?g|png|webp|gif)/i.exec(String(url || '')); return m ? m[1].toLowerCase() : null; };

function setupPinterest({ getWin, handle, send, save, aiScore }) {
  let ai = { hide: true, scores: {} };
  try { ai = { ...ai, ...JSON.parse(fs.readFileSync(aiFile(), 'utf8')) }; } catch { /* first time */ }
  if (ai.v !== AI_VERSION) { ai.scores = {}; ai.v = AI_VERSION; } // answers from an older detector are worked out again
  let aiSaveTimer = null, queue = Promise.resolve(), countTimer = null;
  const hiddenSigs = new Set(); // AI-made pictures kept off the page this time (for the toolbar count)
  const counted = (sig) => { if (!hiddenSigs.has(sig)) { hiddenSigs.add(sig); clearTimeout(countTimer); countTimer = setTimeout(() => send('pin:ai', { hidden: hiddenSigs.size }), 300); } return true; };
  const saveAi = () => { clearTimeout(aiSaveTimer); aiSaveTimer = setTimeout(() => {
    const keys = Object.keys(ai.scores); if (keys.length > 20000) for (const k of keys.slice(0, keys.length - 20000)) delete ai.scores[k];
    fs.promises.writeFile(aiFile(), JSON.stringify(ai)).catch(() => {});
  }, 2000); };
  const isAiSig = (sig) => ai.hide && sig && ai.scores[sig] >= HIDE_AT;
  // A pin in Pinterest's data whose picture is already known to be AI-made.
  const knownAiPin = (o) => {
    if (!ai.hide) return false;
    const sig = isAiSig(o.image_signature) ? o.image_signature : o.images && typeof o.images === 'object' ? Object.values(o.images).map((im) => im && signatureOf(im.url)).find(isAiSig) : null;
    return sig ? counted(sig) : false;
  };
  async function checkPicture(url) {
    const sig = signatureOf(url);
    if (!sig) return { hide: false };
    if (!(sig in ai.scores)) {
      const big = url.replace(/\/\d+x\//, '/474x/'); // a clearer copy than the small grid picture
      queue = queue.then(async () => {
        if (sig in ai.scores) return;
        const get = (u) => view.webContents.session.fetch(u, { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r : null)).catch(() => null); // never hold up the queue
        const res = await get(big) || await get(url);
        if (!res || !res.ok) return;
        const score = await aiScore(Buffer.from(await res.arrayBuffer()));
        if (score == null) return;
        ai.scores[sig] = Math.round(score * 1000) / 1000;
        saveAi();
      }).catch(() => {});
      await queue;
    }
    const hide = isAiSig(sig);
    if (hide) counted(sig);
    return { hide };
  }
  // Before Pinterest's page gets a page of pins, check the pictures it hasn't seen yet, so AI-made pins
  // can be taken out of the data (no gaps in the layout). A few seconds at most; anything not checked
  // by then goes through and is caught on the page instead.
  const PIC = /https:\/\/i\.pinimg\.com\/(?:\d+x|originals)\/(?:[0-9a-f]{2}\/){3}([0-9a-f]{32})\.(?:jpe?g|png|webp)/gi;
  async function precheck(raw) {
    if (!ai.hide || !view) return;
    const todo = new Map();
    for (const m of raw.matchAll(PIC)) { const sig = m[1].toLowerCase(); if (!(sig in ai.scores) && todo.size < 40) todo.set(sig, m[0].replace(/\/(?:\d+x|originals)\//, '/236x/')); }
    if (!todo.size) return;
    const deadline = Date.now() + 4000;
    const get = (u) => view.webContents.session.fetch(u, { signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    const pictures = await Promise.all([...todo].map(async ([sig, u]) => [sig, await get(u)]));
    for (const [sig, bytes] of pictures) {
      if (!bytes || Date.now() > deadline) continue;
      const score = await aiScore(Buffer.from(bytes));
      if (score != null) ai.scores[sig] = Math.round(score * 1000) / 1000;
    }
    saveAi();
  }
  ipcMain.handle('pin:ai', (e, url) => (view && e.sender === view.webContents && /^https:\/\/i\.pinimg\.com\//.test(String(url)) ? checkPicture(String(url)) : { hide: false }));
  handle('pin:aiSetting', (on) => { if (typeof on === 'boolean') { ai.hide = on; saveAi(); if (view) view.webContents.reload(); } return { hide: ai.hide, hidden: hiddenSigs.size }; });

  let view = null, loading = false;
  // While another page is loading, there's nothing to save yet (so Save can never save the pin you just left).
  const state = () => ({ url: view ? view.webContents.getURL() : null, pin: view && !loading ? pinOf(view.webContents.getURL()) : null, canBack: !!(view && view.webContents.navigationHistory.canGoBack()) });
  const tell = () => send('pin:state', state());

  function make() {
    view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'pinterest-preload.js') } });
    view.setBackgroundColor('#0A0A0A');
    const wc = view.webContents;
    attachAdFilter(wc, knownAiPin, precheck); // promoted pins and AI-made pins are taken out before the page sees them
    wc.setWindowOpenHandler(({ url }) => {
      let host = ''; try { host = new URL(url).hostname; } catch { /* ignore */ }
      if (SIGN_IN.test(host)) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: getWin(), webPreferences: { partition: PARTITION, sandbox: true } } };
      if (pinOf(url)) { wc.loadURL(url); return { action: 'deny' }; }
      shell.openExternal(url); // anything else opens in your normal browser
      return { action: 'deny' };
    });
    wc.on('did-start-navigation', (_e, _url, inPage, isMain) => { if (isMain && !inPage) { loading = true; tell(); } });
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-finish-load', 'did-fail-load']) wc.on(ev, () => { loading = false; tell(); });
    let saveTimer = null;
    const remember = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { const url = wc.getURL(); if (isPinterest(url)) fs.promises.writeFile(lastFile(), JSON.stringify({ url })).catch(() => {}); }, 1000); };
    wc.on('did-navigate', remember); wc.on('did-navigate-in-page', remember);
    // Right-click a pin: "Save to Notebook" saves that pin without opening it.
    wc.on('context-menu', (_e, p) => {
      const pin = pinOf(p.linkURL) || pinOf(wc.getURL());
      if (!pin) return;
      Menu.buildFromTemplate([{ label: 'Save to Notebook', click: () => save(pin) }]).popup({ window: getWin() });
    });
    wc.loadURL(lastPage());
  }

  handle('pin:open', (bounds) => {
    const win = getWin();
    if (!view) make();
    win.contentView.addChildView(view);
    if (bounds) view.setBounds(bounds);
    return state();
  });
  handle('pin:bounds', (bounds) => { if (view && bounds) view.setBounds(bounds); });
  handle('pin:close', () => { if (view) getWin().contentView.removeChildView(view); });
  handle('pin:back', () => { if (view && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack(); });
  handle('pin:home', () => { if (view) view.webContents.loadURL(HOME); });
  handle('pin:go', (url) => { if (view && pinOf(url)) view.webContents.loadURL(url); });
  // Save what's open. Only a pin page can be saved.
  handle('pin:save', async () => {
    const pin = view && !loading && pinOf(view.webContents.getURL());
    if (!pin) { const e = new Error(); e.friendly = 'Open a pin first, then press Save to library.'; throw e; }
    return save(pin);
  });
  return { pinOf };
}

module.exports = { setupPinterest, pinOf };
