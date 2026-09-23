// The only doorway between the page and the rest of the PC.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('nb', {
  state: call('lib:state'),
  useLibrary: call('lib:use'),
  revealLibrary: call('lib:reveal'),
  revealItem: call('item:reveal'),
  pickFiles: call('items:pick'),
  importPaths: call('items:import'),
  updateItem: call('item:update'),
  saveThumb: call('item:thumb'),
  moveToBin: call('item:bin'),
  restore: call('item:restore'),
  addNote: call('note:add'),
  emptyBin: call('bin:empty'),
  addBoard: call('board:add'),
  renameBoard: call('board:rename'),
  deleteBoard: call('board:delete'),
  backup: call('backup:run'),
  restoreBackup: call('backup:restore'),
  exportAll: call('export:run'),
  pathForFile: (file) => webUtils.getPathForFile(file)
});
