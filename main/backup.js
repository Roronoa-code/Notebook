// Backup, restore and export for the library: verified whole-folder copies (a restore always goes into
// a new folder, the current library is never touched) and a plain-files export anyone can open.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DB = 'library.json';
const now = () => new Date().toISOString();
const exists = (p) => fsp.access(p).then(() => true, () => false);

class FriendlyError extends Error {
  constructor(message) { super(message); this.friendly = message; }
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

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function readLibraryFile(file) {
  const data = JSON.parse(await fsp.readFile(file, 'utf8'));
  if (!data || typeof data !== 'object' || !Array.isArray(data.items) || !Array.isArray(data.boards)) throw new FriendlyError("That folder doesn't contain a Notebook library.");
  return data;
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

async function backup(lib, destParent) {
  if (isInside(destParent, lib.root)) throw new FriendlyError("Pick a folder outside the library itself for the backup.");
  await lib.queue.catch(() => {});
  const name = `Notebook Backup ${stamp()}`;
  const partial = path.join(destParent, name + ' (in progress)');
  const final = path.join(destParent, name);
  try {
    const result = await copyVerified(lib.root, partial);
    await fsp.rm(path.join(partial, DB + '.tmp'), { force: true });
    await fsp.writeFile(path.join(partial, 'backup-info.json'), JSON.stringify({
      app: 'Notebook', createdAt: now(), from: lib.root,
      items: lib.data.items.length, boards: lib.data.boards.length, files: result.files, bytes: result.bytes
    }, null, 1));
    await fsp.rename(partial, final);
    return { dir: final, ...result, items: lib.data.items.length };
  } catch (err) {
    await fsp.rm(partial, { recursive: true, force: true });
    throw err;
  }
}

// Checks a backup is complete before anything is restored from it.
async function inspectBackup(dir) {
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
async function restoreBackup(backupDir, destDir) {
  if (await exists(destDir)) throw new FriendlyError('The restore folder already exists. Pick another location.');
  const info = await inspectBackup(backupDir);
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
async function exportTo(lib, destParent) {
  if (isInside(destParent, lib.root)) throw new FriendlyError('Pick a folder outside the library itself for the export.');
  const name = `Notebook Export ${stamp()}`;
  const partial = path.join(destParent, name + ' (in progress)');
  const final = path.join(destParent, name);
  const live = lib.data.items.filter((i) => !i.deletedAt);
  const boardName = (id) => (lib.data.boards.find((b) => b.id === id) || {}).name;
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
        await fsp.copyFile(lib.p(it.file), path.join(partial, out), fs.constants.COPYFILE_EXCL);
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
      `Exported ${new Date().toLocaleString('en-GB')} - ${live.length} items, ${lib.data.boards.length} boards.`
    ].join('\r\n'), 'utf8');
    await fsp.rename(partial, final);
    return { dir: final, items: live.length };
  } catch (err) {
    await fsp.rm(partial, { recursive: true, force: true });
    throw err;
  }
}

module.exports = { backup, inspectBackup, restoreBackup, exportTo, htmlToText, safeName, isInside };
