// The library: one folder holding library.json (the list of items and boards),
// media/ (full copies of imported photos and videos) and thumbs/ (small previews).
// Everything here is plain Node so it can be tested without the app window.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { takenAt } = require('./dates');
const { pipeline } = require('stream/promises');
const { cleanRemote, cleanCrop, mergeInto, pruneTombstones, SyncError, ID_RE } = require('./merge');
const { isGenericTitle } = require('./naming');
const backup = require('./backup');
const { htmlToText, safeName } = backup;

const DB = 'library.json';
const MAX_UPLOAD = 2 * 1024 ** 3;
const PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.dng']; // .dng: camera RAW, shown by its preview (raw.js)
const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mov'];
const DEFAULT_BOARDS = ['Outfits', 'Wallpapers', 'Icons', 'Profile pictures'];

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const exists = (p) => fsp.access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FriendlyError extends Error {
  constructor(message, status) { super(message); this.friendly = message; if (status) this.status = status; }
}

// Version 2 (docs/SYNC.md) adds board dates and tombstones. Returns true if anything changed.
function migrate(data) {
  let changed = false;
  if (data.version !== 2) { data.version = 2; changed = true; }
  for (const b of data.boards) if (!b.updatedAt) { b.updatedAt = b.createdAt || now(); changed = true; }
  for (const it of data.items) if (!it.updatedAt) { it.updatedAt = it.importedAt || now(); changed = true; }
  if (!data.tombstones || typeof data.tombstones !== 'object') { data.tombstones = { items: [], boards: [] }; changed = true; }
  for (const k of ['items', 'boards']) if (!Array.isArray(data.tombstones[k])) { data.tombstones[k] = []; changed = true; }
  const pruned = pruneTombstones(data.tombstones);
  if (pruned.items.length !== data.tombstones.items.length || pruned.boards.length !== data.tombstones.boards.length) { data.tombstones = pruned; changed = true; }
  return changed;
}

// A fingerprint of a file's bytes, to notice the same picture being added twice.
async function hashFile(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (PHOTO_EXT.includes(ext)) return 'photo';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

function validate(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items) || !Array.isArray(data.boards)) {
    throw new FriendlyError("That folder doesn't contain a Notebook library.");
  }
  return data;
}

async function readLibraryFile(file) {
  return validate(JSON.parse(await fsp.readFile(file, 'utf8')));
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

class Library {
  constructor(root) {
    this.root = root;
    this.data = null;
    this.recovered = false;
    this.queue = Promise.resolve();
    this.waiting = new Set(); // items the phone still has to send (from the last sync)
  }

  p(...parts) { return path.join(this.root, ...parts); }

  // Opens the library in `root`, or starts a new one there if the folder has none.
  static async openOrCreate(root) {
    const lib = new Library(root);
    await fsp.mkdir(lib.p('media'), { recursive: true });
    await fsp.mkdir(lib.p('thumbs'), { recursive: true });
    if (await exists(lib.p(DB)) || await exists(lib.p(DB + '.bak'))) {
      await lib.load();
    } else {
      const at = now();
      lib.data = { app: 'Notebook', version: 2, createdAt: at, boards: DEFAULT_BOARDS.map((name) => ({ id: newId(), name, updatedAt: at })), items: [], tombstones: { items: [], boards: [] } };
      await lib.save();
    }
    // Leftovers from a phone upload that was cut off (e.g. the PC was switched off mid-way).
    for (const f of await fsp.readdir(lib.p('media'))) if (f.endsWith('.part')) await fsp.rm(lib.p('media', f), { force: true });
    return lib;
  }

  async load() {
    try {
      this.data = await readLibraryFile(this.p(DB));
    } catch (err) {
      // library.json is damaged or missing: fall back to the copy kept from the previous save.
      if (!(await exists(this.p(DB + '.bak')))) throw err.friendly ? err : new FriendlyError("The library file couldn't be read and there's no earlier copy to fall back on.");
      this.data = await readLibraryFile(this.p(DB + '.bak'));
      this.recovered = true;
      migrate(this.data);
      await this.save();
      return;
    }
    if (migrate(this.data)) await this.save();
  }

  // Runs `fn` in the same queue as saves, so nothing else writes while it runs.
  exclusive(fn) {
    const run = this.queue.catch(() => {}).then(fn);
    this.queue = run;
    return run;
  }

  // Saves are queued so two changes never write at the same time.
  save() {
    return this.exclusive(() => this.write());
  }

  // For many small changes in a row that can be redone if lost (previews): one save shortly after.
  saveSoon() {
    if (!this.pendingSave) {
      this.pendingSave = new Promise((resolve) => setTimeout(resolve, 400)).then(() => { this.pendingSave = null; return this.save(); });
    }
    return this.pendingSave;
  }

  async write() {
    const file = this.p(DB), tmp = this.p(DB + '.tmp');
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(JSON.stringify(this.data, null, 1));
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (await exists(file)) await fsp.copyFile(file, this.p(DB + '.bak'));
    // Windows can briefly lock a file (e.g. antivirus scanning it), so retry the swap a few times.
    for (let attempt = 0; ; attempt++) {
      try { await fsp.rename(tmp, file); return; } catch (err) {
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        await sleep(100 * (attempt + 1));
      }
    }
  }

  item(id) {
    const it = this.data.items.find((i) => i.id === id);
    if (!it) throw new FriendlyError('That item no longer exists.');
    return it;
  }

  board(id) {
    const b = this.data.boards.find((x) => x.id === id);
    if (!b) throw new FriendlyError('That board no longer exists.');
    return b;
  }

  validBoards(ids) {
    const known = new Set(this.data.boards.map((b) => b.id));
    return [...new Set((ids || []).filter((id) => known.has(id)))];
  }

  // ---------- items ----------

  // Folders dropped in are opened up: every photo and video inside (and in folders inside) is added.
  // Anything else in them is left alone quietly. Plain files are passed straight through.
  static async expandFolders(paths, limit = 5000) {
    const out = [];
    const walk = async (p, depth) => {
      if (out.length >= limit) return;
      let st; try { st = await fsp.stat(p); } catch { out.push(p); return; } // let importFiles report it
      if (!st.isDirectory()) { if (depth === 0 || kindOf(p)) out.push(p); return; }
      if (depth > 6) return;
      for (const name of (await fsp.readdir(p)).sort()) await walk(path.join(p, name), depth + 1);
    };
    for (const p of paths) await walk(p, 0);
    return out;
  }

  async importFiles(paths, boardId) {
    const boards = this.validBoards(boardId ? [boardId] : []);
    const added = [], skipped = [];
    // The same picture twice (already here, or twice in this batch) is skipped. In the Bin counts too:
    // restore it from there instead of keeping two copies.
    const known = new Map(this.data.items.filter((i) => i.hash).map((i) => [i.hash, i]));
    for (const src of paths) {
      const name = path.basename(src);
      const kind = kindOf(src);
      if (!kind) { skipped.push({ name, reason: 'not a supported photo or video' }); continue; }
      const id = newId();
      const rel = `media/${id}${path.extname(src).toLowerCase()}`;
      try {
        const st = await fsp.stat(src);
        if (!st.isFile()) { skipped.push({ name, reason: 'not a file' }); continue; }
        await fsp.copyFile(src, this.p(rel), fs.constants.COPYFILE_EXCL);
        if ((await fsp.stat(this.p(rel))).size !== st.size) throw new Error('size mismatch');
        const hash = await hashFile(this.p(rel));
        const twin = known.get(hash);
        if (twin) {
          await fsp.rm(this.p(rel), { force: true });
          skipped.push({ name, reason: twin.deletedAt ? 'it’s already in your Bin' : 'it’s already in your notebook', duplicate: twin.id });
          continue;
        }
        const item = {
          id, kind, title: path.basename(src, path.extname(src)), file: rel, thumb: null, w: null, h: null, duration: null,
          originalName: name, size: st.size, hash, takenAt: await takenAt(this.p(rel), name, kind), importedAt: now(), updatedAt: now(), boards: [...boards], deletedAt: null
        };
        known.set(hash, item);
        added.push(item);
      } catch (err) {
        await fsp.rm(this.p(rel), { force: true });
        skipped.push({ name, reason: err.code === 'ENOSPC' ? 'the drive is full' : "it couldn't be copied" });
      }
    }
    if (added.length) {
      this.data.items.unshift(...added);
      try {
        await this.save();
      } catch (err) {
        // Undo the half-finished import so the library and its files stay in step.
        this.data.items = this.data.items.filter((i) => !added.includes(i));
        await Promise.all(added.map((i) => fsp.rm(this.p(i.file), { force: true })));
        throw err;
      }
    }
    return { added: added.map((i) => i.id), skipped };
  }

  // Fingerprints for items saved before duplicates were checked (or that arrived from the phone).
  // Like thumbnails, this isn't a synced edit. Runs in the background; saves once at the end.
  async fillHashes() {
    let n = 0;
    for (const it of this.data.items) {
      if (it.kind === 'note' || it.hash || !it.file) continue;
      try { it.hash = await hashFile(this.p(it.file)); n++; } catch { /* file not here yet (waiting for the phone) */ }
    }
    if (n) await this.save();
    return n;
  }

  // When each photo or video was taken (for sorting by date), for items added before dates were read
  // or that arrived from the phone without one. Not a synced edit, like thumbnails. `null`: nothing says.
  async fillDates() {
    let n = 0;
    for (const it of this.data.items) {
      if (it.kind === 'note' || it.takenAt !== undefined || !it.file || !fs.existsSync(this.p(it.file))) continue;
      it.takenAt = await takenAt(this.p(it.file), it.originalName || it.title, it.kind);
      n++;
    }
    if (n) await this.save();
    return n;
  }

  async addNote(boardId) {
    const note = {
      id: newId(), kind: 'note', title: 'Untitled note', html: '', importedAt: now(), updatedAt: now(),
      boards: this.validBoards(boardId ? [boardId] : []), deletedAt: null
    };
    this.data.items.unshift(note);
    await this.save();
    return note.id;
  }

  async updateItem(id, changes) {
    const it = this.item(id);
    if (typeof changes.title === 'string') {
      const t = changes.title.trim().slice(0, 120) || (it.kind === 'note' ? 'Untitled note' : it.originalName);
      if (t !== it.title && it.kind !== 'note') it.named = 'user'; // a name you gave is never replaced
      it.title = t;
    }
    if (typeof changes.html === 'string' && it.kind === 'note') it.html = changes.html.slice(0, 500000);
    if (typeof changes.caption === 'string' && it.kind !== 'note') it.caption = changes.caption.slice(0, 5000);
    if (Array.isArray(changes.boards)) it.boards = this.validBoards(changes.boards);
    if ('crop' in changes && it.kind !== 'note') {
      if (changes.crop == null) delete it.crop;
      else it.crop = cleanCrop(changes.crop) || (() => { throw new FriendlyError("That crop couldn't be used. Try again."); })();
    }
    it.updatedAt = now();
    await this.save();
  }

  // ---------- names ----------

  // Can this item's title be replaced by a proper name? Not if you named it (here or on the phone):
  // only placeholders (file or website names), a post's own wording, or a name given here before
  // that nobody has changed since.
  nameable(it) {
    if (it.kind === 'note' || it.named === 'user') return false;
    if (it.aiName) return it.title === it.aiName;
    return !!it.source || isGenericTitle(it.title);
  }

  // Gives an item its proper name (made from what the picture shows). The old title is kept as
  // `sourceTitle`, so search still finds it. A synced edit, so the phone shows the name too. Call save() after.
  applyName(id, name) {
    const it = this.data.items.find((i) => i.id === id);
    if (!it || !name || !this.nameable(it) || it.title === name) return false;
    if (it.sourceTitle == null) it.sourceTitle = it.title;
    it.title = name;
    it.aiName = name;
    it.updatedAt = now();
    return true;
  }

  // ---------- recognition (build plan A1-A3) ----------

  // What the PC recognised. Like a thumbnail, this isn't a synced edit (updatedAt stays) and a
  // re-scan only ever replaces `ai`, never the user's corrections in `labels`. Call save() after.
  setAi(id, ai) {
    const it = this.data.items.find((i) => i.id === id);
    if (it) it.ai = ai;
  }

  // The user's own corrections (main type, extra types, styles). They win over what was recognised,
  // survive every re-scan and sync like any edit. `null` for a field goes back to the recognised value.
  async setLabels(id, changes, types, styles) {
    const it = this.item(id);
    const next = { ...(it.labels || {}) };
    if ('main' in changes) {
      if (changes.main === null) delete next.main;
      else if (types.includes(changes.main)) next.main = changes.main;
      else throw new FriendlyError("That isn't one of the types.");
    }
    if ('extra' in changes) {
      if (changes.extra === null) delete next.extra;
      else next.extra = [...new Set((Array.isArray(changes.extra) ? changes.extra : []).filter((t) => types.includes(t)))];
    }
    if ('styles' in changes) {
      if (changes.styles === null) delete next.styles;
      else next.styles = [...new Set((Array.isArray(changes.styles) ? changes.styles : []).map(String).filter((s) => styles.includes(s)))].slice(0, 3);
    }
    if (Object.keys(next).length) it.labels = next; else delete it.labels;
    it.updatedAt = now();
    await this.save();
  }

  // The outfit style list (the user's own, starting from the 8 defaults).
  styles(defaults) { return (this.data.settings && Array.isArray(this.data.settings.styles) && this.data.settings.styles.length) ? this.data.settings.styles : defaults; }
  async setStyles(list) {
    const clean = [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 16);
    if (!clean.length) throw new FriendlyError('Keep at least one style.');
    this.data.settings = { ...(this.data.settings || {}), styles: clean };
    await this.save();
    return clean;
  }

  // "Show on phone" (on unless switched off). Not a synced edit, so updatedAt stays: the PC just
  // stops sending the item, and the phone removes its copy on the next sync.
  async setOnPhone(ids, on) {
    for (const id of ids) {
      const it = this.item(id);
      if (on) delete it.phone; else it.phone = false;
    }
    await this.save();
  }

  // Stacks: items sharing a `stack` id show as one fanned card you can flick through.
  // Stacking items that are already in stacks joins those stacks together.
  // `stackIn`: the board it was stacked in. A stack shows grouped in All, and inside a board only
  // when it was stacked in that board (null: made in All, so loose cards on every board).
  async stackItems(ids, boardId = null) {
    const picked = ids.map((id) => this.item(id));
    if (picked.length < 2) throw new FriendlyError('Pick at least two things to stack.');
    const joining = new Set(picked.map((it) => it.stack).filter(Boolean));
    const members = new Set(picked.concat(this.data.items.filter((it) => it.stack && joining.has(it.stack))));
    const stack = newId();
    const stackIn = (boardId && this.data.boards.some((b) => b.id === boardId) ? boardId : null) || [...members].map((it) => it.stackIn).find(Boolean) || null;
    for (const it of members) { it.stack = stack; it.stackIn = stackIn; it.updatedAt = now(); }
    await this.save();
    return stack;
  }

  // Takes one item out of its stack; a stack left with one item stops being a stack.
  async unstackItem(id) {
    const it = this.item(id);
    if (!it.stack) return;
    const rest = this.data.items.filter((x) => x.stack === it.stack && x !== it);
    it.stack = null; it.stackIn = null; it.updatedAt = now();
    if (rest.length === 1) { rest[0].stack = null; rest[0].stackIn = null; rest[0].updatedAt = now(); }
    await this.save();
  }

  async saveThumb(id, bytes, meta) {
    const it = this.item(id);
    const rel = `thumbs/${id}.jpg`;
    await fsp.writeFile(this.p(rel), Buffer.from(bytes));
    // A phone sync may have removed the item while the preview was being written.
    if (!this.data.items.includes(it)) { await fsp.rm(this.p(rel), { force: true }); throw new FriendlyError('That item no longer exists.'); }
    it.thumb = rel;
    const num = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
    if (meta) { it.w = num(meta.w); it.h = num(meta.h); if (it.kind === 'video') it.duration = num(meta.duration); }
    // Previews come in quick bursts, so they're saved together. If the app closes first, the preview is
    // simply made again next time.
    this.saveSoon().catch((err) => console.error('saving previews', err));
  }

  async moveToBin(id) {
    const it = this.item(id);
    it.deletedAt = now();
    it.updatedAt = it.deletedAt;
    await this.save();
  }

  async restore(id) {
    const it = this.item(id);
    it.deletedAt = null;
    it.boards = this.validBoards(it.boards);
    it.updatedAt = now();
    await this.save();
  }

  // A tombstone tells the phone something was removed for good, so it removes it too.
  addTombstone(kind, id) {
    const at = now();
    const t = this.data.tombstones;
    t[kind] = t[kind].filter((x) => x.id !== id).concat({ id, at });
    this.data.tombstones = pruneTombstones(t);
  }

  // Permanently removes everything in the Bin, including the copied files.
  async emptyBin() {
    const gone = this.data.items.filter((i) => i.deletedAt);
    this.data.items = this.data.items.filter((i) => !i.deletedAt);
    for (const it of gone) this.addTombstone('items', it.id);
    await this.save();
    for (const it of gone) {
      if (it.file) await fsp.rm(this.p(it.file), { force: true });
      if (it.thumb) await fsp.rm(this.p(it.thumb), { force: true });
    }
    return gone.length;
  }

  // ---------- boards ----------

  cleanBoardName(name, exceptId) {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) throw new FriendlyError('Give the board a name.');
    if (this.data.boards.some((b) => b.id !== exceptId && b.name.toLowerCase() === clean.toLowerCase())) {
      throw new FriendlyError(`There's already a board called "${clean}".`);
    }
    return clean;
  }

  async addBoard(name) {
    let base = String(name || 'New board').trim() || 'New board', n = 1, clean = base;
    while (this.data.boards.some((b) => b.name.toLowerCase() === clean.toLowerCase())) clean = `${base} ${++n}`;
    const board = { id: newId(), name: this.cleanBoardName(clean), updatedAt: now() };
    this.data.boards.push(board);
    await this.save();
    return board.id;
  }

  async renameBoard(id, name) {
    const board = this.board(id);
    board.name = this.cleanBoardName(name, id);
    board.updatedAt = now();
    await this.save();
  }

  // Deleting a board only removes the board: its items stay in All items and any other boards.
  // A new order for the boards (all of them, each once). Only the order changes, so it isn't a synced edit;
  // the phone gets the PC's order at its next sync.
  async reorderBoards(ids) {
    const byId = new Map(this.data.boards.map((b) => [b.id, b]));
    if (!Array.isArray(ids) || ids.length !== byId.size || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) throw new FriendlyError('The boards couldn’t be moved. Try again.');
    this.data.boards = ids.map((id) => byId.get(id));
    await this.save();
  }

  async deleteBoard(id) {
    this.board(id);
    this.data.boards = this.data.boards.filter((b) => b.id !== id);
    for (const it of this.data.items) it.boards = it.boards.filter((b) => b !== id);
    this.addTombstone('boards', id);
    await this.save();
  }

  // ---------- phone sync (docs/SYNC.md) ----------

  // Merges the phone's library into this one, saves, and deletes files of items removed by tombstones.
  async mergeRemote(remote) {
    const clean = cleanRemote(remote);
    return this.exclusive(async () => {
      const before = JSON.stringify(this.data);
      const { removed } = mergeInto(this.data, clean);
      const changed = JSON.stringify(this.data) !== before;
      if (changed) {
        try { await this.write(); } catch (err) { this.data = JSON.parse(before); throw err; }
      }
      for (const it of removed) {
        this.waiting.delete(it.id);
        for (const rel of [it.file, it.thumb]) if (rel && isInside(this.p(rel), this.root)) await fsp.rm(this.p(rel), { force: true });
      }
      const onDisk = new Set((await fsp.readdir(this.p('media'))).map((f) => 'media/' + f.toLowerCase()));
      const pcNeeds = this.data.items.filter((i) => i.file && !onDisk.has(i.file.toLowerCase())).map((i) => i.id);
      this.waiting = new Set(pcNeeds);
      return { pcNeeds, changed };
    });
  }

  mediaPath(it) {
    if (!it.file || !/^media\/[^/\\]+$/.test(it.file) || !isInside(this.p(it.file), this.p('media'))) throw new SyncError("That item doesn't have a file.", 400);
    return this.p(it.file);
  }

  // For the phone to download: the file's stream and size, or null if this PC doesn't have it.
  async openMedia(id) {
    const it = this.data.items.find((i) => i.id === id);
    if (!it || !it.file) return null;
    const file = this.mediaPath(it);
    const st = await fsp.stat(file).catch(() => null);
    if (!st || !st.isFile()) return null;
    return { file: it.file, size: st.size, stream: fs.createReadStream(file) };
  }

  async readMedia(id) {
    const it = this.data.items.find((i) => i.id === id);
    return it && it.file ? fsp.readFile(this.mediaPath(it)).catch(() => null) : null;
  }

  // Checks an upload is wanted before any bytes are read.
  async checkUpload(id, size) {
    const it = ID_RE.test(String(id)) && this.data.items.find((i) => i.id === id);
    if (!it) throw new SyncError("This PC doesn't know that item. Sync first, then send the file.", 400);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD) throw new SyncError('The file size is missing or too big (the limit is 2 GB).', 400);
    const file = this.mediaPath(it);
    if (await exists(file)) throw new SyncError('This PC already has that file.', 409);
    return file;
  }

  // Saves a file sent by the phone: temporary file, size check, then an atomic rename.
  async receiveMedia(id, stream, size) {
    const file = await this.checkUpload(id, size);
    const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.part`;
    let got = 0;
    try {
      await pipeline(stream, async function* (source) {
        for await (const chunk of source) {
          got += chunk.length;
          if (got > size) throw new SyncError("The file was bigger than the phone said. It wasn't saved.", 400);
          yield chunk;
        }
      }, fs.createWriteStream(tmp, { flags: 'wx' }));
      if (got !== size || (await fsp.stat(tmp)).size !== size) throw new SyncError("The file didn't arrive complete. It wasn't saved, so try syncing again.", 400);
      await this.exclusive(async () => {
        if (!this.data.items.some((i) => i.id === id)) throw new SyncError('That item was removed while it was being sent.', 409);
        if (await exists(file)) throw new SyncError('This PC already has that file.', 409);
        await fsp.rename(tmp, file);
      });
    } finally {
      await fsp.rm(tmp, { force: true });
    }
    this.waiting.delete(id);
    return { ok: true };
  }

  // ---------- backup, restore, export (backup.js) ----------
  backup(destParent) { return backup.backup(this, destParent); }
  static inspectBackup(dir) { return backup.inspectBackup(dir); }
  static restoreBackup(backupDir, destDir) { return backup.restoreBackup(backupDir, destDir); }
  exportTo(destParent) { return backup.exportTo(this, destParent); }
}

module.exports = { Library, FriendlyError, kindOf, htmlToText, safeName, PHOTO_EXT, VIDEO_EXT };
