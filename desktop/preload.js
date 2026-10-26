// The small API the pages (wallpaper, bar, island, panel) get from the main process.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (e, v) => cb(v));

contextBridge.exposeInMainWorld('rez', {
  settings: () => ipcRenderer.invoke('settings'),
  info: () => ipcRenderer.invoke('info'),
  set: (patch) => ipcRenderer.send('set', patch),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  onSettings: on('settings'),
  onMedia: on('media'),
  onLyrics: on('lyrics'),
  onPause: on('pause'),
  onAudio: on('audio'),
  onPanel: on('panel'),
  onIsland: on('island'),
  onInfo: on('info'),
  media: (action, pos) => ipcRenderer.send('media', action, pos),
  panel: (cmd) => ipcRenderer.send('panel', cmd),
  islandMouse: (on) => ipcRenderer.send('island-mouse', !!on),
  action: (name) => ipcRenderer.send('action', name),
  log: (msg) => ipcRenderer.send('log', String(msg)),
  // the Start menu and the Quick settings
  shell: (cmd, arg) => ipcRenderer.send('shell', cmd, arg),
  onShell: on('shell'),
  onApps: on('apps'),
  onRecent: on('recent'),
  onStatus: on('status'),
  // the taskbar
  onWindows: on('windows'),
  onTaskpins: on('taskpins'),
  onTray: on('tray'),
  // the volume pill
  onOsd: on('osd'),
});
