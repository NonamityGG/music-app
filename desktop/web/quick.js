// Резонанс для ПК — the Quick settings, laid out like Windows 11's: what's
// playing, a grid of toggles with their names under them, the volume with the
// sound output beside it, the battery, settings and power. Wi-Fi and Bluetooth
// show only when the PC has them. The window is see-through and as tall as the
// panel (the page tells main.js); the panel slides up in one short move.

import { h, clear } from '../../src/util.js';
import * as shellwaves from './shellwaves.js';
import { coverAccent } from './coverlook.js';
import { appName } from './common.js';

const $ = (id) => document.getElementById(id);
const body = document.body;
shellwaves.init($('waves'), { y: 1.0, amp: 0.2, name: 'быстрые настройки' });

const ICON = {
  cast: 'M21 3H3a2 2 0 0 0-2 2v3h2V5h18v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM1 18v3h3a3 3 0 0 0-3-3zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7zm0-4v2a9 9 0 0 1 9 9h2A11 11 0 0 0 1 10z',
  wifi: 'M12 21l3-3a4.2 4.2 0 0 0-6 0l3 3zm0-6a7.5 7.5 0 0 1 5.3 2.2l1.7-1.7a9.9 9.9 0 0 0-14 0l1.7 1.7A7.5 7.5 0 0 1 12 15zm0-5c2.9 0 5.6 1.1 7.6 3.1l1.7-1.7A13.4 13.4 0 0 0 12 5 13.4 13.4 0 0 0 2.7 11.4l1.7 1.7A10.6 10.6 0 0 1 12 10z',
  bt: 'M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z',
  waves: 'M3 10h2v4H3zm4-3h2v10H7zm4-4h2v18h-2zm4 4h2v10h-2zm4 3h2v4h-2z',
  moon: 'M12.3 2a1 1 0 0 0-.2 2 6 6 0 1 1-7.9 7.9 1 1 0 0 0-2 .2 8 8 0 1 0 10.1-10.1z',
  island: 'M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zm0 2a3 3 0 0 0 0 6h10a3 3 0 0 0 0-6H7zm10 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  paint: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.36-.6-.36-.99 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  lan: 'M20 4H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h4v3h8v-3h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM7 13V9h2v4H7zm4 0V9h2v4h-2zm4 0V9h2v4h-2z',
  glass: 'M3 15h18v4H3zm2-9h14v7H5z',
  tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  vol1: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
  mute: 'M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45a4.9 4.9 0 0 0 .05-.63zM19 12a7 7 0 0 1-.73 3.1l1.46 1.46A9 9 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25a7 7 0 0 1-2.25 1.21v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z',
  battery: 'M16 4h-2V2h-4v2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
  gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  power: 'M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.98 6.98 0 0 1 19 12a7 7 0 1 1-11.41-5.42L6.17 5.17A9 9 0 1 0 21 12a8.97 8.97 0 0 0-3.17-6.83z',
  sleep: 'M12.3 2a1 1 0 0 0-.2 2 6 6 0 1 1-7.9 7.9 1 1 0 0 0-2 .2 8 8 0 1 0 10.1-10.1z',
  restart: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3-9H9V6a3 3 0 0 1 6 0v2z',
  out: 'M17 8l-1.41 1.41L17.17 11H9v2h8.17l-1.58 1.58L17 16l4-4-4-4zM5 5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7v-2H5V5z',
  speaker: 'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-5 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 16a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  right: 'M9.3 6.7 10.7 5.3 17.4 12l-6.7 6.7-1.4-1.4 5.3-5.3z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  next: 'M5.5 6.1v11.8a.8.8 0 0 0 1.24.66l8.3-5.9a.8.8 0 0 0 0-1.32l-8.3-5.9A.8.8 0 0 0 5.5 6.1zM16.5 6h2v12h-2z',
  prev: 'M18.5 6.1v11.8a.8.8 0 0 1-1.24.66l-8.3-5.9a.8.8 0 0 1 0-1.32l8.3-5.9a.8.8 0 0 1 1.24.66zM5.5 6h2v12h-2z',
};

function svg(name, cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICON[name] || '');
  p.setAttribute('fill', 'currentColor');
  s.appendChild(p);
  return s;
}

let status = {};
let settings = {};
let media = { status: 'none' };
let wavesOn = true;

// the palette's colours; "from the cover" — the colours of what's playing
function paint() {
  coverAccent(settings, media, (c, pal) => {
    body.style.setProperty('--acc', c[0]);
    body.style.setProperty('--acc3', c[1]);
    body.style.setProperty('--acc2', c[2]);
    shellwaves.look(pal);
  });
}

function colors(s) {
  settings = s || settings;
  paint();
  wavesOn = settings.shellWaves !== 'off';
  body.classList.toggle('no-waves', !wavesOn);
  if (wavesOn) shellwaves.setMode(settings.shellWaves);
  else shellwaves.show(false);
  renderTiles();
}

// ---------- toggles ----------
// A tile: the button (lit when on) and its name under it. Wi-Fi and Bluetooth
// are split like Windows': the left part switches, the arrow opens their page
// in the Windows settings. A radio the PC hasn't got isn't shown at all (the
// helper says nothing about a radio that isn't there).

function tileEl(it) {
  const btn = h('button', { class: 'tb' + (it.on ? ' on' : '') + (it.more ? ' split' : ''), title: it.name, 'aria-pressed': it.toggle ? String(!!it.on) : null });
  const main = h('span', { class: 'tb-main' }, svg(it.ic));
  btn.appendChild(main);
  if (it.more) {
    const more = h('span', { class: 'tb-more', title: 'Открыть в параметрах' }, svg('right'));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      it.more();
    });
    btn.appendChild(more);
  }
  btn.addEventListener('click', it.act);
  return h('div', { class: 'tile' }, btn, h('div', { class: 'tl' }, it.name));
}

function openSettings(page) {
  window.rez.shell('launch', { path: 'ms-settings:' + page });
  window.rez.shell('quickClose');
}

const canCast = typeof window.rez.castState === 'function';
let castState = { live: false, tv: '' };
if (canCast) {
  const setCast = (st) => {
    castState = st || castState;
    renderTiles();
  };
  if (window.rez.onCastState) window.rez.onCastState(setCast);
  window.rez.castState().then(setCast, () => {});
}

function renderTiles() {
  const items = [];
  if ('wifi' in status)
    items.push({ name: status.wifi && status.net === 'wifi' && status.netName ? status.netName : 'Wi-Fi', ic: 'wifi', toggle: true, on: !!status.wifi, act: () => window.rez.shell('radio', { kind: 'wifi', on: !status.wifi }), more: () => openSettings('network-wifi') });
  // a cable and no Wi-Fi module: the connection, opening the network settings
  else if (status.net === 'ethernet') items.push({ name: status.netLevel === 'internet' ? 'Ethernet' : 'Нет интернета', ic: 'lan', on: status.netLevel === 'internet', act: () => openSettings('network-ethernet') });
  if ('bt' in status) items.push({ name: 'Bluetooth', ic: 'bt', toggle: true, on: !!status.bt, act: () => window.rez.shell('radio', { kind: 'bt', on: !status.bt }), more: () => openSettings('bluetooth') });
  // «На телевизор» (Резонанс Connect): this PC's screen and sound on a TV with
  // Резонанс OS — only in a build that can do it
  if (canCast) items.push({ name: castState.live ? castState.tv || 'На телевизоре' : 'На телевизор', ic: 'cast', toggle: true, on: !!castState.live, act: () => window.rez.shell('cast') });
  items.push(
    { name: 'Живые обои', ic: 'waves', toggle: true, on: settings.wallpaper !== false, act: () => window.rez.set({ wallpaper: !(settings.wallpaper !== false) }) },
    { name: 'Остров', ic: 'island', toggle: true, on: settings.island !== false, act: () => window.rez.set({ island: !(settings.island !== false) }) },
    { name: 'Тёмная тема', ic: 'moon', toggle: true, on: !!settings.winDark, act: () => window.rez.set({ winDark: !settings.winDark }) },
    { name: 'Цвета Windows', ic: 'paint', toggle: true, on: !!settings.winAccent, act: () => window.rez.set({ winAccent: !settings.winAccent }) },
    { name: 'Прозрачная панель', ic: 'glass', toggle: true, on: !!settings.taskbarClear, act: () => window.rez.set({ taskbarClear: !settings.taskbarClear }) },
    {
      name: 'Резонанс',
      ic: 'tune',
      act: () => {
        window.rez.shell('settings');
        window.rez.shell('quickClose');
      },
    }
  );
  const box = clear($('tiles'));
  for (const it of items) box.appendChild(tileEl(it));
}

// ---------- volume ----------

const vol = $('vol');
function renderVolume() {
  const v = typeof status.vol === 'number' ? status.vol : 50;
  if (document.activeElement !== vol) vol.value = v;
  paintVol(status.muted ? 0 : Number(vol.value));
  clear($('volIc')).appendChild(svg(status.muted || v === 0 ? 'mute' : v < 40 ? 'vol1' : 'vol'));
  vol.title = status.muted ? 'Звук выключен' : `Громкость: ${v}`;
}
function paintVol(p) {
  vol.style.setProperty('--p', p + '%');
}
vol.addEventListener('input', () => {
  paintVol(vol.value);
  window.rez.shell('volume', { level: Number(vol.value) });
});
vol.addEventListener('wheel', (e) => {
  e.preventDefault();
  const v = Math.max(0, Math.min(100, Number(vol.value) + (e.deltaY < 0 ? 2 : -2)));
  vol.value = v;
  paintVol(v);
  window.rez.shell('volume', { level: v });
}, { passive: false });
$('volIc').addEventListener('click', () => window.rez.shell('mute', { on: !status.muted }));

// ---------- sound output ----------

let outputs = [];
const outBtn = $('outBtn');
$('outChev').appendChild(svg('right'));
outBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('outList').classList.toggle('hidden') === false;
  outBtn.setAttribute('aria-expanded', String(open));
  outBtn.classList.toggle('open', open);
});

function renderOutputs() {
  outBtn.classList.toggle('hidden', outputs.length < 2);
  if (outputs.length < 2) $('outList').classList.add('hidden');
  clear($('outIc')).appendChild(svg('speaker'));
  const cur = outputs.find((o) => o.def);
  outBtn.title = cur ? `Вывод звука: ${cur.name}` : 'Вывод звука';
  const list = clear($('outItems'));
  for (const o of outputs) {
    list.appendChild(
      h(
        'button',
        {
          class: 'out' + (o.def ? ' on' : ''),
          title: o.name,
          onclick: (e) => {
            e.stopPropagation();
            if (!o.def) window.rez.shell('output', { id: o.id });
          },
        },
        h('span', { class: 'out-ic' }, svg(o.def ? 'check' : 'speaker')),
        h('span', { class: 'out-t' }, o.name)
      )
    );
  }
}

// ---------- battery ----------

function renderBattery() {
  const row = $('batRow');
  if (typeof status.battery !== 'number') return row.classList.add('hidden');
  row.classList.remove('hidden');
  clear($('batIc')).appendChild(svg('battery'));
  $('batIc').style.setProperty('--b', status.battery + '%');
  $('batText').textContent = `${status.battery}%${status.charging ? ' · заряжается' : ''}`;
}

// ---------- media ----------

function renderMedia() {
  const active = media && media.status && media.status !== 'none' && (media.title || media.artist);
  $('np').classList.toggle('hidden', !active);
  if (!active) return;
  $('npApp').textContent = media.app ? appName(media.app) : 'Сейчас играет';
  $('npTitle').textContent = media.title || 'Без названия';
  $('npArtist').textContent = media.artist || '';
  $('cover').style.backgroundImage = media.thumb ? `url("${media.thumb}")` : '';
  clear($('play')).appendChild(svg(media.status === 'playing' ? 'pause' : 'play'));
}

for (const [id, ic, action] of [
  ['prev', 'prev', 'prev'],
  ['play', 'play', 'toggle'],
  ['next', 'next', 'next'],
]) {
  $(id).appendChild(svg(ic));
  $(id).addEventListener('click', () => window.rez.shell('media', { action }));
}

// ---------- footer ----------

$('winSettings').appendChild(svg('gear'));
$('power').appendChild(svg('power'));
$('winSettings').addEventListener('click', () => openSettings(''));

const pwMenu = $('pwMenu');
$('power').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!pwMenu.classList.contains('hidden')) return pwMenu.classList.add('hidden');
  clear(pwMenu);
  for (const [action, name, ic] of [
    ['lock', 'Заблокировать', 'lock'],
    ['signout', 'Выйти', 'out'],
    ['sleep', 'Спящий режим', 'sleep'],
    ['shutdown', 'Завершение работы', 'power'],
    ['restart', 'Перезагрузка', 'restart'],
  ]) {
    pwMenu.appendChild(h('button', { onclick: () => window.rez.shell('power', { action }) }, svg(ic), name));
  }
  pwMenu.classList.remove('hidden');
});
document.addEventListener('click', () => pwMenu.classList.add('hidden'));
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.rez.shell('quickClose');
});
// a click on the see-through margin round the panel closes it
document.addEventListener('mousedown', (e) => {
  if (!$('panel').contains(e.target)) window.rez.shell('quickClose');
});

// ---------- the window is as tall as the panel ----------

let saidH = 0;
new ResizeObserver(() => {
  const hh = Math.ceil($('panel').offsetHeight + 24);
  if (Math.abs(hh - saidH) < 2) return;
  saidH = hh;
  window.rez.shell('quickHeight', { h: hh - 24 });
}).observe($('panel'));

// ---------- updates ----------

function applyStatus(s) {
  status = s || status;
  renderTiles();
  renderVolume();
  renderBattery();
}

window.rez.onStatus(applyStatus);
window.rez.onOutputs((list) => {
  outputs = Array.isArray(list) ? list : [];
  renderOutputs();
});
window.rez.onSettings(colors);
window.rez.onMedia((m) => {
  if (!m) return;
  media = m.status === 'none' ? { status: 'none' } : { ...media, ...m };
  if (settings.palette === 'cover') paint();
  renderMedia();
});

let wavesTimer = 0;
window.rez.onShell((d) => {
  if (!d) return;
  clearTimeout(wavesTimer);
  if (d.open) {
    if (d.status) status = d.status;
    if (d.settings) settings = d.settings;
    if (d.media) media = d.media;
    colors(settings);
    applyStatus(status);
    renderMedia();
    renderOutputs();
    $('outList').classList.add('hidden');
    outBtn.classList.remove('open');
    pwMenu.classList.add('hidden');
    body.classList.remove('open');
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add('open')));
    if (wavesOn) wavesTimer = setTimeout(() => shellwaves.show(true), 260);
  } else {
    body.classList.remove('open');
    shellwaves.show(false);
    pwMenu.classList.add('hidden');
  }
});
