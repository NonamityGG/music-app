// Резонанс для ПК — the Start menu: a live wave along the bottom, a clock,
// search, pinned apps that take the colour of their icon, recent files, all
// apps and power. The apps and their icons come from the helper (the shortcuts
// Windows keeps in the Start Menu folders). Pins are kept in this window.

import { h, clear } from '../../src/util.js';
import * as shellwaves from './shellwaves.js';

const $ = (id) => document.getElementById(id);
const q = $('q');
const body = document.body;
const canvas = $('waves');
shellwaves.init(canvas, { y: 1.0, amp: 0.2 });

const ICON = {
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  power: 'M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.98 6.98 0 0 1 19 12a7 7 0 1 1-11.41-5.42L6.17 5.17A9 9 0 1 0 21 12a8.97 8.97 0 0 0-3.17-6.83z',
  sleep: 'M10 2a9 9 0 1 0 12 12A10 10 0 0 1 10 2z',
  restart: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3-9H9V6a3 3 0 0 1 6 0v2z',
  out: 'M17 8l-1.41 1.41L17.17 11H9v2h8.17l-1.58 1.58L17 16l4-4-4-4zM5 5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7v-2H5V5z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  web: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a7.82 7.82 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.07 16zm2.95-8H5.07a7.99 7.99 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82A13.7 13.7 0 0 1 12 19.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8 8 0 0 1-4.33 3.56zM16.36 14a16.5 16.5 0 0 0 0-4h3.38a7.82 7.82 0 0 1 0 4h-3.38z',
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

$('searchIcon').appendChild(svg('search'));
$('power').appendChild(svg('power'));

// ---------- state ----------

let apps = [];
let recent = [];
let recentOn = true;
let nav = [];
let navIdx = -1;

function pins() {
  try {
    return JSON.parse(localStorage.getItem('rez.pins') || 'null') || defaultPins();
  } catch {
    return defaultPins();
  }
}
function defaultPins() {
  const want = ['проводник', 'параметры', 'microsoft edge', 'резонанс', 'steam', 'counter-strike'];
  const found = [];
  for (const w of want) {
    const a = apps.find((x) => x.name.toLowerCase() === w || x.name.toLowerCase().includes(w));
    if (a && !found.includes(a.path)) found.push(a.path);
  }
  return found.slice(0, 5);
}
function setPins(list) {
  try {
    localStorage.setItem('rez.pins', JSON.stringify(list));
  } catch {}
}
function appByPath(p) {
  return apps.find((a) => a.path === p);
}
function isPinned(p) {
  return pins().includes(p);
}
function pin(p) {
  const list = pins();
  if (!list.includes(p)) list.unshift(p);
  setPins(list.slice(0, 10));
  render();
}
function unpin(p) {
  setPins(pins().filter((x) => x !== p));
  render();
}

// ---------- the colour of an app, from its icon ----------

const colorCache = {};
function rgb2hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hsl2css(h, s, l) {
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}
function iconColor(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    if (src in colorCache) return res(colorCache[src]);
    const img = new Image();
    img.onload = () => {
      try {
        const N = 22;
        const c = document.createElement('canvas');
        c.width = c.height = N;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, N, N);
        const d = x.getImageData(0, 0, N, N).data;
        const bins = {};
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          const [hh, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
          if (l < 0.12 || l > 0.9 || s < 0.22) continue;
          const k = Math.round(hh / 20) % 18;
          const w = s * s * (1 - Math.abs(l - 0.55));
          const bn = bins[k] || (bins[k] = { w: 0, h: 0, s: 0 });
          bn.w += w;
          bn.h += hh * w;
          bn.s += s * w;
        }
        let best = null;
        for (const k in bins) if (!best || bins[k].w > best.w) best = bins[k];
        const col = best && best.w > 0.5 ? hsl2css(best.h / best.w, Math.min(1, Math.max(0.5, (best.s / best.w) * 1.05)), 0.6) : null;
        colorCache[src] = col;
        res(col);
      } catch {
        res((colorCache[src] = null));
      }
    };
    img.onerror = () => res((colorCache[src] = null));
    img.src = src;
  });
}

// ---------- apply the look ----------

function colors(s) {
  const c = (s && s.paletteColors) || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  body.style.setProperty('--acc', c[0]);
  body.style.setProperty('--acc3', c[1]);
  body.style.setProperty('--acc2', c[2]);
  shellwaves.look(s && (s.palette === 'cover' ? s.lastPalette : s.palette));
}
window.rez.onSettings(colors);

// ---------- build ----------

function tile(a) {
  const el = h('button', { class: 'tile', title: a.name });
  if (a.icon) {
    el.appendChild(h('img', { src: a.icon, alt: '' }));
    iconColor(a.icon).then((col) => {
      if (col) {
        el.style.setProperty('--c1', col);
        el.style.setProperty('--c2', col);
      }
    });
  } else el.appendChild(h('div', { class: 'ro-ic' }, svg('file')));
  el.appendChild(h('span', { class: 'nm' }, a.name));
  el.addEventListener('click', () => launch(a));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    unpin(a.path);
  });
  return el;
}

function row(a, sub, iconName) {
  const el = h('button', { class: 'row', title: a.name });
  if (a.icon) el.appendChild(h('img', { src: a.icon, alt: '' }));
  else el.appendChild(h('div', { class: 'ro-ic' }, svg(iconName || 'file')));
  el.appendChild(h('div', { class: 'ro-t' }, h('div', { class: 'ro-n' }, a.name), sub ? h('div', { class: 'ro-s' }, sub) : null));
  el.addEventListener('click', () => launch(a));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (a._web) return;
    if (isPinned(a.path)) unpin(a.path);
    else pin(a.path);
  });
  return el;
}

function render() {
  const pinBox = $('pinned');
  clear(pinBox);
  const pinApps = pins().map(appByPath).filter(Boolean);
  $('pinnedSec').classList.toggle('hidden', !pinApps.length);
  for (const a of pinApps) pinBox.appendChild(tile(a));

  const recBox = $('recent');
  clear(recBox);
  $('recentSec').classList.toggle('hidden', !recentOn || !recent.length);
  for (const r of recent.slice(0, 5)) recBox.appendChild(row(r, folderOf(r.path), 'file'));

  const appBox = $('apps');
  clear(appBox);
  for (const a of apps) appBox.appendChild(row(a));
}

// the folder a recent file sits in — a quiet, useful sublabel (not "Недавнее")
function folderOf(p) {
  if (!p) return '';
  const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

// ---------- search ----------

function search(text) {
  const t = text.trim().toLowerCase();
  const searching = t.length > 0;
  $('resultsSec').classList.toggle('hidden', !searching);
  $('pinnedSec').classList.toggle('hidden', searching || !pins().map(appByPath).filter(Boolean).length);
  $('recentSec').classList.toggle('hidden', searching || !recentOn || !recent.length);
  $('allSec').classList.toggle('hidden', searching);
  if (!searching) {
    buildNav();
    return;
  }
  const box = $('results');
  clear(box);
  const hits = apps
    .map((a) => ({ a, i: a.name.toLowerCase().indexOf(t) }))
    .filter((x) => x.i >= 0)
    .sort((x, y) => x.i - y.i || x.a.name.length - y.a.name.length)
    .slice(0, 40);
  for (const { a } of hits) box.appendChild(row(a));
  box.appendChild(row({ name: `Искать «${text.trim()}» в интернете`, _web: text.trim() }, 'Поиск в интернете', 'web'));
  $('empty').classList.add('hidden');
  buildNav();
}

function launch(a) {
  if (a._web) {
    window.rez.shell('launch', { path: 'https://www.google.com/search?q=' + encodeURIComponent(a._web) });
    return;
  }
  window.rez.shell('launch', { path: a.path, args: a.args || '' });
}

// ---------- keyboard ----------

function buildNav() {
  nav = Array.prototype.slice.call(document.querySelectorAll('section:not(.hidden) .tile, section:not(.hidden) .row'));
  navIdx = -1;
  for (const el of nav) el.classList.remove('sel');
}
function move(d) {
  if (!nav.length) return;
  if (navIdx >= 0 && nav[navIdx]) nav[navIdx].classList.remove('sel');
  navIdx = (navIdx + d + nav.length) % nav.length;
  const el = nav[navIdx];
  el.classList.add('sel');
  el.scrollIntoView({ block: 'nearest' });
}

q.addEventListener('input', () => search(q.value));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return window.rez.shell('startClose');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    move(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    move(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (navIdx >= 0 && nav[navIdx]) nav[navIdx].click();
    else if (nav[0]) nav[0].click();
  }
});

// ---------- power ----------

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
$('who').addEventListener('click', () => window.rez.shell('launch', { path: 'ms-settings:yourinfo' }));

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

// ---------- open / close ----------

window.rez.onShell((d) => {
  if (!d) return;
  if (d.open) {
    if (d.apps) apps = d.apps;
    if (d.recent) recent = d.recent;
    if ('recentOn' in d) recentOn = d.recentOn;
    if (d.settings) colors(d.settings);
    if (d.user) {
      $('uname').textContent = d.user;
      $('ava').textContent = (d.user[0] || 'П').toUpperCase();
    }
    render();
    q.value = '';
    search('');
    tick();
    body.classList.add('open');
    shellwaves.show(true);
    setTimeout(() => q.focus(), 40);
  } else {
    body.classList.remove('open');
    shellwaves.show(false);
    clearTimeout(clockTimer);
    pwMenu.classList.add('hidden');
  }
});

window.rez.onApps((list) => {
  apps = list || [];
  if (body.classList.contains('open')) {
    render();
    search(q.value);
  }
});
window.rez.onRecent((list) => {
  recent = list || [];
  if (body.classList.contains('open')) render();
});
