// A small static server for looking at the launcher page in a desktop browser:
// the built www/, generated icons (/icon/<pkg>), a cover (/art) and stand-ins
// for the outside services the weather asks (/net?u=).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const APPS = [
  ['com.android.dialer', 'Телефон', 'sys', -1, '#2e7d32'],
  ['com.android.messages', 'Сообщения', 'sys', 4, '#1565c0'],
  ['com.android.chrome', 'Chrome', 'sys', -1, '#ef6c00'],
  ['com.android.camera', 'Камера', 'sys', 3, '#455a64'],
  ['org.telegram.messenger', 'Telegram', 'user', 4, '#229ed9'],
  ['com.whatsapp', 'WhatsApp', 'user', 4, '#25d366'],
  ['com.vkontakte.android', 'ВКонтакте', 'user', 4, '#0077ff'],
  ['com.google.android.youtube', 'YouTube', 'user', 2, '#e53935'],
  ['ru.zvuk.music', 'Звук', 'user', 1, '#7c4dff'],
  ['ru.yandex.music', 'Яндекс Музыка', 'user', 1, '#fdd835'],
  ['com.spotify.music', 'Spotify', 'user', 1, '#1db954'],
  ['com.google.android.apps.maps', 'Карты', 'user', 6, '#34a853'],
  ['ru.dublgis.dgismobile', '2ГИС', 'user', 6, '#43a047'],
  ['com.android.settings', 'Настройки', 'sys', -1, '#607d8b'],
  ['com.android.gallery3d', 'Галерея', 'sys', 3, '#8e24aa'],
  ['com.google.android.calendar', 'Календарь', 'user', 7, '#1e88e5'],
  ['com.android.calculator2', 'Калькулятор', 'sys', -1, '#546e7a'],
  ['com.android.deskclock', 'Часы', 'sys', -1, '#37474f'],
  ['com.valvesoftware.cs2', 'CS2 Companion', 'user', 0, '#ff7043'],
  ['com.faceit.app', 'FACEIT', 'user', 0, '#ff5500'],
  ['com.supercell.brawl', 'Brawl Stars', 'user', 0, '#fbc02d'],
  ['com.mojang.minecraft', 'Minecraft', 'user', 0, '#558b2f'],
  ['ru.sberbankmobile', 'СберБанк', 'user', -1, '#21a038'],
  ['ru.tinkoff', 'Т-Банк', 'user', -1, '#ffdd2d'],
  ['com.google.android.gm', 'Gmail', 'user', 5, '#d93025'],
  ['com.google.android.apps.docs', 'Диск', 'user', 7, '#1fa463'],
  ['com.microsoft.office.word', 'Word', 'user', 7, '#2b579a'],
  ['ru.max.messenger', 'Макс', 'user', 4, '#00b0ff'],
  ['com.discord', 'Discord', 'user', 4, '#5865f2'],
  ['com.twitch.android', 'Twitch', 'user', 2, '#9146ff'],
  ['com.instagram.android', 'Photos Pro', 'user', 3, '#e1306c'],
  ['com.android.vending', 'Play Маркет', 'sys', -1, '#00897b'],
  ['com.android.contacts', 'Контакты', 'sys', -1, '#3949ab'],
  ['com.android.documentsui', 'Файлы', 'sys', -1, '#6d4c41'],
  ['com.android.recorder', 'Диктофон', 'sys', -1, '#c62828'],
  ['com.hotspot.vpn', 'VPN', 'user', -1, '#00acc1'],
  ['com.aliexpress.ru', 'AliExpress', 'user', -1, '#ff4747'],
  ['ru.ozon.app.android', 'Ozon', 'user', -1, '#005bff'],
  ['ru.wildberries', 'Wildberries', 'user', -1, '#cb11ab'],
  ['com.avito.android', 'Авито', 'user', -1, '#00aaff'],
  ['ru.yandex.taxi', 'Такси', 'user', -1, '#fc3f1d'],
  ['ru.yandex.market', 'Маркет', 'user', -1, '#ffcc00'],
  ['com.duolingo', 'Duolingo', 'user', -1, '#58cc02'],
  ['com.notion.id', 'Notion', 'user', 7, '#eeeeee'],
  ['com.adobe.reader', 'Acrobat', 'user', 7, '#d32f2f'],
  ['org.videolan.vlc', 'VLC', 'user', 2, '#ff8800'],
  ['com.shazam.android', 'Shazam', 'user', 1, '#0088ff'],
  ['com.google.android.apps.translate', 'Переводчик', 'user', -1, '#4285f4'],
  ['com.google.android.apps.photos', 'Google Фото', 'user', 3, '#fbbc04'],
];

const byPkg = Object.fromEntries(APPS.map((a) => [a[0], a]));
const glyph = (label) => (label.trim().charAt(0) || '?').toUpperCase();

function iconSvg(pkg, mono) {
  const a = byPkg[pkg] || [pkg, pkg, 'user', -1, '#7c4dff'];
  if (mono) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="26" fill="#000"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" fill="${a[4]}"/><rect width="192" height="192" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs><text x="96" y="122" font-family="sans-serif" font-weight="700" font-size="84" text-anchor="middle" fill="#fff">${glyph(a[1])}</text></svg>`;
}

const artSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5fa2"/><stop offset=".5" stop-color="#7c4dff"/><stop offset="1" stop-color="#1c1245"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="130" cy="70" r="46" fill="#ffd36e" opacity=".85"/></svg>`;

function forecast() {
  const base = new Date();
  base.setMinutes(0, 0, 0);
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const time = [];
  const t2 = [];
  const code = [];
  const day = [];
  for (let i = 0; i < 26; i++) {
    const d = new Date(base.getTime() + i * 3600e3);
    time.push(iso(d));
    t2.push(-4 - Math.round(3 * Math.sin(i / 4)));
    code.push(i % 7 === 0 ? 71 : 3);
    day.push(d.getHours() >= 8 && d.getHours() < 17 ? 1 : 0);
  }
  return {
    current: { time: iso(new Date()), temperature_2m: -4.4, apparent_temperature: -9, weather_code: 71, is_day: 1, wind_speed_10m: 4, relative_humidity_2m: 84 },
    hourly: { time, temperature_2m: t2, weather_code: code, is_day: day },
    daily: { time: ['0', '1', '2', '3', '4'].map((_, i) => iso(new Date(base.getTime() + i * 86400e3)).slice(0, 10)), temperature_2m_max: [-2, -3, -6, -8, -5], temperature_2m_min: [-9, -10, -12, -14, -11], weather_code: [71, 3, 3, 0, 2] },
  };
}

export function serve(www, port = 0) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (u.pathname.startsWith('/icon/')) return send(200, 'image/svg+xml', iconSvg(decodeURIComponent(u.pathname.slice(6)), u.searchParams.get('k') === 'mono'));
    if (u.pathname === '/art') return send(200, 'image/svg+xml', artSvg);
    if (u.pathname === '/net') {
      const t = u.searchParams.get('u') || '';
      if (t.includes('sypexgeo')) return send(200, 'application/json', JSON.stringify({ city: { lat: 49.79, lon: 129.4, name_ru: 'Райчихинск' } }));
      if (t.includes('open-meteo.com/v1/forecast')) return send(200, 'application/json', JSON.stringify(forecast()));
      return send(404, 'text/plain', 'no');
    }
    let p = join(www, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!p.startsWith(www) || !existsSync(p) || statSync(p).isDirectory()) return send(404, 'text/plain', 'not found');
    send(200, types[extname(p)] || 'application/octet-stream', readFileSync(p));
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ srv, port: srv.address().port })));
}

// the stand-in for window.RezL, as a script to run before the page
export function mockScript(opts = {}) {
  const apps = APPS.map((a, i) => ({ pkg: a[0], label: a[1], sys: a[2] === 'sys', cat: a[3], installed: Date.now() - (i % 9 === 0 ? 2 : 90) * 86400e3, updated: 0 }));
  const o = {
    apps,
    info: { app: '1.0.0', model: 'NOTE 50 Pro', maker: 'Infinix', android: '15', sdk: 35, dp: 2.75, sw: opts.tablet ? 800 : 393, tablet: !!opts.tablet, home: false, notif: true, mic: true, liveWall: false, dark: true, insets: opts.insets || { t: 32, b: 24, l: 0, r: 0, ime: 0 }, you: ['#6750a4', '#d0bcff', '#ccc2dc'] },
    battery: { level: 76, charging: false },
    badges: { 'org.telegram.messenger': 12, 'com.whatsapp': 3, 'com.android.messages': 1 },
    media: { active: true, app: 'ru.zvuk.music', appLabel: 'Звук', title: 'Midnight City', artist: 'M83', album: '', playing: true, pos: 61000, dur: 243000, art: 1, canNext: true, canPrev: true },
    store: opts.store || '',
  };
  return `
    (() => {
      const O = ${JSON.stringify(o)};
      const log = (window.__calls = []);
      const rec = (n, ...a) => log.push([n, ...a]);
      window.RezL = {
        apps: () => JSON.stringify(O.apps), meta: () => '{}', launch: (...a) => (rec('launch', ...a), true),
        shortcuts: () => JSON.stringify([{ id: 's1', label: 'Новый чат' }, { id: 's2', label: 'Избранное' }]),
        startShortcut: (...a) => rec('shortcut', ...a), appInfo: (p) => rec('appInfo', p), uninstall: (p) => rec('uninstall', p),
        openSettings: () => {}, openUrl: (u) => rec('openUrl', u), requestMic: () => {}, openNotificationAccess: () => {}, openHomeSettings: () => rec('homeSettings'),
        info: () => JSON.stringify(O.info), network: () => 'wifi', battery: () => JSON.stringify(O.battery), badges: () => JSON.stringify(O.badges),
        media: (a) => rec('media', a), mediaState: () => JSON.stringify(O.media), visualizer: () => {}, wallpaper: (j) => rec('wallpaper', j), setLiveWallpaper: () => {},
        pickWallpaper: () => {}, seeThrough: (b) => rec('seeThrough', b), scroll: () => {}, haptic: () => {}, notifications: () => (rec('shade'), true),
        widgets: () => JSON.stringify([{ k: 'com.android.deskclock/.Clock', pkg: 'com.android.deskclock', label: 'Часы', w: 250, h: 110, cfg: false }, { k: 'com.google.search/.Box', pkg: 'org.telegram.messenger', label: 'Чаты', w: 250, h: 250, cfg: false }]),
        widgetAdd: (k) => { rec('widgetAdd', k); setTimeout(() => window.__rezEmit('widgetAdded', { id: 41, w: 250, h: 110, label: 'Часы' }), 50); },
        widgetFrames: (j) => rec('frames', j), widgetRemove: (id) => rec('widgetRemove', id),
        orientation: () => {}, storeGet: () => O.store, storeSet: (s) => rec('storeSet', s.length), log: (m) => console.log('[RezL]', m), reload: () => {},
      };
    })();`;
}
