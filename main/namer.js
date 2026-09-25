// Proper names for pictures that only have a placeholder title (a camera file name, "Pinterest pin",
// a long post title), never one you typed. Runs after recognition, in its own background process at
// low priority, one picture at a time, only while there are pictures waiting; then the process closes
// so its memory is given back. Without the naming model on this PC, titles are simply left as they are.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanName } = require('./naming');
const { isRaw } = require('./raw');

const NAME_V = 1; // bump to name everything nameable again (e.g. after changing the model)
const MODEL_FILE = 'onnx-community/Qwen3-VL-2B-Instruct-ONNX/onnx/decoder_model_merged_q4.onnx';

class Namer {
  // fork(file) starts the worker process (returns { on, postMessage, kill, pid }); onChanged() after names land.
  constructor({ modelsDir, fork, onChanged = () => {}, log = console }) {
    Object.assign(this, { modelsDir, fork, onChanged, log });
    this.running = false; this.again = false;
  }

  // (The checks use a stand-in only when they ask for names: NOTEBOOK_FAKE_NAMES.)
  available() { return process.env.NOTEBOOK_FAKE_RECOGNISER ? !!process.env.NOTEBOOK_FAKE_NAMES : fs.existsSync(path.join(this.modelsDir, MODEL_FILE)); }

  todo(lib) {
    return lib.data.items.filter((it) => !it.deletedAt && it.kind !== 'note' && it.ai && !it.ai.failed && it.ai.nameV !== NAME_V && lib.nameable(it))
      .filter((it) => { const f = it.kind === 'video' || isRaw(it.file) ? it.thumb : it.file; return f && fs.existsSync(lib.p(f)); });
  }

  async run(lib) {
    if (!this.available()) return;
    if (this.running) { this.again = true; return; }
    this.running = true;
    let w = null;
    try {
      do {
        this.again = false;
        const list = this.todo(lib);
        if (!list.length) break;
        if (!w) w = this.start();
        let changed = 0, last = Date.now();
        for (const it of list) {
          if (!lib.data.items.includes(it) || !it.ai) continue;
          const res = await w.ask({ file: lib.p(it.kind === 'video' || isRaw(it.file) ? it.thumb : it.file), hint: it.originalName || it.title, modelsDir: this.modelsDir });
          if (res.ok) { const name = cleanName(res.name); if (name && lib.applyName(it.id, name)) changed++; }
          else this.log.error('naming', it.id, res.error);
          it.ai = { ...it.ai, nameV: NAME_V }; // looked at (named, or not nameable by the model): not asked again
          if (Date.now() - last > 3000) { await lib.save(); if (changed) this.onChanged(); changed = 0; last = Date.now(); }
        }
        await lib.save();
        if (changed) this.onChanged();
      } while (this.again);
    } catch (err) {
      this.log.error('namer', err);
    } finally {
      if (w) w.kill();
      this.running = false;
    }
  }

  // The naming process, set to low priority so it never gets in the way.
  start() {
    const proc = this.fork(path.join(__dirname, 'namer-worker.js'));
    try { if (proc.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_LOW); } catch { /* not allowed here: it still runs */ }
    const pending = new Map();
    let seq = 0;
    proc.on('message', (m) => { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } });
    proc.on('exit', () => { for (const p of pending.values()) p({ ok: false, error: 'The naming process stopped.' }); pending.clear(); });
    return {
      ask: (msg) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); proc.postMessage({ ...msg, id }); }),
      kill: () => proc.kill()
    };
  }
}

module.exports = { Namer, NAME_V };
