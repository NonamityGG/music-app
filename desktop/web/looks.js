// Резонанс для ПК: looks of the waves made for a big screen, on top of the phone
// app's own ones (src/waves.js). Capsules are redrawn (on a monitor the phone's
// short pills read as glowing dots), two new styles and more palettes are added.
// Imported by the wallpaper and by the panel (for its previews).

import * as waves from '../../src/waves.js';

const { roundRect } = waves;

export const PC_PALETTES = [
  { id: 'ice', name: 'Лёд', colors: ['#3d7bff', '#7fd3ff', '#e8f7ff'] },
  { id: 'aurora', name: 'Аврора', colors: ['#00e5a0', '#00b3ff', '#8a5cff'] },
  { id: 'fire', name: 'Пламя', colors: ['#ff2e4d', '#ff7a1a', '#ffd23f'] },
  { id: 'sakura', name: 'Сакура', colors: ['#ff6fa5', '#ffb8d0', '#c9a7ff'] },
  { id: 'gold', name: 'Золото', colors: ['#b8742b', '#f5c96a', '#fff3cf'] },
  { id: 'mono', name: 'Серебро', colors: ['#7d8590', '#d4d9e0', '#ffffff'] },
  { id: 'cover', name: 'Из обложки', colors: ['#7c4dff', '#c3a6ff', '#ff6fd8'] },
];

const PC_STYLES = [
  { id: 'horizon', name: 'Горизонт' },
  { id: 'orb', name: 'Сфера' },
];

let installed = false;

export function install() {
  if (installed) return;
  installed = true;
  for (const p of PC_PALETTES) if (!waves.PALETTES.some((x) => x.id === p.id)) waves.PALETTES.push(p);
  for (const s of PC_STYLES) if (!waves.STYLES.some((x) => x.id === s.id)) waves.STYLES.push(s);
  waves.registerStyle('capsules', capsules, { rest: true });
  waves.registerStyle('horizon', horizon, { rest: true });
  waves.registerStyle('orb', orb, { rest: true });
}

// colours of the "Из обложки" palette
export function setCoverColors(colors) {
  const p = waves.PALETTES.find((x) => x.id === 'cover');
  if (p && colors && colors.length === 3) p.colors = colors;
}

// ---------- helpers ----------

// mirrored layout: d = 0 in the middle of the screen, 1 at the edges
function bandAt(b, d) {
  return b[Math.min(b.length - 1, Math.floor(d * b.length * 0.82))];
}

function smoothBand(b, d) {
  return (bandAt(b, d) * 2 + bandAt(b, Math.min(1, d + 0.015)) + bandAt(b, Math.max(0, d - 0.015))) / 4;
}

const heights = { caps: null, hor: null };

// heights glide a little, so wide bars don't flicker on a big screen
function glide(key, n, k) {
  let a = heights[key];
  if (!a || a.length !== n) a = heights[key] = new Float32Array(n);
  return { a, k };
}

// ---------- Капсулы: a row of tall rounded pills standing on a glass floor ----------

function capsules(f, b) {
  const { ctx, w, cy, amp, dpr, colors } = f;
  const dt = Math.min(0.1, Math.max(0, f.dt || 0.016));
  const total = w * 0.84;
  let n = Math.round(total / (24 * dpr));
  n = Math.max(25, Math.min(81, n)) | 1;
  const step = total / n;
  const bw = Math.min(step * 0.56, 22 * dpr);
  const x0 = (w - total) / 2 + (step - bw) / 2;
  const maxH = amp * 1.5;
  const floor = cy + amp * 0.5;
  const rest = bw * 1.7;
  const { a } = glide('caps', n);
  const k = 1 - Math.exp(-dt / 0.045);
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - mid) / mid;
    const v = smoothBand(b, d);
    // a gentle arch even at rest: the middle stands a bit taller
    const target = rest * (1 + 0.5 * (1 - d) * (1 - d)) + v * maxH * (1 - d * 0.4);
    a[i] = dt ? a[i] + (target - a[i]) * (target > a[i] ? Math.max(k, 0.55) : k) : target;
  }

  const grad = ctx.createLinearGradient(0, floor - maxH - rest, 0, floor);
  grad.addColorStop(0, colors[2]);
  grad.addColorStop(0.55, colors[1]);
  grad.addColorStop(1, colors[0]);

  const body = new Path2D();
  const glow = new Path2D();
  const mirror = new Path2D();
  const gap = 4 * dpr;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * step;
    const hh = a[i];
    roundRect(body, x, floor - hh, bw, hh, bw / 2);
    roundRect(glow, x - bw * 0.35, floor - hh - bw * 0.35, bw * 1.7, hh + bw * 0.7, bw);
    const rh = hh * 0.42;
    roundRect(mirror, x, floor + gap, bw, rh, bw / 2);
  }

  ctx.save();
  ctx.globalCompositeOperation = f.blend;
  // soft light around the pills
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.13;
  ctx.fill(glow);
  // the pills themselves
  ctx.globalAlpha = 0.95;
  ctx.fill(body);
  ctx.restore();

  // a glossy line down the left side of every pill
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#ffffff';
  const shine = new Path2D();
  for (let i = 0; i < n; i++) {
    const x = x0 + i * step + bw * 0.22;
    const hh = a[i];
    if (hh < bw * 1.4) continue;
    roundRect(shine, x, floor - hh + bw * 0.35, bw * 0.16, Math.max(0, hh - bw * 0.7) * 0.55, bw * 0.08);
  }
  ctx.fill(shine);
  ctx.restore();

  // reflection on the floor, fading away
  ctx.save();
  ctx.globalCompositeOperation = f.blend;
  const rg = ctx.createLinearGradient(0, floor + gap, 0, floor + gap + maxH * 0.42 + rest);
  rg.addColorStop(0, colors[0]);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.globalAlpha = 0.22;
  ctx.fill(mirror);
  ctx.restore();
}

// ---------- Горизонт: beams of light rising from the bottom edge ----------

function horizon(f, b) {
  const { ctx, w, h, amp, dpr, colors } = f;
  const dt = Math.min(0.1, Math.max(0, f.dt || 0.016));
  let n = Math.round(w / (14 * dpr));
  n = Math.max(41, Math.min(161, n)) | 1;
  const step = w / n;
  const bw = Math.max(2 * dpr, step * 0.42);
  const maxH = Math.min(h * 0.62, amp * 2.3);
  const base = h;
  const { a } = glide('hor', n);
  const k = 1 - Math.exp(-dt / 0.05);
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - mid) / mid;
    const v = smoothBand(b, d);
    const target = 6 * dpr + v * maxH * (1 - d * 0.3);
    a[i] = dt ? a[i] + (target - a[i]) * (target > a[i] ? Math.max(k, 0.6) : k) : target;
  }
  const hg = ctx.createLinearGradient(0, 0, w, 0);
  hg.addColorStop(0, colors[0]);
  hg.addColorStop(0.5, colors[1]);
  hg.addColorStop(1, colors[2]);
  const beams = new Path2D();
  for (let i = 0; i < n; i++) {
    const x = i * step + (step - bw) / 2;
    roundRect(beams, x, base - a[i], bw, a[i] + bw, bw / 2);
  }
  ctx.save();
  ctx.globalCompositeOperation = f.blend;
  // the beams fade upwards
  ctx.fillStyle = hg;
  ctx.globalAlpha = 0.9;
  ctx.fill(beams);
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, base - maxH, 0, base);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.75, 'rgba(0,0,0,0.15)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, base - maxH - 8 * dpr, w, maxH + 8 * dpr);
  ctx.restore();
  // a glowing horizon line
  const lv = waves.levels();
  ctx.save();
  ctx.globalCompositeOperation = f.blend;
  const lg = ctx.createLinearGradient(0, base - 60 * dpr, 0, base);
  lg.addColorStop(0, 'rgba(0,0,0,0)');
  lg.addColorStop(1, colors[1]);
  ctx.fillStyle = lg;
  ctx.globalAlpha = 0.12 + lv.bass * 0.25;
  ctx.fillRect(0, base - 60 * dpr, w, 60 * dpr);
  ctx.restore();
}

// ---------- Сфера: a soft glowing orb breathing with the music ----------

const orbState = { rot: 0, lift: 0 };

function orb(f, b) {
  const { ctx, cx, cy, amp, dpr, colors, t } = f;
  const dt = Math.min(0.1, Math.max(0, f.dt || 0.016));
  const lv = waves.levels();
  orbState.rot += dt * (0.18 + lv.energy * 0.5);
  orbState.lift += ((lv.bass || 0) - orbState.lift) * (dt ? 1 - Math.exp(-dt / 0.12) : 1);
  // (the panel's small previews have no frame time: a bigger orb reads better there)
  const R = amp * (f.dt === undefined ? 0.95 : 0.62) * (1 + orbState.lift * 0.18);
  const layers = [
    { c: colors[0], a: 0.5, off: 0, k: 1 },
    { c: colors[1], a: 0.36, off: 2.1, k: 0.8 },
    { c: colors[2], a: 0.32, off: 4.2, k: 0.65 },
  ];
  const N = 72;
  ctx.save();
  ctx.globalCompositeOperation = f.blend;
  // halo
  const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.1);
  halo.addColorStop(0, colors[1]);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.16 + lv.energy * 0.2;
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 2.1, 0, Math.PI * 2);
  ctx.fill();
  for (const L of layers) {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const d = Math.abs(((i / N) * 2) % 2 - 1);
      const v = smoothBand(b, 1 - d);
      const wob = Math.sin(ang * 3 + t * 0.9 + L.off) * 0.05 + Math.sin(ang * 5 - t * 0.6 + L.off) * 0.03;
      const r = R * (0.82 + wob) + v * amp * 0.42 * L.k;
      const a2 = ang + orbState.rot * (L.k > 0.9 ? 1 : -0.7) + L.off;
      pts.push([cx + Math.cos(a2) * r, cy + Math.sin(a2) * r]);
    }
    const g = ctx.createRadialGradient(cx - R * 0.15, cy - R * 0.35, R * 0.05, cx, cy, R * 1.45);
    g.addColorStop(0, colors[2]);
    g.addColorStop(0.45, L.c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.globalAlpha = L.a;
    ctx.beginPath();
    let [px, py] = pts[N - 1];
    let [qx, qy] = pts[0];
    ctx.moveTo((px + qx) / 2, (py + qy) / 2);
    for (let i = 0; i < N; i++) {
      const [x, y] = pts[i];
      const [nx, ny] = pts[(i + 1) % N];
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    ctx.closePath();
    ctx.fill();
  }
  // a thin bright rim
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = colors[2];
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---------- colours from a cover picture ----------

// Three colours for the waves out of a cover: the most vivid hue, a lighter
// tone of it and a second hue (or a shifted one). Returns null when unsure.
export function coverColors(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const S = 40;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, S, S);
        const d = x.getImageData(0, 0, S, S).data;
        const bins = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const [h, s, l] = hsl(d[i], d[i + 1], d[i + 2]);
          if (l < 0.12 || l > 0.92) continue;
          const key = Math.round(h / 20) % 18;
          const wgt = s * s * (1 - Math.abs(l - 0.55));
          const e = bins.get(key) || { w: 0, h: 0, s: 0, l: 0 };
          e.w += wgt;
          e.h += h * wgt;
          e.s += s * wgt;
          e.l += l * wgt;
          bins.set(key, e);
        }
        const list = [...bins.values()].filter((e) => e.w > 0.2).sort((p, q) => q.w - p.w);
        if (!list.length) return resolve(null);
        const top = list[0];
        const h1 = top.h / top.w;
        const s1 = Math.max(0.55, Math.min(1, (top.s / top.w) * 1.15));
        let h2 = (h1 + 40) % 360;
        const other = list.find((e) => Math.abs(((e.h / e.w - h1 + 540) % 360) - 180) > 35);
        if (other) h2 = other.h / other.w;
        resolve([hex(h1, s1, 0.56), hex(h1, s1 * 0.8, 0.78), hex(h2, Math.max(0.6, s1), 0.66)]);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// one colour for glows (the island card, the bar): vivid enough on black
export function accentOf(colors) {
  return colors ? colors[0] : null;
}

function hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const dd = mx - mn;
  const s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / dd + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / dd + 2;
  else h = (r - g) / dd + 4;
  return [h * 60, s, l];
}

function hex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
