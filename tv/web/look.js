// Резонанс OS: how it looks — the background, the palette's colours on
// everything, the waves (the phone and PC apps' own waves, with the PC's
// capsules, horizon and orb), and the light from the focused app.

import * as waves from '../../src/waves.js';
import * as looks from '../../desktop/web/looks.js';
import * as graph from './graph.js';
import { S } from './store.js';
import { tv } from './tv.js';

// a box with little memory gets the light effects unless chosen otherwise
let weakBox = null;
export function weak() {
  if (weakBox === null) {
    const i = tv.info() || {};
    weakBox = !!(i.lowRam || (i.ram && i.ram < 2600));
  }
  return weakBox;
}
export const eco = () => S.fx === 'eco' || (S.fx !== 'max' && weak());

looks.install();

export const PALETTES = waves.PALETTES;
export const STYLES = [{ id: 'off', name: 'Выключены' }].concat(waves.STYLES);
export const BACKGROUNDS = [
  ['glass-violet', 'Liquid Glass фиолетовый'],
  ['glass-black', 'Liquid Glass чёрный'],
  ['aurora', 'Северное сияние'],
  ['ember', 'Угли'],
  ['dark', 'Тёмный'],
  ['amoled', 'Чёрный AMOLED'],
];

const body = document.body;
const canvas = document.getElementById('waves');
let state = { visible: true, music: false, saver: false };
let place = { y: 0.5, amp: 0.22 };

export function setWaveState(patch) {
  Object.assign(state, patch);
  document.body.classList.toggle('quiet', !state.music && !state.saver);
  waves.kick();
}

export function setWavePlace(p) {
  place = p;
  waves.burst(1500);
  waves.kick();
}

waves.setSource({
  playing: () => state.visible && (state.music || state.saver),
  analysing: () => S.hear && graph.fresh(),
  onSilence: () => {},
});

// a big TV screen at full sharpness costs more than it shows: about 1100 px wide
waves.addSurface('bg', canvas, {
  dpr: Math.min(1, (eco() ? 900 : 1100) / Math.max(1, window.innerWidth)),
  center: () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const amp = Math.min(w, h) * place.amp;
    // place.box: [from, width] as parts of the screen width (the waves keep to it)
    if (place.box) return { x: w * (place.box[0] + place.box[1] / 2), y: h * place.y, amp, r: 0, box: { x: w * place.box[0], w: w * place.box[1] } };
    return { x: w / 2, y: h * place.y, amp, r: 0 };
  },
});

function hexRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function paletteColors(id) {
  const p = PALETTES.find((x) => x.id === id) || PALETTES[0];
  return p.colors;
}

export function apply() {
  body.className = body.className.replace(/\bbg-[\w-]+/g, '').trim();
  body.classList.add('bg-' + (S.bg || 'glass-violet'));
  // room for TVs that cut the edges of the picture
  const k = 1 - (Number(S.inset) || 0) / 50;
  document.documentElement.style.transform = k < 1 ? `scale(${k})` : '';
  body.classList.toggle('eco', eco());
  body.classList.toggle('fx', !eco());
  const c = paletteColors(S.palette);
  body.style.setProperty('--a1', c[0]);
  body.style.setProperty('--a2', c[1]);
  body.style.setProperty('--a3', c[2]);
  const a = hexRgb(c[0]);
  body.style.setProperty('--a1s', `rgba(${a[0]},${a[1]},${a[2]},0.35)`);
  body.style.setProperty('--a1g', `rgba(${a[0]},${a[1]},${a[2]},0.6)`);
  waves.configure({ style: S.style || 'capsules', palette: S.palette || 'violet', light: false, maxFps: eco() ? 24 : 60 });
  waves.kick();
}

// "Из обложки": the palette follows the cover of what's playing
export function coverPalette(src) {
  return looks.coverColors(src).then((c) => {
    if (c) looks.setCoverColors(c);
    if (S.palette === 'cover') apply();
    return c;
  });
}

// the screen saver takes the colours of the cover, whatever the palette;
// null gives the palette back
export function saverColors(c) {
  if (c) {
    looks.setCoverColors(c);
    waves.configure({ palette: 'cover' });
  } else {
    if (S.palette === 'cover') return waves.kick();
    waves.configure({ palette: S.palette || 'violet' });
  }
  waves.kick();
}

export const coverColors = (src) => looks.coverColors(src);

// ---------- light from the focused app ----------

const tints = [document.getElementById('tintA'), document.getElementById('tintB')];
let tintIdx = 0;
let tintKey = '';

export function tint(css) {
  const key = S.tint === false ? '' : css || '';
  if (key === tintKey) return;
  tintKey = key;
  const next = tints[1 - tintIdx];
  const prev = tints[tintIdx];
  if (key) next.style.setProperty('--tc', key);
  next.classList.toggle('on', !!key);
  prev.classList.remove('on');
  tintIdx = 1 - tintIdx;
}
