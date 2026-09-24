// The Pinterest panel (build plan B2): the real Pinterest website inside the app, signed in as you
// (its own saved session, separate from everything else), with "Save to library". Nothing is saved
// unless you press Save or choose "Save to Notebook" on a pin. The rest of the app stays offline.
const path = require('path');
const fs = require('fs');
const { WebContentsView, Menu, shell, app } = require('electron');
const { attachAdFilter } = require('./adfilter');

const HOME = 'https://www.pinterest.com/';
const PARTITION = 'persist:pinterest';
const pinOf = (url) => { try { const u = new URL(url); return /pinterest\.|^pin\.it$/.test(u.hostname) && /^\/pin\/[\w-]+/.test(u.pathname) ? `https://www.pinterest.com${u.pathname.match(/^\/pin\/[\w-]+/)[0]}/` : null; } catch { return null; } };
// Sign-in pages Pinterest opens in a pop-up (Google, Apple, Facebook): allowed in a small window with the same session.
const SIGN_IN = /(^|\.)(pinterest\.[a-z.]+|google\.com|accounts\.google\.com|appleid\.apple\.com|facebook\.com)$/i;

// The panel reopens where you left it (even after a restart). Only Pinterest pages are remembered.
const lastFile = () => path.join(app.getPath('userData'), 'pinterest-last.json');
const isPinterest = (url) => { try { return /(^|\.)pinterest\.[a-z.]+$/i.test(new URL(url).hostname); } catch { return false; } };
function lastPage() { try { const u = JSON.parse(fs.readFileSync(lastFile(), 'utf8')).url; return isPinterest(u) ? u : HOME; } catch { return HOME; } }

function setupPinterest({ getWin, handle, send, save }) {
  let view = null, loading = false;
  // While another page is loading, there's nothing to save yet (so Save can never save the pin you just left).
  const state = () => ({ url: view ? view.webContents.getURL() : null, pin: view && !loading ? pinOf(view.webContents.getURL()) : null, canBack: !!(view && view.webContents.navigationHistory.canGoBack()) });
  const tell = () => send('pin:state', state());

  function make() {
    view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'pinterest-preload.js') } });
    view.setBackgroundColor('#0A0A0A');
    const wc = view.webContents;
    attachAdFilter(wc); // promoted pins are taken out before Pinterest's page sees them
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
