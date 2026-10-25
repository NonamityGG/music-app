// Резонанс для ПК — the top bar: logo (menu), what's playing with its controls,
// date and time. The playing info comes from Windows' media controls through the
// helper, so it works with any player: Yandex Music, Spotify, a browser…

import { icon } from '../../src/util.js';
import * as graph from './graph.js';
import { BANDS } from './graph.js';
import * as listen from './listen.js';
import { coverColors } from './looks.js';

const $ = (id) => document.getElementById(id);
const player = $('player');
const cover = $('cover');
const meta = $('meta');
const titleEl = $('title');
const artistEl = $('artist');
const prog = $('progFill');
const playBtn = $('play');
const prevBtn = $('prev');
const nextBtn = $('next');

prevBtn.append(icon('prev', 16));
nextBtn.append(icon('next', 16));
playBtn.append(icon('play', 16));

// ---------- settings ----------

let settings = {};
let coverCols = null;

function apply(s) {
  if (!s) return;
  settings = s;
  const b = document.body;
  b.dataset.bg = s.bg || 'glass-violet';
  b.style.setProperty('--tint-a', String(s.barTint ?? 0.42));
  b.classList.toggle('island', !!s.island);
  b.classList.toggle('nodate', s.barDate === false);
  paintColors();
  tick();
}
window.rez.settings().then(apply);
window.rez.onSettings(apply);

function paintColors() {
  const c = settings.palette === 'cover' && coverCols ? coverCols : settings.paletteColors || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  c.forEach((v, i) => document.body.style.setProperty(`--c${i + 1}`, v));
}

$('brand').addEventListener('click', () => window.rez.panel('toggle'));

// ---------- what's playing ----------

let media = { status: 'none' };
let shownKey = '';
let thumb = '';
let posAt = 0; // when pos was reported (performance.now())

function setIcon(btn, name) {
  if (btn._icon === name) return;
  btn._icon = name;
  btn.replaceChildren(icon(name, 16));
}

function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

window.rez.onMedia((m) => {
  media = m.status === 'none' ? { status: 'none' } : { ...media, ...m };
  if (m.thumb !== undefined && m.thumb !== thumb) {
    thumb = m.thumb || '';
    coverColors(thumb).then((c) => {
      coverCols = c;
      paintColors();
    });
  }
  posAt = performance.now();
  paint();
});

function paint() {
  const active = media.status && media.status !== 'none' && (media.title || media.artist);
  player.classList.toggle('idle', !active);
  if (!active) {
    if (shownKey !== '') {
      shownKey = '';
      titleEl.textContent = 'Ничего не играет';
      artistEl.textContent = '';
      cover.style.backgroundImage = '';
      replay(meta, 'swap');
    }
    setIcon(playBtn, 'play');
    playBtn.disabled = true;
    prevBtn.disabled = nextBtn.disabled = true;
    player.title = 'Включи музыку в любом плеере — она появится здесь';
    return;
  }
  const key = `${media.app}|${media.title}|${media.artist}`;
  if (key !== shownKey) {
    const first = shownKey === '';
    shownKey = key;
    titleEl.textContent = media.title || 'Без названия';
    artistEl.textContent = media.artist || '';
    replay(meta, 'swap');
    if (!first || thumb) replay(cover, 'swap');
  }
  cover.style.backgroundImage = thumb ? `url("${thumb}")` : '';
  player.title = [media.title, media.artist, media.album].filter(Boolean).join(' — ');
  setIcon(playBtn, media.status === 'playing' ? 'pause' : 'play');
  playBtn.disabled = false;
  prevBtn.disabled = !media.canPrev;
  nextBtn.disabled = !media.canNext;
  player.classList.toggle('nodur', !(media.dur > 0));
  paintProgress();
}

function position() {
  if (!(media.dur > 0)) return 0;
  const extra = media.status === 'playing' ? performance.now() - posAt : 0;
  return Math.min(media.dur, (media.pos || 0) + extra);
}

function paintProgress() {
  prog.style.setProperty('--p', media.dur > 0 ? (position() / media.dur).toFixed(4) : '0');
}
setInterval(() => {
  if (media.status === 'playing') paintProgress();
}, 250);

playBtn.addEventListener('click', () => {
  window.rez.media('toggle');
  // feels instant; the real state follows from Windows
  media.status = media.status === 'playing' ? 'paused' : 'playing';
  media.pos = position();
  posAt = performance.now();
  paint();
});
prevBtn.addEventListener('click', () => window.rez.media('prev'));
nextBtn.addEventListener('click', () => window.rez.media('next'));
$('prog').parentElement.addEventListener('click', (e) => {
  if (!(media.dur > 0) || e.target.closest('button')) return;
  const r = $('prog').getBoundingClientRect();
  if (e.clientY < r.top - 6) return; // only the lower edge of the capsule seeks
  const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  window.rez.media('seek', f * media.dur);
  media.pos = f * media.dur;
  posAt = performance.now();
  paintProgress();
});

// ---------- clock ----------

let clockTimer = 0;
function tick() {
  clearTimeout(clockTimer);
  const d = new Date();
  const sec = !!settings.barSeconds;
  $('date').textContent = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
  $('time').textContent = d.toLocaleTimeString('ru-RU', sec ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  clockTimer = setTimeout(tick, sec ? 1010 - d.getMilliseconds() : 60500 - d.getSeconds() * 1000 - d.getMilliseconds());
}
tick();

// ---------- the logo moves with the sound ----------

const bars = [...document.querySelectorAll('#mark i')];
const REST = [0.42, 1, 0.66, 0.32];
const bands = new Float32Array(BANDS);
const wave = new Float32Array(256);
const level = [0, 0, 0, 0];
let last = 0;

function frame(t) {
  requestAnimationFrame(frame);
  if (t - last < 33) return; // 30 fps is plenty for four little bars
  last = t;
  let loud = false;
  if (listen.heard() && settings.barMark !== false) {
    const r = graph.read(bands, wave);
    if (r.ok) {
      const groups = [
        [0, 6],
        [6, 18],
        [18, 36],
        [36, 60],
      ];
      groups.forEach(([a, b], i) => {
        let v = 0;
        for (let k = a; k < b; k++) v = Math.max(v, bands[k]);
        level[i] += (v - level[i]) * (v > level[i] ? 0.6 : 0.18);
        if (v > 0.05) loud = true;
      });
    }
  }
  bars.forEach((el, i) => {
    const h = loud ? 0.25 + 0.75 * Math.min(1, level[i] * 1.15) : REST[i];
    el.style.setProperty('--h', h.toFixed(3));
  });
}
requestAnimationFrame(frame);

listen.start({ name: 'строка', playing: () => media.status === 'playing' });

paint();
