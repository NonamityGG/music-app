// Резонанс для ПК — the Start menu, laid out like Windows 11's: search on top,
// the pinned apps in a grid, «Все приложения» by letter on a second page, the
// account and power at the bottom. No recent files. The window is see-through:
// the page draws the panel (no Windows acrylic — it stutters as the window
// appears) and slides it up in one short move. The apps and their icons come
// from the helper (the shortcuts in the Start Menu folders). Pins live here.

import { h, clear } from '../../src/util.js';
import * as shellwaves from './shellwaves.js';
import { coverAccent } from './coverlook.js';

const $ = (id) => document.getElementById(id);
const q = $('q');
const body = document.body;
shellwaves.init($('waves'), { y: 1.0, amp: 0.16, name: 'Пуск' });

const ICON = {
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  power: 'M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.98 6.98 0 0 1 19 12a7 7 0 1 1-11.41-5.42L6.17 5.17A9 9 0 1 0 21 12a8.97 8.97 0 0 0-3.17-6.83z',
  sleep: 'M10 2a9 9 0 1 0 12 12A10 10 0 0 1 10 2z',
  restart: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  lock: 'M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3-9H9V6a3 3 0 0 1 6 0v2z',
  out: 'M17 8l-1.41 1.41L17.17 11H9v2h8.17l-1.58 1.58L17 16l4-4-4-4zM5 5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7v-2H5V5z',
  app: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  web: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a7.82 7.82 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.07 16zm2.95-8H5.07a7.99 7.99 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82A13.7 13.7 0 0 1 12 19.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8 8 0 0 1-4.33 3.56zM16.36 14a16.5 16.5 0 0 0 0-4h3.38a7.82 7.82 0 0 1 0 4h-3.38z',
  gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  pin: 'M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z',
  unpin: 'M3.3 2 2 3.3l5.6 5.6-2.6-.5-2 2 4 4-5 5 1 1 5-5 4 4 2-2-.5-2.6 5.6 5.6 1.3-1.3L3.3 2zM16 3l-3 3 .9.9L17 4l3 3-2.9 3.1.9.9 3-3-5-5z',
  top: 'M4 4h16v2H4zm8 3-6 6h4v7h4v-7h4z',
  right: 'M9.3 6.7 10.7 5.3 17.4 12l-6.7 6.7-1.4-1.4 5.3-5.3z',
  left: 'M14.7 6.7 13.3 5.3 6.6 12l6.7 6.7 1.4-1.4L9.4 12z',
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
$('winSet').appendChild(svg('gear'));
$('chevR').appendChild(svg('right'));
$('chevL').appendChild(svg('left'));

// ---------- state ----------

let apps = [];
let view = 'home'; // home | all | results
let wavesOn = true;
let nav = [];
let navIdx = -1;

const MAX_PINS = 24;
function pins() {
  try {
    const v = JSON.parse(localStorage.getItem('rez.pins') || 'null');
    return Array.isArray(v) ? v : defaultPins();
  } catch {
    return defaultPins();
  }
}
function defaultPins() {
  const want = ['проводник', 'file explorer', 'параметры', 'settings', 'microsoft edge', 'google chrome', 'резонанс', 'steam', 'telegram', 'discord', 'блокнот', 'notepad', 'калькулятор', 'calculator', 'microsoft store', 'фотографии', 'photos', 'терминал', 'terminal'];
  const found = [];
  for (const w of want) {
    const a = apps.find((x) => x.name.toLowerCase() === w) || apps.find((x) => x.name.toLowerCase().startsWith(w));
    if (a && !found.includes(a.path)) found.push(a.path);
  }
  return found.slice(0, 12);
}
function setPins(list) {
  try {
    localStorage.setItem('rez.pins', JSON.stringify(list.slice(0, MAX_PINS)));
  } catch {}
}
const appByPath = (p) => apps.find((a) => a.path === p);
const isPinned = (p) => pins().includes(p);
function pin(p) {
  const list = pins().filter((x) => x !== p);
  list.push(p);
  setPins(list);
  renderPins();
}
function unpin(p) {
  setPins(pins().filter((x) => x !== p));
  renderPins();
}
function toFront(p) {
  setPins([p, ...pins().filter((x) => x !== p)]);
  renderPins();
}

// ---------- the look ----------

let settings = null;
let media = { status: 'none' };

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
  if (!s) return;
  settings = s;
  paint();
  wavesOn = s.shellWaves !== 'off';
  body.classList.toggle('no-waves', !wavesOn);
  if (wavesOn) shellwaves.setMode(s.shellWaves);
  else shellwaves.show(false);
}
window.rez.onSettings(colors);
window.rez.onMedia((m) => {
  if (!m) return;
  media = m.status === 'none' ? { status: 'none' } : { ...media, ...m };
  if (settings && settings.palette === 'cover') paint();
});

// ---------- items ----------

function icon(a, size) {
  if (a.icon) return h('img', { src: a.icon, alt: '', width: size, height: size, draggable: 'false' });
  return h('span', { class: 'ph' }, svg(a._web ? 'web' : 'app'));
}

function tile(a) {
  const el = h('button', { class: 'tile', title: a.name }, icon(a, 32), h('span', { class: 'nm' }, a.name));
  el.addEventListener('click', () => launch(a));
  el.addEventListener('contextmenu', (e) => openCtx(e, a, true));
  return el;
}

function row(a, sub) {
  const el = h('button', { class: 'row', title: a.name }, icon(a, 24), h('span', { class: 'ro-t' }, h('span', { class: 'ro-n' }, a.name), sub ? h('span', { class: 'ro-s' }, sub) : null));
  el.addEventListener('click', () => launch(a));
  if (!a._web) el.addEventListener('contextmenu', (e) => openCtx(e, a, false));
  return el;
}

function renderPins() {
  const box = clear($('pinned'));
  const list = pins().map(appByPath).filter(Boolean);
  for (const a of list) box.appendChild(tile(a));
  $('noPins').classList.toggle('hidden', list.length > 0 || apps.length === 0);
  if (view === 'home') buildNav();
}

const letterOf = (name) => {
  const c = (name || '').trim().charAt(0).toUpperCase();
  if (/[0-9]/.test(c)) return '0–9';
  if (/[A-ZА-ЯЁ]/.test(c)) return c;
  return '#';
};

function renderAll() {
  const box = clear($('apps'));
  let last = null;
  for (const a of apps) {
    const l = letterOf(a.name);
    if (l !== last) {
      box.appendChild(h('div', { class: 'letter' }, l));
      last = l;
    }
    box.appendChild(row(a));
  }
}

// ---------- pages ----------

function show(v) {
  view = v;
  for (const id of ['home', 'all', 'resultsView']) $(id).classList.toggle('on', (id === 'resultsView' ? 'results' : id) === v);
  if (v === 'all') $('allScroll').scrollTop = 0;
  buildNav();
}
$('toAll').addEventListener('click', () => show('all'));
$('toHome').addEventListener('click', () => show('home'));

// ---------- search ----------

function search(text) {
  const t = text.trim().toLowerCase();
  if (!t) return show(view === 'results' ? 'home' : view);
  const box = clear($('results'));
  const hits = apps
    .map((a) => ({ a, i: a.name.toLowerCase().indexOf(t), w: a.name.toLowerCase().split(/\s+/).some((x) => x.startsWith(t)) }))
    .filter((x) => x.i >= 0)
    .sort((x, y) => (y.w - x.w) || x.i - y.i || x.a.name.length - y.a.name.length)
    .slice(0, 30);
  if (hits.length) {
    box.appendChild(h('div', { class: 'letter' }, 'Лучшее соответствие'));
    const best = row(hits[0].a, 'Приложение');
    best.classList.add('best');
    box.appendChild(best);
    if (hits.length > 1) {
      box.appendChild(h('div', { class: 'letter' }, 'Приложения'));
      for (const { a } of hits.slice(1)) box.appendChild(row(a));
    }
  }
  box.appendChild(h('div', { class: 'letter' }, 'Интернет'));
  box.appendChild(row({ name: text.trim(), _web: text.trim() }, 'Искать в интернете'));
  show('results');
}

function launch(a) {
  if (a._web) return window.rez.shell('launch', { path: 'https://www.google.com/search?q=' + encodeURIComponent(a._web) });
  window.rez.shell('launch', { path: a.path, args: a.args || '' });
}

// ---------- keyboard ----------

function buildNav() {
  const sec = view === 'home' ? $('home') : view === 'all' ? $('all') : $('resultsView');
  nav = Array.prototype.slice.call(sec.querySelectorAll('.tile, .row'));
  for (const el of document.querySelectorAll('.sel')) el.classList.remove('sel');
  navIdx = -1;
  // what Enter would open: the best match while searching
  if (view === 'results' && nav[0]) {
    navIdx = 0;
    nav[0].classList.add('sel');
  }
}
function move(d) {
  if (!nav.length) return;
  if (navIdx >= 0 && nav[navIdx]) nav[navIdx].classList.remove('sel');
  navIdx = navIdx < 0 ? (d > 0 ? 0 : nav.length - 1) : (navIdx + d + nav.length) % nav.length;
  const el = nav[navIdx];
  el.classList.add('sel');
  el.scrollIntoView({ block: 'nearest' });
}
// the grid moves by a row up and down, by one left and right
const COLS = 6;

q.addEventListener('input', () => search(q.value));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('ctx').classList.contains('hidden') || !$('pwMenu').classList.contains('hidden')) return closeMenus();
    if (q.value) {
      q.value = '';
      return show('home');
    }
    if (view === 'all') return show('home');
    return window.rez.shell('startClose');
  }
  const grid = view === 'home';
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    move(grid ? COLS : 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    move(grid ? -COLS : -1);
  } else if (grid && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && navIdx >= 0) {
    e.preventDefault();
    move(e.key === 'ArrowRight' ? 1 : -1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const el = nav[navIdx >= 0 ? navIdx : 0];
    if (el) el.click();
  } else if (e.key.length === 1 && document.activeElement !== q && !e.ctrlKey && !e.altKey) {
    q.focus();
  }
});

// ---------- the right-click menu and power ----------

const ctx = $('ctx');
const pwMenu = $('pwMenu');
function closeMenus() {
  ctx.classList.add('hidden');
  pwMenu.classList.add('hidden');
}
function item(ic, name, fn) {
  return h(
    'button',
    {
      onclick: (e) => {
        e.stopPropagation();
        closeMenus();
        fn();
      },
    },
    svg(ic),
    name
  );
}
function placeMenu(menu, x, y) {
  const r = $('panel').getBoundingClientRect();
  menu.classList.remove('hidden');
  const w = menu.offsetWidth;
  const hh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(x - r.left, r.width - w - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y - r.top, r.height - hh - 8)) + 'px';
}
function openCtx(e, a, inGrid) {
  e.preventDefault();
  e.stopPropagation();
  closeMenus();
  clear(ctx);
  ctx.appendChild(item('right', 'Открыть', () => launch(a)));
  if (isPinned(a.path)) {
    if (inGrid && pins()[0] !== a.path) ctx.appendChild(item('top', 'Переместить в начало', () => toFront(a.path)));
    ctx.appendChild(item('unpin', 'Открепить от «Пуска»', () => unpin(a.path)));
  } else ctx.appendChild(item('pin', 'Закрепить в «Пуске»', () => pin(a.path)));
  placeMenu(ctx, e.clientX, e.clientY);
}

$('power').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!pwMenu.classList.contains('hidden')) return closeMenus();
  closeMenus();
  clear(pwMenu);
  for (const [action, name, ic] of [
    ['lock', 'Заблокировать', 'lock'],
    ['signout', 'Выйти', 'out'],
    ['sleep', 'Спящий режим', 'sleep'],
    ['shutdown', 'Завершение работы', 'power'],
    ['restart', 'Перезагрузка', 'restart'],
  ]) {
    pwMenu.appendChild(item(ic, name, () => window.rez.shell('power', { action })));
  }
  pwMenu.classList.remove('hidden');
  pwMenu.style.left = '';
  pwMenu.style.top = '';
});
document.addEventListener('click', closeMenus);
document.addEventListener('contextmenu', (e) => e.preventDefault());
$('who').addEventListener('click', () => window.rez.shell('launch', { path: 'ms-settings:yourinfo' }));
$('winSet').addEventListener('click', () => window.rez.shell('launch', { path: 'ms-settings:' }));
$('rez').addEventListener('click', () => {
  window.rez.shell('settings');
  window.rez.shell('startClose');
});
// a click on the see-through margin round the panel closes the menu
document.addEventListener('mousedown', (e) => {
  if (!$('panel').contains(e.target)) window.rez.shell('startClose');
});

// ---------- open / close ----------

let wavesTimer = 0;
window.rez.onShell((d) => {
  if (!d) return;
  clearTimeout(wavesTimer);
  if (d.open) {
    if (d.apps) apps = d.apps;
    if (d.media) media = d.media;
    if (d.settings) colors(d.settings);
    if (d.user) {
      $('uname').textContent = d.user;
      $('ava').textContent = (d.user[0] || 'П').toUpperCase();
    }
    closeMenus();
    q.value = '';
    renderPins();
    renderAll();
    show('home');
    // drawn closed first, then slid up on the next frames — once the window is
    // on screen, so the move is seen from its start
    body.classList.remove('open');
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add('open')));
    setTimeout(() => q.focus(), 30);
    // the wave starts once the panel is up: nothing else competes with the slide
    if (wavesOn) wavesTimer = setTimeout(() => shellwaves.show(true), 260);
  } else {
    body.classList.remove('open');
    shellwaves.show(false);
    closeMenus();
  }
});

window.rez.onApps((list) => {
  apps = list || [];
  if (!body.classList.contains('open')) return;
  renderPins();
  renderAll();
  if (q.value) search(q.value);
  else buildNav();
});
