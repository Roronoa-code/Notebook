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
  setOnPhone: call('items:onPhone'),
  stackItems: call('items:stack'),
  unstackItem: call('item:unstack'),
  restore: call('item:restore'),
  addNote: call('note:add'),
  emptyBin: call('bin:empty'),
  addBoard: call('board:add'),
  renameBoard: call('board:rename'),
  deleteBoard: call('board:delete'),
  backup: call('backup:run'),
  restoreBackup: call('backup:restore'),
  exportAll: call('export:run'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  // Recognition, styles and suggestions (build plan Track A)
  aiStatus: call('ai:status'),
  setLabels: call('ai:labels'),
  setStyles: call('ai:setStyles'),
  rescan: call('ai:rescan'),
  suggestions: call('suggest:list'),
  dismissSuggestion: call('suggest:dismiss'),
  renameSuggestion: call('suggest:rename'),
  keepSuggestion: call('suggest:keep'),
  onAiProgress: (fn) => ipcRenderer.on('ai:progress', (_e, s) => fn(s)),
  // Phone sync
  syncOpen: call('sync:open'),
  syncStatus: call('sync:status'),
  syncNewCode: call('sync:newCode'),
  syncUnpair: call('sync:unpair'),
  syncKeepReady: call('sync:keepReady'),
  onLibraryChanged: (fn) => ipcRenderer.on('lib:changed', (_e, payload) => fn(payload)),
  onSyncChanged: (fn) => ipcRenderer.on('sync:changed', () => fn())
});
