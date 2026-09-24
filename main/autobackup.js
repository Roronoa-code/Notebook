// Automatic backups: once switched on (Library menu), the library is backed up to your chosen folder
// straight away, then again whenever the app starts and the last one is a week old. The newest three
// automatic backups are kept; older ones this made are deleted. Backups you make yourself are never touched.
const fs = require('fs');
const path = require('path');

const WEEK = 7 * 864e5, KEEP = 3;

function setupAutoBackup({ handle, getLib, readConfig, writeConfig, pickFolder, send }) {
  const cfg = () => readConfig().autoBackup || {};
  const set = (changes) => writeConfig({ autoBackup: { ...cfg(), ...changes } });
  const state = () => { const c = cfg(); return { on: !!c.on, dir: c.dir || null, last: c.last || null, running }; };
  let running = false;

  async function run() {
    const lib = getLib(), c = cfg();
    if (running || !lib || !c.on || !c.dir) return;
    running = true;
    send('backup:auto', { ...state(), status: 'running' });
    try {
      await fs.promises.mkdir(c.dir, { recursive: true });
      const res = await lib.backup(c.dir);
      const made = [res.dir, ...(c.made || [])];
      // Only folders this made, still looking like Notebook backups, inside the chosen folder.
      for (const old of made.slice(KEEP)) {
        const ours = path.dirname(old) === path.resolve(c.dir) && /^Notebook Backup /.test(path.basename(old)) && fs.existsSync(path.join(old, 'backup-info.json'));
        if (ours) await fs.promises.rm(old, { recursive: true, force: true });
      }
      set({ last: new Date().toISOString(), made: made.slice(0, KEEP), error: null });
      running = false;
      send('backup:auto', { ...state(), status: 'done', items: res.items, bytes: res.bytes });
    } catch (err) {
      set({ error: err.friendly || err.message });
      running = false;
      send('backup:auto', { ...state(), status: 'failed', error: err.friendly || "The automatic backup couldn't be made." });
    } finally { running = false; }
  }
  const due = () => { const c = cfg(); return c.on && c.dir && (!c.last || Date.now() - Date.parse(c.last) > WEEK); };

  handle('backup:auto:get', async () => state());
  handle('backup:auto:set', async (on) => {
    if (!on) { set({ on: false }); return state(); }
    let dir = cfg().dir;
    if (!dir || !fs.existsSync(dir)) {
      dir = await pickFolder('Choose where automatic backups go (ideally another drive)', readConfig().lastBackupDir || path.dirname(getLib().root), 'Back up here');
      if (!dir) return { ...state(), cancelled: true };
    }
    const root = path.resolve(getLib().root);
    if (path.resolve(dir).startsWith(root + path.sep) || path.resolve(dir) === root) { const msg = 'Pick a folder outside the library itself for backups.'; throw Object.assign(new Error(msg), { friendly: msg }); }
    set({ on: true, dir });
    if (due()) run(); // the first one straight away, in the background
    return state();
  });
  handle('backup:auto:folder', async () => {
    const dir = await pickFolder('Choose where automatic backups go', cfg().dir || readConfig().lastBackupDir, 'Back up here');
    if (dir) { set({ dir, made: [] }); if (due()) run(); }
    return state();
  });

  // Called when a library opens: a backup if one is due, a little later so starting up stays quick.
  return { check: () => setTimeout(() => { if (due()) run(); }, +process.env.NOTEBOOK_AUTOBACKUP_DELAY_MS || 60000) };
}

module.exports = { setupAutoBackup };
