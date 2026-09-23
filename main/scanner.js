// Recognises new photos and videos in the background (build plan A1/A2) and keeps the results:
// `ai` on each item (type, colours, styles) and a fingerprint per item in <library>/ai/embeddings.json
// for suggested groups. The user's corrections (`labels`) are never touched here.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { DEFAULT_STYLES } = require('./recognise');

const VERSION = 2; // bump to re-scan everything after a recogniser change (corrections still stay)

class Scanner {
  // fork(file) starts the worker process; onProgress({ state, done, total, device, error }); onChanged() after results land.
  constructor({ modelsDir, fork, onProgress, onChanged, log = console }) {
    Object.assign(this, { modelsDir, fork, onProgress, onChanged, log });
    this.state = { state: 'idle', done: 0, total: 0 };
    this.worker = null; this.pending = new Map(); this.seq = 0; this.running = false; this.lib = null; this.emb = null;
  }

  set(s) { this.state = { ...this.state, ...s }; this.onProgress(this.state); }

  ask(msg) {
    if (!this.worker) {
      this.worker = this.fork(path.join(__dirname, 'recognise-worker.js'));
      this.worker.on('message', (m) => { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p(m); } });
      this.worker.on('exit', () => { this.worker = null; for (const p of this.pending.values()) p({ ok: false, error: 'The recognition process stopped.' }); this.pending.clear(); });
    }
    const id = ++this.seq;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.worker.postMessage({ ...msg, id, modelsDir: this.modelsDir }); });
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
      .filter((it) => { const f = it.kind === 'video' ? it.thumb : it.file; return f && fs.existsSync(lib.p(f)); });
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
        if (!todo.length) { this.set({ state: 'idle', done: 0, total: 0 }); break; }
        await this.loadEmbeddings();
        this.set({ state: 'scanning', done: 0, total: todo.length, error: null });
        let lastSave = Date.now();
        for (let i = 0; i < todo.length; i++) {
          if (this.lib !== lib) return;
          const it = todo[i];
          const styles = lib.styles(DEFAULT_STYLES);
          const res = await this.ask({ cmd: 'analyse', file: lib.p(it.kind === 'video' ? it.thumb : it.file), styles, hint: it.originalName || it.title });
          if (!res.ok) {
            if (res.missingModels) { this.set({ state: 'needs-setup', error: 'The recognition models are not on this PC yet.' }); return; }
            this.log.error('recognition', it.id, res.error);
            lib.setAi(it.id, { v: VERSION, failed: true, at: new Date().toISOString() });
          } else {
            const r = res.result;
            lib.setAi(it.id, { v: VERSION, type: { main: r.type.main, extra: r.type.extra, conf: +(r.type.scores[r.type.main] || 0).toFixed(3) }, colours: r.colours || [], styles: r.styles, styleScores: r.styleScores ? Object.fromEntries(Object.entries(r.styleScores).map(([k, v]) => [k, +v.toFixed(3)])) : undefined, stylesFor: r.styles ? styles.join('|') : undefined, at: new Date().toISOString() });
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
    } finally { this.running = false; }
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
