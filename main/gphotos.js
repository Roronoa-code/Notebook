// Google Photos copies (the owner's request). Samsung Gallery's cloud sync keeps a Google Photos copy of each photo,
// which the phone's trash leaves alone, so a trashed photo still shows in Gallery. After a Gallery batch, Notebook
// finds the cloud copies of exactly those files (by the file's SHA-1, which Google Photos keeps for every backed-up
// copy) and moves them to Google Photos' trash, where they can be restored for 60 days; Restore brings them back.
// Google refuses to sign in inside Electron or in a browser under remote control, so this uses the PC's own Chrome
// (or Edge) with a profile of its own: signed in once in a normal window, then driven without a window, asking
// Google Photos through the same requests its own web page makes. Nothing else is read or changed.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BROWSERS = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
];
const HASH = /^[A-Za-z0-9+/]{27}=$/; // base64 SHA-1
const KEY = /^[A-Za-z0-9_-]{20,40}$/; // Google Photos' dedup key (the hash, URL-safe, no padding)
const fail = (message) => Object.assign(new Error(message), { status: 409 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the Google Photos page: one batchexecute request, as the page itself makes them.
const RPC = `async (rpcid, data) => {
  const g = window.WIZ_global_data; if (!g || !g.SNlM0e) throw new Error('signed out');
  const body = 'f.req=' + encodeURIComponent(JSON.stringify([[[rpcid, JSON.stringify(data), null, 'generic']]])) + '&at=' + encodeURIComponent(g.SNlM0e) + '&';
  const q = new URLSearchParams({ rpcids: rpcid, 'source-path': location.pathname, 'f.sid': g.FdrFJe, bl: g.cfb2h, pageId: 'none', rt: 'c' });
  const r = await fetch('https://photos.google.com' + g.eptZe + 'data/batchexecute?' + q, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
  if (!r.ok) throw new Error('Google Photos answered ' + r.status);
  const line = (await r.text()).split('\\n').find((l) => l.includes('wrb.fr'));
  const payload = line && JSON.parse(line)[0][2];
  return payload ? JSON.parse(payload) : null;
}`;

class GooglePhotos {
  constructor(dir) { this.profile = path.join(dir, 'google-photos'); this.busy = Promise.resolve(); this.window = null; }
  browser() { const b = BROWSERS.find((p) => p && fs.existsSync(p)); if (!b) throw fail('Google Photos needs Chrome or Edge on this PC.'); return b; }
  connected() { return fs.existsSync(path.join(this.profile, 'Default', 'Cookies')) || fs.existsSync(path.join(this.profile, 'Default', 'Network', 'Cookies')); }

  // A normal browser window (no remote control, which Google refuses) for signing in. Resolves when it is closed.
  signIn() {
    if (this.window) return this.window;
    fs.mkdirSync(this.profile, { recursive: true });
    const p = spawn(this.browser(), [`--user-data-dir=${this.profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', 'https://photos.google.com/login'], { stdio: 'ignore' });
    this.window = new Promise((resolve) => p.on('exit', () => { this.window = null; resolve(); }));
    return this.window;
  }

  // Opens the profile without a window, controlled over the DevTools protocol, on the Google Photos page.
  async session(work) {
    if (this.window) await this.window; // the profile can only be open once: wait for the sign-in window to be closed
    fs.mkdirSync(this.profile, { recursive: true });
    const portFile = path.join(this.profile, 'DevToolsActivePort'); fs.rmSync(portFile, { force: true });
    const proc = spawn(this.browser(), [`--user-data-dir=${this.profile}`, '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', windowsHide: true });
    let exited = false; proc.on('exit', () => { exited = true; });
    let ws;
    try {
      let port;
      for (let i = 0; i < 100 && !port; i++) { if (exited) throw fail('The browser closed straight away. If a Google Photos window is open, close it and try again.'); try { port = fs.readFileSync(portFile, 'utf8').split('\n')[0]; } catch { await wait(100); } }
      if (!port) throw fail('The browser did not start.');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      ws = new WebSocket(page.webSocketDebuggerUrl);
      let id = 0; const pending = new Map(), events = [];
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m.method); };
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(fail('Could not reach the browser.')); });
      const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
      const { userAgent } = await send('Browser.getVersion');
      await send('Network.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome') });
      await send('Page.enable');
      await send('Page.navigate', { url: 'https://photos.google.com/' });
      const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || 'Google Photos request failed');
        return r.result.value;
      };
      let ready = false;
      for (let i = 0; i < 150 && !ready; i++) { await wait(100); ready = await evaluate(`location.host === 'photos.google.com' && !!(window.WIZ_global_data && WIZ_global_data.SNlM0e)`).catch(() => false); if (!ready && await evaluate(`location.host`).catch(() => '') === 'accounts.google.com') break; }
      if (!ready) throw fail('Google Photos is signed out. Sign in again from Gallery.');
      const rpc = (rpcid, data) => evaluate(`(${RPC})(${JSON.stringify(rpcid)}, ${JSON.stringify(data)})`);
      return await work({ rpc, evaluate });
    } finally {
      try { ws?.close(); } catch { /* closing anyway */ }
      try { proc.kill(); } catch { /* already gone */ }
    }
  }
  run(work) { const next = this.busy.then(() => this.session(work)); this.busy = next.catch(() => {}); return next; }

  status() { return this.run(async ({ evaluate }) => ({ signedIn: true, account: await evaluate(`WIZ_global_data.oPEP7c || ''`) })); }

  // hashes: base64 SHA-1s of files now in the phone's trash. Returns which had a Google Photos copy, now in its trash.
  trash(hashes) {
    hashes = [...new Set(hashes)].filter((h) => HASH.test(h)).slice(0, 500);
    return this.run(async ({ rpc }) => {
      const found = {};
      for (let i = 0; i < hashes.length; i += 100) {
        const answer = await rpc('swbisb', [hashes.slice(i, i + 100), null, 3, 0]);
        for (const m of answer?.[0] || []) if (HASH.test(m?.[0]) && KEY.test(m?.[1]?.[3] || '')) found[m[0]] = m[1][3];
      }
      const keys = Object.values(found);
      for (let i = 0; i < keys.length; i += 100) await rpc('XwAOJf', [null, 1, keys.slice(i, i + 100), 3]);
      return { found, missing: hashes.filter((h) => !found[h]) };
    });
  }
  restore(keys) {
    keys = [...new Set(keys)].filter((k) => KEY.test(k)).slice(0, 500);
    return this.run(async ({ rpc }) => { for (let i = 0; i < keys.length; i += 100) await rpc('XwAOJf', [null, 3, keys.slice(i, i + 100), 2]); return { restored: keys.length }; });
  }
}

module.exports = { GooglePhotos };
