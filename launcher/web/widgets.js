// Widgets of the home screen, Резонанс's own: glass cards in the palette's
// colours. Each takes whole cells of the page's grid (w × h). A widget on a page
// is a key "#kind:n"; what it shows is refreshed here (the minute, the battery,
// what's playing, the weather).

import { rez } from './bridge.js';
import * as apps from './apps.js';
import * as weather from './weather.js';
import { S, save } from './store.js';

// sizes (columns × rows): the first is the one a new widget gets; the long press offers the rest
export const KINDS = {
  clock: { sizes: ['4x2', '4x1', '2x2', '2x1'], name: 'Часы', sub: 'время, дата, заряд' },
  music: { sizes: ['4x1', '4x2', '2x2'], name: 'Сейчас играет', sub: 'обложка и кнопки' },
  weather: { sizes: ['2x2', '4x1', '2x1'], name: 'Погода', sub: 'там, где ты' },
  calendar: { sizes: ['2x2', '4x2'], name: 'Календарь', sub: 'месяц, сегодня' },
  analog: { sizes: ['2x2', '1x1'], name: 'Циферблат', sub: 'часы со стрелками' },
  battery: { sizes: ['2x1', '1x1', '2x2'], name: 'Заряд', sub: 'батарея телефона' },
};

export const isWidget = (key) => key && key[0] === '#';
export const kindOf = (key) => key.slice(1).split(':')[0];
export function sizeName(key) {
  const k = KINDS[kindOf(key)];
  if (!k) return '1x1';
  const s = (S.wsize || {})[key];
  return k.sizes.includes(s) ? s : k.sizes[0];
}
export function sizeOf(key) {
  const [w, h] = sizeName(key).split('x').map(Number);
  return { w, h };
}
// the cells it takes, and a class (s-WxH) by which style.css lays out what it shows
function place(el) {
  const { w, h } = sizeOf(el.dataset.key);
  el.style.gridColumn = 'span ' + w;
  el.style.gridRow = 'span ' + h;
  el.className = el.className.replace(/\bs-\d+x\d+\b/g, '').trim() + ` s-${w}x${h}`;
}
// a new size, chosen in the long press menu
export function resize(el, size) {
  save({ wsize: { ...(S.wsize || {}), [el.dataset.key]: size } });
  place(el);
}
export function newKey(kind, pages) {
  let n = 1;
  const all = new Set(pages.flat());
  while (all.has(`#${kind}:${n}`)) n++;
  return `#${kind}:${n}`;
}

const svg = (inner, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}">${inner}</svg>`;
const PLAY = '<path d="M8 5.8v12.4a.7.7 0 0 0 1.05.6l10-6.2a.7.7 0 0 0 0-1.2l-10-6.2A.7.7 0 0 0 8 5.8z"/>';
const PAUSE = '<path d="M8.5 6v12M15.5 6v12"/>';
const PREV = '<path d="M7 6v12M18 6.5v11a.6.6 0 0 1-.9.5L9.2 12.5a.6.6 0 0 1 0-1l7.9-5.5a.6.6 0 0 1 .9.5z"/>';
const NEXT = '<path d="M17 6v12M6 6.5v11a.6.6 0 0 0 .9.5l7.9-5.5a.6.6 0 0 0 0-1L6.9 6a.6.6 0 0 0-.9.5z"/>';

// ---------- making one ----------

export function make(key) {
  const kind = kindOf(key);
  const k = KINDS[kind];
  const el = document.createElement('div');
  el.className = `wd wd-${kind}`;
  el.dataset.key = key;
  place(el);
  const card = document.createElement('div');
  card.className = 'wcard' + (kind === 'clock' ? '' : ' glass');
  el.appendChild(card);
  BUILD[kind] && BUILD[kind](card);
  refresh(el);
  return el;
}

const BUILD = {
  clock(c) {
    c.innerHTML = `<b class="w-time">00:00</b><span class="w-date"><span class="w-day"></span><span class="w-batt"></span></span>`;
  },
  music(c) {
    c.innerHTML = `<img class="w-art" alt=""><div class="w-txt"><b class="w-title"></b><span class="w-artist"></span></div>
      <div class="w-ctl"><button class="np-b" data-a="prev" aria-label="Назад">${svg(PREV, 'fill')}</button><button class="np-b np-play" data-a="toggle" aria-label="Пауза">${svg(PAUSE, 'i-pause')}${svg(PLAY, 'i-play')}</button><button class="np-b" data-a="next" aria-label="Дальше">${svg(NEXT, 'fill')}</button></div>
      <i class="w-bar"><i></i></i>`;
  },
  weather(c) {
    c.innerHTML = `<span class="w-city"></span><div class="w-now"><b class="w-temp">—</b><i class="w-icon"></i></div><span class="w-words"></span><span class="w-range"></span>`;
  },
  calendar(c) {
    c.innerHTML = `<div class="w-month"></div><div class="w-days"></div>`;
  },
  analog(c) {
    let ticks = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r1 = i % 3 ? 41 : 37;
      ticks += `<line x1="${50 + Math.sin(a) * r1}" y1="${50 - Math.cos(a) * r1}" x2="${50 + Math.sin(a) * 45}" y2="${50 - Math.cos(a) * 45}" class="${i % 3 ? 'tk' : 'tk big'}"/>`;
    }
    c.innerHTML = `<svg viewBox="0 0 100 100" class="w-face"><defs><linearGradient id="wh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--a3)"/><stop offset="1" stop-color="var(--a1)"/></linearGradient></defs>${ticks}<line class="hh" x1="50" y1="50" x2="50" y2="28"/><line class="mh" x1="50" y1="50" x2="50" y2="15"/><circle cx="50" cy="50" r="3.4" class="pin"/></svg>`;
  },
  battery(c) {
    c.innerHTML = `<svg viewBox="0 0 44 44" class="w-ring"><circle cx="22" cy="22" r="18" class="bg"/><circle cx="22" cy="22" r="18" class="fg"/></svg><div class="w-btxt"><b class="w-level">—</b><span class="w-state"></span></div>`;
  },
};

// ---------- what they show ----------

const fmtDay = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtMonth = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
const two = (n) => String(n).padStart(2, '0');
let media = { active: false };
let mediaAt = 0;
let batt = {};

function refresh(el) {
  const kind = kindOf(el.dataset.key);
  const c = el.firstChild;
  const d = new Date();
  if (kind === 'clock') {
    c.querySelector('.w-time').textContent = two(d.getHours()) + ':' + two(d.getMinutes());
    c.querySelector('.w-day').textContent = fmtDay.format(d);
    const b = c.querySelector('.w-batt');
    b.textContent = batt.level >= 0 ? batt.level + '%' : '';
    b.classList.toggle('low', batt.level >= 0 && batt.level <= 15 && !batt.charging);
    b.classList.toggle('charging', !!batt.charging);
  } else if (kind === 'analog') {
    const m = d.getMinutes();
    const h = (d.getHours() % 12) + m / 60;
    c.querySelector('.hh').setAttribute('transform', `rotate(${h * 30} 50 50)`);
    c.querySelector('.mh').setAttribute('transform', `rotate(${m * 6} 50 50)`);
  } else if (kind === 'calendar') {
    const key = d.toDateString();
    if (c.dataset.day === key) return;
    c.dataset.day = key;
    c.querySelector('.w-month').textContent = fmtMonth.format(d);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const shift = (first.getDay() + 6) % 7; // Monday first
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    let html = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'].map((x, i) => `<i class="hd${i > 4 ? ' we' : ''}">${x}</i>`).join('');
    for (let i = 0; i < shift; i++) html += '<i></i>';
    for (let i = 1; i <= n; i++) {
      const wd = (shift + i - 1) % 7;
      html += `<i class="${i === d.getDate() ? 'today' : ''}${wd > 4 ? ' we' : ''}">${i}</i>`;
    }
    c.querySelector('.w-days').innerHTML = html;
  } else if (kind === 'battery') {
    const lv = batt.level >= 0 ? batt.level : 0;
    c.querySelector('.w-level').textContent = batt.level >= 0 ? lv + '%' : '—';
    c.querySelector('.w-state').textContent = batt.charging ? 'Заряжается' : lv <= 15 ? 'Пора зарядить' : 'Батарея';
    const fg = c.querySelector('.fg');
    const len = 2 * Math.PI * 18;
    fg.style.strokeDasharray = `${((len * lv) / 100).toFixed(1)} ${len.toFixed(1)}`;
    el.classList.toggle('charging', !!batt.charging);
    el.classList.toggle('low', lv <= 15 && !batt.charging);
  } else if (kind === 'music') {
    music(el);
  } else if (kind === 'weather') {
    paintWeather(el, weather.now());
  }
}

const all = (kind) => document.querySelectorAll(kind ? `.wd-${kind}` : '.wd');

// the minute, the battery: once a minute (and when the screen comes back)
let tickT = 0;
export function tick() {
  batt = rez.battery() || {};
  for (const el of all()) {
    const k = kindOf(el.dataset.key);
    if (k !== 'music' && k !== 'weather') refresh(el);
  }
  clearTimeout(tickT);
  tickT = setTimeout(tick, 60000 - (Date.now() % 60000) + 30);
}
export const stop = () => clearTimeout(tickT);

// ---------- what's playing ----------

let barT = 0;
export function setMedia(m) {
  media = m || { active: false };
  mediaAt = performance.now();
  for (const el of all('music')) music(el);
  bar();
}
export const mediaNow = () => media;
const showing = () => !!media.active && !!(media.title || media.artist);

function music(el) {
  const c = el.firstChild;
  const on = showing();
  el.classList.toggle('idle', !on);
  el.classList.toggle('paused', !media.playing);
  c.querySelector('.w-title').textContent = on ? media.title || media.appLabel || '' : 'Тишина';
  c.querySelector('.w-artist').textContent = on ? media.artist || media.appLabel || '' : 'Включи музыку — волны оживут';
  const art = c.querySelector('.w-art');
  const player = apps.get('app.rezonans.player') ? 'app.rezonans.player' : '';
  const src = on ? (media.art ? rez.artUrl(media.art) : rez.iconUrl(media.app)) : player ? rez.iconUrl(player) : '';
  if (art.dataset.src !== src) {
    art.dataset.src = src;
    if (src) art.src = src;
    else art.removeAttribute('src');
  }
  c.querySelector('.np-play').setAttribute('aria-label', media.playing ? 'Пауза' : 'Играть');
}
function bar() {
  clearTimeout(barT);
  const els = all('music');
  if (!els.length) return;
  const f = media.active && media.dur ? Math.max(0, Math.min(1, (media.pos + (media.playing ? performance.now() - mediaAt : 0)) / media.dur)) : 0;
  for (const el of els) el.querySelector('.w-bar i').style.transform = `scaleX(${f.toFixed(4)})`;
  if (media.playing && !document.hidden) barT = setTimeout(bar, 1000);
}

// a tap on a music widget's button
export function musicButton(btn) {
  rez.haptic('tick');
  const a = btn.dataset.a;
  if (a === 'toggle' && !showing()) {
    // nothing plays: Резонанс (the player) opens
    if (apps.get('app.rezonans.player')) rez.launch('app.rezonans.player');
    else rez.media('play');
    return;
  }
  rez.media(a);
  if (a === 'toggle') setMedia({ ...media, playing: !media.playing, pos: media.pos + (media.playing ? performance.now() - mediaAt : 0) });
}

// ---------- the weather ----------

function paintWeather(el, w) {
  const c = el.firstChild;
  el.classList.toggle('empty', !w);
  c.querySelector('.w-city').textContent = w ? w.city || '' : 'Погода';
  c.querySelector('.w-temp').textContent = w ? w.tempText : '—';
  c.querySelector('.w-icon').innerHTML = w ? w.svg : '';
  c.querySelector('.w-words').textContent = w ? w.words : weather.status().status === 'fail' ? 'нет связи' : 'узнаю…';
  c.querySelector('.w-range').textContent = w ? w.range : '';
}
let weatherOn = false;
export function weatherWatch() {
  const need = all('weather').length > 0;
  if (need && !weatherOn) {
    weatherOn = true;
    weather.start((w) => {
      for (const el of all('weather')) paintWeather(el, w);
    });
  } else if (!need && weatherOn) {
    weatherOn = false;
    weather.stop();
  }
}

// ---------- a tap on a widget ----------

const findApp = (re) => apps.all().find((a) => re.test(a.pkg));
export function tap(el, target) {
  const btn = target.closest('.np-b');
  if (btn) return musicButton(btn);
  const kind = kindOf(el.dataset.key);
  const open = (re) => {
    const a = findApp(re);
    if (a) {
      rez.haptic('tick');
      rez.launch(a.pkg, el.getBoundingClientRect());
    }
  };
  if (kind === 'clock') {
    if (target.closest('.w-date')) open(/calendar/);
    else open(/deskclock|\.clock$|clock/);
  } else if (kind === 'analog') open(/deskclock|\.clock$|clock/);
  else if (kind === 'calendar') open(/calendar/);
  else if (kind === 'weather') open(/weather/);
  else if (kind === 'music') {
    if (showing() && media.app) {
      rez.haptic('tick');
      rez.launch(media.app, el.getBoundingClientRect());
    } else if (apps.get('app.rezonans.player')) rez.launch('app.rezonans.player', el.getBoundingClientRect());
  }
}

// the waves follow the music
export const playing = () => showing() && !!media.playing;
