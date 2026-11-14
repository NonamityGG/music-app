// A look at the launcher in a desktop browser: the built page (www) with a
// stand-in phone (window.RezL) — some apps, drawn icons, a song playing.
// node launcher/test/serve.mjs [port]   (build first: node launcher/build.mjs)

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = resolve(process.env.LAUNCHER_OUT || join(here, '..', 'android', 'app', 'src', 'main', 'assets', 'www'));
const port = Number(process.argv[2] || 5180);

const APPS = [
  ['app.rezonans.music', 'Резонанс', '#7c4dff', '#ff6fd8'],
  ['org.telegram.messenger', 'Telegram', '#2aabee', '#229ed9'],
  ['com.whatsapp', 'WhatsApp', '#25d366', '#128c7e'],
  ['com.vkontakte.android', 'ВКонтакте', '#0077ff', '#3f8cff'],
  ['ru.yandex.yandexmaps', 'Яндекс Карты', '#ffcc00', '#ff5a36'],
  ['com.google.android.youtube', 'YouTube', '#ff0033', '#cc0000'],
  ['com.google.android.gm', 'Gmail', '#ea4335', '#fbbc04'],
  ['com.android.chrome', 'Chrome', '#34a853', '#4285f4'],
  ['com.google.android.dialer', 'Телефон', '#2ee6c1', '#1a9e85'],
  ['com.google.android.apps.messaging', 'Сообщения', '#3fa9ff', '#4d6bff'],
  ['com.android.camera', 'Камера', '#3a3550', '#1e1a2c'],
  ['com.google.android.apps.photos', 'Галерея', '#ff8a3d', '#ffd36b'],
  ['com.android.settings', 'Настройки', '#5d5577', '#2f2940'],
  ['com.google.android.deskclock', 'Часы', '#1e172d', '#7c4dff'],
  ['com.google.android.calendar', 'Календарь', '#4285f4', '#3367d6'],
  ['com.android.calculator2', 'Калькулятор', '#ff6b8b', '#d6325a'],
  ['ru.sberbankmobile', 'СберБанк', '#21a038', '#0b7a2a'],
  ['ru.ozon.app.android', 'Ozon', '#005bff', '#f91155'],
  ['com.wildberries.ru', 'Wildberries', '#cb11ab', '#481173'],
  ['ru.yandex.taxi', 'Яндекс Go', '#fce000', '#1d1d1d'],
  ['com.spotify.music', 'Spotify', '#1ed760', '#121212'],
  ['com.android.vending', 'Google Play', '#00d1ff', '#34a853'],
  ['com.google.android.apps.docs', 'Диск', '#fbbc04', '#34a853'],
  ['com.google.android.keep', 'Keep', '#fbbc04', '#f29900'],
  ['com.instagram.android', 'Instagram', '#f58529', '#dd2a7b'],
  ['ru.kinopoisk', 'Кинопоиск', '#ff6600', '#1a1a1a'],
  ['com.duolingo', 'Duolingo', '#58cc02', '#46a302'],
  ['com.android.contacts', 'Контакты', '#7be0b0', '#2ee6c1'],
  ['com.google.android.apps.nbu.files', 'Файлы', '#4d6bff', '#b44dff'],
  ['ru.rostel', 'Госуслуги', '#0d4cd3', '#ee3f58'],
  ['com.avito.android', 'Авито', '#00aaff', '#97cf26'],
  ['com.google.android.apps.maps', 'Google Карты', '#34a853', '#ea4335'],
  ['com.android.soundrecorder', 'Диктофон', '#ff3d7f', '#ff8a3d'],
  ['com.android.fmradio', 'Радио', '#c3a6ff', '#7c4dff'],
  ['com.shazam.android', 'Shazam', '#0088ff', '#0055ff'],
  ['ru.yandex.music', 'Яндекс Музыка', '#ffdb4d', '#ff3d7f'],
  ['com.zhiliaoapp.musically', 'TikTok', '#25f4ee', '#fe2c55'],
  ['com.discord', 'Discord', '#5865f2', '#404eed'],
  ['com.notion.id', 'Notion', '#ffffff', '#d0d0d0'],
  ['com.weather.forecast', 'Погода', '#3fa9ff', '#a8ff9e'],
];

function mock() {
  const apps = APPS.map(([pkg, label], i) => ({ pkg, label, sys: /android\.(settings|camera|dialer|contacts|calculator2|vending)/.test(pkg), cat: -1 }));
  return `<script>
(function(){
  var apps=${JSON.stringify(apps)};
  var media={active:true,app:'app.rezonans.music',appLabel:'Резонанс',title:'Ночной город',artist:'Mujuice',playing:true,pos:62000,dur:214000,art:1,canNext:true,canPrev:true};
  var store='';
  window.RezL={
    apps:function(){return JSON.stringify(apps)}, meta:function(){return '{}'},
    launch:function(p){console.log('launch',p);return true},
    shortcuts:function(p){return p==='org.telegram.messenger'?JSON.stringify([{id:'1',label:'Новое сообщение'},{id:'2',label:'Избранное'}]):'[]'},
    startShortcut:function(){return true}, appInfo:function(){return true}, uninstall:function(){return true},
    openSettings:function(){return true}, openUrl:function(u){console.log('url',u);return true},
    requestMic:function(){return true}, openNotificationAccess:function(){return true}, openHomeSettings:function(){return true},
    info:function(){return JSON.stringify({app:'2.0.0-preview',home:false,notif:true,mic:true,insets:{t:32,b:20,l:0,r:0,ime:0}})},
    battery:function(){return JSON.stringify({level:76,charging:false})},
    badges:function(){return JSON.stringify({'org.telegram.messenger':3,'com.google.android.gm':1})},
    mediaState:function(){return JSON.stringify(media)}, media:function(a){if(a==='toggle'){media.playing=!media.playing}},
    visualizer:function(){}, haptic:function(){}, notifications:function(){console.log('shade');return true},
    storeGet:function(){return store}, storeSet:function(s){store=s}, log:function(m){console.log(m)}
  };
})();
</script>`;
}

const ICON = (bg1, bg2, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="192" height="192" fill="url(#g)"/><text x="96" y="122" font-family="Arial" font-weight="700" font-size="84" text-anchor="middle" fill="rgba(255,255,255,0.92)">${label.charAt(0)}</text></svg>`;
const ART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3d7f"/><stop offset=".5" stop-color="#7c4dff"/><stop offset="1" stop-color="#00d1ff"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="140" cy="60" r="34" fill="#ffd36b" opacity=".85"/><path d="M0 150 L50 110 L90 140 L140 90 L200 130 L200 200 L0 200z" fill="#140f1f" opacity=".7"/></svg>`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/icon/')) {
    const pkg = decodeURIComponent(u.pathname.slice(6));
    const a = APPS.find((x) => x[0] === pkg) || [pkg, '?', '#444', '#222'];
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end(ICON(a[2], a[3], a[1]));
  }
  if (u.pathname === '/art') {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end(ART);
  }
  const p = join(www, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(www) || !existsSync(p)) {
    res.writeHead(404);
    return res.end();
  }
  let data = readFileSync(p);
  if (p.endsWith('index.html')) data = data.toString().replace('<script src="app.js">', mock() + '<script src="app.js">');
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(data);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
