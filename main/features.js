// The "full version" features. Track A: on-PC recognition in the background, corrections, the style
// list, and suggested groups / matching sets. Track B: saving from TikTok and Pinterest links (with a
// retry list, "Check my links" and a manual downloader update) and the Pinterest panel. Plain IPC handlers.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { utilityProcess, ipcMain } = require('electron');
const { Scanner } = require('./scanner');
const { TYPES, DEFAULT_STYLES } = require('./recognise');
const { suggestions } = require('./suggest');
const { Downloader } = require('./downloader');
const links = require('./links');
const { setupPinterest } = require('./pinterest');
const { Feed, PinterestSource, FakeSource, pinIdOf } = require('./feed');

// Where downloaded tools live: D:\Notebook Tools when there's a D: drive (as agreed), else next to the settings.
function toolsDir(app) {
  if (process.env.NOTEBOOK_TOOLS) return process.env.NOTEBOOK_TOOLS;
  return fs.existsSync('D:\\') ? 'D:\\Notebook Tools' : path.join(app.getPath('userData'), 'tools');
}

function setupFeatures({ app, handle, getLib, send, snapshot, getWin }) {
  const tools = toolsDir(app);
  let kickTimer = null;
  const scanner = new Scanner({
    modelsDir: path.join(tools, 'models'),
    fork: (file) => {
      const w = utilityProcess.fork(file, [], { serviceName: 'Notebook recognition', stdio: 'ignore' });
      return { on: (e, fn) => w.on(e, fn), postMessage: (m) => w.postMessage(m), kill: () => w.kill() };
    },
    onProgress: (s) => send('ai:progress', s),
    onChanged: () => { const lib = getLib(); if (lib) send('lib:changed', { snap: snapshot(), arrived: [] }); }
  });
  // Something changed in the library: look for new pictures a moment later (cheap when there's nothing new).
  const kick = () => { clearTimeout(kickTimer); kickTimer = setTimeout(() => { const lib = getLib(); if (lib) scanner.start(lib); }, 800); };

  const memoryFile = () => path.join(getLib().root, 'ai', 'suggestions.json');
  const readMemory = async () => { try { return JSON.parse(await fsp.readFile(memoryFile(), 'utf8')); } catch { return { dismissed: [], names: {} }; } };
  const writeMemory = async (m) => { await fsp.mkdir(path.dirname(memoryFile()), { recursive: true }); await fsp.writeFile(memoryFile() + '.tmp', JSON.stringify(m, null, 1)); await fsp.rename(memoryFile() + '.tmp', memoryFile()); };
  const current = async () => { const lib = getLib(); return suggestions(lib.data.items, await scanner.embeddings(lib), await readMemory()); };

  handle('ai:status', async () => ({ status: scanner.state, types: Object.keys(TYPES), styles: getLib().styles(DEFAULT_STYLES), tools }));
  handle('ai:labels', (id, changes) => getLib().setLabels(String(id), changes || {}, Object.keys(TYPES), getLib().styles(DEFAULT_STYLES)));
  handle('ai:setStyles', async (list) => { const styles = await getLib().setStyles(list); kick(); return { styles }; });
  handle('ai:rescan', async () => { scanner.rescan(getLib()); });
  handle('suggest:list', async () => ({ suggestions: await current() }));
  handle('suggest:dismiss', async (sig) => { const m = await readMemory(); m.dismissed = [...new Set([...(m.dismissed || []), String(sig)])]; await writeMemory(m); return { suggestions: await current() }; });
  handle('suggest:rename', async (sig, name) => { const m = await readMemory(); m.names = { ...(m.names || {}), [String(sig)]: String(name).trim().slice(0, 40) }; await writeMemory(m); return { suggestions: await current() }; });
  // Keep as a board: makes a board with the suggestion's name and puts its items on it (nothing is moved off other boards).
  handle('suggest:keep', async (sig, name) => {
    const lib = getLib();
    const g = (await current()).find((x) => x.sig === String(sig));
    if (!g) { const e = new Error(); e.friendly = 'That suggestion has changed. Have another look.'; throw e; }
    const boardId = await lib.addBoard(String(name || g.name).trim() || g.name);
    for (const id of g.ids) { const it = lib.data.items.find((i) => i.id === id); if (it && !it.boards.includes(boardId)) await lib.updateItem(id, { boards: [...it.boards, boardId] }); }
    const m = await readMemory(); m.dismissed = [...new Set([...(m.dismissed || []), g.sig])]; await writeMemory(m);
    return { id: boardId, suggestions: await current() };
  });

  // ---------- saving from links (Track B) ----------
  const dl = new Downloader({ binDir: path.join(tools, 'bin'), tmpDir: path.join(tools, 'tmp') });
  let queue = Promise.resolve();
  // One save at a time; the page hears "saving" straight away and the result when it's done.
  const save = (url, boardId) => (queue = queue.then(async () => {
    send('links:saving', { url });
    const res = await links.saveLink({ lib: getLib(), dl, url, boardId });
    send('links:saved', { url, ...res, snap: snapshot(), retry: links.list(getLib()).retry });
    kick();
    return res;
  }));
  handle('links:save', (url, boardId) => save(String(url), boardId ? String(boardId) : null));
  handle('links:list', async () => ({ ...links.list(getLib()), ready: dl.ready(), versions: dl.ready() ? await dl.versions() : null }));
  handle('links:forget', async (url) => { await links.forget(getLib(), String(url)); return { retry: links.list(getLib()).retry }; });
  // "Check my links": re-tests your last few saved links (nothing is downloaded).
  handle('links:check', async () => {
    const saved = links.list(getLib()).saved.slice(0, 6);
    if (!saved.length) { const e = new Error(); e.friendly = 'Save a link or two first, then there’s something to check.'; throw e; }
    return { results: await dl.check(saved) };
  });
  handle('links:update', async () => ({ update: await dl.update() }));
  const pinterest = setupPinterest({ getWin, handle, send, save: (url) => save(url, null), aiScore: (bytes, strict) => scanner.aiScore(bytes, strict) });

  // ---------- Ideas (the Pinterest-style feed) ----------
  const changed = new Map();
  const feed = new Feed({
    getLib, dir: path.join(app.getPath('userData'), 'feed'),
    source: process.env.NOTEBOOK_FAKE_FEED ? new FakeSource() : new PinterestSource(pinterest.session),
    embeddings: (lib) => scanner.embeddings(lib), embed: (bytes) => scanner.embed(bytes), aiHide: pinterest.aiHide, aiQuick: pinterest.aiQuick, aiKnown: pinterest.aiKnown,
    onChange: (key) => { clearTimeout(changed.get(key)); changed.set(key, setTimeout(() => send('feed:changed', { key }), 120)); }
  });
  // Plain answers (no library snapshot each time): { feed } or { error }.
  const feedCall = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
    try { return await fn(...args); } catch (err) { console.error(channel, err); return { error: 'Ideas aren’t available just now.' }; }
  });
  feedCall('feed:get', (key) => ({ feed: feed.get(String(key)) }));
  feedCall('feed:refresh', (key) => { feed.load(String(key), 'fresh'); return { feed: feed.get(String(key), { load: false }) }; });
  feedCall('feed:more', (key) => { feed.load(String(key), 'more'); return { feed: feed.get(String(key), { load: false }) }; });
  feedCall('feed:hide', async (id) => { await feed.hide(String(id)); return {}; });
  // Save a pin from Ideas (onto a board if given). The result arrives like any saved link.
  const saveIdea = (url, boardId) => {
    const id = pinIdOf(url), lib = getLib();
    if (!id || !lib) return false;
    save(`https://www.pinterest.com/pin/${id}/`, typeof boardId === 'string' && lib.data.boards.some((b) => b.id === boardId) ? boardId : null);
    return true;
  };
  feedCall('feed:save', (url, boardId) => (saveIdea(String(url), boardId) ? {} : { error: 'That isn’t a Pinterest pin.' }));
  feed.saveIdea = saveIdea;
  // For you and recently looked-at boards are kept ready (checked a minute after start, then every hour).
  setTimeout(() => { feed.warm(); setInterval(() => feed.warm(), 60 * 60 * 1000); }, process.env.NOTEBOOK_USER_DATA ? 3600000 : 60000);

  return { kick, scanner, tools, feed, styles: () => getLib().styles(DEFAULT_STYLES), types: Object.keys(TYPES) };
}

module.exports = { setupFeatures, toolsDir };
