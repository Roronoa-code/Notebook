// The library: one folder holding library.json (the list of items and boards),
// media/ (full copies of imported photos and videos) and thumbs/ (small previews).
// Everything here is plain Node so it can be tested without the app window.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DB = 'library.json';
const PHOTO_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'];
const VIDEO_EXT = ['.mp4', '.m4v', '.webm', '.mov'];
const DEFAULT_BOARDS = ['Outfits', 'Wallpapers', 'Icons', 'Profile pictures'];

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const exists = (p) => fsp.access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FriendlyError extends Error {
  constructor(message) { super(message); this.friendly = message; }
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (PHOTO_EXT.includes(ext)) return 'photo';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeName(name) {
  const s = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 80);
  return s || 'untitled';
}

function uniqueName(used, base, ext) {
  let name = base + ext;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
  used.add(name.toLowerCase());
  return name;
}

// Notes are stored as simple HTML (bold, italic, lists, headings). This turns them into readable text.
function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\s*\/\s*(p|div|h1|h2|h3|li|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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

// Copies a whole folder, then checks every file arrived at the same size.
async function copyVerified(src, dest) {
  await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
  let files = 0, bytes = 0;
  const walk = async (dir) => {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(from); continue; }
      const to = path.join(dest, path.relative(src, from));
      const [a, b] = await Promise.all([fsp.stat(from), fsp.stat(to)]);
      if (a.size !== b.size) throw new FriendlyError(`A file didn't copy completely (${entry.name}). Nothing was changed.`);
      files++; bytes += a.size;
    }
  };
  await walk(src);
  return { files, bytes };
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
      lib.data = { app: 'Notebook', version: 1, createdAt: now(), boards: DEFAULT_BOARDS.map((name) => ({ id: newId(), name })), items: [] };
      await lib.save();
    }
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
      await this.save();
    }
  }

  // Saves are queued so two changes never write at the same time.
  save() {
    const run = this.queue.catch(() => {}).then(() => this.write());
    this.queue = run;
    return run;
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

  async importFiles(paths, boardId) {
    const boards = this.validBoards(boardId ? [boardId] : []);
    const added = [], skipped = [];
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
        added.push({
          id, kind, title: path.basename(src, path.extname(src)), file: rel, thumb: null, w: null, h: null, duration: null,
          originalName: name, size: st.size, importedAt: now(), updatedAt: now(), boards: [...boards], deletedAt: null
        });
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
    if (typeof changes.title === 'string') it.title = changes.title.trim().slice(0, 120) || (it.kind === 'note' ? 'Untitled note' : it.originalName);
    if (typeof changes.html === 'string' && it.kind === 'note') it.html = changes.html.slice(0, 500000);
    if (typeof changes.caption === 'string' && it.kind !== 'note') it.caption = changes.caption.slice(0, 5000);
    if (Array.isArray(changes.boards)) it.boards = this.validBoards(changes.boards);
    it.updatedAt = now();
    await this.save();
  }

  async saveThumb(id, bytes, meta) {
    const it = this.item(id);
    const rel = `thumbs/${id}.jpg`;
    await fsp.writeFile(this.p(rel), Buffer.from(bytes));
    it.thumb = rel;
    const num = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
    if (meta) { it.w = num(meta.w); it.h = num(meta.h); if (it.kind === 'video') it.duration = num(meta.duration); }
    await this.save();
  }

  async moveToBin(id) {
    this.item(id).deletedAt = now();
    await this.save();
  }

  async restore(id) {
    const it = this.item(id);
    it.deletedAt = null;
    it.boards = this.validBoards(it.boards);
    await this.save();
  }

  // Permanently removes everything in the Bin, including the copied files.
  async emptyBin() {
    const gone = this.data.items.filter((i) => i.deletedAt);
    this.data.items = this.data.items.filter((i) => !i.deletedAt);
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
    const board = { id: newId(), name: this.cleanBoardName(clean) };
    this.data.boards.push(board);
    await this.save();
    return board.id;
  }

  async renameBoard(id, name) {
    this.board(id).name = this.cleanBoardName(name, id);
    await this.save();
  }

  // Deleting a board only removes the board: its items stay in All items and any other boards.
  async deleteBoard(id) {
    this.board(id);
    this.data.boards = this.data.boards.filter((b) => b.id !== id);
    for (const it of this.data.items) it.boards = it.boards.filter((b) => b !== id);
    await this.save();
  }

  // ---------- backup, restore, export ----------

  async backup(destParent) {
    if (isInside(destParent, this.root)) throw new FriendlyError("Pick a folder outside the library itself for the backup.");
    await this.queue.catch(() => {});
    const name = `Notebook Backup ${stamp()}`;
    const partial = path.join(destParent, name + ' (in progress)');
    const final = path.join(destParent, name);
    try {
      const result = await copyVerified(this.root, partial);
      await fsp.rm(path.join(partial, DB + '.tmp'), { force: true });
      await fsp.writeFile(path.join(partial, 'backup-info.json'), JSON.stringify({
        app: 'Notebook', createdAt: now(), from: this.root,
        items: this.data.items.length, boards: this.data.boards.length, files: result.files, bytes: result.bytes
      }, null, 1));
      await fsp.rename(partial, final);
      return { dir: final, ...result, items: this.data.items.length };
    } catch (err) {
      await fsp.rm(partial, { recursive: true, force: true });
      throw err;
    }
  }

  // Checks a backup is complete before anything is restored from it.
  static async inspectBackup(dir) {
    const data = await readLibraryFile(path.join(dir, DB)).catch((err) => {
      throw err.friendly ? err : new FriendlyError("That folder isn't a Notebook backup (library.json is missing or damaged).");
    });
    const missing = [];
    for (const it of data.items) {
      if (it.file && !(await exists(path.join(dir, it.file)))) missing.push(it.title || it.file);
    }
    return { items: data.items.length, boards: data.boards.length, missing };
  }

  // Restores into a brand-new folder, leaving the current library untouched.
  static async restoreBackup(backupDir, destDir) {
    if (await exists(destDir)) throw new FriendlyError('The restore folder already exists. Pick another location.');
    const info = await Library.inspectBackup(backupDir);
    if (info.missing.length) throw new FriendlyError(`That backup is incomplete: ${info.missing.length} file(s) are missing, so nothing was restored.`);
    try {
      await copyVerified(backupDir, destDir);
      await fsp.rm(path.join(destDir, 'backup-info.json'), { force: true });
    } catch (err) {
      await fsp.rm(destDir, { recursive: true, force: true });
      throw err;
    }
    return info;
  }

  // Export: plain files anyone can open without Notebook.
  async exportTo(destParent) {
    if (isInside(destParent, this.root)) throw new FriendlyError('Pick a folder outside the library itself for the export.');
    const name = `Notebook Export ${stamp()}`;
    const partial = path.join(destParent, name + ' (in progress)');
    const final = path.join(destParent, name);
    const live = this.data.items.filter((i) => !i.deletedAt);
    const boardName = (id) => (this.data.boards.find((b) => b.id === id) || {}).name;
    const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Title', 'Type', 'Exported file', 'Boards', 'Original file name', 'Added', 'Note'].map(csv).join(',')];
    const used = new Set();
    try {
      await fsp.mkdir(path.join(partial, 'Media'), { recursive: true });
      await fsp.mkdir(path.join(partial, 'Notes'), { recursive: true });
      for (const it of live) {
        let out;
        if (it.kind === 'note') {
          out = 'Notes/' + uniqueName(used, safeName(it.title), '.txt');
          await fsp.writeFile(path.join(partial, out), htmlToText(it.html) + '\n', 'utf8');
        } else {
          out = 'Media/' + uniqueName(used, safeName(it.title), path.extname(it.file));
          await fsp.copyFile(this.p(it.file), path.join(partial, out), fs.constants.COPYFILE_EXCL);
        }
        const boards = it.boards.map(boardName).filter(Boolean).join('; ');
        rows.push([it.title, it.kind, out, boards, it.originalName || '', it.importedAt.slice(0, 10), it.caption || ''].map(csv).join(','));
      }
      await fsp.writeFile(path.join(partial, 'boards.csv'), '﻿' + rows.join('\r\n') + '\r\n', 'utf8');
      await fsp.writeFile(path.join(partial, 'README.txt'), [
        'Notebook export', '',
        'Media  - every photo and video, named by its title.',
        'Notes  - every note as a plain text file.',
        'boards.csv - opens in Excel or Google Sheets: which boards each item is on, plus any note on a photo or video.', '',
        `Exported ${new Date().toLocaleString('en-GB')} - ${live.length} items, ${this.data.boards.length} boards.`
      ].join('\r\n'), 'utf8');
      await fsp.rename(partial, final);
      return { dir: final, items: live.length };
    } catch (err) {
      await fsp.rm(partial, { recursive: true, force: true });
      throw err;
    }
  }
}

module.exports = { Library, FriendlyError, kindOf, htmlToText, safeName, PHOTO_EXT, VIDEO_EXT };
