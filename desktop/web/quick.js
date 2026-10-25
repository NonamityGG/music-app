// Резонанс для ПК — the Quick settings: a live wave, what's playing, toggles
// (Wi-Fi, Bluetooth and the Резонанс ones), the volume, the battery and power.
// The radios, the volume and the battery come from the helper; the Резонанс
// toggles go straight to the settings.

import { h, clear } from '../../src/util.js';
import * as shellwaves from './shellwaves.js';

const $ = (id) => document.getElementById(id);
const body = document.body;
const canvas = $('waves');
shellwaves.init(canvas, { y: 1.0, amp: 0.2 });

const ICON = {
  wifi: 'M12 21l3-3a4.2 4.2 0 0 0-6 0l3 3zm0-6a7.5 7.5 0 0 1 5.3 2.2l1.7-1.7a9.9 9.9 0 0 0-14 0l1.7 1.7A7.5 7.5 0 0 1 12 15zm0-5c2.9 0 5.6 1.1 7.6 3.1l1.7-1.7A13.4 13.4 0 0 0 12 5 13.4 13.4 0 0 0 2.7 11.4l1.7 1.7A10.6 10.6 0 0 1 12 10z',
  bt: 'M14.88 12 17 9.88 12.71 5.6 11 7.3V2.3L6.7 6.6 9.59 9.5 6.7 12.38 11 16.7v-5l1.71 1.71L10.59 15 12 16.41l2.88-2.88zM13 5.83l1.17 1.17L13 8.17V5.83zm0 9l1.17 1.17L13 17.17v-2.34z',
  waves: 'M3 10h2v4H3zm4-3h2v10H7zm4-4h2v18h-2zm4 4h2v10h-2zm4 3h2v4h-2z',
  moon: 'M12.3 2a1 1 0 0 0-.2 2 6 6 0 1 1-7.9 7.9 1 1 0 0 0-2 .2 8 8 0 1 0 10.1-10.1z',
  island: 'M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zm0 2a3 3 0 0 0 0 6h10a3 3 0 0 0 0-6H7zm10 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  paint: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.36-.6-.36-.99 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45a4.9 4.9 0 0 0 .05-.63zM19 12a7 7 0 0 1-.73 3.1l1.46 1.46A9 9 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25a7 7 0 0 1-2.25 1.21v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z',
  battery: 'M16 4h-2V2h-4v2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
  gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  power: 'M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.98 6.98 0 0 1 19 12a7 7 0 1 1-11.41-5.42L6.17 5.17A9 9 0 1 0 21 12a8.97 8.97 0 0 0-3.17-6.83z',
  sleep: 'M12.3 2a1 1 0 0 0-.2 2 6 6 0 1 1-7.9 7.9 1 1 0 0 0-2 .2 8 8 0 1 0 10.1-10.1z',
  restart: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3-9H9V6a3 3 0 0 1 6 0v2z',
  out: 'M17 8l-1.41 1.41L17.17 11H9v2h8.17l-1.58 1.58L17 16l4-4-4-4zM5 5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7v-2H5V5z',
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

function colors(s) {
  settings = s || settings;
  const c = (settings && settings.paletteColors) || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  body.style.setProperty('--acc', c[0]);
  body.style.setProperty('--acc3', c[1]);
  body.style.setProperty('--acc2', c[2]);
  shellwaves.look(settings.palette === 'cover' ? settings.lastPalette : settings.palette);
  renderTiles();
}

// ---------- toggles ----------

function renderTiles() {
  const box = $('tiles');
  clear(box);
  const on = (v) => !!v;
  const items = [
    { name: 'Wi-Fi', ic: 'wifi', on: on(status.wifi), sub: status.wifi ? 'Подключено' : 'Выключено', act: () => window.rez.shell('radio', { kind: 'wifi', on: !status.wifi }) },
    { name: 'Bluetooth', ic: 'bt', on: on(status.bt), sub: status.bt ? 'Включено' : 'Выключено', act: () => window.rez.shell('radio', { kind: 'bt', on: !status.bt }) },
    { name: 'Волны', ic: 'waves', on: settings.wallpaper !== false, sub: 'Живые обои', act: () => window.rez.set({ wallpaper: !(settings.wallpaper !== false) }) },
    { name: 'Остров', ic: 'island', on: settings.island !== false, sub: 'Плеер сверху', act: () => window.rez.set({ island: !(settings.island !== false) }) },
    { name: 'Тёмная тема', ic: 'moon', on: on(settings.winDark), sub: 'Windows', act: () => window.rez.set({ winDark: !settings.winDark }) },
    { name: 'Цвета', ic: 'paint', on: on(settings.winAccent), sub: 'Windows в палитре', act: () => window.rez.set({ winAccent: !settings.winAccent }) },
  ];
  for (const it of items) {
    box.appendChild(
      h('button', { class: 'toggle' + (it.on ? ' on' : ''), onclick: it.act, title: it.name }, h('span', { class: 't-ic' }, svg(it.ic)), h('div', { class: 't-t' }, h('div', { class: 't-n' }, it.name), h('div', { class: 't-s' }, it.sub)))
    );
  }
}

// ---------- volume ----------

const vol = $('vol');
function renderVolume() {
  const v = typeof status.vol === 'number' ? status.vol : 50;
  if (document.activeElement !== vol) vol.value = v;
  vol.style.setProperty('--p', (status.muted ? 0 : v) + '%');
  $('volVal').textContent = status.muted ? '—' : v;
  clear($('volIc')).appendChild(svg(status.muted || v === 0 ? 'mute' : 'vol'));
}
vol.addEventListener('input', () => {
  vol.style.setProperty('--p', vol.value + '%');
  $('volVal').textContent = vol.value;
  window.rez.shell('volume', { level: Number(vol.value) });
});
$('volIc').addEventListener('click', () => window.rez.shell('mute', { on: !status.muted }));

// ---------- battery ----------

function renderBattery() {
  const row = $('batRow');
  if (typeof status.battery !== 'number') return row.classList.add('hidden');
  row.classList.remove('hidden');
  clear($('batIc')).appendChild(svg('battery'));
  $('batText').textContent = `Батарея ${status.battery}%${status.charging ? ' · заряжается' : ''}`;
}

// ---------- media ----------

function renderMedia() {
  const np = $('np');
  const active = media && media.status && media.status !== 'none' && (media.title || media.artist);
  np.classList.toggle('hidden', !active);
  if (!active) return;
  $('npApp').textContent = media.app || 'Сейчас играет';
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

// ---------- clock ----------

const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
let clockTimer = 0;
function tick() {
  clearTimeout(clockTimer);
  const d = new Date();
  $('clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('date').textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  clockTimer = setTimeout(tick, (60 - d.getSeconds()) * 1000 + 20);
}

// ---------- footer ----------

$('winSettings').appendChild(svg('gear'));
$('power').appendChild(svg('power'));
$('winSettings').addEventListener('click', () => {
  window.rez.shell('launch', { path: 'ms-settings:' });
  window.rez.shell('quickClose');
});
$('rezSettings').addEventListener('click', () => {
  window.rez.shell('settings');
  window.rez.shell('quickClose');
});

const pwMenu = $('pwMenu');
$('power').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!pwMenu.classList.contains('hidden')) return pwMenu.classList.add('hidden');
  clear(pwMenu);
  for (const [action, name, ic] of [
    ['sleep', 'Спящий режим', 'sleep'],
    ['shutdown', 'Завершение работы', 'power'],
    ['restart', 'Перезагрузка', 'restart'],
    ['lock', 'Заблокировать', 'lock'],
    ['signout', 'Выйти', 'out'],
  ]) {
    pwMenu.appendChild(h('button', { onclick: () => window.rez.shell('power', { action }) }, svg(ic), name));
  }
  pwMenu.classList.remove('hidden');
});
document.addEventListener('click', () => pwMenu.classList.add('hidden'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.rez.shell('quickClose');
});

// ---------- updates ----------

function applyStatus(s) {
  status = s || status;
  renderTiles();
  renderVolume();
  renderBattery();
}

window.rez.onStatus(applyStatus);
window.rez.onSettings(colors);
window.rez.onMedia((m) => {
  if (!m) return;
  media = m.status === 'none' ? { status: 'none' } : { ...media, ...m };
  renderMedia();
});

window.rez.onShell((d) => {
  if (!d) return;
  if (d.open) {
    if (d.status) status = d.status;
    if (d.settings) settings = d.settings;
    if (d.media) media = d.media;
    colors(settings);
    applyStatus(status);
    renderMedia();
    tick();
    body.classList.add('open');
    shellwaves.show(true);
  } else {
    body.classList.remove('open');
    shellwaves.show(false);
    clearTimeout(clockTimer);
    pwMenu.classList.add('hidden');
  }
});
