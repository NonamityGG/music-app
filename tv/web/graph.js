// Резонанс OS: the sound for the waves. The same interface as the phone app's
// audio-graph.js (the shared waves module reads it), fed by the TV's Visualizer
// through the Android side about 20 times a second.

import { on } from './tv.js';

export const BANDS = 64;
export const WAVE = 256;

const lastBands = new Float32Array(BANDS);
const lastWave = new Float32Array(64);
let at = 0;
let silentSince = 0;

on('viz', (d) => {
  if (!d || !d.b) return;
  let total = 0;
  for (let i = 0; i < BANDS; i++) {
    lastBands[i] = d.b[i] || 0;
    total += lastBands[i];
  }
  for (let i = 0; i < 64; i++) lastWave[i] = (d.w && d.w[i]) || 0;
  at = performance.now();
  if (total < 0.02) {
    if (!silentSince) silentSince = at;
  } else silentSince = 0;
});

export const fresh = () => performance.now() - at < 400;
export const available = () => true;
export const attach = () => false;
export const resume = () => {};
export const state = () => (fresh() ? 'running' : 'none');

export function read(bands, wave) {
  if (!fresh()) return { ok: false, silent: 0 };
  bands.set(lastBands);
  // 64 points of the wave stretched to 256, smoothly
  for (let j = 0; j < WAVE; j++) {
    const x = (j / (WAVE - 1)) * 63;
    const i = Math.floor(x);
    const f = x - i;
    wave[j] = (lastWave[i] * (1 - f) + lastWave[Math.min(63, i + 1)] * f) * 1.6;
  }
  return { ok: true, silent: silentSince ? performance.now() - silentSince : 0 };
}
