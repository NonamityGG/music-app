// The small API the wallpaper and the bar pages get from the main process.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rez', {
  settings: () => ipcRenderer.invoke('settings'),
  onSettings: (cb) => ipcRenderer.on('settings', (e, s) => cb(s)),
  onMedia: (cb) => ipcRenderer.on('media', (e, m) => cb(m)),
  onPause: (cb) => ipcRenderer.on('pause', (e, p) => cb(p)),
  media: (action, pos) => ipcRenderer.send('media', action, pos),
  menu: (x, y) => ipcRenderer.send('menu', x, y),
  log: (msg) => ipcRenderer.send('log', String(msg)),
});
