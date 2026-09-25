// The app shell: opens the window, keeps the app offline (apart from phone sync on the home
// network), and answers requests from the page.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, session, Menu, protocol, Tray, nativeImage, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { Library, PHOTO_EXT, VIDEO_EXT } = require('./library');
const { SyncServer } = require('./sync-server');
const { setupFeatures } = require('./features');
const { setupAutoBackup } = require('./autobackup');
const { rawPreview, isRaw } = require('./raw');
let features = null, autoBackup = null;

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
let tray = null;
let quitting = false;
let reportedRecovery = false;
// Lets the automated check (scripts/test-ui.js) use its own settings instead of yours.
const TEST_MODE = !!process.env.NOTEBOOK_USER_DATA;
if (TEST_MODE) app.setPath('userData', process.env.NOTEBOOK_USER_DATA);
// Started with Windows ("Keep Notebook ready for your phone"): no window, just sync and the tray icon.
const BACKGROUND = process.argv.includes('--background');
const configFile = () => path.join(app.getPath('userData'), 'config.json');

// Launching Notebook again just brings back the window that's already running.
const FIRST_INSTANCE = app.requestSingleInstanceLock();
if (!FIRST_INSTANCE) app.quit();
app.on('second-instance', (_e, argv) => { if (!argv.includes('--background')) showWindow(); });

const sync = new SyncServer({
  settingsFile: path.join(app.getPath('userData'), 'sync.json'),
  host: process.env.NOTEBOOK_SYNC_HOST || undefined, // the checks use 127.0.0.1 so Windows Firewall doesn't ask
  port: Number(process.env.NOTEBOOK_SYNC_PORT) || undefined,
  onLibraryChanged: ({ arrived }) => {
    send('lib:changed', { snap: lib && lib.data ? snapshot() : null, arrived });
    if (features) features.kick();
    // Photos and videos just sent by the phone: when were they taken?
    if (arrived.length && lib) lib.fillDates().then((n) => { if (n) send('lib:changed', { snap: snapshot(), arrived: [] }); }).catch((err) => console.error('dates', err));
  },
  onStatusChanged: () => send('sync:changed'),
  onKeepReady: (on) => applyKeepReady(on)
});
const keepReady = () => !!sync.settings.keepReady;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// "Keep Notebook ready for your phone": start with Windows (in the background) and close to the tray.
function applyKeepReady(on) {
  // Only the installed app registers itself; the checks and `electron .` never touch Windows startup.
  if (app.isPackaged && !TEST_MODE) {
    try { app.setLoginItemSettings({ openAtLogin: on, args: ['--background'] }); } catch (err) { console.error('login item', err); }
  }
  if (on) ensureTray();
  else if (tray && win) { tray.destroy(); tray = null; }
}

function ensureTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(icon);
  tray.setToolTip('Notebook: ready for your phone');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Notebook', click: showWindow },
    { type: 'separator' },
    { label: 'Quit Notebook', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

function showWindow() {
  if (!app.isReady()) return;
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

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
    items: lib.data.items.map((it) => ({ ...it, src: url(it.file), thumbSrc: url(it.thumb), waiting: lib.waiting.has(it.id) })),
    types: features ? features.types : [],
    styles: features ? features.styles() : []
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
      if (features && lib) features.kick(); // new or changed pictures get recognised in the background
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
  await sync.start(lib); // never throws: problems show in the Phone panel
  if (autoBackup) autoBackup.check();
  const opened = lib; // fingerprints for older items, quietly, so duplicates are noticed; and when things were taken
  setTimeout(() => opened.fillHashes().catch((err) => console.error('fingerprints', err))
    .then(() => opened.fillDates()).then((n) => { if (n && lib === opened) send('lib:changed', { snap: snapshot(), arrived: [] }); })
    .catch((err) => console.error('dates', err)), 4000);
  return { recovered: lib.recovered };
}

// Requests from the Phone panel. They return the panel's status, or { error } in plain English.
function handleSync(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { await fn(...args); return { ok: true, status: await sync.status() }; } catch (err) {
      console.error(channel, err);
      return { error: friendly(err) };
    }
  });
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
  features = setupFeatures({ app, handle, getLib: () => lib, send, snapshot, getWin: () => win });
  sync.feed = features.feed; // the phone gets Ideas too
  autoBackup = setupAutoBackup({ handle, getLib: () => lib, readConfig, writeConfig, pickFolder, send });
  handle('lib:state', async () => {
    const saved = readConfig().libraryPath;
    if (!lib && saved && fs.existsSync(saved)) await useLibrary(saved);
    if (lib) {
      const recovered = lib.recovered && !reportedRecovery;
      reportedRecovery = true;
      return { status: 'ready', recovered };
    }
    return { status: 'none', defaultPath: defaultLibraryPath(), missing: saved && !fs.existsSync(saved) ? saved : null };
  });

  handleSync('sync:open', () => { if (sync.codeState() !== 'ready') sync.newCode(); });
  handleSync('sync:status', () => {});
  handleSync('sync:newCode', () => sync.newCode());
  handleSync('sync:unpair', (deviceId) => sync.unpair(String(deviceId)));
  handleSync('sync:keepReady', (on) => { sync.setKeepReady(!!on); applyKeepReady(!!on); });

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
  handle('items:import', async (paths, boardId) => lib.importFiles(await Library.expandFolders(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []), boardId));
  handle('boards:reorder', (ids) => lib.reorderBoards(ids));
  // A pasted or dropped picture that isn't a file on disk (a screenshot, an image copied or dragged
  // from a browser): written to a temporary file, imported like any other, then the temporary file goes.
  handle('items:importData', async (name, bytes, boardId) => {
    const ext = path.extname(String(name || '')).toLowerCase();
    if (![...PHOTO_EXT, ...VIDEO_EXT].includes(ext)) { const e = new Error(); e.friendly = 'Only photos and videos can be added.'; throw e; }
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 2e9) { const e = new Error(); e.friendly = "That picture couldn't be read."; throw e; }
    const clean = path.basename(String(name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').slice(0, 120).trim() || 'Pasted' + ext;
    const dir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'notebook-paste-'));
    try {
      await fs.promises.writeFile(path.join(dir, clean), bytes);
      return await lib.importFiles([path.join(dir, clean)], boardId);
    } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
  });

  handle('item:update', (id, changes) => lib.updateItem(id, changes || {}));
  handle('item:thumb', (id, bytes, meta) => lib.saveThumb(id, bytes, meta));
  // A camera RAW photo's preview, from the JPEG inside it (the page can't read RAW files itself).
  handle('item:rawThumb', async (id) => {
    const it = lib.item(String(id));
    if (!isRaw(it.file)) { const e = new Error(); e.friendly = 'That isn’t a RAW photo.'; throw e; }
    const { data, width, height } = await rawPreview(lib.p(it.file));
    await lib.saveThumb(it.id, data, { w: width, h: height });
  });
  handle('item:bin', (id) => lib.moveToBin(id));
  handle('items:onPhone', (ids, on) => lib.setOnPhone(Array.isArray(ids) ? ids.map(String) : [], !!on));
  handle('items:stack', async (ids, boardId) => ({ id: await lib.stackItems(Array.isArray(ids) ? ids.map(String) : [], typeof boardId === 'string' ? boardId : null) }));
  handle('item:unstack', (id) => lib.unstackItem(String(id)));
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
  // The checks can open the window on the second monitor (NOTEBOOK_WINDOW_DISPLAY=second) without taking focus.
  const other = process.env.NOTEBOOK_WINDOW_DISPLAY === 'second' && screen.getAllDisplays().find((d) => d.id !== screen.getPrimaryDisplay().id);
  if (other) win.setBounds({ ...other.workArea, width: Math.min(1440, other.workArea.width), height: Math.min(1000, other.workArea.height) });
  // Otherwise it opens where you left it (if that place is still on a screen), or maximised the first time.
  const was = !other && readConfig().window;
  const onScreen = was && screen.getAllDisplays().some((d) => { const a = d.workArea; return was.x < a.x + a.width - 80 && was.x + was.width > a.x + 80 && was.y >= a.y - 20 && was.y < a.y + a.height - 80; });
  if (onScreen) win.setBounds({ x: was.x, y: was.y, width: Math.max(900, was.width), height: Math.max(620, was.height) });
  win.once('ready-to-show', () => { if (other) win.showInactive(); else { if (!onScreen || was.maximized) win.maximize(); win.show(); } });
  let placeTimer = null;
  const remember = () => { clearTimeout(placeTimer); placeTimer = setTimeout(() => { if (win && !win.isDestroyed() && !win.isMinimized() && !other) writeConfig({ window: { ...win.getNormalBounds(), maximized: win.isMaximized() } }); }, 600); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, remember);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // With "Keep Notebook ready for your phone" on, closing hides the window so sync keeps working.
  let told = false;
  win.on('close', (e) => {
    if (quitting || !keepReady()) return;
    e.preventDefault();
    win.hide();
    ensureTray();
    if (!told && tray) {
      told = true;
      tray.displayBalloon({ title: 'Notebook is still running', content: 'Your phone can keep syncing. To quit, right-click the Notebook icon here and choose Quit Notebook.' });
    }
  });
  win.on('closed', () => { win = null; });
  win.loadURL('nb://notebook/app/index.html');
}

app.on('before-quit', () => { quitting = true; });

// Let the last save and any phone transfer finish before the app closes.
let closedCleanly = false;
app.on('will-quit', (e) => {
  if (closedCleanly) return;
  e.preventDefault();
  // Windows are already closed here; app.quit() again would be ignored, so exit once saving is done.
  Promise.all([lib ? lib.queue.catch(() => {}) : null, sync.stop().catch(() => {})]).finally(() => { closedCleanly = true; app.exit(0); });
});

app.whenReady().then(async () => {
  if (!FIRST_INSTANCE) return;
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  protocol.handle('nb', async (request) => {
    // Pictures for Ideas: fetched from Pinterest by this PC the first time they're shown, then kept.
    const idea = /^nb:\/\/notebook\/feed\/([0-9a-f]{32})(-big)?\.jpg$/.exec(request.url);
    if (idea) { const file = features && await features.feed.image(idea[1], !!idea[2]); return file ? serveFile(file, request) : new Response('Not found', { status: 404 }); }
    const file = resolveUrl(request.url);
    return file ? serveFile(file, request) : new Response('Not found', { status: 404 });
  });
  // Nothing ever leaves this PC: all web requests are blocked.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  registerHandlers();
  // Open the library straight away so phone sync works even before (or without) the window.
  const saved = readConfig().libraryPath;
  if (saved && fs.existsSync(saved)) {
    try { await useLibrary(saved); } catch (err) { console.error('open library', err); } // the window shows the problem
  }
  if (keepReady()) applyKeepReady(true); // also refreshes the startup entry if Notebook was moved
  if (BACKGROUND && keepReady()) ensureTray();
  else createWindow();
});

app.on('window-all-closed', () => {
  if (quitting || !keepReady()) app.quit();
});
