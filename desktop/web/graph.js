// Резонанс для ПК: the analyser behind the waves, fed with the whole PC's sound.
// The same interface as src/audio-graph.js of the phone app (tools: build.mjs
// points the shared waves module here), with a MediaStream instead of <audio>.

export const BANDS = 64;
export const WAVE = 256;

let ctx = null;
let analyser = null;
const attached = new Set();
let freq = null;
let time = null;
let bandBins = null; // [start, end) bin range per band
let broken = false;

export function available() {
  return typeof (window.AudioContext || window.webkitAudioContext) === 'function';
}

// The PC's own sound (system loopback from the main process): analysed only,
// never played back (it is already coming out of the speakers).
export function attachStream(stream) {
  if (broken || !stream) return false;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'playback' });
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.55;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      freq = new Uint8Array(analyser.frequencyBinCount);
      time = new Float32Array(analyser.fftSize);
      bandBins = makeBands(ctx.sampleRate, analyser.frequencyBinCount);
    }
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
    attached.add(src);
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return true;
  } catch (e) {
    console.warn('audio graph unavailable', e);
    broken = !attached.size;
    return false;
  }
}

// The sound output changed: drop the old stream before listening to the new one.
export function detachAll() {
  for (const src of attached) {
    try {
      src.disconnect();
    } catch {}
  }
  attached.clear();
  silentSince = 0;
}

// how long the sound has been fully silent (ms), as of the last read
export function silentMs() {
  return silentSince ? performance.now() - silentSince : 0;
}

// kept for the shared waves module (the phone app attaches media elements)
export function attach() {
  return false;
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

// The oscilloscope line: smoothed (a raw waveform of a loud track is a wall of
// spikes), started at the same point of the wave each frame so it stands still
// instead of jittering, and scaled to the track's own recent loudness.
const SPAN = 6; // samples between points: 256 points cover ~35 ms
const SMOOTH = 14; // moving-average width, cuts the hiss and cymbals
let cum = null;
let wavePeak = 0.3;

function readWave(wave) {
  const n = time.length;
  if (!cum || cum.length !== n + 1) cum = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) cum[k + 1] = cum[k] + time[k];
  const avg = (k) => (cum[k + SMOOTH] - cum[k]) / SMOOTH;
  const room = n - WAVE * SPAN - SMOOTH;
  let start = 0;
  let prev = avg(0);
  for (let k = 1; k < room; k++) {
    const cur = avg(k);
    if (prev < 0 && cur >= 0) {
      start = k;
      break;
    }
    prev = cur;
  }
  let peak = 0;
  for (let j = 0; j < WAVE; j++) {
    const v = avg(Math.min(n - SMOOTH, start + j * SPAN));
    wave[j] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  // follow loudness slowly: quiet parts stay quieter, but nothing overflows
  wavePeak = peak > wavePeak ? wavePeak + (peak - wavePeak) * 0.3 : wavePeak * 0.992 + peak * 0.008;
  const scale = 0.85 / Math.max(0.04, wavePeak);
  for (let j = 0; j < WAVE; j++) {
    const v = wave[j] * scale;
    wave[j] = v / (1 + Math.abs(v) * 0.35); // soft limit
  }
}

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
    bands[i] = v;
  }

  analyser.getFloatTimeDomainData(time);
  readWave(wave);

  const now = performance.now();
  if (total === 0) {
    if (!silentSince) silentSince = now;
  } else silentSince = 0;
  return { ok: true, silent: silentSince > 0 ? now - silentSince : 0 };
}
