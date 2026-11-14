// Резонанс Connect, checked end to end on one PC (no TV needed):
//
//   electron desktop/tools/connect-check.js
//
// A stand-in TV runs here: the same HTTP + UDP protocol as Connect.java (with
// the same pairing rules), and the real Резонанс OS page
// (tv/android/app/src/main/assets/www) in a window with a stand-in Android
// bridge. The real PC side (lib/cast.js + app/cast.html) finds it, gets the
// code, captures the screen and sound, and sends them over WebRTC.
//
// A small square on the screen flips black/white once a second; the TV page
// looks for the flip in the picture it receives, so the delay measured is
// the real one: screen -> capture -> encode -> network -> decode -> picture.
//
// The result goes to stdout and connect-check.json (+ a screenshot) in the
// folder given by REZ_CHECK_OUT (default: the system temp folder).

'use strict';

const { app, BrowserWindow, session, desktopCapturer, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');
const castLib = require('../lib/cast');

app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const OUT = process.env.REZ_CHECK_OUT || os.tmpdir();
const TV_PAGE = path.join(__dirname, '..', '..', 'tv', 'android', 'app', 'src', 'main', 'assets', 'www', 'index.html');
const result = { steps: [], ok: false };
const t0 = Date.now();
const step = (s) => {
  const line = `${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`;
  result.steps.push(line);
  console.log(line);
};

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rez-connect-check-')));

// ---------- the stand-in TV: Connect.java + Pairing.java in a few lines ----------

const TV = { id: crypto.randomUUID(), name: 'Резонанс OS · проверка', w: 1920, h: 1080 };
const pairing = { code: null, codeFor: null, until: 0, tries: 0, known: {} };
let tvWin = null;
let waiting = null; // {sid, resolve}
let sid = 0;

function emitTv(e) {
  if (tvWin && !tvWin.isDestroyed()) tvWin.webContents.executeJavaScript(`window.__rezEmit && window.__rezEmit('connect', ${JSON.stringify(e)})`).catch(() => {});
}

function serveTv() {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const send = (code, o) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (req.headers.origin) return send(403, { ok: false, error: 'origin' });
      let q = {};
      try {
        q = body ? JSON.parse(body) : {};
      } catch {}
      if (req.method === 'GET' && req.url === '/connect/info') return send(200, { proto: 1, port: 48230, ...TV });
      if (req.url === '/connect/hello') {
        if (pairing.known[q.from] && !q.again) return send(200, { ok: true, paired: true });
        if (!pairing.code || Date.now() > pairing.until || pairing.codeFor !== q.from) {
          pairing.code = String(crypto.randomInt(10000)).padStart(4, '0');
          pairing.codeFor = q.from;
          pairing.until = Date.now() + 180000;
          pairing.tries = 0;
        }
        step(`ТВ: показываю код ${pairing.code} для «${q.name}»`);
        emitTv({ t: 'code', code: pairing.code, name: q.name });
        return send(200, { ok: true, paired: false });
      }
      if (req.url === '/connect/offer') {
        let token = null;
        const known = pairing.known[q.from];
        let ok = !!(known && q.token && q.token === known);
        if (!ok && q.code) {
          if (!pairing.code || Date.now() > pairing.until) return send(403, { ok: false, error: 'expired' });
          if (q.code !== pairing.code) {
            if (++pairing.tries >= 5) pairing.code = null;
            step('ТВ: неверный код');
            return send(403, { ok: false, error: 'code' });
          }
          pairing.code = null;
          token = crypto.randomBytes(24).toString('hex');
          pairing.known[q.from] = token;
          ok = true;
        }
        if (!ok) return send(403, { ok: false, error: 'pair' });
        const my = ++sid;
        const answer = await new Promise((resolve) => {
          waiting = { sid: my, resolve };
          emitTv({ t: 'offer', sid: my, sdp: q.sdp, ip: req.socket.remoteAddress.replace(/^::ffff:/, ''), name: q.name });
          setTimeout(() => resolve({ error: 'timeout' }), 20000);
        });
        if (!answer.sdp) return send(504, { ok: false, error: answer.error || 'timeout' });
        return send(200, { ok: true, sdp: answer.sdp, ...(token ? { token } : {}) });
      }
      if (req.url === '/connect/bye') {
        emitTv({ t: 'bye' });
        return send(200, { ok: true });
      }
      send(404, { ok: false, error: 'path' });
    });
  });
  srv.listen(48230);

  const u = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  u.on('message', (m, r) => {
    if (String(m).startsWith('REZCONNECT?')) {
      const a = Buffer.from('REZCONNECT!' + JSON.stringify({ proto: 1, port: 48230, ...TV }));
      u.send(a, r.port, r.address);
    }
  });
  u.on('error', (e) => step('ТВ: UDP: ' + e.message));
  u.bind(48231);
}

// the page's side of the bridge (sync calls come by sendSync)
ipcMain.on('tv-sync', (e, name) => {
  if (name === 'connectPending') e.returnValue = '[]';
  else e.returnValue = null;
});
ipcMain.on('tv', (e, name, a, b) => {
  if (name === 'connectAnswer' && waiting && waiting.sid === a) waiting.resolve({ sdp: b });
  else if (name === 'connectFail' && waiting && waiting.sid === a) waiting.resolve({ error: b });
  else if (name === 'log' && /connect|Резонанс OS/.test(a)) step('ТВ-страница: ' + a);
});

function openTv() {
  const pre = path.join(app.getPath('userData'), 'tv-preload.js');
  fs.writeFileSync(
    pre,
    `const { ipcRenderer } = require('electron');
     const fixed = { apps: '[]', info: '{"ram":4096}', network: 'wifi', mediaState: '{"active":false}', connectInfo: '{}' };
     window.RezTV = new Proxy({}, { get: (o, k) => (...args) => {
       if (k in fixed) return fixed[k];
       if (k === 'connectPending') return ipcRenderer.sendSync('tv-sync', k);
       ipcRenderer.send('tv', k, ...args);
       return false;
     } });`
  );
  tvWin = new BrowserWindow({
    width: 960,
    height: 540,
    x: 40,
    y: 300,
    title: 'Проверка: телевизор',
    webPreferences: { preload: pre, contextIsolation: false, nodeIntegration: false, sandbox: false, backgroundThrottling: false, partition: 'tv-check' },
  });
  // the TV page may reach nothing outside (the weather and so on): the check runs offline
  session.fromPartition('tv-check').webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|devtools|data|blob):/.test(d.url) }));
  tvWin.loadFile(TV_PAGE);
}

// ---------- the probe: a square that flips, seen by the TV ----------

let probe = null;
const flips = [];
function openProbe() {
  const d = screen.getPrimaryDisplay();
  probe = new BrowserWindow({ x: d.bounds.x + 20, y: d.bounds.y + 20, width: 160, height: 160, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, backgroundColor: '#000000', webPreferences: { backgroundThrottling: false } });
  probe.setAlwaysOnTop(true, 'screen-saver');
  probe.loadURL('data:text/html,<body style="margin:0;background:#000"></body>');
  let white = false;
  setInterval(() => {
    white = !white;
    probe.webContents
      .executeJavaScript(`new Promise((r) => { document.body.style.background = '${white ? '#fff' : '#000'}'; requestAnimationFrame(() => requestAnimationFrame(() => r(Date.now()))); })`)
      .then((at) => flips.push({ white, at }))
      .catch(() => {});
  }, 1000);
}

// on the TV page: watch the square's corner of the received picture
function watchFlips() {
  const d = screen.getPrimaryDisplay();
  const fx = (20 + 80) / d.bounds.width;
  const fy = (20 + 80) / d.bounds.height;
  return tvWin.webContents.executeJavaScript(`(() => {
    window.__seen = [];
    const v = document.getElementById('castVideo');
    const c = document.createElement('canvas'); c.width = 4; c.height = 4;
    const x = c.getContext('2d', { willReadFrequently: true });
    let last = null;
    const look = () => {
      if (v.videoWidth) {
        x.drawImage(v, v.videoWidth * ${fx} - 2, v.videoHeight * ${fy} - 2, 4, 4, 0, 0, 4, 4);
        const p = x.getImageData(1, 1, 1, 1).data;
        const white = p[0] + p[1] + p[2] > 382;
        if (last !== null && white !== last) window.__seen.push({ white, at: Date.now() });
        last = white;
      }
      v.requestVideoFrameCallback(look);
    };
    v.requestVideoFrameCallback(look);
    return true;
  })()`);
}

// ---------- the PC side, driven like a person would ----------

async function js(win, code) {
  return win.webContents.executeJavaScript(code);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(150);
  }
  throw new Error('не дождался: ' + what);
}

async function run() {
  serveTv();
  openTv();
  await until(() => !tvWin.webContents.isLoading(), 10000, 'страница ТВ');
  step('ТВ: страница Резонанс OS открыта');
  openProbe();

  const ctl = castLib.create({
    BrowserWindow,
    session,
    desktopCapturer,
    screen,
    app,
    preload: path.join(__dirname, '..', 'preload.js'),
    log: (m) => step('ПК: ' + m),
    onChange: (s) => step('ПК: состояние ' + JSON.stringify(s)),
  });
  ipcMain.handle('cast', (e, cmd, arg) => ctl.handle(String(cmd || ''), arg));
  ipcMain.handle('settings', () => ({}));
  ipcMain.on('log', (e, m) => step('ПК-окно: ' + m));

  // 1. the list finds the TV (the broadcast reaches this same PC too)
  ctl.open();
  const casting = BrowserWindow.getAllWindows().find((w) => /трансляция/.test(w.getTitle()));
  await until(() => !casting.webContents.isLoading(), 10000, 'окно трансляции');
  casting.webContents.on('console-message', (e) => step('ПК-окно (консоль): ' + (e.message || '')));
  let found = await until(() => js(casting, `document.querySelectorAll('.tv').length`), 6000, 'телевизор в списке').catch(() => 0);
  result.foundByBroadcast = !!found;
  if (!found) {
    step('ПК: в списке пусто — ввожу адрес 127.0.0.1');
    await js(casting, `document.getElementById('ip').value='127.0.0.1'; document.getElementById('ipGo').click(); true`);
    found = await until(() => js(casting, `document.querySelectorAll('.tv').length`), 6000, 'телевизор по адресу');
  }
  step(`ПК: в списке ${await js(casting, `[...document.querySelectorAll('.tv-n')].map((e) => e.textContent).join(', ')`)}`);

  // 2. a wrong code first, then the one from the TV's screen
  await js(casting, `document.querySelector('.tv').click(); true`);
  await until(() => pairing.code, 6000, 'код на ТВ');
  const shown = await until(() => js(tvWin, `[...document.querySelectorAll('.cast-code b')].map((b) => b.textContent).join('')`), 5000, 'код на экране ТВ');
  result.codeShownOnTv = shown === pairing.code;
  step(`ТВ-страница показывает код ${shown}`);
  await until(() => js(casting, `!document.getElementById('vCode').classList.contains('hidden')`), 5000, 'поле для кода');
  const typeCode = (c) => js(casting, `(() => { const i = document.getElementById('code'); i.value = '${c}'; i.dispatchEvent(new Event('input')); return true; })()`);
  await typeCode(pairing.code === '0000' ? '1111' : '0000');
  const err = await until(() => js(casting, `document.getElementById('codeErr').textContent`), 15000, 'ошибка неверного кода');
  result.wrongCodeRefused = /Неверный код/.test(err);
  step('ПК: неверный код — «' + err + '»');
  const tStart = Date.now();
  await typeCode(pairing.code);

  // 3. the picture goes
  await until(() => ctl.isLive(), 20000, 'картинка пошла');
  result.connectMs = Date.now() - tStart;
  step(`связь за ${result.connectMs} мс`);
  await until(() => js(tvWin, `document.body.classList.contains('casting') && document.getElementById('castVideo').videoWidth > 0`), 10000, 'видео на ТВ');
  await watchFlips();
  step('ТВ: видео идёт, меряю задержку 12 с');
  await wait(12000);

  // 4. what came: stats on both ends, the delay of the flips, a screenshot
  const seen = await js(tvWin, `window.__seen`);
  const delays = [];
  for (const s of seen) {
    const f = flips.filter((x) => x.white === s.white && x.at <= s.at).pop();
    if (f && s.at - f.at < 1000) delays.push(s.at - f.at);
  }
  delays.sort((a, b) => a - b);
  result.delayMs = delays.length ? { min: delays[0], median: delays[Math.floor(delays.length / 2)], max: delays[delays.length - 1], n: delays.length } : null;
  result.tv = await js(
    tvWin,
    `(async () => {
      const v = document.getElementById('castVideo');
      const o = { video: v.videoWidth + 'x' + v.videoHeight, audioTracks: v.srcObject ? v.srcObject.getAudioTracks().length : 0 };
      return o;
    })()`
  );
  const img = await tvWin.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'connect-check-tv.png'), img.toPNG());
  const bmp = img.toBitmap();
  let sum = 0;
  for (let i = 0; i < bmp.length; i += 4 * 97) sum += bmp[i] + bmp[i + 1] + bmp[i + 2];
  result.tvPictureNotBlack = sum / (bmp.length / (4 * 97)) > 20;

  // 5. Back on the TV's remote ends it on the PC too
  await js(tvWin, `window.__rezEmit('key', 'back'); true`);
  await until(() => !ctl.isLive(), 10000, 'остановка с пульта');
  step('Назад на пульте: показ на ПК остановлен');
  result.backStops = true;

  // 6. once more: no code this time (the TV knows this PC)
  ctl.open();
  await wait(500);
  await until(() => js(casting, `document.querySelectorAll('.tv').length`), 6000, 'телевизор снова в списке');
  const tag = await js(casting, `(document.querySelector('.tag') || {}).textContent || ''`);
  await js(casting, `document.querySelector('.tv').click(); true`);
  await until(() => ctl.isLive(), 20000, 'вторая трансляция без кода');
  result.secondTimeNoCode = tag === 'без кода';
  step('второй раз — без кода: ' + (result.secondTimeNoCode ? 'да' : 'нет'));
  ctl.stop();
  await until(() => !ctl.isLive(), 10000, 'остановка кнопкой');
  await until(() => js(tvWin, `!document.body.classList.contains('casting')`), 10000, 'ТВ закончил показ');
  step('«Остановить» на ПК: ТВ вернулся на главный экран');
  result.stopFromPc = true;

  result.ok = result.codeShownOnTv && result.wrongCodeRefused && result.tvPictureNotBlack && result.backStops && result.secondTimeNoCode && result.stopFromPc;
}

app.whenReady().then(() => {
  const done = (e) => {
    if (e) {
      result.error = e.message;
      step('ОШИБКА: ' + e.message);
    }
    // the stats lines the PC side logged
    result.pcStats = result.steps.filter((s) => /ПК: трансляция: (H264|VP8|VP9|AV1|video)/i.test(s) || /кодер/.test(s));
    result.tvStats = result.steps.filter((s) => /декодер|буфер/.test(s));
    fs.writeFileSync(path.join(OUT, 'connect-check.json'), JSON.stringify(result, null, 2));
    console.log('RESULT ' + JSON.stringify({ ok: result.ok, delayMs: result.delayMs, connectMs: result.connectMs }));
    setTimeout(() => app.exit(result.ok ? 0 : 1), 500);
  };
  const guard = setTimeout(() => done(new Error('проверка шла слишком долго')), 120000);
  run()
    .then(() => done())
    .catch(done)
    .finally(() => clearTimeout(guard));
});
