// Резонанс для ПК — the main process.
//
// Two kinds of windows:
//   * wallpaper: one per screen, put behind the desktop icons by the Windows
//     helper (host/RezonansHost.exe); the waves listen to whatever the PC plays;
//   * bar: a thin acrylic strip along the top of the main screen with the player
//     (any music app that shows up in Windows' media controls) and the clock.
// Everything is set from the tray icon (or the logo on the bar).

'use strict';

const { app, BrowserWindow, Tray, Menu, screen, ipcMain, session, desktopCapturer, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

// The wallpaper sits under other windows: Chromium must not decide it is hidden
// and stop drawing it.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const BAR_H = 36; // DIP

const STYLES = [
  ['neon', 'Неон'],
  ['ribbons', 'Ленты'],
  ['capsules', 'Капсулы'],
  ['dots', 'Точки'],
  ['rings', 'Кольца'],
  ['scope', 'Осциллограф'],
];
const PALETTES = [
  ['violet', 'Фиолет'],
  ['neon', 'Неон'],
  ['sunset', 'Закат'],
  ['mint', 'Мята'],
];
const BACKGROUNDS = [
  ['glass-violet', 'Liquid Glass фиолетовый'],
  ['glass-black', 'Liquid Glass чёрный'],
  ['dark', 'Тёмный'],
  ['amoled', 'Чёрный (AMOLED)'],
];
const ATTACH = [
  ['auto', 'Автоматически'],
  ['child', 'Способ 1 (Windows 11 24H2+)'],
  ['layered', 'Способ 2 (Windows 11 24H2+)'],
  ['worker', 'Способ 3 (Windows 10 и ранние 11)'],
];

// ---------- settings and log ----------

const DEFAULTS = { wallpaper: true, bar: true, style: 'neon', palette: 'violet', bg: 'glass-violet', autostart: true, attachMode: 'auto', firstRun: true };
let settings = { ...DEFAULTS };
let settingsFile = '';
let logFile = '';

function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function saveSettings(patch) {
  Object.assign(settings, patch);
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch (e) {
    log('settings: ' + e.message);
  }
  for (const w of allWindows()) w.webContents.send('settings', settings);
  rebuildMenu();
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try {
    if (!logFile) logFile = path.join(app.getPath('userData'), 'rezonans.log');
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1e6) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, line);
  } catch {}
  if (!app.isPackaged) process.stdout.write(line);
}

// ---------- the Windows helper ----------

let host = null;
let hostInfo = null; // reply to "hello"
let quitting = false;

function hostPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'host', 'RezonansHost.exe') : path.join(__dirname, 'host', 'bin', 'RezonansHost.exe');
}

function startHost() {
  const exe = hostPath();
  if (!fs.existsSync(exe)) {
    log('помощник не найден: ' + exe);
    return;
  }
  host = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  readline.createInterface({ input: host.stdout }).on('line', (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return log('помощник: ' + line);
    }
    onHost(m);
  });
  host.stderr.on('data', (d) => log('помощник (ошибка): ' + String(d).trim()));
  host.on('exit', (code) => {
    log('помощник закрылся, код ' + code);
    host = null;
    hostInfo = null;
    if (!quitting) setTimeout(() => {
      startHost();
    }, 2000);
  });
  hostSend({ cmd: 'hello' });
}

function hostSend(o) {
  if (host && host.stdin.writable) host.stdin.write(JSON.stringify(o) + '\n');
}

function onHost(m) {
  switch (m.type) {
    case 'hello':
      hostInfo = m;
      log(`помощник готов: ${m.os}, рабочий стол ${m.raised ? 'нового типа (24H2+)' : 'классический'}`);
      hookBar();
      for (const id of walls.keys()) attachWall(id);
      if (bar && barShown) registerAppBar();
      sendOwn();
      break;
    case 'attached': {
      const w = walls.get(Number(m.id));
      log(`обои на экране ${m.id}: ${m.ok ? 'встали' : 'НЕ встали'} (${m.how || m.mode || ''}${m.error ? ', ' + m.error : ''}, ${m.at || ''})`);
      if (!w) break;
      w.attached = !!m.ok;
      if (m.ok) w.win.showInactive();
      else if (!w.warned) {
        w.warned = true;
        notify('Обои не встали под значки', 'Попробуй другой способ: меню Резонанса → «Способ встраивания обоев».');
      }
      break;
    }
    case 'appbar':
      log(`строка заняла место: ${m.x},${m.y} ${m.w}×${m.h}`);
      break;
    case 'media':
      lastMedia = m.thumb !== undefined || !lastMedia ? m : { ...m, thumb: lastMedia.thumb };
      if (bar) bar.webContents.send('media', m);
      break;
    case 'fg':
      onForeground(m);
      break;
    case 'log':
      log('помощник: ' + m.msg);
      break;
    default:
      break;
  }
}

function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
}

function sendOwn() {
  hostSend({ cmd: 'own', hwnds: allWindows().map(hwndOf) });
}

function allWindows() {
  const list = [...walls.values()].map((w) => w.win);
  if (bar) list.push(bar);
  return list.filter((w) => w && !w.isDestroyed());
}

// ---------- wallpaper ----------

const walls = new Map(); // display id -> { win, display, attached, paused }
const preload = path.join(__dirname, 'preload.js');

function createWallpapers() {
  for (const d of screen.getAllDisplays()) createWall(d);
}

function createWall(d) {
  const win = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    frame: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#0f0b16',
    title: 'Rezonans wallpaper',
    webPreferences: { preload, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, 'app', 'wallpaper.html'), { query: { screen: String(d.id) } });
  win.once('ready-to-show', () => attachWall(d.id));
  win.on('closed', () => {
    const w = walls.get(d.id);
    if (w && w.win === win) walls.delete(d.id);
    // Explorer restarted (its desktop took our window down with it): build again
    if (!quitting && settings.wallpaper && w && !w.closing) scheduleRebuild('обои закрылись');
  });
  walls.set(d.id, { win, display: d, attached: false, paused: false, closing: false });
}

function attachWall(id) {
  const w = walls.get(id);
  if (!w || !hostInfo || w.win.isDestroyed()) return;
  const r = screen.dipToScreenRect(null, w.display.bounds);
  hostSend({ cmd: 'attach', id: String(id), hwnd: hwndOf(w.win), x: r.x, y: r.y, w: r.width, h: r.height, mode: settings.attachMode });
  sendOwn();
}

function closeWallpapers() {
  for (const w of walls.values()) {
    w.closing = true;
    if (!w.win.isDestroyed()) w.win.destroy();
  }
  walls.clear();
  hostSend({ cmd: 'refreshWallpaper' });
}

// rest while a window covers the whole screen (saves the graphics card)
function onForeground(m) {
  for (const w of walls.values()) {
    if (w.win.isDestroyed()) continue;
    const r = screen.dipToScreenRect(null, w.display.bounds);
    const same = Math.abs(r.x - m.mx) < 4 && Math.abs(r.y - m.my) < 4 && Math.abs(r.width - m.mw) < 6 && Math.abs(r.height - m.mh) < 6;
    const covered = !m.desktop && same && (m.full || m.max);
    if (covered !== w.paused) {
      w.paused = covered;
      w.win.webContents.send('pause', covered);
    }
  }
  // a full-screen game or video on the main screen: the bar steps aside
  if (bar && barShown) {
    const p = screen.dipToScreenRect(null, screen.getPrimaryDisplay().bounds);
    const onMain = Math.abs(p.x - m.mx) < 4 && Math.abs(p.y - m.my) < 4;
    setBarHidden(!m.desktop && m.full && onMain, 'fg');
  }
}

// ---------- the bar ----------

let bar = null;
let barShown = false;
let lastMedia = null;
const barHide = new Set();

function createBar() {
  const d = screen.getPrimaryDisplay();
  bar = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: BAR_H,
    frame: false,
    show: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    title: 'Rezonans bar',
    webPreferences: { preload, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  bar.loadFile(path.join(__dirname, 'app', 'bar.html'));
  bar.once('ready-to-show', () => {
    bar.showInactive();
    barShown = true;
    registerAppBar();
    sendOwn();
    if (lastMedia) bar.webContents.send('media', lastMedia);
  });
  bar.on('closed', () => {
    bar = null;
    barShown = false;
  });
  hookBar();
}

function registerAppBar() {
  if (!bar || bar.isDestroyed()) return;
  const d = screen.getPrimaryDisplay();
  const r = screen.dipToScreenRect(null, d.bounds);
  hostSend({ cmd: 'appbar', hwnd: hwndOf(bar), x: r.x, y: r.y, w: r.width, h: r.height, height: Math.round(BAR_H * d.scaleFactor) });
}

let hooked = null;
function hookBar() {
  if (!bar || !hostInfo || hooked === bar) return;
  hooked = bar;
  const num = (b) => (b && b.length >= 8 ? Number(b.readBigInt64LE(0)) : b && b.length >= 4 ? b.readInt32LE(0) : 0);
  bar.hookWindowMessage(hostInfo.appbarMsg, (wParam, lParam) => {
    const code = num(wParam);
    if (code === 1) registerAppBar(); // ABN_POSCHANGED: the taskbar moved or changed size
    if (code === 2) setBarHidden(num(lParam) !== 0, 'fullscreen'); // ABN_FULLSCREENAPP
  });
  // Explorer restarted: the app bar has to be registered again
  bar.hookWindowMessage(hostInfo.taskbarCreated, () => setTimeout(registerAppBar, 1500));
}

function setBarHidden(hide, why) {
  if (!bar || bar.isDestroyed()) return;
  if (hide) barHide.add(why);
  else barHide.delete(why);
  const should = barHide.size === 0;
  if (should && !bar.isVisible()) bar.showInactive();
  if (!should && bar.isVisible()) bar.hide();
}

function closeBar() {
  hostSend({ cmd: 'appbarRemove' });
  if (bar && !bar.isDestroyed()) bar.destroy();
  bar = null;
  barShown = false;
  hooked = null;
}

// ---------- tray and menu ----------

let tray = null;
let menu = null;

function radio(list, key) {
  return list.map(([id, label]) => ({ label, type: 'radio', checked: settings[key] === id, click: () => applySetting(key, id) }));
}

function rebuildMenu() {
  menu = Menu.buildFromTemplate([
    { label: 'Резонанс для ПК', enabled: false },
    { type: 'separator' },
    { label: 'Живые обои', type: 'checkbox', checked: settings.wallpaper, click: (i) => applySetting('wallpaper', i.checked) },
    { label: 'Строка с плеером', type: 'checkbox', checked: settings.bar, click: (i) => applySetting('bar', i.checked) },
    { type: 'separator' },
    { label: 'Стиль волн', submenu: radio(STYLES, 'style') },
    { label: 'Цвета', submenu: radio(PALETTES, 'palette') },
    { label: 'Фон', submenu: radio(BACKGROUNDS, 'bg') },
    { type: 'separator' },
    { label: 'Запускать вместе с Windows', type: 'checkbox', checked: settings.autostart, click: (i) => applySetting('autostart', i.checked) },
    { label: 'Способ встраивания обоев', submenu: radio(ATTACH, 'attachMode') },
    { label: 'Открыть журнал', click: () => shell.openPath(logFile) },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]);
  if (tray) tray.setContextMenu(menu);
}

function applySetting(key, value) {
  saveSettings({ [key]: value });
  if (key === 'wallpaper') {
    if (value) createWallpapers();
    else closeWallpapers();
  }
  if (key === 'bar') {
    if (value) createBar();
    else closeBar();
  }
  if (key === 'autostart') setAutostart(value);
  if (key === 'attachMode') rebuild('другой способ встраивания');
}

function setAutostart(on) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
}

function notify(title, content) {
  if (tray) tray.displayBalloon({ title, content, iconType: 'info' });
}

// ---------- screens changing, sleep, Explorer restarts ----------

let rebuildTimer = 0;
function scheduleRebuild(why) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => rebuild(why), 1500);
}

function rebuild(why) {
  log('перестраиваю: ' + why);
  closeWallpapers();
  if (settings.wallpaper) createWallpapers();
  if (settings.bar) {
    closeBar();
    createBar();
  }
}

// ---------- self-test (CI only) ----------

// Plays a soft beat with media info in a hidden window, so the build machine can
// check the whole chain: Windows media controls -> helper -> bar, and the waves.
function selftest() {
  log('самопроверка: включаю звук');
  const page = `<audio id="a" loop></audio><script>
    const sr = 22050, n = sr * 30, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const W = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    W(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); W(8, 'WAVE'); W(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); W(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / sr, b = (t * 2) % 1;
      const s = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-b * 8) * 0.8 + Math.sin(2 * Math.PI * 440 * t) * 0.08 * Math.exp(-((t * 4) % 1) * 6);
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767 * 0.7, true);
    }
    const a = document.getElementById('a');
    a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Проверка звука', artist: 'Резонанс', album: 'Самопроверка' });
    a.play().then(() => console.log('selftest playing')).catch((e) => console.log('selftest: ' + e.message));
  </script>`;
  const w = new BrowserWindow({ show: false, webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false } });
  w.webContents.on('console-message', (e, level, message) => log('самопроверка: ' + (typeof e.message === 'string' ? e.message : message)));
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
}

// ---------- start ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (tray && menu) tray.popUpContextMenu(menu);
  });

  app.whenReady().then(() => {
    loadSettings();
    log(`запуск ${app.getVersion()}`);
    if (settings.firstRun) {
      saveSettings({ firstRun: false });
      setAutostart(settings.autostart);
    }

    // the waves hear the whole PC: system sound loopback, no picker, no screen video kept
    session.defaultSession.setDisplayMediaRequestHandler(
      (request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen'] })
          .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
          .catch((e) => {
            log('звук компьютера: ' + e.message);
            callback({});
          });
      },
      { useSystemPicker: false }
    );

    ipcMain.handle('settings', () => settings);
    ipcMain.on('media', (e, action, pos) => hostSend({ cmd: 'media', action, pos: typeof pos === 'number' ? Math.round(pos) : -1 }));
    ipcMain.on('menu', (e, x, y) => {
      if (menu && bar) menu.popup({ window: bar, x: Math.round(x), y: Math.round(y) });
    });
    ipcMain.on('log', (e, msg) => log('окно: ' + msg));

    tray = new Tray(app.isPackaged ? path.join(process.resourcesPath, 'tray.ico') : path.join(__dirname, 'build', 'tray.ico'));
    tray.setToolTip('Резонанс');
    rebuildMenu();
    tray.on('click', () => tray.popUpContextMenu(menu));

    startHost();
    if (settings.wallpaper) createWallpapers();
    if (settings.bar) createBar();
    if (process.env.REZONANS_SELFTEST === '1') setTimeout(selftest, 3000);

    screen.on('display-added', () => scheduleRebuild('новый экран'));
    screen.on('display-removed', () => scheduleRebuild('экран отключён'));
    // the bar itself changes the work area: only a real change of the screen counts
    screen.on('display-metrics-changed', (e, d, changed) => {
      if ((changed || []).some((c) => c === 'bounds' || c === 'scaleFactor' || c === 'rotation')) scheduleRebuild('экран изменился');
    });
    powerMonitor.on('resume', () => scheduleRebuild('после сна'));
  });

  app.on('window-all-closed', () => {
    // stays in the tray
  });

  app.on('before-quit', () => {
    quitting = true;
    hostSend({ cmd: 'appbarRemove' });
    hostSend({ cmd: 'refreshWallpaper' });
    hostSend({ cmd: 'quit' });
  });
}
