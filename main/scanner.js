// Recognises new photos and videos in the background (build plan A1/A2) and keeps the results:
// `ai` on each item (type, colours, styles) and a fingerprint per item in <library>/ai/embeddings.json
// for suggested groups. The user's corrections (`labels`) are never touched here.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { DEFAULT_STYLES, TYPES_VERSION } = require('./recognise');
const { isRaw } = require('./raw');
// The picture recognition looks at: a video's (or RAW photo's) preview, otherwise the file itself.
const pictureOf = (it) => (it.kind === 'video' || isRaw(it.file) ? it.thumb : it.file);

const IDLE_MS = Number(process.env.NOTEBOOK_IDLE_MS) || 60 * 1000; // close the recognition process after this long idle
const VERSION = 3; // bump to re-scan everything after a recogniser change (corrections still stay)

class Scanner {
  // fork(file) starts the worker process; onProgress({ state, done, total, device, error }); onChanged() after results land.
  constructor({ modelsDir, fork, onProgress, onChanged, log = console }) {
    Object.assign(this, { modelsDir, fork, onProgress, onChanged, log });
    this.state = { state: 'idle', done: 0, total: 0 };
    this.worker = null; this.pending = new Map(); this.seq = 0; this.running = false; this.lib = null; this.emb = null;
  }

  set(s) { this.state = { ...this.state, ...s }; this.onProgress(this.state); }

  // The recognition process holds its models in memory (several GB of graphics memory), so it's only
  // kept while there's work: after a minute with nothing to do it's closed, and started again on demand.
  ask(msg) {
    clearTimeout(this.idleTimer);
    if (!this.worker) {
      const w = this.worker = this.fork(path.join(__dirname, 'recognise-worker.js'));
      w.on('message', (m) => { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p(m); } this.idleSoon(); });
      w.on('exit', () => {
        if (this.worker !== w) return; // an old one closing after a new one started
        this.worker = null;
        for (const p of this.pending.values()) p({ ok: false, error: 'The recognition process stopped.' });
        this.pending.clear();
      });
    }
    const id = ++this.seq;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.worker.postMessage({ ...msg, id, modelsDir: this.modelsDir }); });
  }

  idleSoon() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.pending.size && !this.running && this.worker) { const w = this.worker; this.worker = null; w.kill(); } }, IDLE_MS);
  }

  // How likely a picture is to be AI-made (0 to 1), from its bytes; null if the detector isn't available.
  async aiScore(bytes, strict = false) {
    const res = await this.ask({ cmd: 'aicheck', bytes, strict });
    return res.ok ? res.score : null;
  }

  // Ideas are about to be looked for: the models they need start loading now, together.
  warmIdeas(ai) { return this.ask({ cmd: 'warm', ai: !!ai }).then((r) => r.ok); }

  // A picture's fingerprint from its bytes (same kind as the library's), or null if recognition isn't available.
  async embed(bytes) {
    const res = await this.ask({ cmd: 'embed', bytes });
    return res.ok ? res.embedding : null;
  }

  // Which pictures show `text` (e.g. "PC"): ids, best first. Compared with every picture's fingerprint;
  // a picture counts when it's close to the best match and clearly related at all.
  async searchPictures(lib, text) {
    const res = await this.ask({ cmd: 'query', text: String(text).slice(0, 80) });
    if (!res.ok) return [];
    const emb = await this.embeddings(lib), q = res.embedding;
    const scored = lib.data.items.filter((it) => !it.deletedAt && emb[it.id] && emb[it.id].length === q.length)
      .map((it) => ({ id: it.id, s: emb[it.id].reduce((t, x, i) => t + x * q[i], 0) })).sort((a, b) => b.s - a.s);
    if (!scored.length) return [];
    const line = Math.max(0.2, scored[0].s - 0.045);
    return scored.filter((x) => x.s >= line).map((x) => x.id);
  }

  embPath() { return path.join(this.lib.root, 'ai', 'embeddings.json'); }
  async loadEmbeddings() {
    if (this.emb) return this.emb;
    try { this.emb = JSON.parse(await fsp.readFile(this.embPath(), 'utf8')); } catch { this.emb = {}; }
    return this.emb;
  }
  async saveEmbeddings() {
    await fsp.mkdir(path.dirname(this.embPath()), { recursive: true });
    const tmp = this.embPath() + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(this.emb));
    await fsp.rename(tmp, this.embPath());
  }

  // What still needs looking at: photos and videos (by their preview) without an up-to-date result.
  needs(lib) {
    const styles = lib.styles(DEFAULT_STYLES).join('|');
    return lib.data.items.filter((it) => !it.deletedAt && it.kind !== 'note' && (!it.ai || it.ai.v !== VERSION || (it.ai.styles && it.ai.stylesFor !== styles)))
      .filter((it) => { const f = pictureOf(it); return f && fs.existsSync(lib.p(f)); });
  }

  // Starts (or restarts) scanning the library. Safe to call often: only one run at a time.
  async start(lib) {
    if (this.lib !== lib) { this.lib = lib; this.emb = null; }
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do {
        this.again = false;
        const todo = this.needs(lib);
        if (!todo.length) { await this.retype(lib); this.set({ state: 'idle', done: 0, total: 0 }); break; }
        await this.loadEmbeddings();
        this.set({ state: 'scanning', done: 0, total: todo.length, error: null });
        let lastSave = Date.now();
        for (let i = 0; i < todo.length; i++) {
          if (this.lib !== lib) return;
          const it = todo[i];
          const styles = lib.styles(DEFAULT_STYLES);
          const res = await this.ask({ cmd: 'analyse', file: lib.p(pictureOf(it)), styles, hint: it.originalName || it.title });
          if (!res.ok) {
            if (res.missingModels) { this.set({ state: 'needs-setup', error: 'The recognition models are not on this PC yet.' }); return; }
            this.log.error('recognition', it.id, res.error);
            lib.setAi(it.id, { v: VERSION, failed: true, at: new Date().toISOString() });
          } else {
            const r = res.result;
            lib.setAi(it.id, { v: VERSION, tv: TYPES_VERSION, type: { main: r.type.main, extra: r.type.extra, conf: +(r.type.scores[r.type.main] || 0).toFixed(3) }, colours: r.colours || [], styles: r.styles, styleScores: r.styleScores ? Object.fromEntries(Object.entries(r.styleScores).map(([k, v]) => [k, +v.toFixed(3)])) : undefined, stylesFor: r.styles ? styles.join('|') : undefined, at: new Date().toISOString() });
            this.emb[it.id] = r.embedding;
          }
          this.set({ done: i + 1, device: res.device });
          if (Date.now() - lastSave > 1500 || i === todo.length - 1) { await lib.save(); await this.saveEmbeddings(); lastSave = Date.now(); this.onChanged(); }
        }
      } while (this.again);
      this.set({ state: 'idle', done: 0, total: 0 });
    } catch (err) {
      this.log.error('scanner', err);
      this.set({ state: 'error', error: err.message });
    } finally { this.running = false; this.idleSoon(); }
  }

  // After the list of types changed: what each picture is, worked out again from its fingerprint (no re-scan).
  async retype(lib) {
    await this.loadEmbeddings();
    const old = lib.data.items.filter((it) => it.ai && it.ai.v === VERSION && !it.ai.failed && (it.ai.tv || 1) !== TYPES_VERSION && this.emb[it.id]);
    for (let i = 0; i < old.length; i += 100) {
      const chunk = old.slice(i, i + 100);
      const res = await this.ask({ cmd: 'types', embs: chunk.map((it) => this.emb[it.id]) });
      if (!res.ok) return;
      chunk.forEach((it, k) => { const t = res.result[k]; lib.setAi(it.id, { ...it.ai, tv: TYPES_VERSION, type: { main: t.main, extra: t.extra, conf: +(t.scores[t.main] || 0).toFixed(3) } }); });
    }
    if (old.length) { await lib.save(); this.onChanged(); }
  }

  // Look at everything again (e.g. after changing the style list). Corrections are kept.
  async rescan(lib) {
    for (const it of lib.data.items) if (it.ai) it.ai.v = 0;
    await lib.save();
    return this.start(lib);
  }

  async embeddings(lib) { if (this.lib !== lib) { this.lib = lib; this.emb = null; } return this.loadEmbeddings(); }
  stop() { if (this.worker) this.worker.kill(); this.worker = null; }
}

module.exports = { Scanner, VERSION };
