// Резонанс для ПК — the main process.
//
// Windows of the app:
//   * wallpaper: one per screen, put behind the desktop icons by the Windows
//     helper (host/RezonansHost.exe); the waves listen to whatever the PC plays,
//     with the words of the song (or a clock, or any text) glowing behind them;
//   * bar: a thin acrylic strip along the top of the main screen (logo, clock);
//   * island: the player — a black pill in the middle of the bar that drops down
//     into a card with the cover, progress and buttons when the mouse comes;
//   * panel: Резонанс's own menu with every setting (instead of a plain Windows
//     menu), opened from the logo on the bar or from the tray icon.
// The helper also paints Windows itself in the colours of the chosen palette.

'use strict';

const { app, BrowserWindow, Tray, screen, ipcMain, session, desktopCapturer, shell, powerMonitor, protocol, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const lyrics = require('./lib/lyrics');
const colors = require('./lib/colors');

// The wallpaper sits under other windows: Chromium must not decide it is hidden
// and stop drawing it.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

protocol.registerSchemesAsPrivileged([{ scheme: 'rez', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const BAR_H = 36; // DIP
const ISL_W = 560;
const ISL_H = 300;
const PANEL_W = 420;
const PANEL_H = 680;
const START_W = 680;
const START_H = 760;
const QUICK_W = 400;
const QUICK_H = 600;
const SELFTEST = process.env.REZONANS_SELFTEST === '1';

// ---------- settings and log ----------

const DEFAULTS = {
  wallpaper: true,
  bar: true,
  island: true, // the player as the island (otherwise a capsule inside the bar)
  islandPeek: true, // drop down for a moment when the song changes
  islandGlow: true, // the island glows in the colour of the cover
  style: 'neon',
  palette: 'violet',
  lastPalette: 'violet', // the last fixed palette (Windows colours when "from the cover")
  bg: 'glass-violet',
  bgImage: '',
  bgDim: 0.35,
  bgBlur: 0,
  clouds: true,
  vignette: true,
  waveSize: 1,
  waveBright: 0.92,
  wavePos: 0.5,
  fps: 60,
  text: 'lyrics', // off | lyrics | track | clock | custom
  textCustom: 'Резонанс',
  textSize: 1,
  textStyle: 'soft', // soft | outline | glass
  textFont: 'display', // display | body | thin
  textOpacity: 0.55,
  textShift: 0,
  textPos: 'center', // center | top
  barTint: 0.42,
  barSeconds: false,
  barDate: true,
  barMark: true,
  winAccent: true,
  winDark: false,
  winPrevalence: false,
  winFont: true, // Onest for the whole of Windows
  shellKeys: true, // the Win key, the Start button and the tray open Резонанс
  guardGames: true, // sleep the shell (hooks + windows) while CS2 / FACEIT runs
  startRecent: true, // the recent files on the Start menu
  autostart: true,
  attachMode: 'auto',
  firstRun: true,
  seen: '',
};

const CHOICES = {
  style: ['neon', 'ribbons', 'capsules', 'dots', 'rings', 'scope', 'horizon', 'orb'],
  palette: ['violet', 'neon', 'sunset', 'mint', 'ice', 'aurora', 'fire', 'sakura', 'gold', 'mono', 'cover'],
  bg: ['glass-violet', 'glass-black', 'glass-palette', 'aurora', 'ember', 'dark', 'amoled', 'windows', 'image'],
  text: ['off', 'lyrics', 'track', 'clock', 'custom'],
  textStyle: ['soft', 'outline', 'glass'],
  textFont: ['display', 'body', 'thin'],
  textPos: ['center', 'top'],
  attachMode: ['auto', 'child', 'layered', 'worker'],
  fps: [30, 60, 144],
};
const RANGES = {
  bgDim: [0, 0.85],
  bgBlur: [0, 40],
  waveSize: [0.4, 1.8],
  waveBright: [0.2, 1],
  wavePos: [0.2, 0.8],
  textSize: [0.5, 1.8],
  textOpacity: [0.1, 1],
  textShift: [-5, 5],
  barTint: [0, 0.95],
};

let settings = { ...DEFAULTS };
let settingsFile = '';
let logFile = '';

function sanitize(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS)) continue;
    if (CHOICES[k]) {
      if (CHOICES[k].includes(v)) out[k] = v;
    } else if (RANGES[k]) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], n));
    } else if (typeof DEFAULTS[k] === 'boolean') out[k] = !!v;
    else if (typeof DEFAULTS[k] === 'string') out[k] = String(v).slice(0, 400);
  }
  return out;
}

function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    settings = { ...DEFAULTS, ...sanitize(raw), firstRun: raw.firstRun !== false, seen: String(raw.seen || '') };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function writeSettings() {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch (e) {
    log('settings: ' + e.message);
  }
}

// what the pages get: the settings and a few derived things
function view() {
  return {
    ...settings,
    version: app.getVersion(),
    bgUrl: bgUrl(),
    windowsUrl: windowsUrl(),
    imageUrl: imageUrl(),
    paletteColors: colors.PALETTES[settings.palette === 'cover' ? settings.lastPalette : settings.palette] || colors.PALETTES.violet,
    colorsSaved: !!winBackup,
    selftest: SELFTEST,
  };
}

function broadcastSettings() {
  const v = view();
  for (const w of allWindows()) w.webContents.send('settings', v);
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
let lastColors = null; // the last answer about Windows colours

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
    if (!quitting) setTimeout(startHost, 2000);
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
      log(`помощник готов: ${m.os}, рабочий стол ${m.raised ? 'нового типа (24H2+)' : 'классический'}, акцент: ${m.immersive}`);
      hookBar();
      for (const id of walls.keys()) attachWall(id);
      if (bar && barShown) registerAppBar();
      styleWindows();
      sendOwn();
      applyWinColors();
      applyShell();
      hostSend({ cmd: 'wallpaperPath' });
      hostSend({ cmd: 'status' });
      break;
    case 'attached': {
      const w = walls.get(Number(m.id));
      log(`обои на экране ${m.id}: ${m.ok ? 'встали' : 'НЕ встали'} (${m.how || m.mode || ''}${m.error ? ', ' + m.error : ''}, ${m.at || ''}${m.border ? ', рамка ' + m.border : ''})`);
      if (!w) break;
      w.attached = !!m.ok;
      if (m.ok) w.win.showInactive();
      else if (!w.warned) {
        w.warned = true;
        notify('Обои не встали под значки', 'Попробуй другой способ: панель Резонанса → Система → «Способ встраивания».');
      }
      break;
    }
    case 'appbar':
      log(`строка заняла место: ${m.x},${m.y} ${m.w}×${m.h}`);
      fixTopSoon();
      break;
    case 'media':
      onMedia(m);
      break;
    case 'fg':
      onForeground(m);
      break;
    case 'audio':
      log('звук: ' + (m.event === 'default' ? 'выбрано другое устройство вывода' : 'устройства изменились (' + m.event + ')'));
      for (const w of allWindows()) w.webContents.send('audio', m);
      break;
    case 'winColorsBackup':
      winBackup = { values: m.values, applied: { accent: false, dark: false, prev: false }, at: new Date().toISOString() };
      saveBackup();
      log('цвета Windows сохранены, чтобы их можно было вернуть');
      if (pendingColors) applyWinColors();
      break;
    case 'winColors':
      lastColors = m;
      log(`цвета Windows: ${m.restored ? 'возвращены' : m.done || '—'}${m.accentNow ? ', акцент ' + m.accentNow : ''}${m.highlightNow ? ', выделение ' + m.highlightNow : ''}${m.immersive ? ', сразу: ' + m.immersive : ''}`);
      if (panel && !panel.isDestroyed()) panel.webContents.send('info', info());
      break;
    case 'wallpaperPath':
      winWallpaper = m.path || '';
      log('обои Windows: ' + (winWallpaper || 'не нашлись'));
      broadcastSettings();
      break;
    case 'hotkey':
      log('горячая: ' + m.key);
      if (m.key === 'start') toggleStart();
      else if (m.key === 'quick') toggleQuick();
      break;
    case 'apps':
      appList = Array.isArray(m.list) ? m.list : [];
      if (startWin && !startWin.isDestroyed()) startWin.webContents.send('apps', appList);
      break;
    case 'recent':
      recentList = Array.isArray(m.list) ? m.list : [];
      if (startWin && !startWin.isDestroyed()) startWin.webContents.send('recent', recentList);
      break;
    case 'status':
      lastStatus = m;
      if (quickWin && !quickWin.isDestroyed()) quickWin.webContents.send('status', m);
      if (bar && !bar.isDestroyed()) bar.webContents.send('status', m);
      break;
    case 'fonts':
      log('шрифт системы: ' + (m.applied ? 'Onest' : 'как было'));
      break;
    case 'guard':
      onGuard(!!m.on);
      break;
    case 'probe':
      onProbe(m);
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
  list.push(bar, island, panel, startWin, quickWin);
  return list.filter((w) => w && !w.isDestroyed());
}

function toggleStart() {
  if (startWin && !startWin.isDestroyed() && startWin.isVisible()) return hideStart();
  showStart();
}
function toggleQuick() {
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) return hideQuick();
  showQuick();
}

// rounded corners and a quiet border for the panel (Windows 11)
function styleWindows() {
  if (panel && !panel.isDestroyed()) hostSend({ cmd: 'style', hwnd: hwndOf(panel), corner: 2, border: '#3a2d58', dark: true });
}

function fontsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'fonts') : path.join(__dirname, 'build', 'fonts');
}

// the system font and the Win-key / Start / tray takeover; sent on every start
// because installed fonts and hooks last only for the session
function applyShell() {
  if (!hostInfo) return;
  if (settings.winFont) hostSend({ cmd: 'fontsInstall', dir: fontsDir() });
  else hostSend({ cmd: 'fontsRestore' });
  hostSend({ cmd: 'shellHooks', on: shellKeysWanted() });
}

// ---------- anti-cheat: the shell sleeps while CS2 or FACEIT runs ----------
// The helper watches for those processes and says so; Резонанс then drops the
// Win-key/Start hooks (what an anti-cheat might take for a cheat) and hides its
// own windows, so nothing of ours is in the way during a match. It all comes
// back the moment the game is closed. Chosen in the settings (guardGames).
let acGuard = false;

function shellKeysWanted() {
  return !!settings.shellKeys && !(acGuard && settings.guardGames);
}

function onGuard(on) {
  if (on === acGuard) return;
  acGuard = on;
  if (!settings.guardGames) return; // the user keeps the shell on in games
  log(on ? 'запущена CS2/FACEIT — оболочка засыпает (безопасно для анти-чита)' : 'CS2/FACEIT закрыта — оболочка снова включена');
  hostSend({ cmd: 'shellHooks', on: shellKeysWanted() });
  setTopHidden(on, 'guard');
  for (const w of walls.values()) {
    if (w.win.isDestroyed()) continue;
    w.paused = on;
    w.win.webContents.send('pause', on);
  }
  if (on) {
    hideStart();
    hideQuick();
    hidePanel();
  } else fixTopSoon();
}

// ---------- what's playing ----------

let lastMedia = null;
let lyricKey = '';
let lyricTimer = 0;
let lyricData = null;

function trackKey(m) {
  return m && m.status && m.status !== 'none' ? `${m.app}|${m.title}|${m.artist}` : '';
}

function onMedia(m) {
  lastMedia = m.thumb !== undefined || !lastMedia ? m : { ...m, thumb: lastMedia.thumb };
  if (m.status === 'none') lastMedia = { status: 'none' };
  for (const w of mediaWindows()) w.webContents.send('media', m);
  const key = trackKey(lastMedia);
  if (key !== lyricKey) {
    lyricKey = key;
    lyricData = null;
    sendLyrics();
    clearTimeout(lyricTimer);
    // titles settle in a moment (some players send the title before the artist)
    if (key && settings.text === 'lyrics') lyricTimer = setTimeout(() => loadLyrics(key), 700);
  }
}

function mediaWindows() {
  const list = [...walls.values()].map((w) => w.win);
  list.push(bar, island, panel, quickWin);
  return list.filter((w) => w && !w.isDestroyed());
}

async function loadLyrics(key) {
  if (!lastMedia || key !== trackKey(lastMedia)) return;
  const m = lastMedia;
  try {
    const r = await lyrics.find(m);
    if (key !== lyricKey) return;
    lyricData = r ? { key, ...r } : { key, none: true };
    log(`текст песни «${m.title}»: ${r ? (r.synced ? 'синхронный, строк ' + r.lines.length : r.instrumental ? 'без слов' : 'обычный') : 'не нашёлся'}`);
  } catch (e) {
    if (key !== lyricKey) return;
    lyricData = { key, none: true, error: true };
    log('текст песни: ' + e.message);
  }
  sendLyrics();
}

function sendLyrics() {
  for (const w of walls.values()) if (!w.win.isDestroyed()) w.win.webContents.send('lyrics', lyricData);
}

// ---------- backgrounds from files ----------

let winWallpaper = '';
let bgStamp = Date.now();

function bgUrl() {
  if (settings.bg === 'windows') return windowsUrl();
  if (settings.bg === 'image') return imageUrl();
  return '';
}

const windowsUrl = () => (winWallpaper ? `rez://bg/windows?v=${stamp(winWallpaper)}` : '');
const imageUrl = () => (settings.bgImage ? `rez://bg/image?v=${stamp(settings.bgImage)}` : '');

function stamp(file) {
  try {
    return Math.round(fs.statSync(file).mtimeMs) + '-' + bgStamp;
  } catch {
    return String(bgStamp);
  }
}

function mimeOf(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return 'application/octet-stream';
}

function serveImages() {
  protocol.handle('rez', async (req) => {
    try {
      const u = new URL(req.url);
      if (u.host !== 'bg') return new Response('', { status: 404 });
      const file = u.pathname === '/windows' ? winWallpaper : u.pathname === '/image' ? settings.bgImage : '';
      if (!file) return new Response('', { status: 404 });
      const buf = await fs.promises.readFile(file);
      return new Response(buf, { headers: { 'content-type': mimeOf(buf), 'cache-control': 'no-cache' } });
    } catch {
      return new Response('', { status: 404 });
    }
  });
}

// ---------- wallpaper ----------

const walls = new Map(); // display id -> { win, display, attached, paused }
const preload = path.join(__dirname, 'preload.js');
const webPrefs = { preload, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false };

// ---------- a window's page crashed, or the drawing process went down ----------
// Seen on some PCs (a graphics-driver hiccup, two live wallpapers fighting over
// the desktop): the window stays, but its page is gone — an empty frosted box,
// the waves vanish. Log it and bring the page back instead of leaving it blank.
function guardPage(win, name, recover) {
  win.webContents.on('render-process-gone', (e, d) => {
    log(`окно «${name}» потеряло страницу: ${d && d.reason} (код ${d && d.exitCode})`);
    setTimeout(() => {
      try {
        recover();
      } catch (er) {
        log('восстановление: ' + er.message);
      }
    }, 300);
  });
  win.webContents.on('unresponsive', () => log(`окно «${name}» не отвечает`));
}

// a menu may open while its page is still loading (just created, or brought
// back after a crash): its "open" goes out only when the page can hear it
function whenLoaded(win, fn) {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fn);
  else fn();
}

// the drawing process itself went down: every page needs a fresh start
let recoveredAt = 0;
function recoverAll(why) {
  // a driver that keeps falling over must not turn this into a rebuild loop
  if (Date.now() - recoveredAt < 20000) return log('восстановление пропущено (было только что): ' + why);
  recoveredAt = Date.now();
  log('восстанавливаю окна: ' + why);
  for (const w of [panel, startWin, quickWin]) if (w && !w.isDestroyed()) w.destroy();
  scheduleRebuild(why);
}

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
    thickFrame: false, // no resize border: the picture must reach every edge
    backgroundColor: '#0f0b16',
    title: 'Rezonans wallpaper',
    webPreferences: webPrefs,
  });
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, 'app', 'wallpaper.html'), { query: { screen: String(d.id), primary: d.id === screen.getPrimaryDisplay().id ? '1' : '0' } });
  guardPage(win, 'обои', () => scheduleRebuild('страница обоев упала'));
  win.once('ready-to-show', () => {
    attachWall(d.id);
    if (lastMedia) win.webContents.send('media', lastMedia);
    if (lyricData) win.webContents.send('lyrics', lyricData);
  });
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
  // another window came to the front: the panel steps away (in case Windows
  // didn't give it the focus, so it never heard the click elsewhere)
  if (panel && !panel.isDestroyed() && panel.isVisible() && m.hwnd && m.hwnd !== hwndOf(panel) && Date.now() - panelShownAt > 700 && !dialogOpen && !SELFTEST_PANEL) {
    const own = allWindows().some((w) => hwndOf(w) === m.hwnd);
    if (!own) hidePanel();
  }
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
  // a full-screen game or video on the main screen: the bar and the island step aside
  const p = screen.dipToScreenRect(null, screen.getPrimaryDisplay().bounds);
  const onMain = Math.abs(p.x - m.mx) < 4 && Math.abs(p.y - m.my) < 4;
  setTopHidden(!m.desktop && m.full && onMain, 'fg');
  // another window just came to the front: make sure the bar and the island are
  // still above it, or the logo stops taking clicks (after a snip, after a reboot)
  assertTop();
  // a capture overlay closing can take a beat to really leave the top
  setTimeout(() => assertTop(true), 300);
  setTimeout(() => assertTop(true), 900);
}

// keep the bar and the island clickable: back on top when something else took it.
// A screen-capture overlay (Win+Shift+S) or Explorer drawing over them after a
// reboot leaves them below, where clicks never reach them. Re-asserting their
// topmost standing — on each foreground change and on a short timer — brings
// them back. setAlwaysOnTop re-applies the topmost flag without any flicker, so
// they climb back above a capture overlay that was itself topmost a moment ago.
function liftTop() {
  if (topHide.size !== 0) return;
  for (const w of [bar, island]) if (w && !w.isDestroyed() && w.isVisible()) w.moveTop();
  probeBar();
}

let lastAssert = 0;
function assertTop(force) {
  if (topHide.size !== 0) return;
  const now = Date.now();
  if (!force && now - lastAssert < 300) return;
  lastAssert = now;
  for (const w of [bar, island]) {
    if (!w || w.isDestroyed()) continue;
    if (!w.isVisible()) w.showInactive();
    try {
      w.setAlwaysOnTop(true, 'screen-saver');
      w.moveTop();
    } catch {}
  }
}

// ---------- the bar ----------

let bar = null;
let barShown = false;
const topHide = new Set();

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
    webPreferences: webPrefs,
  });
  bar.loadFile(path.join(__dirname, 'app', 'bar.html'));
  guardPage(bar, 'строка', () => scheduleRebuild('страница строки упала'));
  bar.once('ready-to-show', () => {
    bar._ready = true;
    placeTop(bar);
    barShown = true;
    registerAppBar();
    sendOwn();
    if (lastMedia) bar.webContents.send('media', lastMedia);
    // the island stays above the bar
    if (island && !island.isDestroyed() && topHide.size === 0) island.moveTop();
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
    if (code === 2) setTopHidden(num(lParam) !== 0, 'fullscreen'); // ABN_FULLSCREENAPP
  });
  // Explorer restarted: the app bar has to be registered again
  bar.hookWindowMessage(hostInfo.taskbarCreated, () => setTimeout(registerAppBar, 1500));
}

// Why the bar and the island step aside. An anti-cheat game ('guard') hides
// them outright. A full-screen window ('fg', 'fullscreen': a game, a video, the
// overlay a screenshot tool puts up for a moment) only sends them to the back —
// they are never hidden for it: a window that never takes the focus, hidden and
// shown again, could come back deaf to clicks (the logo after a snip).
function setTopHidden(hide, why) {
  const before = [...topHide].join(', ');
  if (hide) topHide.add(why);
  else topHide.delete(why);
  const now = [...topHide].join(', ');
  if (now !== before) log('строка и остров: ' + (now ? 'в стороне (' + now + ')' : 'снова сверху'));
  placeTop(bar);
  placeTop(island);
  if (topHide.size === 0) {
    if (island && !island.isDestroyed()) island.moveTop();
    probeSoon();
  }
}

function placeTop(w) {
  if (!w || w.isDestroyed() || !w._ready) return;
  if (topHide.has('guard')) {
    if (w.isVisible()) w.hide();
    return;
  }
  if (!w.isVisible()) w.showInactive();
  if (topHide.size !== 0) {
    hostSend({ cmd: 'toBack', hwnd: hwndOf(w) });
    return;
  }
  try {
    w.setAlwaysOnTop(true, 'screen-saver');
    w.moveTop();
  } catch {}
}

// ---------- is the logo really reachable? ----------
// Now and then the helper says which window sits under the logo. When it isn't
// the bar (a capture overlay left behind, a window in a higher layer), or the bar
// lost its "always on top", lets clicks through or was hidden by the system, the
// bar is put back on top — and the log says what was there.
let probeSaid = '';
function probeBar() {
  if (!bar || bar.isDestroyed() || !bar._ready || topHide.size !== 0 || !bar.isVisible()) return;
  const b = bar.getBounds();
  const p = screen.dipToScreenPoint({ x: b.x + 44, y: b.y + Math.round(BAR_H / 2) });
  hostSend({ cmd: 'probe', hwnd: hwndOf(bar), x: Math.round(p.x), y: Math.round(p.y) });
}

let probeTimers = [];
function probeSoon() {
  for (const t of probeTimers) clearTimeout(t);
  probeTimers = [400, 1500].map((ms) => setTimeout(probeBar, ms));
}

function onProbe(m) {
  if (!bar || bar.isDestroyed() || topHide.size !== 0) return;
  // another app's menu or tooltip over the logo goes away by itself
  const passing = /^(#32768|tooltips_class32|SysShadow)$/.test(m.cls || '');
  const ok = (m.mine || passing) && m.topmost && !m.transparent && !m.cloaked;
  const said = ok
    ? 'логотип доступен'
    : 'логотип недоступен:' +
      (m.mine || passing ? '' : ` сверху «${m.cls || 'ничего'}» (${m.exe || '?'}${m.own ? ', наше окно' : ''})`) +
      (m.topmost ? '' : ', строка не поверх всех') +
      (m.transparent ? ', строка пропускает клики' : '') +
      (m.cloaked ? ', строка спрятана системой' : '') +
      (m.visible ? '' : ', строка не видна');
  if (said !== probeSaid) {
    log('проверка строки: ' + said);
    probeSaid = said;
  }
  if (ok) return;
  if (m.transparent) bar.setIgnoreMouseEvents(false);
  try {
    bar.setAlwaysOnTop(false);
    bar.setAlwaysOnTop(true, 'screen-saver');
    bar.moveTop();
  } catch {}
  if (island && !island.isDestroyed() && island.isVisible()) island.moveTop();
}

// When the bar takes its strip, the work area shrinks and Chromium "helpfully"
// moves every window of ours that sticks out of the new work area into it — the
// bar and the island would end up 36 px lower, with a gap above. Put them back.
function fixTop() {
  const d = screen.getPrimaryDisplay();
  if (bar && !bar.isDestroyed()) {
    const b = bar.getBounds();
    const off = (p, q, tol) => Math.abs(p - q) > tol;
    if (off(b.x, d.bounds.x, 2) || off(b.y, d.bounds.y, 2) || off(b.width, d.bounds.width, 4) || off(b.height, BAR_H, 3)) {
      log(`строка съехала: ${b.x},${b.y} ${b.width}×${b.height} — возвращаю наверх`);
      bar.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: BAR_H });
    }
  }
  if (island && !island.isDestroyed()) {
    const want = islandBounds();
    const b = island.getBounds();
    if (Math.abs(b.x - want.x) > 2 || Math.abs(b.y - want.y) > 2) island.setBounds(want);
  }
  // keep the bar and the island above Explorer, which can draw over them after a
  // reboot — otherwise the logo stops taking clicks
  if (topHide.size === 0) {
    for (const w of [bar, island]) {
      if (!w || w.isDestroyed()) continue;
      if (!w.isVisible()) w.showInactive();
      w.moveTop();
    }
  }
}

let fixTimers = [];
function fixTopSoon() {
  for (const t of fixTimers) clearTimeout(t);
  fixTimers = [150, 600, 1800].map((ms) => setTimeout(fixTop, ms));
}

function closeBar() {
  hostSend({ cmd: 'appbarRemove' });
  if (bar && !bar.isDestroyed()) bar.destroy();
  bar = null;
  barShown = false;
  hooked = null;
}

// ---------- the island ----------

let island = null;

function islandBounds() {
  const d = screen.getPrimaryDisplay();
  return { x: Math.round(d.bounds.x + (d.bounds.width - ISL_W) / 2), y: d.bounds.y, width: ISL_W, height: ISL_H };
}

function createIsland() {
  island = new BrowserWindow({
    ...islandBounds(),
    frame: false,
    transparent: true,
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
    title: 'Rezonans island',
    webPreferences: webPrefs,
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setIgnoreMouseEvents(true, { forward: true });
  island.loadFile(path.join(__dirname, 'app', 'island.html'));
  guardPage(island, 'остров', () => scheduleRebuild('страница острова упала'));
  island.once('ready-to-show', () => {
    island._ready = true;
    placeTop(island);
    fixTopSoon();
    sendOwn();
    if (lastMedia) island.webContents.send('media', lastMedia);
  });
  island.on('closed', () => {
    island = null;
  });
}

function closeIsland() {
  if (island && !island.isDestroyed()) island.destroy();
  island = null;
}

// ---------- the panel (Резонанс's own menu) ----------

let panel = null;
let panelHiddenAt = 0;
let panelShownAt = 0;
let dialogOpen = false;

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    frame: false,
    show: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    roundedCorners: true,
    title: 'Резонанс',
    webPreferences: webPrefs,
  });
  panel.loadFile(path.join(__dirname, 'app', 'panel.html'));
  guardPage(panel, 'панель', () => {
    const was = panel && !panel.isDestroyed() && panel.isVisible();
    if (panel && !panel.isDestroyed()) panel.destroy();
    panel = null;
    if (was) showPanel('bar');
  });
  panel.on('blur', () => {
    if (dialogOpen || SELFTEST_PANEL) return;
    // the click that opened it can arrive just after show and steal focus back
    if (Date.now() - panelShownAt < 400) return;
    hidePanel();
  });
  panel.on('closed', () => {
    panel = null;
  });
  panel.once('ready-to-show', () => {
    styleWindows();
    sendOwn();
    if (lastMedia) panel.webContents.send('media', lastMedia);
  });
}

let SELFTEST_PANEL = false;

function hidePanel() {
  if (!panel || panel.isDestroyed() || !panel.isVisible()) return;
  panelHiddenAt = Date.now();
  panel.webContents.send('panel', { open: false });
  panel.hide();
}

// from: 'bar' (drops from the logo) | 'tray' (rises above the tray icon) | 'center'
function showPanel(from = 'bar', tab) {
  if (!panel || panel.isDestroyed()) createPanel();
  const target = from === 'tray' && tray ? tray.getBounds() : null;
  const d = target ? screen.getDisplayNearestPoint({ x: target.x + 1, y: target.y + 1 }) : screen.getPrimaryDisplay();
  const wa = d.workArea;
  const h = Math.min(PANEL_H, wa.height - 20);
  let x;
  let y;
  if (from === 'tray' && target) {
    x = Math.round(Math.max(wa.x + 10, Math.min(wa.x + wa.width - PANEL_W - 10, target.x + target.width / 2 - PANEL_W / 2)));
    y = target.y > d.bounds.y + d.bounds.height / 2 ? wa.y + wa.height - h - 10 : wa.y + 10;
  } else if (from === 'center') {
    x = Math.round(wa.x + (wa.width - PANEL_W) / 2);
    y = Math.round(wa.y + (wa.height - h) / 2);
  } else {
    x = wa.x + 8;
    y = wa.y + 8;
  }
  panel.setBounds({ x, y, width: PANEL_W, height: h });
  const openMsg = { open: true, from: from === 'tray' && y > wa.y + 20 ? 'bottom' : 'top', tab: tab || null };
  const p = panel;
  whenLoaded(p, () => {
    if (p.isDestroyed()) return;
    p.webContents.send('panel', openMsg);
    p.webContents.send('info', info());
    if (lastMedia) p.webContents.send('media', lastMedia);
  });
  panel.show();
  panel.focus();
  panelShownAt = Date.now();
  if (island && !island.isDestroyed() && topHide.size === 0) island.moveTop();
}

function togglePanel(from, tab) {
  if (panel && !panel.isDestroyed() && panel.isVisible()) {
    log('панель: закрываю (' + from + ')');
    return hidePanel();
  }
  // the click that took the focus away from the panel has just closed it
  if (Date.now() - panelHiddenAt < 350) return log('панель: только что закрылась — не открываю снова');
  log('панель: открываю (' + from + ')');
  showPanel(from, tab);
}

// ---------- the Start menu and the Quick settings (instead of Windows') ----------

let startWin = null;
let quickWin = null;
let appList = []; // the apps, cached between opens
let recentList = [];
let lastStatus = {};

function shellPrefs() {
  return { preload, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false };
}

function createShellWindow(w, h) {
  return new BrowserWindow({
    width: w,
    height: h,
    frame: false,
    show: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    title: 'Резонанс',
    webPreferences: shellPrefs(),
  });
}

function styleShell(win) {
  if (win && !win.isDestroyed()) hostSend({ cmd: 'style', hwnd: hwndOf(win), corner: 2, border: '#3a2d58', dark: true });
}

function createStart() {
  startWin = createShellWindow(START_W, START_H);
  startWin.loadFile(path.join(__dirname, 'app', 'start.html'));
  guardPage(startWin, 'Пуск', () => {
    const was = startWin && !startWin.isDestroyed() && startWin.isVisible();
    if (startWin && !startWin.isDestroyed()) startWin.destroy();
    startWin = null;
    if (was) showStart();
  });
  startWin.on('blur', () => {
    if (SELFTEST_PANEL) return;
    hideStart();
  });
  startWin.on('closed', () => {
    startWin = null;
  });
  startWin.once('ready-to-show', () => { styleShell(startWin); sendOwn(); });
}

function createQuick() {
  quickWin = createShellWindow(QUICK_W, QUICK_H);
  quickWin.loadFile(path.join(__dirname, 'app', 'quick.html'));
  guardPage(quickWin, 'быстрые настройки', () => {
    const was = quickWin && !quickWin.isDestroyed() && quickWin.isVisible();
    if (quickWin && !quickWin.isDestroyed()) quickWin.destroy();
    quickWin = null;
    if (was) showQuick();
  });
  quickWin.on('blur', () => {
    if (SELFTEST_PANEL) return;
    hideQuick();
  });
  quickWin.on('closed', () => {
    quickWin = null;
  });
  quickWin.once('ready-to-show', () => { styleShell(quickWin); sendOwn(); });
}

let startHiddenAt = 0;
let quickHiddenAt = 0;

function hideStart() {
  if (!startWin || startWin.isDestroyed() || !startWin.isVisible()) return;
  startHiddenAt = Date.now();
  startWin.webContents.send('shell', { open: false });
  setTimeout(() => startWin && !startWin.isDestroyed() && !startWin._reopen && startWin.hide(), 180);
}
function hideQuick() {
  if (!quickWin || quickWin.isDestroyed() || !quickWin.isVisible()) return;
  quickHiddenAt = Date.now();
  quickWin.webContents.send('shell', { open: false });
  setTimeout(() => quickWin && !quickWin.isDestroyed() && !quickWin._reopen && quickWin.hide(), 180);
}

function showStart() {
  if (Date.now() - startHiddenAt < 250) return hideStart();
  if (!startWin || startWin.isDestroyed()) createStart();
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea;
  const h = Math.min(START_H, wa.height - 12);
  // above the taskbar, centred — where Windows 11 opens Start on a centred taskbar
  const x = Math.round(Math.max(wa.x + 12, Math.min(wa.x + wa.width - START_W - 12, wa.x + (wa.width - START_W) / 2)));
  const y = wa.y + wa.height - h - 12;
  startWin.setBounds({ x, y, width: START_W, height: h });
  startWin.show();
  startWin.focus();
  const sw = startWin;
  whenLoaded(sw, () => {
    if (!sw.isDestroyed()) sw.webContents.send('shell', { open: true, apps: appList, recent: recentList, settings: view(), recentOn: settings.startRecent, user: process.env.USERNAME || '' });
  });
  refreshApps();
  if (island && !island.isDestroyed() && topHide.size === 0) island.moveTop();
}

function showQuick() {
  if (Date.now() - quickHiddenAt < 250) return hideQuick();
  if (!quickWin || quickWin.isDestroyed()) createQuick();
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea;
  const h = Math.min(QUICK_H, wa.height - 12);
  const x = wa.x + wa.width - QUICK_W - 12; // above the tray, bottom-right
  const y = wa.y + wa.height - h - 12;
  quickWin.setBounds({ x, y, width: QUICK_W, height: h });
  quickWin.show();
  quickWin.focus();
  const qw = quickWin;
  whenLoaded(qw, () => {
    if (!qw.isDestroyed()) qw.webContents.send('shell', { open: true, status: lastStatus, settings: view(), media: lastMedia });
  });
  hostSend({ cmd: 'status' });
  if (island && !island.isDestroyed() && topHide.size === 0) island.moveTop();
}

let appsAt = 0;
function refreshApps() {
  // the list is cached; ask again at most every half minute
  if (Date.now() - appsAt < 30000 && appList.length) return;
  appsAt = Date.now();
  hostSend({ cmd: 'apps' });
  if (settings.startRecent) hostSend({ cmd: 'recent' });
}

function info() {
  return {
    version: app.getVersion(),
    os: hostInfo ? hostInfo.os : '',
    raised: hostInfo ? !!hostInfo.raised : null,
    helper: !!hostInfo,
    immersive: hostInfo ? hostInfo.immersive : '',
    guard: acGuard,
    colors: lastColors,
    colorsSaved: !!winBackup,
    walls: [...walls.values()].map((w) => ({ attached: w.attached, paused: w.paused })),
  };
}

// ---------- Windows in the colours of Резонанс ----------

let winBackup = null; // { values, applied: { accent, dark, prev } }
let pendingColors = false;
let backupFile = '';

function loadBackup() {
  backupFile = path.join(app.getPath('userData'), 'windows-colors.json');
  try {
    winBackup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  } catch {
    winBackup = null;
  }
}

function saveBackup() {
  try {
    if (winBackup) fs.writeFileSync(backupFile, JSON.stringify(winBackup, null, 2));
    else if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);
  } catch (e) {
    log('цвета Windows: ' + e.message);
  }
}

const GROUPS = {
  accent: [
    'Software\\Microsoft\\Windows\\DWM|AccentColor',
    'Software\\Microsoft\\Windows\\DWM|ColorizationColor',
    'Software\\Microsoft\\Windows\\DWM|ColorizationAfterglow',
    'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent|AccentPalette',
    'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent|AccentColorMenu',
    'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent|StartColorMenu',
    'Control Panel\\Desktop|AutoColorization',
    'Control Panel\\Colors|Hilight',
    'Control Panel\\Colors|HotTrackingColor',
    'sys|highlight',
    'sys|hotlight',
  ],
  dark: ['Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize|AppsUseLightTheme', 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize|SystemUsesLightTheme'],
  prev: ['Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize|ColorPrevalence', 'Software\\Microsoft\\Windows\\DWM|ColorPrevalence'],
};

let lastApplied = '';

function applyWinColors(force) {
  if (!hostInfo) return;
  const want = { accent: !!settings.winAccent, dark: !!settings.winDark, prev: !!settings.winPrevalence };
  const any = want.accent || want.dark || want.prev;
  if (any && !winBackup) {
    pendingColors = true;
    hostSend({ cmd: 'winColorsGet' });
    return;
  }
  pendingColors = false;
  if (!winBackup) return;
  // groups switched off: put back what was there before
  const back = {};
  for (const g of Object.keys(GROUPS)) {
    if (!want[g] && winBackup.applied[g]) for (const k of GROUPS[g]) if (winBackup.values[k]) back[k] = winBackup.values[k];
  }
  if (Object.keys(back).length) hostSend({ cmd: 'winColorsRestore', values: back });
  const pal = settings.palette === 'cover' ? settings.lastPalette : settings.palette;
  const c = colors.forPalette(pal);
  const cmd = { cmd: 'winColorsSet' };
  if (want.accent) Object.assign(cmd, { accent: c.accent, palette: c.palette, highlight: c.highlight, hot: c.hot });
  if (want.dark) cmd.dark = true;
  if (want.prev) cmd.prevalence = true;
  const sig = JSON.stringify(cmd);
  if (any && (force || sig !== lastApplied || Object.keys(back).length)) hostSend(cmd);
  lastApplied = any ? sig : '';
  winBackup.applied = want;
  if (!any) {
    winBackup = null; // next time, read Windows' colours afresh
    lastApplied = '';
  }
  saveBackup();
  broadcastSettings();
}

function restoreAllColors() {
  saveSettingsPatch({ winAccent: false, winDark: false, winPrevalence: false });
}

// ---------- settings changes ----------

function saveSettingsPatch(patch) {
  const clean = sanitize(patch);
  const prev = { ...settings };
  Object.assign(settings, clean);
  if (clean.palette && clean.palette !== 'cover') settings.lastPalette = clean.palette;
  writeSettings();
  const changed = (k) => k in clean && clean[k] !== prev[k];

  if (changed('wallpaper')) {
    if (settings.wallpaper) createWallpapers();
    else closeWallpapers();
  }
  if (changed('bar')) {
    if (settings.bar) createBar();
    else closeBar();
  }
  if (changed('island')) {
    if (settings.island) createIsland();
    else closeIsland();
  }
  if (changed('autostart')) setAutostart(settings.autostart);
  if (changed('winFont')) {
    if (settings.winFont) hostSend({ cmd: 'fontsInstall', dir: fontsDir() });
    else hostSend({ cmd: 'fontsRestore' });
  }
  if (changed('shellKeys') || changed('guardGames')) hostSend({ cmd: 'shellHooks', on: shellKeysWanted() });
  if (changed('attachMode')) rebuild('другой способ встраивания');
  if (changed('palette') || changed('winAccent') || changed('winDark') || changed('winPrevalence')) applyWinColors();
  if (changed('bg') && settings.bg === 'windows') hostSend({ cmd: 'wallpaperPath' });
  if (changed('bgImage')) bgStamp = Date.now();
  if (changed('text') && settings.text === 'lyrics' && lyricKey && !lyricData) loadLyrics(lyricKey);
  broadcastSettings();
}

function setAutostart(on) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath });
}

function notify(title, content) {
  if (tray) tray.displayBalloon({ title, content, iconType: 'info' });
}

async function pickImage() {
  dialogOpen = true;
  try {
    const r = await dialog.showOpenDialog({
      title: 'Свой рисунок для обоев',
      properties: ['openFile'],
      filters: [{ name: 'Картинки', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
    });
    if (r.canceled || !r.filePaths[0]) return '';
    saveSettingsPatch({ bgImage: r.filePaths[0], bg: 'image' });
    return r.filePaths[0];
  } finally {
    dialogOpen = false;
    if (panel && !panel.isDestroyed() && panel.isVisible()) panel.focus();
  }
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
  if (settings.island) {
    closeIsland();
    createIsland();
  }
}

// ---------- tray ----------

let tray = null;

// ---------- self-test (CI only) ----------

// Plays a soft beat with media info in a hidden window, so the build machine can
// check the whole chain (Windows media controls -> helper -> island, waves), and
// opens the island and the panel at known moments for the screenshots.
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
      const s = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-b * 8) * 0.8 + Math.sin(2 * Math.PI * 440 * t) * 0.08 * Math.exp(-((t * 4) % 1) * 6) + Math.sin(2 * Math.PI * 1320 * t) * 0.05 * Math.exp(-((t * 8) % 1) * 9);
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767 * 0.7, true);
    }
    const a = document.getElementById('a');
    a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    const c = document.createElement('canvas'); c.width = c.height = 300;
    const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 300, 300);
    g.addColorStop(0, '#ff4fb4'); g.addColorStop(0.5, '#7a3cff'); g.addColorStop(1, '#2f6bff');
    x.fillStyle = g; x.fillRect(0, 0, 300, 300); x.fillStyle = 'rgba(255,255,255,.85)';
    x.beginPath(); x.arc(150, 150, 60, 0, 7); x.fill(); x.fillStyle = '#1a0f33'; x.beginPath(); x.arc(150, 150, 18, 0, 7); x.fill();
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Проверка звука', artist: 'Резонанс', album: 'Самопроверка', artwork: [{ src: c.toDataURL('image/png'), sizes: '300x300', type: 'image/png' }] });
    a.play().then(() => console.log('selftest playing')).catch((e) => console.log('selftest: ' + e.message));
  </script>`;
  const w = new BrowserWindow({ show: false, webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false } });
  w.webContents.on('console-message', (e, level, message) => log('самопроверка: ' + (typeof e.message === 'string' ? e.message : message)));
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));

  const at = (sec, fn) => setTimeout(fn, sec * 1000 - 3000);
  at(9, () => island && island.webContents.send('island', { force: true }));
  at(19, () => island && island.webContents.send('island', { force: false }));
  at(21, () => {
    SELFTEST_PANEL = true;
    showPanel('bar', 'home');
  });
  at(28, () => panel && panel.webContents.send('panel', { tab: 'waves' }));
  at(34, () => panel && panel.webContents.send('panel', { tab: 'text' }));
  at(40, () => {
    SELFTEST_PANEL = false;
    hidePanel();
  });
  // as if the headphones were plugged in: everything must listen again
  at(43, () => onHost({ type: 'audio', event: 'selftest' }));
  // the Start menu and the Quick settings (opened here; CI photographs them)
  at(47, () => {
    SELFTEST_PANEL = true;
    showStart();
  });
  at(53, () => {
    if (startWin && !startWin.isDestroyed()) startWin.hide();
    showQuick();
  });
  at(59, () => {
    SELFTEST_PANEL = false;
    if (startWin && !startWin.isDestroyed()) startWin.hide();
    if (quickWin && !quickWin.isDestroyed()) quickWin.hide();
  });
}

// ---------- start ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel('center'));

  app.whenReady().then(() => {
    loadSettings();
    loadBackup();
    log(`запуск ${app.getVersion()}`);
    if (settings.firstRun) {
      settings.firstRun = false;
      writeSettings();
      setAutostart(settings.autostart);
    }
    serveImages();

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

    ipcMain.handle('settings', () => view());
    ipcMain.handle('info', () => info());
    ipcMain.handle('pick-image', () => pickImage());
    ipcMain.on('set', (e, patch) => saveSettingsPatch(patch));
    ipcMain.on('media', (e, action, pos) => hostSend({ cmd: 'media', action, pos: typeof pos === 'number' ? Math.round(pos) : -1 }));
    ipcMain.on('panel', (e, cmd) => {
      if (cmd === 'toggle') togglePanel('bar');
      else if (cmd === 'close') hidePanel();
    });
    // The island takes the mouse only while the pointer is on it. While it does,
    // the cursor is watched here: when a window stops letting the mouse through,
    // Windows sends it a "mouse left" at once, so the page can't trust that.
    let islandPoll = 0;
    ipcMain.on('island-mouse', (e, on) => {
      if (!island || island.isDestroyed()) return;
      island.setIgnoreMouseEvents(!on, { forward: true });
      clearInterval(islandPoll);
      if (!on) return;
      islandPoll = setInterval(() => {
        if (!island || island.isDestroyed()) return clearInterval(islandPoll);
        const p = screen.getCursorScreenPoint();
        const b = island.getBounds();
        island.webContents.send('island', { cursor: { x: p.x - b.x, y: p.y - b.y } });
      }, 120);
    });
    ipcMain.on('action', (e, name) => {
      if (name === 'quit') app.quit();
      else if (name === 'log') shell.openPath(logFile);
      else if (name === 'reattach') rebuild('встроить обои заново');
      else if (name === 'restoreColors') restoreAllColors();
      else if (name === 'applyColors') applyWinColors(true);
      else if (name === 'lyricsAgain' && lyricKey) loadLyrics(lyricKey);
    });
    ipcMain.on('log', (e, msg) => log('окно: ' + msg));
    ipcMain.on('shell', (e, cmd, arg) => {
      if (cmd === 'startClose') hideStart();
      else if (cmd === 'quickClose') hideQuick();
      else if (cmd === 'launch') {
        hostSend({ cmd: 'launch', path: arg && arg.path, args: (arg && arg.args) || '' });
        hideStart();
      } else if (cmd === 'appsFolder') {
        hostSend({ cmd: 'appsFolder' });
        hideStart();
      } else if (cmd === 'power') hostSend({ cmd: 'power', action: arg && arg.action });
      else if (cmd === 'volume') hostSend({ cmd: 'volume', level: arg && arg.level });
      else if (cmd === 'mute') hostSend({ cmd: 'mute', on: !!(arg && arg.on) });
      else if (cmd === 'radio') hostSend({ cmd: 'radio', kind: arg && arg.kind, on: !!(arg && arg.on) });
      else if (cmd === 'status') hostSend({ cmd: 'status' });
      else if (cmd === 'media') hostSend({ cmd: 'media', action: arg && arg.action, pos: -1 });
      else if (cmd === 'settings') showPanel('center', arg && arg.tab);
      else if (cmd === 'openStart') showStart();
      else if (cmd === 'openQuick') showQuick();
      else if (cmd === 'openSettingsApp') hostSend({ cmd: 'launch', path: 'ms-settings:', args: '' });
    });

    tray = new Tray(app.isPackaged ? path.join(process.resourcesPath, 'tray.ico') : path.join(__dirname, 'build', 'tray.ico'));
    tray.setToolTip('Резонанс');
    tray.on('click', () => togglePanel('tray'));
    tray.on('right-click', () => togglePanel('tray'));

    startHost();
    createPanel();
    if (settings.wallpaper) createWallpapers();
    if (settings.bar) createBar();
    if (settings.island) createIsland();
    // Explorer can draw over the bar and the island for a few seconds after a
    // reboot: keep nudging them back on top, so the logo takes clicks at once
    fixTopSoon();
    for (const ms of [2500, 5000, 9000]) setTimeout(fixTop, ms);
    if (SELFTEST) setTimeout(selftest, 3000);
    else if (settings.seen !== app.getVersion()) {
      // a new version: show the new panel once
      settings.seen = app.getVersion();
      writeSettings();
      setTimeout(() => showPanel('bar', 'home'), 3500);
    }

    screen.on('display-added', () => scheduleRebuild('новый экран'));
    screen.on('display-removed', () => scheduleRebuild('экран отключён'));
    // the bar itself changes the work area: only a real change of the screen counts
    screen.on('display-metrics-changed', (e, d, changed) => {
      if ((changed || []).some((c) => c === 'bounds' || c === 'scaleFactor' || c === 'rotation')) scheduleRebuild('экран изменился');
      else fixTopSoon();
    });
    // and now and then, in case something else moved them
    setInterval(fixTop, 5000);
    // a light safety net so the bar never stays unclickable for long (just a raise;
    // the heavier topmost re-assert happens on real foreground changes)
    setInterval(liftTop, 3000);
    // the drawing process went down (graphics driver, another live wallpaper):
    // give every page a fresh start instead of leaving empty frosted boxes
    app.on('child-process-gone', (e, d) => {
      log(`процесс ${d.type} упал: ${d.reason} (код ${d.exitCode})`);
      if (d.type === 'GPU') recoverAll('упал процесс отрисовки');
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
