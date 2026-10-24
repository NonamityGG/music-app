// Background waves. Six styles, four palettes. Real audio data when the player can
// listen to the track, a believable simulation otherwise. Idle and hidden states
// stop the animation loop to save battery.

import * as graph from './audio-graph.js';
import { BANDS, WAVE } from './audio-graph.js';

export const STYLES = [
  { id: 'neon', name: 'Неон' },
  { id: 'ribbons', name: 'Ленты' },
  { id: 'capsules', name: 'Капсулы' },
  { id: 'dots', name: 'Точки' },
  { id: 'rings', name: 'Кольца' },
  { id: 'scope', name: 'Осциллограф' },
];

export const PALETTES = [
  { id: 'violet', name: 'Фиолет', colors: ['#7c4dff', '#c3a6ff', '#ff6fd8'] },
  { id: 'neon', name: 'Неон', colors: ['#00d1ff', '#4d6bff', '#b44dff'] },
  { id: 'sunset', name: 'Закат', colors: ['#ff3d7f', '#ff8a3d', '#ffd36b'] },
  { id: 'mint', name: 'Мята', colors: ['#2ee6c1', '#3fa9ff', '#a8ff9e'] },
];

const bands = new Float32Array(BANDS);
const target = new Float32Array(BANDS);
const wave = new Float32Array(WAVE);
const waveTarget = new Float32Array(WAVE);
const ripples = [];
// Per-band automatic gain: loud, mastered tracks would otherwise sit at the top
// all the time and nothing would seem to move with the music.
const avgLevel = new Float32Array(BANDS).fill(0.3);
const peakLevel = new Float32Array(BANDS).fill(0.6);
const fallSpeed = new Float32Array(BANDS);
let energy = 0;
let bass = 0;
let mid = 0;
let bassAvg = 0.15;
let lastBeat = 0;
let prevBassRaw = 0;
let beatPulse = 0; // 0..1, jumps on each kick drum and fades quickly

let source = { playing: () => false, analysing: () => false, onSilence: () => {} };
let cfg = { style: 'neon', palette: 'violet', light: false };
const surfaces = {}; // name -> { canvas, ctx, dpr, w, h, opts }
let active = 'bg';
let raf = 0;
let lastFrame = 0;
let lastDraw = 0;
let centerCache = null;
let centerAt = 0;

export function configure(next) {
  cfg = { ...cfg, ...next };
  gradCache.key = '';
  kick();
}

export function setSource(s) {
  source = s;
}

// opts: { dpr, center: () => ({ x, y }) | null, ampScale, place: 'low' | 'center' }
export function addSurface(name, canvas, opts = {}) {
  surfaces[name] = { canvas, ctx: canvas.getContext('2d'), opts, w: 0, h: 0, dpr: 1 };
  resize(name);
}

export function setActive(name) {
  if (active !== name) {
    const prev = surfaces[active];
    if (prev) prev.ctx.clearRect(0, 0, prev.w, prev.h);
  }
  active = name;
  centerCache = null;
  resize(name);
  kick();
}

export function resize(name = active) {
  centerCache = null;
  const s = surfaces[name];
  if (!s) return;
  const dpr = Math.min(s.opts.dpr || window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  const r = s.canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (w !== s.w || h !== s.h) {
    s.canvas.width = w;
    s.canvas.height = h;
    s.w = w;
    s.h = h;
    s.dpr = dpr;
    gradCache.key = '';
  }
}

window.addEventListener('resize', () => {
  for (const n of Object.keys(surfaces)) resize(n);
  kick();
});
document.addEventListener('visibilitychange', () => kick());

function running() {
  return cfg.style !== 'off' && !document.hidden && (source.playing() || energy > 0.004 || ripples.length > 0);
}

export function kick() {
  if (!raf && running()) raf = requestAnimationFrame(loop);
  if (cfg.style === 'off') clearActive();
}

function clearActive() {
  const s = surfaces[active];
  if (s) s.ctx.clearRect(0, 0, s.w, s.h);
}

function loop(now) {
  raf = 0;
  // 60 fps is plenty; on 90/120 Hz screens drawing every refresh only costs battery
  // and makes the frame pacing uneven when the phone can't keep up
  if (now - lastDraw >= 15.5 || !lastDraw) {
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    lastDraw = now;
    update(now / 1000, dt);
    draw(now / 1000, dt);
  }
  if (running()) raf = requestAnimationFrame(loop);
  else {
    lastFrame = 0;
    lastDraw = 0;
    clearActive();
  }
}

// ---------- data ----------

function simulate(t) {
  // ~122 BPM kick with a softer offbeat, slow drifting spectrum
  const beatPhase = (t * 2.03) % 1;
  // rounded pulses instead of sharp spikes
  const kickEnv = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * beatPhase), 3);
  const off = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * ((beatPhase + 0.5) % 1)), 4) * 0.5;
  for (let i = 0; i < BANDS; i++) {
    const f = i / BANDS;
    const shape = 0.62 * Math.exp(-f * 2.2) + 0.18;
    const drift = 0.55 + 0.45 * Math.sin(t * 1.1 + i * 0.42) * Math.sin(t * 0.37 + i * 0.13);
    const hit = f < 0.22 ? kickEnv : f > 0.55 ? off : kickEnv * 0.4;
    target[i] = Math.min(1, shape * drift * (0.65 + 0.6 * hit));
  }
  for (let j = 0; j < WAVE; j++) {
    const x = j / WAVE;
    waveTarget[j] =
      (0.55 * Math.sin(x * Math.PI * 4 + t * 3.1) + 0.3 * Math.sin(x * Math.PI * 11 - t * 5.3) + 0.15 * Math.sin(x * Math.PI * 23 + t * 9)) *
      (0.35 + 0.65 * kickEnv);
  }
}

function update(t, dt) {
  const playing = source.playing();
  let real = false;
  if (playing && source.analysing()) {
    const r = graph.read(target, waveTarget);
    real = r.ok;
    if (r.silent > 5000) source.onSilence();
  }
  if (!real) {
    if (playing) simulate(t);
    else {
      target.fill(0);
      waveTarget.fill(0);
    }
  }

  // bass transient: how much the low end jumped since the previous frame
  let bassRaw = 0;
  for (let i = 0; i < 6; i++) bassRaw += target[i];
  bassRaw /= 6;
  const flux = Math.max(0, bassRaw - prevBassRaw);
  prevBassRaw = bassRaw;
  beatPulse = Math.max(beatPulse * Math.exp(-dt / 0.12), Math.min(1, flux * 7));

  const kAvg = 1 - Math.exp(-dt / 1.4);
  const peakDecay = Math.exp(-dt / 2.5);
  const gravity = 5.5; // how fast bars fall, in full heights per second squared
  let e = 0;
  let b = 0;
  let m = 0;
  for (let i = 0; i < BANDS; i++) {
    const v = target[i];
    let out = v;
    if (real) {
      // compare each band with its own recent level: hits stand out,
      // steady loudness doesn't fill the screen
      avgLevel[i] += (v - avgLevel[i]) * kAvg;
      peakLevel[i] = Math.max(v, peakLevel[i] * peakDecay, avgLevel[i] + 0.08);
      const floor = avgLevel[i] * 0.65;
      const rel = (v - floor) / Math.max(0.1, peakLevel[i] - floor);
      out = Math.min(1, 0.3 * v + 0.8 * Math.max(0, rel));
    }
    // rise at once, fall with gravity, like a level meter
    if (out >= bands[i]) {
      bands[i] += (out - bands[i]) * (1 - Math.exp(-dt / 0.018));
      fallSpeed[i] = 0;
    } else {
      fallSpeed[i] += gravity * dt;
      bands[i] = Math.max(out, bands[i] - fallSpeed[i] * dt);
    }
    e += bands[i];
    if (i < 8) b += bands[i];
    else if (i < 32) m += bands[i];
  }
  // the line glides between frames instead of snapping (snapping looks like noise)
  const kw = 1 - Math.exp(-dt / (cfg.style === 'scope' ? 0.07 : 0.02));
  for (let j = 0; j < WAVE; j++) wave[j] += (waveTarget[j] - wave[j]) * kw;
  energy = e / BANDS;
  bass = b / 8;
  mid = m / 24;
  bassAvg += (bass - bassAvg) * (1 - Math.exp(-dt / 0.9));
  const nowMs = t * 1000;
  if ((beatPulse > 0.45 || (bass > 0.28 && bass > bassAvg * 1.25)) && nowMs - lastBeat > 240) {
    lastBeat = nowMs;
    ripples.push({ r: 0, a: 0.75 });
    if (ripples.length > 7) ripples.shift();
  }
}

// ---------- drawing ----------

const gradCache = { key: '', h: null, v: null };

function gradients(s, colors) {
  const key = `${s.w}x${s.h}:${colors.join()}`;
  if (gradCache.key !== key) {
    const hg = s.ctx.createLinearGradient(0, 0, s.w, 0);
    hg.addColorStop(0, colors[0]);
    hg.addColorStop(0.5, colors[1]);
    hg.addColorStop(1, colors[2]);
    const vg = s.ctx.createLinearGradient(0, 0, 0, s.h);
    vg.addColorStop(0, colors[2]);
    vg.addColorStop(0.5, colors[1]);
    vg.addColorStop(1, colors[0]);
    gradCache.key = key;
    gradCache.h = hg;
    gradCache.v = vg;
  }
  return gradCache;
}

function frameFor(s, t) {
  const pal = PALETTES.find((p) => p.id === cfg.palette) || PALETTES[0];
  // measuring the layout every frame can stutter; refresh the position a few times a second
  if (s.opts.center && (t * 1000 - centerAt > 250 || !centerCache)) {
    centerCache = s.opts.center();
    centerAt = t * 1000;
  }
  const c = s.opts.center ? centerCache : null;
  const cx = c ? c.x * s.dpr : s.w / 2;
  const cy = c ? c.y * s.dpr : s.opts.place === 'low' ? s.h * 0.79 : s.h / 2;
  const amp = c && c.amp ? c.amp * s.dpr : Math.min(s.w, s.h) * (s.opts.ampScale || 0.3);
  // glowing 'lighter' blending washes out to white on a light background
  const blend = cfg.light ? 'source-over' : 'lighter';
  return { ctx: s.ctx, w: s.w, h: s.h, cx, cy, amp, dpr: s.dpr, t, colors: pal.colors, g: gradients(s, pal.colors), full: !!s.opts.full, rx: c ? c.r * s.dpr : 0, blend };
}

function draw(t, dt) {
  const s = surfaces[active];
  if (!s || !s.w) return;
  const f = frameFor(s, t);
  f.dt = dt;
  f.ctx.clearRect(0, 0, f.w, f.h);
  if (cfg.style === 'off') return;
  f.amp *= 1 + beatPulse * 0.22;
  (DRAW[cfg.style] || DRAW.neon)(f, bands, wave);
}

// Index into bands for a mirrored layout: 0 at the center, 1 at the edges.
function bandAt(d) {
  return bands_[Math.min(BANDS - 1, Math.floor(d * BANDS * 0.82))];
}
let bands_ = bands;

const DRAW = {
  neon(f, b) {
    bands_ = b;
    const { ctx, w, cy, amp, dpr } = f;
    const n = 72;
    const gap = w / n;
    const bw = Math.max(1.5 * dpr, gap * 0.38);
    const path = new Path2D();
    for (let k = 0; k < n; k++) {
      const d = Math.abs(k - (n - 1) / 2) / ((n - 1) / 2);
      const v = bandAt(d);
      const hh = Math.max(dpr * 1.5, v * amp * (1 - d * 0.3));
      const x = k * gap + gap / 2;
      path.moveTo(x, cy - hh);
      path.lineTo(x, cy + hh);
    }
    ctx.save();
    ctx.globalCompositeOperation = f.blend;
    ctx.lineCap = 'round';
    ctx.strokeStyle = f.g.h;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = bw * 3.4;
    ctx.stroke(path);
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = bw;
    ctx.stroke(path);
    ctx.restore();
  },

  ribbons(f) {
    const { ctx, w, cy, amp, dpr, t } = f;
    const lines = 18;
    const step = 5 * dpr;
    ctx.save();
    ctx.globalCompositeOperation = f.blend;
    ctx.strokeStyle = f.g.h;
    ctx.lineWidth = 1.3 * dpr;
    const lift = 0.12 + bass * 1.1 + energy * 0.5;
    for (let l = 0; l < lines; l++) {
      const p = l / (lines - 1);
      ctx.globalAlpha = 0.18 + 0.55 * (1 - Math.abs(p - 0.5) * 2);
      ctx.beginPath();
      for (let x = 0; x <= w + step; x += step) {
        const u = x / w;
        const env = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 1.3);
        const a = amp * lift * env;
        const y =
          cy +
          a * (Math.sin(u * 5.5 + t * 1.15 + p * 1.7) * 0.62 + Math.sin(u * 12.5 - t * 1.8 + p * 3.3) * 0.28 * (0.4 + mid * 1.6)) +
          (p - 0.5) * amp * 0.42 * env * (0.6 + energy);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  },

  capsules(f, b) {
    bands_ = b;
    const { ctx, w, cy, amp } = f;
    const n = 11;
    const total = w * 0.9;
    const bw = Math.min(total / (n * 1.75), amp * 0.32);
    const gap = bw * 0.75;
    const x0 = (w - (n * bw + (n - 1) * gap)) / 2;
    ctx.save();
    ctx.fillStyle = f.g.v;
    for (let k = 0; k < n; k++) {
      const d = Math.abs(k - (n - 1) / 2) / ((n - 1) / 2);
      // average a few bands per capsule
      let v = 0;
      for (let q = 0; q < 3; q++) v += bandAt(Math.min(1, d + q * 0.03));
      v /= 3;
      const hh = Math.max(bw, (0.12 + v * 1.05) * amp * 1.25 * (1 - d * 0.28));
      const x = x0 + k * (bw + gap);
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      roundRect(ctx, x, cy - hh / 2, bw, hh, bw / 2);
      ctx.fill();
    }
    ctx.restore();
  },

  dots(f, b) {
    bands_ = b;
    const { ctx, w, cy, amp, dpr } = f;
    const cols = 46;
    const gap = w / cols;
    const r = Math.max(1.1 * dpr, gap * 0.17);
    const spacing = r * 3.1;
    const buckets = [new Path2D(), new Path2D(), new Path2D()];
    for (let c = 0; c < cols; c++) {
      const d = Math.abs(c - (cols - 1) / 2) / ((cols - 1) / 2);
      const v = bandAt(d);
      const count = Math.floor((v * amp * (1 - d * 0.25)) / spacing);
      const x = c * gap + gap / 2;
      for (let j = -count; j <= count; j++) {
        const fade = count ? Math.abs(j) / (count + 1) : 0;
        const bi = fade < 0.34 ? 0 : fade < 0.67 ? 1 : 2;
        const y = cy + j * spacing;
        buckets[bi].moveTo(x + r, y);
        buckets[bi].arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.save();
    ctx.fillStyle = f.g.h;
    [0.95, 0.6, 0.3].forEach((a, i) => {
      ctx.globalAlpha = a;
      ctx.fill(buckets[i]);
    });
    ctx.restore();
  },

  rings(f, b) {
    bands_ = b;
    const { ctx, cx, cy, amp, dpr, w, h } = f;
    const base = f.rx ? f.rx * 1.08 + 8 * dpr : Math.min(w, h) * 0.16;
    const n = 120;
    const path = new Path2D();
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 - Math.PI / 2;
      const d = Math.abs(((k / n) * 2) % 2 - 1); // mirrored around the circle
      const v = bandAt(1 - d);
      const len = 3 * dpr + v * amp * 0.5;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      path.moveTo(cx + c * base, cy + s * base);
      path.lineTo(cx + c * (base + len), cy + s * (base + len));
    }
    ctx.save();
    ctx.globalCompositeOperation = f.blend;
    ctx.strokeStyle = f.g.h;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 6 * dpr;
    ctx.stroke(path);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2 * dpr;
    ctx.stroke(path);
    // ripples on the beat
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      const dt = f.dt || 1 / 60;
      rp.r += (170 + bass * 380) * dt * dpr;
      rp.a *= Math.exp(-dt * 2.3);
      if (rp.a < 0.02) {
        ripples.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = rp.a;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, base + amp * 0.2 + rp.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  scope(f, b, wv) {
    const { ctx, w, h, cy, amp, dpr } = f;
    ctx.save();
    if (f.full) {
      // faint oscilloscope grid
      ctx.globalAlpha = 0.07;
      ctx.strokeStyle = f.colors[1];
      ctx.lineWidth = dpr;
      const cell = 36 * dpr;
      ctx.beginPath();
      for (let x = (w / 2) % cell; x < w; x += cell) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = cy % cell; y < h; y += cell) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }
    const path = new Path2D();
    const gain = amp * (f.full ? 0.95 : 0.7) * (0.8 + energy * 0.5);
    // a smooth curve through the points: quadratic segments between midpoints
    const pt = (j) => {
      const env = Math.sin(Math.PI * (j / (WAVE - 1)));
      return [(j / (WAVE - 1)) * w, cy + wv[j] * gain * (0.25 + 0.75 * env)];
    };
    let [px, py] = pt(0);
    path.moveTo(px, py);
    for (let j = 1; j < WAVE; j++) {
      const [x, y] = pt(j);
      path.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      px = x;
      py = y;
    }
    path.lineTo(px, py);
    ctx.globalCompositeOperation = f.blend;
    ctx.strokeStyle = f.g.h;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 8 * dpr;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.2 * dpr;
    ctx.stroke(path);
    ctx.restore();
  },
};

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Static thumbnail of a style for the settings screen.
export function renderPreview(canvas, styleId, paletteId) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = canvas.getContext('2d');
  const sample = new Float32Array(BANDS);
  for (let i = 0; i < BANDS; i++) {
    const fq = i / BANDS;
    sample[i] = Math.min(1, (0.75 * Math.exp(-fq * 2) + 0.15) * (0.7 + 0.3 * Math.sin(i * 0.9) * Math.cos(i * 0.31)));
  }
  const wv = new Float32Array(WAVE);
  for (let j = 0; j < WAVE; j++) wv[j] = 0.6 * Math.sin((j / WAVE) * Math.PI * 6) + 0.25 * Math.sin((j / WAVE) * Math.PI * 17);
  const pal = PALETTES.find((p) => p.id === paletteId) || PALETTES[0];
  const s = { w: canvas.width, h: canvas.height, ctx };
  const hg = ctx.createLinearGradient(0, 0, s.w, 0);
  const vg = ctx.createLinearGradient(0, 0, 0, s.h);
  pal.colors.forEach((c, i) => {
    hg.addColorStop(i / 2, c);
    vg.addColorStop(1 - i / 2, c);
  });
  const saved = { energy, bass, mid, ripples: ripples.splice(0) };
  energy = 0.45;
  bass = 0.55;
  mid = 0.4;
  ripples.push({ r: 6 * dpr, a: 0.5 }, { r: 16 * dpr, a: 0.25 });
  const f = { ctx, w: s.w, h: s.h, cx: s.w / 2, cy: s.h / 2, amp: Math.min(s.w, s.h) * 0.42, dpr, t: 1.3, colors: pal.colors, g: { h: hg, v: vg }, full: false, rx: 0, blend: cfg.light ? 'source-over' : 'lighter' };
  if (styleId === 'rings') f.amp = Math.min(s.w, s.h) * 0.5;
  ctx.clearRect(0, 0, s.w, s.h);
  (DRAW[styleId] || DRAW.neon)(f, sample, wv);
  ripples.splice(0);
  ripples.push(...saved.ripples);
  energy = saved.energy;
  bass = saved.bass;
  mid = saved.mid;
}

// For diagnostics and the seek bar: current smoothed levels.
export function levels() {
  if (cfg.style === 'off') return { bass: 0, energy: 0, beat: 0 };
  return { bass, energy, beat: beatPulse };
}

// n values 0..1 from low to high notes, for things that move gently with the music.
export function barLevels(n, out = new Float32Array(n)) {
  const live = cfg.style !== 'off' && (source.playing() || energy > 0.004);
  for (let i = 0; i < n; i++) out[i] = live ? bands[Math.min(BANDS - 1, Math.floor((i / n) * BANDS * 0.7))] : 0;
  return out;
}
