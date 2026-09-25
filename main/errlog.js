// Notebook's error log: what went wrong, on the PC and on the phone (it sends its own with each sync),
// kept in <userData>/logs/errors.log (about the last 1 MB, plus the one before as errors.old.log).
// Nothing leaves the PC. It's there so problems can be found without anyone having to notice them first.
const fs = require('fs');
const path = require('path');

const MAX = 1024 * 1024;
let file = null;

const text = (x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })());

function write(where, ...parts) {
  if (!file) return;
  try {
    try { if (fs.statSync(file).size > MAX) fs.renameSync(file, file.replace(/\.log$/, '.old.log')); } catch { /* no log yet */ }
    fs.appendFileSync(file, `${new Date().toISOString()} [${where}] ${parts.map(text).join(' ')}\n`);
  } catch { /* the log must never break anything */ }
}

// Everything that already goes to console.error, uncaught errors, crashed processes and the window's
// own script errors (sent by preload.js) end up here.
function install({ app, ipcMain, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'errors.log');
  const plain = console.error.bind(console);
  console.error = (...a) => { plain(...a); write('pc', ...a); };
  process.on('uncaughtException', (err) => write('pc crash', err));
  process.on('unhandledRejection', (err) => write('pc', 'unhandled:', err));
  app.on('render-process-gone', (_e, _wc, d) => write('window gone', d.reason, 'exit code ' + d.exitCode));
  app.on('child-process-gone', (_e, d) => { if (!['clean-exit', 'killed'].includes(d.reason)) write('process gone', d.type, d.serviceName || d.name || '', d.reason, 'exit code ' + d.exitCode); });
  ipcMain.on('log:error', (_e, msg) => write('window', String(msg).slice(0, 4000)));
}

module.exports = { install, write, file: () => file };
