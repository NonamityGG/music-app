// Резонанс OS: the home screen — the clock and the weather, what's playing, and
// rows of apps that light up the room in their own colours when focused.

import { tv } from './tv.js';
import { S } from './store.js';
import * as apps from './apps.js';
import * as nav from './nav.js';
import * as look from './look.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const home = $('home');
const stage = $('stage');
const rowsEl = $('rows');
const npEl = $('np');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- clock, date, weather ----------

const DAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const two = (n) => String(n).padStart(2, '0');
let weather = null;

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h >= 5 && h < 12 ? 'Доброе утро' : h >= 12 && h < 17 ? 'Добрый день' : h >= 17 && h < 23 ? 'Добрый вечер' : 'Доброй ночи';
}

export const dateText = (d = new Date()) => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;

let clockTimer = 0;
export function tick() {
  clearTimeout(clockTimer);
  const d = new Date();
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  $('timeTop').textContent = hm;
  const clock = $('clock');
  clock.textContent = hm;
  if (S.clockSec) clock.appendChild(el('small', '', two(d.getSeconds())));
  $('greet').textContent = greeting(d);
  const date = $('date');
  date.textContent = '';
  date.appendChild(el('b', '', dateText(d)));
  if (S.weather !== false && weather) date.appendChild(document.createTextNode(` · ${weather.tempText}, ${weather.words}${weather.range ? ' · днём ' + weather.range : ''}`));
  clockTimer = setTimeout(tick, S.clockSec ? 1000 - d.getMilliseconds() + 5 : 60000 - d.getSeconds() * 1000 - d.getMilliseconds() + 20);
}

export function setWeather(w) {
  weather = w;
  const box = $('wxTop');
  box.innerHTML = '';
  if (S.weather !== false && w) {
    box.innerHTML = w.svg;
    box.appendChild(el('b', '', w.tempText));
    if (w.city) box.title = w.city;
  }
  tick();
}

export function setNet(kind) {
  const box = $('net');
  box.innerHTML = '';
  box.appendChild(icon(kind === 'wifi' ? 'wifi' : kind === 'eth' ? 'eth' : kind === 'none' ? 'nonet' : 'wifi'));
}

// ---------- rows ----------

function pic(app) {
  const p = el('div', 'pic');
  if (app.banner) {
    p.style.backgroundImage = `url("${tv.iconUrl(app.pkg, true)}")`;
  } else {
    p.classList.add('tile');
    const img = new Image();
    img.src = tv.iconUrl(app.pkg, false);
    img.alt = '';
    p.appendChild(img);
    p.appendChild(el('span', 'nm', app.label));
    apps.colorOf(app).then((c) => {
      if (!c) return;
      p.style.setProperty('--c1', apps.rgba(c, 1));
      p.style.setProperty('--c2', apps.rgba(apps.shade(c, 0.32), 1));
    });
  }
  p.appendChild(el('i', 'shine'));
  return p;
}

export function appCard(app) {
  const c = el('div', 'card f');
  c.appendChild(pic(app));
  if (apps.isNew(app)) c.appendChild(el('span', 'badge', 'Новое'));
  c.appendChild(el('div', 'cap', app.label));
  c._app = app;
  return c;
}

function toolCard(id, name, sub, iconName) {
  const c = el('div', 'card f');
  const p = el('div', 'pic tool');
  p.appendChild(icon(iconName));
  const nm = el('span', 'nm', name);
  if (sub) nm.appendChild(el('span', 'sub', sub));
  p.appendChild(nm);
  p.appendChild(el('i', 'shine'));
  c.appendChild(p);
  c._tool = id;
  return c;
}

function row(id, title, big) {
  const r = el('section', 'row' + (big ? ' big' : ''));
  r.setAttribute('data-row', id);
  r.appendChild(el('h2', '', title));
  const t = el('div', 'track');
  r.appendChild(t);
  r._track = t;
  return r;
}

let stockLabel = '';
export function setStock(label) {
  stockLabel = label || '';
}

export function render(keep) {
  const focusedPkg = keep && nav.current() && nav.current()._app ? nav.current()._app.pkg : null;
  const focusedTool = keep && nav.current() && nav.current()._tool;
  const focusedRow = keep && nav.current() && nav.current().closest('[data-row]');
  const rowId = focusedRow ? focusedRow.getAttribute('data-row') : null;
  rowsEl.textContent = '';

  const favs = apps.favourites();
  const r1 = row('favs', 'Избранное', true);
  for (const a of favs) r1._track.appendChild(appCard(a));
  if (!favs.length) r1._track.appendChild(toolCard('allApps', 'Добавь любимое', 'Удерживай OK на приложении', 'star'));
  rowsEl.appendChild(r1);

  const rest = apps.others();
  if (rest.length) {
    const r2 = row('apps', 'Приложения');
    for (const a of rest) r2._track.appendChild(appCard(a));
    rowsEl.appendChild(r2);
  }

  if (S.tools !== false) {
    const r3 = row('tools', 'Резонанс OS');
    r3._track.appendChild(toolCard('allApps', 'Все приложения', `${apps.everything().length} шт.`, 'grid'));
    r3._track.appendChild(toolCard('saver', 'Заставка', 'Часы и волны', 'moon'));
    r3._track.appendChild(toolCard('settings', 'Настройки', 'Вид, заставка, «Домой»', 'gear'));
    r3._track.appendChild(toolCard('tvSettings', 'Настройки ТВ', 'Сеть, экран, звук', 'sliders'));
    if (stockLabel) r3._track.appendChild(toolCard('stock', 'Экран Сбера', 'На 5 минут', 'home'));
    rowsEl.appendChild(r3);
  }

  // put the focus back where it was
  let target = null;
  if (focusedPkg) target = Array.prototype.find.call(rowsEl.querySelectorAll('.card'), (c) => c._app && c._app.pkg === focusedPkg && (!rowId || c.closest('[data-row]').getAttribute('data-row') === rowId));
  if (!target && focusedTool) target = Array.prototype.find.call(rowsEl.querySelectorAll('.card'), (c) => c._tool === focusedTool);
  if (keep && nav.current() && npEl.contains(nav.current())) target = nav.current();
  if (nav.getScope() === home) nav.focus(target || rowsEl.querySelector('.card'), { silent: true });
}

// ---------- what's playing ----------

let np = { active: false };
let npAt = 0;
let npParts = null;

export function setMedia(m) {
  np = m || { active: false };
  npAt = performance.now();
  paintMedia();
}

export const media = () => np;

export function position() {
  if (!np.active) return 0;
  const extra = np.playing ? performance.now() - npAt : 0;
  return np.dur > 0 ? Math.min(np.dur, np.pos + extra) : np.pos + extra;
}

function buildMedia() {
  npEl.textContent = '';
  const aura = el('i', 'np-aura');
  const cover = el('div', 'np-cover f');
  cover._tool = 'npOpen';
  const meta = el('div', 'np-meta');
  const app = el('div', 'np-app');
  app.appendChild(el('i'));
  const appName = el('span');
  app.appendChild(appName);
  const title = el('div', 'np-title');
  const artist = el('div', 'np-artist');
  const bar = el('div', 'np-bar');
  const tPos = el('span', '', '0:00');
  const line = el('div', 'np-line');
  const fill = el('i');
  line.appendChild(fill);
  const tDur = el('span', '', '0:00');
  bar.append(tPos, line, tDur);
  const ctl = el('div', 'np-ctl');
  const prev = el('div', 'rb f');
  prev.appendChild(icon('prev'));
  prev._tool = 'npPrev';
  const play = el('div', 'rb f');
  play._tool = 'npToggle';
  const next = el('div', 'rb f');
  next.appendChild(icon('next'));
  next._tool = 'npNext';
  ctl.append(prev, play, next);
  meta.append(app, title, artist, bar, ctl);
  npEl.append(aura, cover, meta);
  npParts = { cover, appName, title, artist, fill, tPos, tDur, play, prev, next, aura, art: -1 };
}

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
};

function paintMedia() {
  const show = S.np !== false && np.active;
  npEl.classList.toggle('hidden', !show);
  if (!show) {
    if (nav.current() && npEl.contains(nav.current())) nav.focus(rowsEl.querySelector('.card'));
    return;
  }
  if (!npParts) buildMedia();
  const p = npParts;
  p.appName.textContent = np.appLabel || 'Сейчас играет';
  p.title.textContent = np.title || 'Без названия';
  p.artist.textContent = np.artist || '';
  if (np.art !== p.art) {
    p.art = np.art;
    const url = np.art ? tv.artUrl(np.art) : '';
    p.cover.style.backgroundImage = url ? `url("${url}")` : '';
    if (url) {
      apps.imageColor(url).then((c) => {
        if (c) p.aura.parentNode.style.setProperty('--npc', apps.rgba(c, 0.5));
      });
      look.coverPalette(url);
    }
  }
  const pi = np.playing ? 'pause' : 'play';
  if (p.play._icon !== pi) {
    p.play._icon = pi;
    p.play.textContent = '';
    p.play.appendChild(icon(pi));
  }
  p.prev.classList.toggle('off', np.canPrev === false);
  p.next.classList.toggle('off', np.canNext === false);
  paintProgress();
}

export function paintProgress() {
  if (!npParts || !np.active) return;
  const pos = position();
  npParts.tPos.textContent = fmt(pos);
  npParts.tDur.textContent = np.dur > 0 ? fmt(np.dur) : '—';
  npParts.fill.style.transform = `scaleX(${np.dur > 0 ? Math.min(1, pos / np.dur).toFixed(4) : 0})`;
}
setInterval(() => {
  if (np.active && np.playing) paintProgress();
}, 500);

// ---------- focus: rows slide, the page scrolls, the room takes the colour ----------

nav.onFocus((elx) => {
  if (!home.contains(elx)) return;
  nav.intoView(elx);
  const r = elx.closest('[data-row]');
  for (const x of rowsEl.querySelectorAll('.row')) x.classList.toggle('on', x === r);
  const rows = Array.prototype.slice.call(rowsEl.querySelectorAll('.row'));
  const idx = rows.indexOf(r);
  rows.forEach((x, i) => x.classList.toggle('past', idx >= 1 && i < idx));
  document.body.classList.toggle('rows-down', idx >= 1);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  if (idx >= 1) {
    const y = rowsEl.offsetTop + r.offsetTop - 17 * rem;
    stage.style.transform = `translate3d(0,${-y}px,0)`;
    home.classList.add('scrolled');
  } else {
    stage.style.transform = 'translate3d(0,0,0)';
    home.classList.remove('scrolled');
  }
  if (elx._app) {
    apps.colorOf(elx._app).then((c) => {
      if (nav.current() !== elx) return;
      look.tint(c ? apps.rgba(c, 0.42) : null);
      elx.style.setProperty('--glow', c ? apps.rgba(c, 0.6) : '');
    });
  } else if (npEl.contains(elx)) {
    look.tint(npEl.style.getPropertyValue('--npc') || null);
  } else look.tint(null);
});

export function toTop() {
  const first = rowsEl.querySelector('.card');
  for (const r of rowsEl.querySelectorAll('[data-row]')) {
    r._last = null;
    if (r._track) {
      r._track._x = 0;
      r._track.style.transform = 'translate3d(0,0,0)';
    }
  }
  if (first) nav.focus(first);
}
