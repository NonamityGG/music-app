// Резонанс Лаунчер: how it looks — the background, the palette's colours on
// everything, the waves behind the desktop (the phone app's own, with the PC's
// capsules, horizon and orb), and what the live wallpaper is told.

import * as waves from '../../src/waves.js';
import * as looks from '../../desktop/web/looks.js';
import * as graph from './graph.js';
import { S } from './store.js';
import { rez } from './bridge.js';

looks.install();

export const PALETTES = waves.PALETTES;
export const STYLES = waves.STYLES.filter((s) => s.id !== 'off');
export const BACKGROUNDS = [
  ['glass-violet', 'Фиолетовое стекло'],
  ['glass-black', 'Чёрное стекло'],
  ['aurora', 'Северное сияние'],
  ['ember', 'Угли'],
  ['dark', 'Тёмный'],
  ['amoled', 'Чёрный AMOLED'],
];

const body = document.body;
const canvas = document.getElementById('waves');
let state = { visible: true, music: false, hidden: false };
let info = {};

// Material You: the phone's own accent colours, when it has them
export function setInfo(i) {
  info = i || {};
  if (info.you && info.you.length === 3 && !waves.PALETTES.some((p) => p.id === 'you')) {
    waves.PALETTES.push({ id: 'you', name: 'Material You', colors: info.you });
  }
}

export function setWaveState(patch) {
  Object.assign(state, patch);
  body.classList.toggle('music', state.music);
  waves.kick();
}

const ampScale = () => (S.motion === 'lively' ? 1 : 0.62);
const drawing = () => S.wall === 'waves' && S.motion !== 'off';

waves.setSource({
  playing: () => state.visible && !state.hidden && drawing(),
  analysing: () => S.hear && state.music && graph.fresh(),
  onSilence: () => {},
});

let shift = 0; // the waves slide with the pages
waves.addSurface('bg', canvas, {
  dpr: Math.min(1, 1000 / Math.max(1, window.innerWidth)),
  center: () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const amp = Math.min(w, h) * 0.17 * ampScale() * (state.music ? 1.35 : 1);
    return { x: w / 2 + shift, y: h * 0.64, amp, r: 0 };
  },
});

export function parallax(frac, pages) {
  if (!S.parallax || pages < 2) shift = 0;
  else shift = -(frac - 0.5) * window.innerWidth * 0.35;
  document.documentElement.style.setProperty('--px', shift.toFixed(1) + 'px');
}

function hexRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const paletteOf = (id) => PALETTES.find((x) => x.id === id) || PALETTES[0];
export const colors = () => paletteOf(S.palette).colors;

export function apply() {
  body.className = body.className.replace(/\b(bg|wp|mo)-[\w-]+/g, '').trim();
  body.classList.add('bg-' + (S.bg || 'glass-violet'), 'wp-' + (S.wall || 'waves'), 'mo-' + (S.motion || 'calm'));
  document.documentElement.classList.toggle('see', S.wall !== 'waves');
  const c = colors();
  const rgb = hexRgb(c[0]);
  const st = body.style;
  st.setProperty('--a1', c[0]);
  st.setProperty('--a2', c[1]);
  st.setProperty('--a3', c[2]);
  st.setProperty('--r1', hexRgb(c[0]).join(','));
  st.setProperty('--r2', hexRgb(c[1]).join(','));
  st.setProperty('--r3', hexRgb(c[2]).join(','));
  st.setProperty('--a1s', `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);
  st.setProperty('--a1g', `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.6)`);
  waves.configure({ style: S.style || 'ribbons', palette: S.palette || 'violet', light: false, maxFps: S.fps || 30 });
  waves.kick();
  rez.seeThrough(S.wall !== 'waves');
  rez.wallpaper({
    style: NATIVE_STYLE[S.style] || 'ribbons',
    bg: S.bg,
    c,
    amp: S.motion === 'lively' ? 1.25 : 0.9,
    speed: S.motion === 'lively' ? 1.3 : 0.8,
    react: !!S.hear,
    fps: S.fps || 30,
  });
}

// the live wallpaper draws four looks of its own; every page look has the nearest one
const NATIVE_STYLE = { neon: 'ribbons', ribbons: 'ribbons', scope: 'ribbons', capsules: 'capsules', dots: 'capsules', orb: 'orb', rings: 'orb', horizon: 'aurora' };

// "Из обложки": the palette follows the cover of what's playing
export function coverPalette(src) {
  return looks.coverColors(src).then((c) => {
    if (c) looks.setCoverColors(c);
    if (S.palette === 'cover') apply();
    return c;
  });
}

export const hasWaves = () => drawing();
