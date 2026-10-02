// Phone Gallery is independent of library.json, imported copies and Notebook's Bin.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const UUID = /^[0-9a-f-]{36}$/;
const ITEM = /^[a-zA-Z0-9_-]{1,80}:(image|video):[0-9]{1,20}$/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function read(req) {
  const chunks = []; let bytes = 0;
  for await (const c of req) { bytes += c.length; if (bytes > 1024 * 1024) throw fail('Gallery message too large.', 413); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail('Invalid Gallery message.'); }
}
function atomic(file, data) { fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); }
function item(value) {
  if (!value || !ITEM.test(value.key) || typeof value.fingerprint !== 'string' || value.fingerprint.length > 256) throw fail('Invalid Gallery item.');
  return { key: value.key, fingerprint: value.fingerprint };
}

class Gallery {
  constructor(dir) {
    this.dir = dir; this.cache = path.join(dir, 'cache'); this.journal = path.join(dir, 'operations');
    fs.mkdirSync(this.cache, { recursive: true }); fs.mkdirSync(this.journal, { recursive: true });
    // Session-only media: never show cached photos after access is revoked or the app restarts.
    for (const f of fs.readdirSync(this.cache)) fs.rmSync(path.join(this.cache, f), { force: true });
    this.sessions = new Map(); this.pending = new Map(); this.files = new Map(); this.inflight = new Map(); this.bytes = 0;
  }
  status() {
    return [...this.sessions.values()].map(s => ({ deviceId: s.deviceId, name: s.name, sessionId: s.id,
      scope: s.scope, ready: s.ready && Date.now() - s.seen < 30000, lastSeen: s.seen }));
  }
  session(deviceId) {
    const s = this.sessions.get(deviceId);
    if (!s || !s.ready || Date.now() - s.seen > 30000) throw fail('Start Gallery cleanup on your phone (Notebook → Sync → Start cleanup). You can put the phone away after that.', 409);
    return s;
  }
  revoke(deviceId) {
    const s = this.sessions.get(deviceId); if (s?.wake) s.wake(null);
    this.sessions.delete(deviceId);
    for (const [id, p] of this.pending) if (p.deviceId === deviceId) { p.upload?.destroy(); this.finish(id, { error: 'Phone session ended. Reconnect and check the operation before trying again.' }); }
    for (const [key, f] of this.files) if (f.deviceId === deviceId) { fs.rmSync(f.file, { force: true }); this.bytes -= f.size; this.files.delete(key); }
  }
  close() { for (const id of this.sessions.keys()) this.revoke(id); }
  cancelReads(deviceId, previewsOnly = false) {
    for (const [id,p] of this.pending) if(p.deviceId===deviceId && (previewsOnly === 'video' ? ['video'] : previewsOnly ? ['preview','video'] :['list','thumb','preview','video']).includes(p.cmd.kind)) {
      p.upload?.destroy(); this.finish(id,{error:'Preview cancelled.'});
    }
  }
  operationFile(id) { if (!UUID.test(id)) throw fail('Invalid operation.'); return path.join(this.journal, id + '.json'); }
  history(deviceId) {
    return fs.readdirSync(this.journal).filter(f => /^[0-9a-f-]{36}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(this.journal, f), 'utf8')))
      .filter(o => o.deviceId === deviceId).sort((a, b) => b.created - a.created).slice(0, 50);
  }
  saveOperation(o) { atomic(this.operationFile(o.id), o); }
  command(deviceId, kind, args = {}, id = crypto.randomUUID()) {
    const s = this.session(deviceId);
    if (this.pending.size >= 96) throw fail('Gallery is busy. Try again in a moment.', 429);
    const long = kind === 'video' || kind === 'hash'; // (hashing reads every file of a batch on the phone)
    const cmd = { id, sessionId: s.id, kind, args, expiresAt: Date.now() + (long ? 180000 : 45000) };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.finish(id, { error: 'Phone did not finish this request. Reconnect to check its status.' }), kind === 'video' ? 180000 : kind === 'hash' || kind === 'trash' || kind === 'restore' ? 600000 : 45000); // (a batch waits for you to tap the phone's confirmation notification)
      this.pending.set(id, { deviceId, sessionId: s.id, cmd, resolve, reject, timer });
    });
    s.queue.push(cmd); if (s.wake) s.wake();
    return { id, promise };
  }
  finish(id, result) {
    const p = this.pending.get(id); if (!p) return;
    this.pending.delete(id); clearTimeout(p.timer);
    const s = this.sessions.get(p.deviceId); if (s) s.queue = s.queue.filter(c => c.id !== id);
    try { if (['trash', 'restore', 'reconcile'].includes(p.cmd.kind)) {
      const file = this.operationFile(p.cmd.args.operationId || id);
      if (fs.existsSync(file)) {
        const o = JSON.parse(fs.readFileSync(file, 'utf8'));
        o.status = result.error ? 'unknown' : result.status || 'unknown';
        o.results = Array.isArray(result.results) ? result.results.slice(0, 200) : [];
        o.message = result.error || result.message || ''; this.saveOperation(o);
      }
    }
    } catch (e) { p.reject(fail('Could not save the batch result. Reconnect and check it before continuing.', 500)); return; }
    if (result.error) p.reject(fail(String(result.error).slice(0, 400), 409)); else p.resolve(result);
  }
  async list(deviceId, cursor) { return this.command(deviceId, 'list', { cursor: cursor || null }).promise; }
  async mutate(deviceId, action, values, restoreFrom) {
    if (!['trash', 'restore'].includes(action) || !Array.isArray(values) || !values.length || values.length > 200) throw fail('Choose between 1 and 200 items.');
    this.session(deviceId);
    if (this.history(deviceId).some(o => ['submitted', 'unknown', 'awaiting consent', 'reconciling'].includes(o.status))) throw fail('Check the previous operation before starting another batch.');
    let items = values.map(item);
    if (new Set(items.map(i => i.key)).size !== items.length) throw fail('Duplicate items in batch.');
    if (action === 'restore') {
      const prior = JSON.parse(fs.readFileSync(this.operationFile(restoreFrom), 'utf8'));
      if (prior.deviceId !== deviceId || prior.action !== 'trash') throw fail('That trash batch belongs to another phone.');
      items = items.map(i => {
        const r = prior.results.find(r => r.key === i.key && r.state === 'trashed');
        if (!r?.fingerprint) throw fail('Only confirmed trashed items can be restored.');
        return { key: i.key, fingerprint: r.fingerprint };
      });
    }
    const id = crypto.randomUUID(), o = { id, deviceId, action, items, created: Date.now(), status: 'submitted', results: [], ...(action === 'restore' ? { restoreFrom } : {}) };
    this.saveOperation(o);
    try { this.command(deviceId, action, { items, restoreFrom }, id).promise.catch(() => {}); }
    catch (e) { o.status = 'failed'; o.message = e.message; this.saveOperation(o); throw e; }
    return o;
  }
  // The Google Photos copies of a finished trash batch (see gphotos.js): the phone reads each trashed file's SHA-1,
  // Google Photos' copies with that SHA-1 go to its trash, and which ones did is kept with the batch for Restore.
  async cloudTrash(deviceId, operationId, photos) {
    const o = JSON.parse(fs.readFileSync(this.operationFile(operationId), 'utf8'));
    if (o.deviceId !== deviceId || o.action !== 'trash') throw fail('Wrong batch.');
    if (o.cloud?.done) return o.cloud;
    const keys = (o.results || []).filter(r => r.state === 'trashed').map(r => r.key);
    if (!keys.length) return { done: true, keys: {}, notBackedUp: 0, unreadable: 0 };
    const { hashes = {} } = await this.command(deviceId, 'hash', { keys }).promise;
    const byHash = {}; for (const k of keys) if (typeof hashes[k] === 'string') byHash[hashes[k]] = k;
    const r = await photos.trash(Object.keys(byHash));
    o.cloud = { done: true, at: Date.now(), keys: Object.fromEntries(Object.entries(r.found).map(([h, d]) => [byHash[h], d])), notBackedUp: r.missing.length, unreadable: keys.length - Object.keys(byHash).length };
    this.saveOperation(o); return o.cloud;
  }
  // After a restore batch, its Google Photos copies come back out of Google's trash too.
  async cloudRestore(deviceId, operationId, photos) {
    const o = JSON.parse(fs.readFileSync(this.operationFile(operationId), 'utf8'));
    if (o.deviceId !== deviceId || o.action !== 'restore' || !o.restoreFrom || o.cloudRestored) return { restored: 0 };
    const from = JSON.parse(fs.readFileSync(this.operationFile(o.restoreFrom), 'utf8'));
    const back = (o.results || []).filter(r => r.state === 'restored').map(r => from.cloud?.keys?.[r.key]).filter(Boolean);
    const r = back.length ? await photos.restore(back) : { restored: 0 };
    o.cloudRestored = true; this.saveOperation(o); return r;
  }
  async reconcile(deviceId, operationId) {
    const o = JSON.parse(fs.readFileSync(this.operationFile(operationId), 'utf8'));
    if (o.deviceId !== deviceId) throw fail('Wrong phone.');
    return this.command(deviceId, 'reconcile', { operationId, action: o.action, items: o.items }).promise;
  }
  async media(deviceId, value, kind) {
    const s = this.session(deviceId), it = item(value);
    if (!['thumb', 'preview', 'video'].includes(kind)) throw fail('Invalid preview.');
    const key = crypto.createHash('sha256').update(JSON.stringify([deviceId, s.id, it, kind])).digest('hex');
    if (this.files.has(key)) return this.files.get(key).url;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const pending = this.command(deviceId, kind, { item: it });
    this.pending.get(pending.id).cacheKey = key;
    const work = pending.promise.then(r => r.url).finally(() => this.inflight.delete(key));
    this.inflight.set(key, work); return work;
  }
  file(key) {
    const f = this.files.get(key);
    if (!f) return null;
    try { this.session(f.deviceId); } catch { return null; }
    return f.file;
  }
  async routes(req, res, device, route) {
    if (!req.socket.encrypted || !device.secure) throw fail('Scan the new secure pairing QR code before using Gallery.', 403);
    if (route === '/api/gallery/session' && req.method === 'POST') {
      const b = await read(req);
      if (!UUID.test(b.sessionId) || typeof b.scope !== 'string' || b.scope.length > 80) throw fail('Invalid session.');
      this.revoke(device.deviceId);
      this.sessions.set(device.deviceId, { deviceId: device.deviceId, name: device.name, id: b.sessionId, scope: b.scope, seen: Date.now(), ready: true, queue: [] });
      return json(res, { ok: true });
    }
    const s = this.sessions.get(device.deviceId);
    if (!s || req.headers['x-gallery-session'] !== s.id) throw fail('Gallery session expired. Start it again on the phone.', 409);
    if (route === '/api/gallery/stop' && req.method === 'POST') { this.revoke(device.deviceId); return json(res, { ok: true }); }
    if (route === '/api/gallery/poll' && req.method === 'POST') {
      const b = await read(req); s.seen = Date.now(); s.ready = b.ready === true;
      if (typeof b.scope === 'string' && b.scope !== s.scope) { this.revoke(device.deviceId); return json(res, { restart: true }); }
      if (s.wake) s.wake(null);
      const next = () => { if (!s.ready) return null; let c; while ((c = s.queue.shift())) { if (c.expiresAt > Date.now() && this.pending.has(c.id)) return c; this.finish(c.id, { error: 'Unstarted request expired.' }); } return null; };
      let command = next();
      if (!command) command = await new Promise(resolve => {
        const done = () => { clearTimeout(timer); s.wake = null; resolve(next()); };
        const timer = setTimeout(done, 15000); s.wake = done; res.once('close', done);
      });
      s.seen = Date.now(); if (!res.destroyed) json(res, { command }); return;
    }
    const id = route.split('/').at(-1), p = this.pending.get(id);
    if (!p || p.deviceId !== device.deviceId || p.sessionId !== s.id) throw fail('Request expired.', 410);
    if (route === '/api/gallery/result/' + id && req.method === 'POST') {
      const b = await read(req); this.finish(id, b); return json(res, { ok: true });
    }
    if (route === '/api/gallery/stream/' + id && req.method === 'PUT' && p.cacheKey && !p.uploading) {
      p.uploading = true;
      p.upload = req;
      const type = req.headers['content-type'], video = p.cmd.kind === 'video';
      if ((!video && type !== 'image/jpeg') || (video && !['video/mp4', 'video/webm', 'video/quicktime'].includes(type))) throw fail('Unsupported preview format.');
      const limit = video ? 256 * 1024 * 1024 : p.cmd.kind === 'thumb' ? 1024 * 1024 : 8 * 1024 * 1024;
      const ext = video ? type === 'video/webm' ? '.webm' : '.mp4' : '.jpg';
      const file = path.join(this.cache, p.cacheKey + ext), tmp = file + '.tmp'; let size = 0;
      try {
        await pipeline(req, new Transform({ transform(c, _e, cb) { size += c.length; cb(size > limit ? fail('Preview exceeds the size limit.', 413) : null, c); } }), fs.createWriteStream(tmp, { flags: 'wx' }));
        if (!size || !this.pending.has(id) || this.sessions.get(device.deviceId) !== s || !s.ready) throw fail('Preview cancelled.');
        // ponytail: FIFO byte-bounded cache; use LRU only if profiling shows excessive repeated decodes.
        while (this.bytes + size > 384 * 1024 * 1024 && this.files.size) {
          const [k, f] = this.files.entries().next().value; fs.rmSync(f.file, { force: true }); this.bytes -= f.size; this.files.delete(k);
        }
        fs.renameSync(tmp, file);
        const url = 'nb://notebook/gallery/' + p.cacheKey;
        this.files.set(p.cacheKey, { file, url, size, deviceId: device.deviceId }); this.bytes += size;
        this.finish(id, { url }); return json(res, { ok: true });
      } finally { fs.rmSync(tmp, { force: true }); }
    }
    throw fail('Unknown Gallery request.', 404);
  }
}
module.exports = { Gallery, item };
