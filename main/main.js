// The app shell: opens the window, keeps the app offline, and answers requests from the page.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, session, Menu, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { Library, PHOTO_EXT, VIDEO_EXT } = require('./library');

// The page and the library files are both served from nb://notebook/ so the page can
// make thumbnails from them. /app/ is the interface, /lib/ is the current library folder.
protocol.registerSchemesAsPrivileged([{ scheme: 'nb', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const APP_DIR = path.join(__dirname, '..', 'renderer');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime'
};

// Streams a file, including the partial ("range") requests videos use for seeking.
async function serveFile(file, request) {
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st || !st.isFile()) return new Response('Not found', { status: 404 });
  const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) }
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { ...headers, 'Content-Length': String(st.size) } });
}

function resolveUrl(url) {
  const u = new URL(url);
  if (u.host !== 'notebook') return null;
  const rel = decodeURIComponent(u.pathname);
  const [base, sub] = rel.startsWith('/app/') ? [APP_DIR, rel.slice(5)] : rel.startsWith('/lib/') && lib ? [lib.root, rel.slice(5)] : [null, null];
  if (!base) return null;
  const file = path.resolve(base, sub);
  return file.startsWith(path.resolve(base) + path.sep) ? file : null; // never outside its folder
}

let win = null;
let lib = null;
// Lets the automated check (scripts/test-ui.js) use its own settings instead of yours.
if (process.env.NOTEBOOK_USER_DATA) app.setPath('userData', process.env.NOTEBOOK_USER_DATA);
const configFile = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}

function writeConfig(changes) {
  const next = { ...readConfig(), ...changes };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 1));
}

function defaultLibraryPath() {
  return fs.existsSync('D:\\') ? 'D:\\Notebook Library' : path.join(app.getPath('documents'), 'Notebook Library');
}

// What the page needs to draw everything, with addresses for the images and videos.
function snapshot() {
  const url = (rel) => (rel ? 'nb://notebook/lib/' + rel.split('/').map(encodeURIComponent).join('/') : null);
  return {
    root: lib.root,
    boards: lib.data.boards,
    items: lib.data.items.map((it) => ({ ...it, src: url(it.file), thumbSrc: url(it.thumb) }))
  };
}

function friendly(err) {
  if (err && err.friendly) return err.friendly;
  const byCode = {
    ENOSPC: 'There isn\'t enough space on that drive.',
    EACCES: "Windows wouldn't let Notebook use that folder. Try a different one.",
    EPERM: "Windows wouldn't let Notebook use that folder. Try a different one.",
    ENOENT: "A file or folder Notebook needed couldn't be found.",
    EBUSY: 'A file is in use by another program. Close it and try again.'
  };
  return byCode[err && err.code] || `Something went wrong: ${err && err.message ? err.message : err}`;
}

// Every request returns either { ok, snap, ... } or { error } in plain English.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const extra = await fn(...args);
      return { ok: true, ...(extra || {}), snap: lib && lib.data ? snapshot() : null };
    } catch (err) {
      console.error(channel, err);
      return { error: friendly(err) };
    }
  });
}

async function useLibrary(root) {
  lib = await Library.openOrCreate(root);
  writeConfig({ libraryPath: root });
  return { recovered: lib.recovered };
}

async function pickFolder(title, defaultPath, buttonLabel) {
  const res = await dialog.showOpenDialog(win, { title, defaultPath, buttonLabel, properties: ['openDirectory', 'createDirectory'] });
  return res.canceled ? null : res.filePaths[0];
}

async function confirm(message, detail, okLabel) {
  const res = await dialog.showMessageBox(win, { type: 'warning', buttons: [okLabel, 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, message, detail });
  return res.response === 0;
}

function registerHandlers() {
  handle('lib:state', async () => {
    const saved = readConfig().libraryPath;
    if (!lib && saved && fs.existsSync(saved)) {
      const res = await useLibrary(saved);
      return { status: 'ready', ...res };
    }
    return { status: lib ? 'ready' : 'none', defaultPath: defaultLibraryPath(), missing: saved && !fs.existsSync(saved) ? saved : null };
  });

  handle('lib:use', async (mode) => {
    let root;
    if (mode === 'default') root = defaultLibraryPath();
    else root = await pickFolder(mode === 'open' ? 'Open a Notebook library' : 'Choose where your notebook lives', app.getPath('documents'), mode === 'open' ? 'Open library' : 'Use this folder');
    if (!root) return { cancelled: true };
    if (mode === 'open' && !fs.existsSync(path.join(root, 'library.json'))) {
      const err = new Error(); err.friendly = "That folder doesn't contain a Notebook library."; throw err;
    }
    return useLibrary(root);
  });

  handle('lib:reveal', async () => { await shell.openPath(lib.root); });
  handle('item:reveal', async (id) => { const it = lib.item(id); if (it.file) shell.showItemInFolder(path.join(lib.root, it.file)); });

  handle('items:pick', async (kind, boardId) => {
    const ext = (kind === 'videos' ? VIDEO_EXT : PHOTO_EXT).map((e) => e.slice(1));
    const res = await dialog.showOpenDialog(win, {
      title: kind === 'videos' ? 'Add videos' : 'Add photos',
      defaultPath: readConfig().lastImportDir || app.getPath('pictures'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: kind === 'videos' ? 'Videos' : 'Photos', extensions: ext }]
    });
    if (res.canceled || !res.filePaths.length) return { cancelled: true };
    writeConfig({ lastImportDir: path.dirname(res.filePaths[0]) });
    return lib.importFiles(res.filePaths, boardId);
  });
  handle('items:import', (paths, boardId) => lib.importFiles(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [], boardId));

  handle('item:update', (id, changes) => lib.updateItem(id, changes || {}));
  handle('item:thumb', (id, bytes, meta) => lib.saveThumb(id, bytes, meta));
  handle('item:bin', (id) => lib.moveToBin(id));
  handle('item:restore', (id) => lib.restore(id));
  handle('note:add', async (boardId) => ({ id: await lib.addNote(boardId) }));

  handle('bin:empty', async () => {
    const count = lib.data.items.filter((i) => i.deletedAt).length;
    if (!count) return { count: 0 };
    const sure = await confirm(`Permanently delete ${count} item${count === 1 ? '' : 's'}?`, 'They will be removed from your library for good, including the copied files. Your original files elsewhere are not touched.', 'Delete forever');
    return sure ? { count: await lib.emptyBin() } : { cancelled: true };
  });

  handle('board:add', async (name) => ({ id: await lib.addBoard(name) }));
  handle('board:rename', (id, name) => lib.renameBoard(id, name));
  handle('board:delete', async (id) => {
    const board = lib.board(id);
    const sure = await confirm(`Delete the board "${board.name}"?`, 'Only the board is removed. Every item on it stays in All items and on its other boards.', 'Delete board');
    if (!sure) return { cancelled: true };
    await lib.deleteBoard(id);
  });

  handle('backup:run', async () => {
    const dest = await pickFolder('Choose where to save the backup', readConfig().lastBackupDir || path.dirname(lib.root), 'Back up here');
    if (!dest) return { cancelled: true };
    writeConfig({ lastBackupDir: dest });
    return lib.backup(dest);
  });

  handle('backup:restore', async () => {
    const src = await pickFolder('Choose a Notebook backup folder', readConfig().lastBackupDir || path.dirname(lib ? lib.root : defaultLibraryPath()), 'Restore this backup');
    if (!src) return { cancelled: true };
    const info = await Library.inspectBackup(src);
    const parent = await pickFolder('Choose where to put the restored library (your current one is kept)', path.dirname(src), 'Restore here');
    if (!parent) return { cancelled: true };
    const d = new Date();
    const dest = path.join(parent, `Notebook Library (restored ${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')})`);
    await Library.restoreBackup(src, dest);
    await useLibrary(dest);
    return { dir: dest, items: info.items };
  });

  handle('export:run', async () => {
    const dest = await pickFolder('Choose where to save the export', readConfig().lastExportDir || app.getPath('documents'), 'Export here');
    if (!dest) return { cancelled: true };
    writeConfig({ lastExportDir: dest });
    const res = await lib.exportTo(dest);
    shell.openPath(res.dir);
    return res;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 620,
    backgroundColor: '#111014', title: 'Notebook', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadURL('nb://notebook/app/index.html');
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  protocol.handle('nb', (request) => {
    const file = resolveUrl(request.url);
    return file ? serveFile(file, request) : new Response('Not found', { status: 404 });
  });
  // Nothing ever leaves this PC: all web requests are blocked.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  registerHandlers();
  createWindow();
});

app.on('window-all-closed', async () => {
  if (lib) await lib.queue.catch(() => {});
  app.quit();
});
