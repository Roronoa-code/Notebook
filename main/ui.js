// In-app confirmations and local file picking. Every reply belongs to one main-window request.
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

module.exports = function setupUI({ ipcMain, app, getWin }) {
  let queue = Promise.resolve(), active = null, generation = 0;
  const request = (kind, options) => {
    const requested = generation;
    const next = queue.then(() => new Promise(resolve => {
      const window = getWin(), owner = window?.webContents;
      if (requested !== generation || !owner || owner.isDestroyed()) return resolve(null);
      const overlays = window.contentView.children.filter(view => view.getVisible());
      overlays.forEach(view => view.setVisible(false));
      let finished = false;
      const finish = value => {
        if (finished) return; finished = true;
        if (!window.isDestroyed()) overlays.forEach(view => { if (window.contentView.children.includes(view)) view.setVisible(true); });
        owner.removeListener('destroyed', cancel); owner.removeListener('did-start-navigation', cancel);
        owner.removeListener('render-process-gone', cancel);
        active = null; resolve(value);
      };
      const cancel = () => { generation++; finish(null); };
      active = { id: randomUUID(), kind, options, owner, finish };
      owner.once('destroyed', cancel); owner.once('did-start-navigation', cancel); owner.once('render-process-gone', cancel);
      owner.send('ui:request', { id: active.id, kind, ...options });
    }));
    queue = next.catch(() => null);
    return next;
  };
  function current(event, id, kind) {
    if (!active || active.owner !== event.sender || active.id !== id || (kind && active.kind !== kind)) throw new Error('That window is no longer open.');
    return active;
  }
  function absolute(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('Enter a full folder path.');
    return path.resolve(value);
  }
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    try { return await fn(event, ...args); }
    catch (e) { return { error: e.code === 'EACCES' || e.code === 'EPERM' ? 'Windows did not allow access to that folder.' : e.code === 'ENOENT' ? 'That file or folder is no longer there.' : e.code === 'EEXIST' ? 'A folder with that name already exists.' : e.message }; }
  });
  handle('ui:reply', async (event, id, value) => {
    const req = current(event, id);
    if (value === null || value === false) { req.finish(null); return { ok: true }; }
    if (req.kind === 'confirm') {
      if (value !== true) throw new Error('Choose one of the confirmation buttons.');
      req.finish(true); return { ok: true };
    }
    if (!Array.isArray(value) || !value.length || value.length > 1000 || (req.options.folder && value.length !== 1)) throw new Error('Choose a file or folder first.');
    const selected = [...new Set(value.map(absolute))];
    for (const file of selected) {
      const stat = await fs.stat(file);
      if (req.options.folder ? !stat.isDirectory() : !stat.isFile() || !req.options.extensions.includes(path.extname(file).slice(1).toLowerCase())) throw new Error('That selection cannot be used here.');
    }
    if (active !== req) throw new Error('That window is no longer open.');
    req.finish(selected); return { ok: true };
  });
  handle('ui:browse', async (event, id, location) => {
    const req = current(event, id, 'pick');
    const dir = absolute(location || req.options.defaultPath);
    const items = await fs.readdir(dir, { withFileTypes: true });
    const entries = items.filter(e => e.isDirectory() || (!req.options.folder && e.isFile() && req.options.extensions.includes(path.extname(e.name).slice(1).toLowerCase())))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(e => ({ name: e.name, path: path.join(dir, e.name), directory: e.isDirectory() }));
    return { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), entries };
  });
  handle('ui:places', async (event, id) => {
    current(event, id, 'pick');
    const places = ['home', 'desktop', 'documents', 'pictures', 'videos', 'downloads'].map(key => ({ name: key === 'home' ? 'Home' : key[0].toUpperCase() + key.slice(1), path: app.getPath(key) }));
    if (process.platform === 'win32') {
      const drives = await Promise.all(Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i) + ':\\').map(async drive => {
        try { await fs.access(drive); return { name: drive.slice(0, 2), path: drive }; } catch { return null; }
      }));
      places.push(...drives.filter(Boolean));
    } else places.push({ name: 'Computer', path: '/' });
    return { places };
  });
  handle('ui:mkdir', async (event, id, location, name) => {
    const req = current(event, id, 'pick');
    if (!req.options.folder) throw new Error('Folders cannot be created in this picker.');
    if (typeof name !== 'string' || !name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(\.|\.\.|CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(name)) throw new Error('Choose a simple folder name without slashes or special characters.');
    const dir = path.join(absolute(location), name);
    await fs.mkdir(dir);
    return { path: dir };
  });
  return {
    confirm: async (message, detail, okLabel) => (await request('confirm', { message, detail, okLabel })) === true,
    pick: async options => { const files = await request('pick', options); return { canceled: !files, filePaths: files || [] }; }
  };
};
