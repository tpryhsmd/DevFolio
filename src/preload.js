const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ファイル操作
  newFile: () => ipcRenderer.invoke('ptf:new'),
  openFile: () => ipcRenderer.invoke('ptf:open'),
  save: () => ipcRenderer.invoke('ptf:save'),
  saveAs: () => ipcRenderer.invoke('ptf:saveAs'),

  // ドキュメント操作
  getDocument: () => ipcRenderer.invoke('ptf:getDocument'),
  updateDocument: (doc) => ipcRenderer.invoke('ptf:updateDocument', doc),

  // 画像操作
  addImage: (arrayBuffer, ext) => ipcRenderer.invoke('ptf:addImage', arrayBuffer, ext),
  getImage: (ref) => ipcRenderer.invoke('ptf:getImage', ref),

  // イベント受信
  onPtfLoaded: (cb) => ipcRenderer.on('ptf:loaded', (_, doc) => cb(doc)),
  onMenuUndo: (cb) => ipcRenderer.on('menu:undo', () => cb()),
  onMenuRedo: (cb) => ipcRenderer.on('menu:redo', () => cb()),

  // リスナー解除
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
