// Резонанс Connect: «Транслировать на телевизор» — the PC's screen and sound on
// a TV with Резонанс OS. One small window (app/cast.html) does it all: first
// the list of TVs and the code from the TV's screen, then — while the picture
// goes — a little pill in the corner with «Остановить». The WebRTC connection
// lives in that window; this side finds TVs, talks to them over HTTP and
// picks what to capture (lib/connect.js does the network part).
//
// The pill and the list are hidden from the capture itself (content
// protection), so the TV never shows them.

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('./connect');

const PICK_W = 420;
const PICK_H = 560;
const PILL_W = 340;
const PILL_H = 60;

function create({ BrowserWindow, session, desktopCapturer, screen, app, preload, log, onChange }) {
  let win = null;
  let mode = 'off'; // off | pick | live
  let tv = null; // the TV being shown on: {id, name, ip}
  // what the person chose last time (the cast window's own storage is not kept)
  const prefsFile = path.join(app.getPath('userData'), 'cast-prefs.json');
  let prefs = { quality: 'sharp', mute: true };
  try {
    prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile, 'utf8')) };
  } catch {}
  const savePrefs = () => {
    try {
      fs.writeFileSync(prefsFile, JSON.stringify(prefs));
    } catch {}
  };
  let capture = { displayId: null, mute: prefs.mute !== false };
  let shownAt = 0;
  let busy = false; // asking the TV: the list stays open even without focus
  const db = net.store(path.join(app.getPath('userData'), 'connect.json'));

  // while the list is open or the picture goes: TVs that let nothing in come to us
  let pres = null;
  function presenceOn() {
    if (pres) return;
    pres = net.presence({ id: db.me(), name: os.hostname(), log, onTv: (t) => send({ cmd: 'found', tv: mark(t) }), onGone: (t) => send({ cmd: 'gone', tv: t }) });
  }
  function presenceOff() {
    if (!pres || mode !== 'off') return;
    pres.stop();
    pres = null;
  }
  // a request to a TV: down the connection it opened to us, or over HTTP
  function talk(t, method, p, body, timeout) {
    if (pres && t && pres.has(t.id)) return pres.request(t.id, method, p, body, timeout);
    return net.request(t.ip, method, p, body, timeout);
  }

  // the cast window's own session: its own "what to capture" answer
  const ses = session.fromPartition('rez-cast');
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const src = sources.find((s) => String(s.display_id) === String(capture.displayId)) || sources[0];
          if (!src) return callback({});
          log(`трансляция: снимаю экран «${src.name}», звук ${capture.mute ? 'только на телевизоре' : 'и здесь, и там'}`);
          callback({ video: src, audio: capture.mute ? 'loopbackWithMute' : 'loopback' });
        })
        .catch((e) => {
          log('трансляция: экран не снять: ' + e.message);
          callback({});
        });
    },
    { useSystemPicker: false }
  );
  // the page only captures the screen; nothing else is asked for
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' || perm === 'display-capture'));

  function make() {
    win = new BrowserWindow({
      width: PICK_W,
      height: PICK_H,
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
      title: 'Резонанс — трансляция',
      webPreferences: { preload, partition: 'rez-cast', backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    // the TV must not show the list or the pill
    win.setContentProtection(true);
    win.loadFile(path.join(__dirname, '..', 'app', 'cast.html'));
    win.on('blur', () => {
      if (mode !== 'pick' || busy || Date.now() - shownAt < 400) return;
      hidePick();
    });
    win.on('closed', () => {
      win = null;
      if (mode === 'live') setMode('off');
    });
    win.webContents.on('render-process-gone', (e, d) => {
      log('трансляция: окно потеряло страницу: ' + (d && d.reason));
      const was = mode;
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
      if (was === 'live') {
        byeTv(tv);
        setMode('off');
      }
    });
  }

  function send(msg) {
    if (!win || win.isDestroyed()) return;
    const w = win;
    const go = () => !w.isDestroyed() && w.webContents.send('cast', msg);
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go);
    else go();
  }

  function setMode(m) {
    mode = m;
    if (m === 'off') tv = null;
    onChange({ live: m === 'live', tv: tv ? tv.name : '' });
  }

  function place(kind) {
    const d = screen.getPrimaryDisplay();
    const wa = d.workArea;
    if (kind === 'pill') {
      win.setBounds({ x: wa.x + wa.width - PILL_W - 14, y: wa.y + 14, width: PILL_W, height: PILL_H });
    } else {
      const h = Math.min(PICK_H, wa.height - 20);
      win.setBounds({ x: Math.round(wa.x + (wa.width - PICK_W) / 2), y: Math.round(wa.y + (wa.height - h) / 2), width: PICK_W, height: h });
    }
  }

  /** Opens the list of TVs (or, while casting, shows the pill). */
  function open() {
    if (!win || win.isDestroyed()) make();
    if (mode === 'live') {
      win.showInactive();
      return;
    }
    mode = 'pick';
    presenceOn();
    place('pick');
    send({ cmd: 'pick' });
    win.show();
    win.focus();
    shownAt = Date.now();
  }

  function hidePick() {
    if (mode !== 'pick') return;
    mode = 'off';
    if (win && !win.isDestroyed()) {
      send({ cmd: 'hidden' });
      win.hide();
    }
    presenceOff();
  }

  /** Stops the picture (from the Quick settings, the panel or the tray). */
  function stop() {
    if (mode === 'live') send({ cmd: 'stop' });
    else hidePick();
  }

  function byeTv(t) {
    if (!t) return;
    const known = db.tv(t.id);
    if (known && known.token) return talk(t, 'POST', '/connect/bye', { from: db.me(), token: known.token }, 3000);
  }

  function displays() {
    const prim = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      name: d.label || `Экран ${i + 1}`,
      w: Math.round(d.size.width * d.scaleFactor),
      h: Math.round(d.size.height * d.scaleFactor),
      primary: d.id === prim,
    }));
  }

  // what the window asks for
  async function handle(cmd, arg) {
    arg = arg || {};
    switch (cmd) {
      case 'find': {
        const found = await net.discover(Number(arg.ms) || 2500, (t) => send({ cmd: 'found', tv: mark(t) }));
        log(`трансляция: найдено телевизоров: ${found.length}`);
        // the ones that came to us count too (and win: that way works for sure)
        const all = new Map();
        for (const t of found) all.set(t.id || t.ip, mark(t));
        for (const t of pres ? pres.tvs() : []) all.set(t.id, mark(t));
        return { tvs: [...all.values()], displays: displays(), mute: capture.mute, quality: prefs.quality };
      }
      case 'byIp': {
        const ip = String(arg.ip || '').trim();
        if (!net.isLanIp(ip)) return { error: 'lan' };
        const r = await net.request(ip, 'GET', '/connect/info', null, 4000);
        if (r.status !== 200 || !r.body || !r.body.id) return { error: r.body && r.body.error === 'timeout' ? 'timeout' : 'net' };
        return { tv: mark({ id: String(r.body.id), name: String(r.body.name || 'Резонанс OS'), ip, w: r.body.w, h: r.body.h }) };
      }
      case 'hello': {
        const t = arg.tv || {};
        busy = true;
        try {
          const known = db.tv(t.id);
          let r = await talk(t, 'POST', '/connect/hello', { from: db.me(), name: os.hostname() });
          if (r.status !== 200 || !r.body.ok) return { error: (r.body && r.body.error) || 'net' };
          // the TV remembers us but we lost the token: a code again
          if (r.body.paired && !(known && known.token)) {
            r = await talk(t, 'POST', '/connect/hello', { from: db.me(), name: os.hostname(), again: true });
            if (r.status !== 200 || !r.body.ok) return { error: (r.body && r.body.error) || 'net' };
          }
          if (!r.body.paired && known && known.token) db.forget(t.id);
          return { paired: !!r.body.paired };
        } finally {
          busy = false;
        }
      }
      case 'prepare':
        capture = { displayId: arg.displayId != null ? arg.displayId : screen.getPrimaryDisplay().id, mute: arg.mute !== false };
        if (prefs.mute !== capture.mute || (arg.quality && prefs.quality !== arg.quality)) {
          prefs = { ...prefs, mute: capture.mute, ...(arg.quality ? { quality: String(arg.quality) } : {}) };
          savePrefs();
        }
        return { display: displays().find((d) => d.id === capture.displayId) || displays()[0] };
      case 'offer': {
        const t = arg.tv || {};
        busy = true;
        try {
          const known = db.tv(t.id);
          const body = { from: db.me(), name: os.hostname(), sdp: String(arg.sdp || '') };
          if (arg.code) body.code = String(arg.code);
          else if (known && known.token) body.token = known.token;
          const r = await talk(t, 'POST', '/connect/offer', body, 25000);
          if (r.status !== 200 || !r.body.ok || !r.body.sdp) {
            const e = (r.body && r.body.error) || 'net';
            log(`трансляция: «${t.name}» отказал: ${e} (HTTP ${r.status})`);
            if (e === 'pair') db.forget(t.id);
            return { error: e };
          }
          db.remember(t.id, { name: t.name, ip: t.ip, ...(r.body.token ? { token: r.body.token } : {}) });
          return { sdp: r.body.sdp };
        } finally {
          busy = false;
        }
      }
      case 'live': {
        const t = arg.tv || {};
        tv = { id: t.id, name: t.name, ip: t.ip };
        setMode('live');
        log(`трансляция: идёт на «${t.name}» (${t.ip})`);
        place('pill');
        win.setAlwaysOnTop(true, 'screen-saver');
        win.showInactive();
        return true;
      }
      case 'stopped': {
        const was = tv;
        log('трансляция: закончена (' + (arg.why || '—') + ')');
        const bye = was && arg.why !== 'remote' ? byeTv(was) : null;
        setMode('off');
        // the bye goes down the TV's connection: close it only after
        Promise.resolve(bye).finally(() => presenceOff());
        if (win && !win.isDestroyed()) {
          win.setAlwaysOnTop(true);
          win.hide();
        }
        return true;
      }
      case 'stats':
        log('трансляция: ' + String(arg.text || '').slice(0, 300));
        return true;
      case 'close':
        hidePick();
        return true;
      default:
        return null;
    }
  }

  // a TV as the window shows it: with "known" when it gave us a token before
  function mark(t) {
    const k = db.tv(t.id);
    return { ...t, known: !!(k && k.token) };
  }

  return { open, stop, handle, isLive: () => mode === 'live', tvName: () => (tv ? tv.name : '') };
}

module.exports = { create };
