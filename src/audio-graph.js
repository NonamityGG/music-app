// Listens to the music so the waves can move with it. Only one audio element is
// ever connected here, and only for same-origin sources (local files, or Zvuk
// streams passed through the app's own native proxy); anything else plays on a
// separate, unconnected element so the sound is never at risk.

export const BANDS = 64;
export const WAVE = 256;

let ctx = null;
let analyser = null;
let attached = null;
let freq = null;
let time = null;
let bandBins = null; // [start, end) bin range per band

export function available() {
  return typeof (window.AudioContext || window.webkitAudioContext) === 'function';
}

export function attach(el) {
  if (attached === el) return true;
  if (attached) return false; // a media element can only be captured once
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'playback' });
    const src = ctx.createMediaElementSource(el);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -18;
    src.connect(ctx.destination);
    src.connect(analyser);
    freq = new Uint8Array(analyser.frequencyBinCount);
    time = new Float32Array(analyser.fftSize);
    bandBins = makeBands(ctx.sampleRate, analyser.frequencyBinCount);
    attached = el;
    return true;
  } catch (e) {
    console.warn('audio graph unavailable', e);
    ctx = null;
    analyser = null;
    return false;
  }
}

// Logarithmic bands from 35 Hz to 15 kHz.
function makeBands(sampleRate, bins) {
  const nyq = sampleRate / 2;
  const lo = 35;
  const hi = Math.min(15000, nyq);
  const out = [];
  let prevEnd = 1;
  for (let i = 0; i < BANDS; i++) {
    const f1 = lo * Math.pow(hi / lo, (i + 1) / BANDS);
    let end = Math.max(prevEnd + 1, Math.round((f1 / nyq) * bins));
    end = Math.min(end, bins);
    out.push([prevEnd, end]);
    prevEnd = end;
  }
  return out;
}

export function resume() {
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
}

export function state() {
  return ctx ? ctx.state : 'none';
}

let silentSince = 0;

// Fills bands (0..1) and wave (-1..1). Returns { ok, silent }.
export function read(bands, wave) {
  if (!analyser) return { ok: false, silent: false };
  analyser.getByteFrequencyData(freq);
  let total = 0;
  for (let i = 0; i < BANDS; i++) {
    const [a, b] = bandBins[i];
    let peak = 0;
    for (let k = a; k < b; k++) if (freq[k] > peak) peak = freq[k];
    total += peak;
    const tilt = 1 + (i / BANDS) * 0.55; // highs are naturally quieter
    let v = (peak / 255) * tilt;
    v = Math.max(0, Math.min(1, (v - 0.06) * 1.12));
    bands[i] = v * v * (3 - 2 * v); // smoothstep: keeps small noise down, peaks punchy
  }

  analyser.getFloatTimeDomainData(time);
  // oscilloscope trigger: start at a rising zero crossing so the line stands still
  let start = 0;
  const half = time.length - WAVE * 4;
  for (let k = 1; k < half; k++) {
    if (time[k - 1] < 0 && time[k] >= 0) {
      start = k;
      break;
    }
  }
  for (let j = 0; j < WAVE; j++) wave[j] = time[start + j * 4] || 0;

  const now = performance.now();
  if (total === 0) {
    if (!silentSince) silentSince = now;
  } else silentSince = 0;
  return { ok: true, silent: silentSince > 0 ? now - silentSince : 0 };
}
