// How it looks: the palette's colours on everything and the phone app's waves
// behind the home screen. The waves move while music plays (hearing it when the
// microphone is allowed) and rest as a still picture otherwise: nothing is
// drawn while nothing changes.

import * as waves from '../../src/waves.js';
import * as graph from './graph.js';
import { S } from './store.js';
import { rez } from './bridge.js';

export const STYLES = waves.STYLES.filter((s) => s.id !== 'off');
export const PALETTES = waves.PALETTES;

const state = { visible: true, covered: false, music: false, preview: false };

export function setYou(colors) {
  if (colors && colors.length === 3 && !PALETTES.some((p) => p.id === 'you')) {
    PALETTES.push({ id: 'you', name: 'Как в системе', colors });
  }
}

export function set(patch) {
  Object.assign(state, patch);
  document.body.classList.toggle('music', state.music);
  waves.kick();
}

waves.setSource({
  playing: () => state.visible && !state.covered && (state.music || state.preview),
  analysing: () => S.hear && state.music && graph.fresh(),
  onSilence: () => {},
});

const canvas = document.getElementById('waves');
waves.addSurface('bg', canvas, {
  dpr: Math.min(1.5, 1100 / Math.max(1, window.innerWidth)),
  // the waves run through the free space between the clock (or what's playing) and the icons
  center: () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const above = document.querySelector('#np:not([hidden])') || document.getElementById('top');
    const below = document.getElementById('grid');
    let y = h * 0.45;
    let gap = h * 0.2;
    if (above && below) {
      const a = above.getBoundingClientRect().bottom;
      const b = below.firstElementChild ? below.getBoundingClientRect().top : document.getElementById('find').getBoundingClientRect().top;
      if (b > a) {
        y = (a + b) / 2;
        gap = b - a;
      }
    }
    const amp = Math.max(Math.min(w, h) * 0.13, Math.min(gap * 0.5, h * 0.2)) * (state.music ? 1.15 : 0.85);
    return { x: w / 2, y, amp, r: 0 };
  },
});
waves.setActive('bg');

const rgb = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
};

export const palette = () => PALETTES.find((p) => p.id === S.palette) || PALETTES[0];

export function apply() {
  const c = palette().colors;
  const st = document.documentElement.style;
  ['--a1', '--a2', '--a3'].forEach((k, i) => st.setProperty(k, c[i]));
  ['--r1', '--r2', '--r3'].forEach((k, i) => st.setProperty(k, rgb(c[i])));
  document.body.classList.toggle('nolabels', !S.labels);
  waves.configure({ style: S.style || 'ribbons', palette: palette().id, light: false, maxFps: 60 });
  rez.visualizer(!!S.hear);
}

// a short hurry of the waves on a change of look, so the new one is seen moving
export function preview() {
  state.preview = true;
  waves.kick();
  clearTimeout(preview.t);
  preview.t = setTimeout(() => set({ preview: false }), 1800);
}
