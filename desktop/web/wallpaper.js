// Резонанс для ПК — the live wallpaper. The phone app's waves (src/waves.js, with
// the PC's own looks from looks.js) fed with the sound of the whole PC; big soft
// words behind them; everything rests while a window covers the screen.

import * as waves from '../../src/waves.js';
import * as graph from './graph.js';
import * as listen from './listen.js';
import * as looks from './looks.js';
import { $, mediaState } from './common.js';

looks.install();

const canvas = $('waves');
const photo = $('photo');
const words = $('words');
const body = document.body;
let resting = false;
let settings = null;
let coverCols = null;

// ---------- what's playing ----------

const media = mediaState(onMedia);
let lyr = null; // { key, synced, lines } for the current song

function onMedia(st) {
  body.classList.toggle('paused-music', st.status === 'paused');
  if (st._thumbChanged) {
    st._thumbChanged = false;
    looks.coverColors(st.thumb).then((c) => {
      coverCols = c;
      paintColors();
    });
  }
  if (media.playing()) waves.kick();
  text();
}

window.rez.onLyrics((d) => {
  lyr = d;
  text();
});

// ---------- the waves ----------

waves.setSource({
  // draw while music plays, or while some other sound is heard
  playing: () => !resting && (media.playing() || (listen.heard() && graph.silentMs() < 4000)),
  analysing: () => listen.heard(),
  onSilence: () => {},
});
waves.addSurface('bg', canvas, {
  dpr: 1,
  center: () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = settings || {};
    return { x: w / 2, y: h * (s.wavePos ?? 0.5), amp: Math.min(w, h) * 0.27 * (s.waveSize ?? 1), r: 0 };
  },
});

// a sound from something that doesn't report itself (a game): wake up for it
setInterval(() => {
  if (resting || !listen.heard() || media.playing()) return;
  const r = graph.read(new Float32Array(graph.BANDS), new Float32Array(graph.WAVE));
  if (r.ok && !r.silent) waves.kick();
}, 2500);

// ---------- settings ----------

function apply(s) {
  if (!s) return;
  const prevBg = settings && settings.bgUrl;
  settings = s;
  body.dataset.bg = s.bg || 'glass-violet';
  body.classList.toggle('still', s.clouds === false);
  body.classList.toggle('novignette', s.vignette === false);
  body.classList.toggle('text-top', s.textPos === 'top');
  body.classList.remove('ts-soft', 'ts-outline', 'ts-glass', 'font-display', 'font-body', 'font-thin');
  body.classList.add('ts-' + (s.textStyle || 'soft'), 'font-' + (s.textFont || 'display'));
  body.style.setProperty('--dim', String(s.bgDim ?? 0.35));
  body.style.setProperty('--blur', `${s.bgBlur || 0}px`);
  body.style.setProperty('--blur-k', String((s.bgBlur || 0) / 500));
  body.style.setProperty('--wb', String(s.waveBright ?? 0.92));
  words.style.setProperty('--ts', String(s.textSize ?? 1));
  words.style.setProperty('--to', String(s.textOpacity ?? 0.55));
  if (s.bgUrl !== prevBg) loadPhoto(s.bgUrl);
  paintColors();
  waves.configure({ style: s.style || 'neon', palette: s.palette || 'violet', light: false, maxFps: s.fps || 60 });
  waves.burst(1500);
  waves.kick();
  curKey = '\u0000'; // the look may have changed: draw the words again
  text();
}

function paintColors() {
  if (!settings) return;
  const c = settings.palette === 'cover' && coverCols ? coverCols : settings.paletteColors || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  if (settings.palette === 'cover') {
    looks.setCoverColors(coverCols || settings.paletteColors);
    waves.configure({ palette: 'cover' });
  }
  c.forEach((v, i) => body.style.setProperty(`--c${i + 1}`, v));
}

function loadPhoto(url) {
  photo.classList.remove('ready');
  if (!url) {
    photo.style.backgroundImage = '';
    return;
  }
  const img = new Image();
  img.onload = () => {
    photo.style.backgroundImage = `url("${url}")`;
    photo.classList.add('ready');
  };
  img.onerror = () => window.rez.log('обои: картинка не открылась');
  img.src = url;
}

window.rez.settings().then(apply);
window.rez.onSettings(apply);
window.rez.onPause((p) => {
  resting = !!p;
  body.classList.toggle('resting', resting);
  waves.kick();
});

// ---------- the words behind the waves ----------

let curKey = '';
let cur = null;
const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';

function show(key, main, sub, cls) {
  if (key === curKey) return;
  curKey = key;
  const old = cur;
  cur = null;
  if (old) {
    const a = old.animate(
      [
        { opacity: 1, transform: 'none', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translateY(-0.5em) scale(0.97)', filter: 'blur(16px)' },
      ],
      { duration: 650, easing: EASE, fill: 'forwards' }
    );
    a.onfinish = () => old.remove();
  }
  if (!main) return;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.style.gridArea = '1 / 1';
  const el = document.createElement('div');
  el.className = 'w ' + (cls || '');
  el.textContent = main;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    el.appendChild(s);
  }
  wrap.appendChild(el);
  words.appendChild(wrap);
  wrap.animate(
    [
      { opacity: 0, transform: 'translateY(0.6em) scale(1.03)', filter: 'blur(18px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0px)' },
    ],
    { duration: 900, delay: old ? 140 : 0, easing: EASE, fill: 'backwards' }
  );
  cur = wrap;
  // a burst of old lines (fast seeking) shouldn't pile up
  while (words.children.length > 3) words.firstElementChild.remove();
}

function trackWords() {
  const st = media.st;
  show('t|' + media.key(), st.title || st.artist || '', st.title && st.artist ? st.artist : '', 'track');
}

function lineAt(lines, sec) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= sec) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function text() {
  if (!settings) return;
  const mode = settings.text || 'off';
  if (mode === 'off') return show('', '');
  if (mode === 'custom') return show('c|' + settings.textCustom, settings.textCustom || '', '', 'custom');
  if (mode === 'clock') {
    const d = new Date();
    const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const day = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    return show('k|' + t + day, t, day, 'clock');
  }
  if (!media.active()) return show('', '');
  if (mode === 'track') return trackWords();
  // lyrics: the line being sung, the title before the first one and when there are none
  const key = media.key();
  const ok = lyr && lyr.key === key && lyr.synced && lyr.lines && lyr.lines.length;
  if (!ok) return trackWords();
  const sec = (media.position() + 250) / 1000 + (settings.textShift || 0);
  const i = lineAt(lyr.lines, sec);
  if (i < 0) return trackWords();
  const line = lyr.lines[i].text;
  // an instrumental bit: the words step aside
  if (!line) return show('g|' + i, '');
  show('l|' + key + '|' + i, line, '', 'lyric');
}

setInterval(() => {
  if (resting || !settings) return;
  if (settings.text === 'lyrics' && media.playing()) text();
  else if (settings.text === 'clock') text();
}, 120);

// ---------- the sound ----------

listen.start({
  name: 'обои',
  playing: () => media.playing(),
  resting: () => resting,
  onChange: () => waves.kick(),
});

waves.kick();
