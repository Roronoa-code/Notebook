// Phone <-> PC sync server (docs/SYNC.md). Plain Node http + dgram, no framework, no Electron,
// so scripts/test-sync.js can run it for real. Paired phones and the PC's id live in a settings
// file next to the app's config, never in the library.
const http = require('http');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { SyncError, ID_RE, forPhone, boardsForPhone } = require('./merge');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_MS = 10 * 60 * 1000;
const WRONG_LIMIT = 10; // wrong pairing codes allowed per minute
const PORT = 47821;
const DISCOVERY_PORT = 47822;
const PORT_TRIES = 10;
const MAX_JSON = 200 * 1024 * 1024;
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.heic': 'image/heic', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime'
};
const WRONG_CODE = 'That pairing code is wrong or has expired. Show a new one on the PC.';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();

// Loopback or private addresses only: 10/8, 172.16/12, 192.168/16, 169.254/16 (plus IPv6 loopback).
function isPrivateAddress(address) {
  let a = String(address || '');
  if (a === '::1') return true;
  if (a.toLowerCase().startsWith('::ffff:')) a = a.slice(7);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m || m.slice(1).some((n) => Number(n) > 255)) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
}

const VIRTUAL = /vethernet|virtual|vmware|vbox|hyper-?v|wsl|docker|tailscale|zerotier|vpn|wireguard|nordlynx|hamachi|tap-|tun|loopback|bluetooth|npcap/i;

// The PC's private IPv4 addresses, most likely first. Wi-Fi and Ethernet lead; virtual adapters
// (WSL, Hyper-V, VirtualBox, VPNs) are left out, unless there's nothing else at all.
function candidateAddresses(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const a of list || []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal || a.address.startsWith('169.254.') || a.address.startsWith('127.') || !isPrivateAddress(a.address)) continue;
      const virtual = VIRTUAL.test(name) || a.address.startsWith('192.168.56.');
      const rank = /wi-?fi|wlan|wireless/i.test(name) ? 0 : /ethernet|^eth|^en/i.test(name) ? 1 : 2;
      found.push({ address: a.address, virtual, rank });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  const real = found.filter((a) => !a.virtual);
  return [...new Set((real.length ? real : found).map((a) => a.address))];
}

function makeCode() {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

function send(res, status, body) {
  if (res.headersSent) { res.destroy(); return; }
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json), 'Cache-Control': 'no-store' });
  res.end(json);
}

function readJson(req, limit = MAX_JSON) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new SyncError('That was too much data in one go.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { reject(new SyncError("The phone sent something Notebook couldn't read.", 400)); }
    });
  });
}

function startError(err) {
  if (!err) return "Sync couldn't start.";
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') return `Other programs are using ports ${PORT} to ${PORT + PORT_TRIES - 1}, so sync couldn't start. Restarting the PC usually frees them.`;
  return `Sync couldn't start: ${err.message}`;
}

class SyncServer {
  constructor(opts = {}) {
    this.settingsFile = opts.settingsFile;
    this.host = opts.host || '0.0.0.0';
    this.basePort = opts.port || PORT;
    this.discoveryPort = opts.discoveryPort || DISCOVERY_PORT;
    this.pcName = opts.pcName || os.hostname();
    this.onLibraryChanged = opts.onLibraryChanged || (() => {});
    this.onPhoneLog = opts.onPhoneLog || (() => {});
    this.onStatusChanged = opts.onStatusChanged || (() => {});
    this.onKeepReady = opts.onKeepReady || (() => {});
    this.log = opts.log || console;
    this.lib = null; this.http = null; this.udp = null; this.port = null;
    this.error = null; this.discoveryError = null;
    this.code = null; this.wrong = []; this.qrCache = null;
    this.settings = this.loadSettings();
  }

  // ---------- settings (pcId + paired phones) ----------
  loadSettings() {
    let s = null;
    try { s = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch (err) {
      // A damaged file is kept aside rather than overwritten, then we start fresh.
      if (err.code !== 'ENOENT') try { fs.renameSync(this.settingsFile, this.settingsFile + '.damaged'); } catch {}
    }
    if (!s || typeof s !== 'object') s = {};
    const fresh = !s.pcId;
    if (fresh) s.pcId = crypto.randomUUID();
    if (!Array.isArray(s.devices)) s.devices = [];
    if (fresh) this.saveSettings(s);
    return s;
  }

  saveSettings(s = this.settings) {
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    const tmp = this.settingsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
    fs.renameSync(tmp, this.settingsFile);
  }

  get pcId() { return this.settings.pcId; }

  // ---------- starting and stopping ----------
  async start(lib) {
    await this.stop();
    this.lib = lib;
    this.error = null; this.discoveryError = null;
    let lastErr = null;
    for (let p = this.basePort; p < this.basePort + PORT_TRIES; p++) {
      try { await this.listen(p); this.port = p; break; } catch (err) {
        lastErr = err;
        if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') break;
      }
    }
    if (!this.port) { this.error = startError(lastErr); this.log.error('sync server', lastErr); }
    else await this.startDiscovery();
    this.onStatusChanged();
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((err) => { this.log.error('sync request', err); try { send(res, 500, { error: 'Something went wrong on the PC.' }); } catch {} });
      });
      server.requestTimeout = 0; // big videos can take a while over Wi-Fi
      server.headersTimeout = 30000;
      server.setTimeout(120000); // but a connection that goes silent for 2 minutes is dropped
      server.on('clientError', (_e, socket) => socket.destroy());
      server.once('error', reject);
      server.listen(port, this.host, () => { server.removeListener('error', reject); server.on('error', (e) => this.log.error('sync server', e)); this.http = server; resolve(); });
    });
  }

  startDiscovery() {
    return new Promise((resolve) => {
      const udp = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      udp.once('error', (err) => {
        this.discoveryError = err.code === 'EADDRINUSE' || err.code === 'EACCES'
          ? 'Another program is using the port phones use to find this PC, so your phone may need the QR code again if this PC\'s address changes.'
          : `Your phone may not find this PC by itself if its address changes (${err.message}).`;
        try { udp.close(); } catch {}
        resolve();
      });
      udp.on('message', (msg, rinfo) => {
        if (msg.toString('utf8').trim() !== 'NOTEBOOK_DISCOVER' || !isPrivateAddress(rinfo.address) || !this.port) return;
        const reply = Buffer.from(JSON.stringify({ app: 'Notebook', pcId: this.pcId, name: this.pcName, port: this.port }));
        udp.send(reply, rinfo.port, rinfo.address, () => {});
      });
      udp.bind(this.discoveryPort, this.host, () => {
        udp.removeAllListeners('error');
        udp.on('error', (e) => this.log.error('discovery', e));
        this.udp = udp;
        resolve();
      });
    });
  }

  async stop() {
    const server = this.http, udp = this.udp;
    this.http = null; this.udp = null; this.port = null;
    if (udp) await new Promise((r) => { try { udp.close(r); } catch { r(); } });
    if (server) await new Promise((r) => { server.close(() => r()); server.closeAllConnections(); });
  }

  // ---------- pairing ----------
  newCode() {
    this.code = { value: makeCode(), expiresAt: Date.now() + CODE_MS, used: false };
    this.onStatusChanged();
    return this.code.value;
  }

  codeState() {
    if (!this.code) return 'none';
    if (this.code.used) return 'used';
    return Date.now() < this.code.expiresAt ? 'ready' : 'expired';
  }

  unpair(deviceId) {
    this.settings.devices = this.settings.devices.filter((d) => d.deviceId !== deviceId);
    this.saveSettings();
    this.onStatusChanged();
  }

  setKeepReady(on) {
    this.settings.keepReady = !!on;
    this.saveSettings();
    this.onStatusChanged();
  }

  pairUrl() {
    if (!this.port || this.codeState() !== 'ready') return null;
    return `notebook://pair?h=${candidateAddresses().join(',')}&p=${this.port}&c=${this.code.value}&id=${this.pcId}`;
  }

  // What the Phone panel shows.
  async status() {
    const url = this.pairUrl();
    if (url && (!this.qrCache || this.qrCache.url !== url)) {
      this.qrCache = { url, qr: await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 480, color: { dark: '#000000', light: '#ffffff' } }) };
    }
    const state = this.codeState();
    return {
      running: !!this.port, port: this.port, error: this.error, discoveryError: this.discoveryError,
      pcName: this.pcName, addresses: candidateAddresses(),
      codeState: state, code: state === 'ready' ? this.code.value : null, codeExpiresAt: state === 'ready' ? this.code.expiresAt : null,
      pairUrl: url, qr: url ? this.qrCache.qr : null,
      keepReady: !!this.settings.keepReady,
      devices: this.settings.devices.map(({ deviceId, name, pairedAt, lastSyncAt }) => ({ deviceId, name, pairedAt, lastSyncAt }))
    };
  }

  deviceFor(req) {
    const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    const hash = Buffer.from(sha256(m[1].toLowerCase()), 'hex');
    return this.settings.devices.find((d) => {
      const stored = Buffer.from(String(d.tokenSha256 || ''), 'hex');
      return stored.length === hash.length && crypto.timingSafeEqual(stored, hash);
    }) || null;
  }

  async pair(req, res) {
    const t = Date.now();
    this.wrong = this.wrong.filter((x) => t - x < 60000);
    if (this.wrong.length >= WRONG_LIMIT) return send(res, 429, { error: 'Too many wrong codes. Wait a minute, then try again.' });
    const body = await readJson(req, 64 * 1024);
    const deviceId = body && typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    if (!deviceId || deviceId.length > 100) return send(res, 400, { error: 'The phone didn\'t say who it is. Update Notebook on the phone and try again.' });
    const given = Buffer.from(String((body && body.code) || '').toUpperCase().replace(/[\s-]/g, ''));
    const ok = this.codeState() === 'ready' && given.length === CODE_LENGTH && crypto.timingSafeEqual(given, Buffer.from(this.code.value));
    if (!ok) { this.wrong.push(t); return send(res, 403, { error: WRONG_CODE }); }
    this.code.used = true;
    const token = crypto.randomBytes(32).toString('hex');
    const name = String(body.deviceName || 'Phone').trim().slice(0, 60) || 'Phone';
    this.settings.devices = this.settings.devices.filter((d) => d.deviceId !== deviceId);
    this.settings.devices.push({ deviceId, name, tokenSha256: sha256(token), pairedAt: nowIso(), lastSyncAt: null });
    // The first phone switches on "Keep Notebook ready for your phone", unless it was turned off before.
    const firstKeepReady = this.settings.keepReady === undefined;
    if (firstKeepReady) this.settings.keepReady = true;
    this.saveSettings();
    if (firstKeepReady) this.onKeepReady(true);
    this.onStatusChanged();
    send(res, 200, { token, pcId: this.pcId, pcName: this.pcName });
  }

  // ---------- requests ----------
  async handle(req, res) {
    if (!isPrivateAddress(req.socket.remoteAddress)) {
      res.setHeader('Connection', 'close');
      return send(res, 403, { error: 'Notebook only accepts connections from your home network.' });
    }
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.replace(/\/+$/, '');
    try {
      if (route === '/api/pair') {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST to pair.' });
        return await this.pair(req, res);
      }
      const device = this.deviceFor(req);
      if (!device) { res.setHeader('Connection', 'close'); return send(res, 401, { error: 'not paired' }); }
      if (!this.lib || !this.lib.data) return send(res, 503, { error: "Notebook on the PC hasn't opened a library yet." });
      if (route === '/api/ping' && req.method === 'GET') {
        return send(res, 200, { ok: true, pcId: this.pcId, pcName: this.pcName, items: this.lib.data.items.length });
      }
      if (route === '/api/sync' && req.method === 'POST') return await this.sync(req, res, device);
      if (route.startsWith('/api/feed')) return await this.ideas(req, res, route);
      // The phone's error log, handed over with a sync (written into the PC's error log).
      if (route === '/api/log' && req.method === 'POST') {
        const body = await readJson(req, 80 * 1024);
        if (typeof body.text !== 'string' || body.text.length > 64 * 1024) throw new SyncError('That log isn’t readable.', 400);
        this.onPhoneLog(body.text);
        return send(res, 200, { ok: true });
      }
      const media = /^\/api\/media\/([^/]+)$/.exec(route);
      if (media && ID_RE.test(media[1])) {
        if (req.method === 'GET') return await this.download(res, media[1]);
        if (req.method === 'PUT') return await this.upload(req, res, media[1]);
      }
      return send(res, 404, { error: "Notebook on the PC doesn't know that request." });
    } catch (err) {
      const status = err.status || (err.code === 'ENOSPC' ? 507 : 500);
      if (status >= 500) this.log.error('sync request', err);
      const message = err.friendly || (err.code === 'ENOSPC' ? "The PC's drive is full." : `Something went wrong on the PC: ${err.message}`);
      // An upload refused before its bytes were read: drop the connection rather than read gigabytes.
      if (!req.readableEnded) {
        if (Number(req.headers['content-length'] || 0) <= 1024 * 1024) req.resume();
        else { res.setHeader('Connection', 'close'); res.on('finish', () => req.destroy()); }
      }
      return send(res, status, { error: message });
    }
  }

  async sync(req, res, device) {
    const body = await readJson(req);
    const { pcNeeds, changed } = await this.lib.mergeRemote(body);
    const d = this.lib.data;
    const answer = { boards: boardsForPhone(d.boards), items: forPhone(d.items, pcNeeds, d.boards), tombstones: d.tombstones, pcNeeds, serverTime: nowIso() };
    device.lastSyncAt = answer.serverTime;
    try { this.saveSettings(); } catch (err) { this.log.error('sync settings', err); }
    if (changed || pcNeeds.length) this.onLibraryChanged({ arrived: [] });
    this.onStatusChanged();
    send(res, 200, answer);
  }

  // Ideas for the phone: every feed, their pictures, and saving or hiding a pin from the phone.
  async ideas(req, res, route) {
    const feed = this.feed;
    if (!feed) return send(res, 404, { error: 'Ideas aren’t available on this PC.' });
    if (route === '/api/feed' && req.method === 'GET') { const q = new URL(req.url, 'http://x').searchParams; return send(res, 200, await feed.forPhone(q.get('want'), q.get('more') === '1')); }
    const img = /^\/api\/feed\/img\/([0-9a-f]{32})$/.exec(route);
    if (img && req.method === 'GET') {
      const file = await feed.image(img[1]);
      if (!file) return send(res, 404, { error: 'That picture isn’t available.' });
      const st = await fs.promises.stat(file);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }
    if ((route === '/api/feed/save' || route === '/api/feed/hide') && req.method === 'POST') {
      const body = await readJson(req, 4096);
      if (!body || typeof body !== 'object') throw new SyncError('The phone sent something Notebook couldn’t read.', 400);
      if (route === '/api/feed/hide') {
        if (!/^\d{1,25}$/.test(String(body.id))) throw new SyncError('That isn’t a pin.', 400);
        await feed.hide(String(body.id));
      } else if (!feed.saveIdea(String(body.url || ''), body.boardId)) throw new SyncError('That isn’t a Pinterest pin.', 400);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Notebook on the PC doesn't know that request." });
  }

  async download(res, id) {
    const m = await this.lib.openMedia(id);
    if (!m) return send(res, 404, { error: "This PC doesn't have that file." });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(m.file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': m.size, 'X-Notebook-File': m.file, 'Cache-Control': 'no-store'
    });
    m.stream.on('error', () => res.destroy());
    res.on('close', () => m.stream.destroy());
    m.stream.pipe(res);
  }

  async upload(req, res, id) {
    const raw = String(req.headers['x-notebook-size'] || '');
    const size = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(size)) throw new SyncError('The phone didn\'t say how big the file is.', 400);
    const length = req.headers['content-length'];
    if (length !== undefined && Number(length) !== size) throw new SyncError("The file size doesn't match what the phone said.", 400);
    await this.lib.receiveMedia(id, req, size);
    this.onLibraryChanged({ arrived: [id] });
    send(res, 200, { ok: true });
  }
}

module.exports = { SyncServer, isPrivateAddress, candidateAddresses, makeCode, CODE_ALPHABET, PORT, DISCOVERY_PORT };
