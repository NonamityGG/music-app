// Резонанс для ПК — the island player. The window is transparent and lets the
// mouse through; mouse moves are still forwarded here, so the page notices when
// the pointer reaches the pill and only then takes the mouse (to click).

import { icon } from '../../src/util.js';
import * as graph from './graph.js';
import { BANDS } from './graph.js';
import * as listen from './listen.js';
import { $, appName, fmt, mediaState } from './common.js';
import { coverColors } from './looks.js';

const isl = $('isl');
const cv = $('cv');
const cvImg = $('cvImg');
const miniTitle = $('miniTitle');
const titleEl = $('title');
const artistEl = $('artist');
const appEl = $('app');
const track = $('track');
const tPos = $('tPos');
const tDur = $('tDur');
const playBtn = $('play');
const prevBtn = $('prev');
const nextBtn = $('next');

prevBtn.append(icon('prev', 22));
nextBtn.append(icon('next', 22));
playBtn.append(icon('play', 24));

let settings = {};
let dragP = -1; // where the progress line is being dragged to (0..1), -1 when not

function applySettings(s) {
  if (!s) return;
  settings = s;
  document.body.classList.toggle('nobar', !s.bar);
  document.body.classList.toggle('noglow', s.islandGlow === false);
  measure();
}
window.rez.settings().then(applySettings);
window.rez.onSettings(applySettings);

// ---------- what's playing ----------

let shownKey = '';
const media = mediaState(onMedia);

function setIcon(btn, name, size) {
  if (btn._icon === name) return;
  btn._icon = name;
  btn.replaceChildren(icon(name, size));
}

function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function onMedia(st, fromWindows) {
  const active = media.active();
  isl.classList.toggle('idle', !active);
  isl.classList.toggle('playing', media.playing());
  if (!active) {
    shownKey = '';
    titleEl.textContent = 'Ничего не играет';
    artistEl.textContent = 'Включи музыку в любом плеере — она появится здесь';
    appEl.textContent = 'Резонанс';
    miniTitle.textContent = '';
    cvImg.style.backgroundImage = '';
    measure();
    loop();
    return;
  }
  const key = media.key();
  if (key !== shownKey) {
    const first = shownKey === '';
    shownKey = key;
    titleEl.textContent = st.title || 'Без названия';
    artistEl.textContent = st.artist || '';
    miniTitle.textContent = st.title || st.artist || '';
    appEl.textContent = appName(st.app);
    measure();
    if (!first) replay(cv, 'swap');
    if (fromWindows && !first) peek();
  }
  if (st._thumbChanged || cvImg._src !== st.thumb) {
    cvImg._src = st.thumb;
    cvImg.style.backgroundImage = st.thumb ? `url("${st.thumb}")` : '';
    tint(st.thumb);
  }
  setIcon(playBtn, media.playing() ? 'pause' : 'play', 24);
  prevBtn.disabled = !st.canPrev;
  nextBtn.disabled = !st.canNext;
  isl.classList.toggle('nodur', !(st.dur > 0));
  paintProgress();
  loop();
}

// the island takes the colours of the cover
async function tint(src) {
  const c = await coverColors(src);
  const acc = c ? c[0] : '#8b5cff';
  const acc2 = c ? c[2] : '#ff6fd8';
  document.body.style.setProperty('--acc', acc);
  document.body.style.setProperty('--acc2', acc2);
}

// the pill is as wide as its title (within limits)
const probe = document.createElement('span');
probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font:600 12.5px 'Onest',sans-serif;letter-spacing:.005em";
document.body.appendChild(probe);
function measure() {
  const ch = settings.bar === false ? 32 : 28;
  let w;
  if (!media.active()) w = 58;
  else {
    probe.textContent = miniTitle.textContent;
    const tw = Math.min(210, Math.max(60, probe.getBoundingClientRect().width));
    w = Math.round(ch + 4 + tw + 10 + 14 + 14 + 8);
  }
  document.body.style.setProperty('--cw', `${w}px`);
}
document.fonts && document.fonts.ready.then(measure);

function paintProgress() {
  const st = media.st;
  const pos = media.position();
  const p = st.dur > 0 ? Math.max(0, Math.min(1, (dragP >= 0 ? dragP * st.dur : pos) / st.dur)) : 0;
  isl.style.setProperty('--p', p.toFixed(4));
  tPos.textContent = fmt(dragP >= 0 ? dragP * st.dur : pos);
  tDur.textContent = st.dur > 0 ? fmt(st.dur) : '—';
}
setInterval(() => {
  if (media.playing()) paintProgress();
}, 250);

// ---------- open and close ----------

let over = false;
let openTimer = 0;
let closeTimer = 0;
let peekTimer = 0;
let forced = false;
let dragging = false;

function setOpen(v) {
  isl.classList.toggle('open', v);
}

function setOver(v) {
  if (v === over) return;
  over = v;
  window.rez.islandMouse(v);
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (v) {
    clearTimeout(peekTimer);
    isl.classList.add('hot');
    // a short pause, so passing by with the mouse doesn't throw the card open
    openTimer = setTimeout(() => setOpen(true), 110);
  } else {
    closeTimer = setTimeout(() => {
      isl.classList.remove('hot');
      if (!forced) setOpen(false);
    }, 420);
  }
}

function inside(x, y) {
  const r = isl.getBoundingClientRect();
  return x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
}

document.addEventListener('mousemove', (e) => {
  if (dragging) return;
  setOver(inside(e.clientX, e.clientY));
});
document.addEventListener('mouseleave', () => {
  if (!dragging) setOver(false);
});

// a new song: show it for a moment
function peek() {
  if (settings.islandPeek === false || over || forced) return;
  setOpen(true);
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (!over && !forced) setOpen(false);
  }, 3400);
}

window.rez.onIsland((m) => {
  if (!m) return;
  if ('force' in m) {
    forced = !!m.force;
    setOpen(forced || over);
  }
});

// ---------- buttons and seeking ----------

playBtn.addEventListener('click', () => {
  window.rez.media('toggle');
  media.setLocal({ status: media.playing() ? 'paused' : 'playing' });
});
prevBtn.addEventListener('click', () => window.rez.media('prev'));
nextBtn.addEventListener('click', () => window.rez.media('next'));
isl.addEventListener('click', (e) => {
  // a click on the small pill opens it at once
  if (!isl.classList.contains('open') && !e.target.closest('button')) setOpen(true);
});

function fracAt(e) {
  const r = track.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}
track.addEventListener('pointerdown', (e) => {
  if (!(media.st.dur > 0)) return;
  dragging = true;
  track.setPointerCapture(e.pointerId);
  track.classList.add('drag');
  dragP = fracAt(e);
  paintProgress();
});
track.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  dragP = fracAt(e);
  paintProgress();
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false;
  track.classList.remove('drag');
  const f = dragP;
  dragP = -1;
  if (f >= 0 && media.st.dur > 0) {
    window.rez.media('seek', f * media.st.dur);
    media.setLocal({ pos: f * media.st.dur });
  }
  paintProgress();
  if (e && !inside(e.clientX, e.clientY)) setOver(false);
};
track.addEventListener('pointerup', endDrag);
track.addEventListener('pointercancel', endDrag);

// ---------- the equalizers move with the sound ----------

const small = [...document.querySelectorAll('#eq i')];
const big = [...document.querySelectorAll('#eq2 i')];
const bands = new Float32Array(BANDS);
const wave = new Float32Array(256);
const lv = new Float32Array(5);
const REST = [0.35, 0.6, 0.45, 0.3, 0.5];
const GROUPS = [
  [0, 5],
  [5, 14],
  [14, 26],
  [26, 40],
  [40, 60],
];
let raf = 0;
let last = 0;

function loop() {
  if (!raf && media.playing()) raf = requestAnimationFrame(frame);
  if (!media.playing()) rest();
}

function rest() {
  small.forEach((el, i) => el.style.setProperty('--h', (REST[i] * 0.6).toFixed(3)));
  big.forEach((el, i) => el.style.setProperty('--h', (REST[i] * 0.5).toFixed(3)));
}

function frame(t) {
  raf = 0;
  if (!media.playing()) return rest();
  raf = requestAnimationFrame(frame);
  if (t - last < 33) return;
  last = t;
  let loud = false;
  if (listen.heard()) {
    const r = graph.read(bands, wave);
    if (r.ok) {
      GROUPS.forEach(([a, b], i) => {
        let v = 0;
        for (let k = a; k < b; k++) v = Math.max(v, bands[k]);
        lv[i] += (v - lv[i]) * (v > lv[i] ? 0.65 : 0.2);
        if (v > 0.04) loud = true;
      });
    }
  }
  if (!loud) {
    // no sound to hear (or not yet): a calm made-up bounce
    const s = t / 1000;
    for (let i = 0; i < 5; i++) lv[i] = 0.35 + 0.3 * Math.abs(Math.sin(s * (2.1 + i * 0.7) + i));
  }
  small.forEach((el, i) => el.style.setProperty('--h', (0.22 + 0.78 * Math.min(1, lv[i] * 1.1)).toFixed(3)));
  big.forEach((el, i) => el.style.setProperty('--h', (0.18 + 0.82 * Math.min(1, lv[i] * 1.1)).toFixed(3)));
}

listen.start({ name: 'остров', playing: () => media.playing() });
measure();
rest();
