// Резонанс для ПК: looks of the waves made for a big screen, on top of the phone
// app's own ones (src/waves.js). Capsules are redrawn (on a monitor the phone's
// short pills read as glowing dots), two new styles and more palettes are added.
// Imported by the wallpaper and by the panel (for its previews).

import * as waves from '../../src/waves.js';

const { roundRect } = waves;

export const PC_PALETTES = [
  { id: 'violet', name: 'Violet', colors: ['#7650c9', '#b79be8', '#f0d8ff'] },
  { id: 'rose', name: 'Rose', colors: ['#a94f83', '#e28bb9', '#f7d2e7'] },
  { id: 'azure', name: 'Azure', colors: ['#356aab', '#72a9e8', '#c8e6ff'] },
  { id: 'emerald', name: 'Emerald', colors: ['#347c68', '#68b99b', '#c3f0dc'] },
  { id: 'amber', name: 'Amber', colors: ['#9c6932', '#d7a65b', '#fff0c2'] },
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
  { id: 'cube', name: 'Cube Spectrum' },
  { id: 'crystal', name: 'Crystal' },
  { id: 'terrain', name: 'Sonic Terrain' },
  { id: 'silk', name: 'Silk Flow' },
  { id: 'orbit', name: 'Orbit' },
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
  waves.registerStyle('cube', cube, { rest: true });
  waves.registerStyle('crystal', crystal, { rest: true });
  waves.registerStyle('terrain', terrain, { rest: true });
  waves.registerStyle('silk', silk, { rest: true });
  waves.registerStyle('orbit', orbit, { rest: true });
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


// ---------- Aesthetic collection: original PC-only visualizers ----------
function cube(f, b) {
  const { ctx, cx, cy, amp, dpr, colors, t } = f;
  const lv = waves.levels();
  const size = amp * (0.62 + lv.bass * 0.16);
  const rot = (t || 0) * 0.34;
  const verts = [];
  for (let z = -1; z <= 1; z += 2) for (let y = -1; y <= 1; y += 2) for (let x = -1; x <= 1; x += 2) {
    let X=x*size, Y=y*size, Z=z*size;
    const x1=X*Math.cos(rot)-Z*Math.sin(rot), z1=X*Math.sin(rot)+Z*Math.cos(rot);
    const y2=Y*Math.cos(rot*.73)-z1*Math.sin(rot*.73), z2=Y*Math.sin(rot*.73)+z1*Math.cos(rot*.73);
    const p=3.4*size/(3.4*size+z2);
    verts.push([cx+x1*p,cy+y2*p,z2]);
  }
  const edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  ctx.save(); ctx.globalCompositeOperation=f.blend; ctx.lineCap='round';
  const glow=ctx.createRadialGradient(cx,cy,size*.15,cx,cy,size*2.2);
  glow.addColorStop(0,colors[0]+'55'); glow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(cx,cy,size*2.2,0,Math.PI*2);ctx.fill();
  for(let i=0;i<edges.length;i++){
    const [a,c]=edges[i],v=bandAt(b,i/edges.length);
    ctx.beginPath();ctx.moveTo(...verts[a].slice(0,2));ctx.lineTo(...verts[c].slice(0,2));
    ctx.strokeStyle=i%3===0?colors[2]:i%3===1?colors[1]:colors[0];
    ctx.globalAlpha=.42+v*.58;ctx.lineWidth=(1.5+v*4)*dpr;
    ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=(8+v*22)*dpr;ctx.stroke();
  }
  for(let i=0;i<8;i++){const p=verts[i],v=bandAt(b,i/8);ctx.beginPath();ctx.arc(p[0],p[1],(2+v*4)*dpr,0,Math.PI*2);ctx.fillStyle=colors[i%3];ctx.globalAlpha=.65+v*.3;ctx.fill();}
  ctx.restore();
}

function crystal(f,b) {
  const {ctx,cx,cy,amp,dpr,colors,t}=f;const lv=waves.levels();
  const R=amp*(.56+lv.energy*.12),rot=(t||0)*.22,N=6,pts=[];
  for(let i=0;i<N;i++){const a=rot+i*Math.PI*2/N,v=bandAt(b,i/N);pts.push([cx+Math.cos(a)*R*(.82+v*.3),cy+Math.sin(a)*R*(.82+v*.3)]);}
  ctx.save();ctx.globalCompositeOperation=f.blend;
  const g=ctx.createRadialGradient(cx-R*.2,cy-R*.3,1,cx,cy,R*1.4);g.addColorStop(0,colors[2]+'aa');g.addColorStop(.55,colors[1]+'55');g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g;ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill();
  for(let i=0;i<N;i++){const p=pts[i],q=pts[(i+1)%N],v=bandAt(b,i/N);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(...p);ctx.lineTo(...q);ctx.closePath();ctx.fillStyle=colors[i%3];ctx.globalAlpha=.08+v*.16;ctx.fill();ctx.strokeStyle=colors[(i+1)%3];ctx.globalAlpha=.65;ctx.lineWidth=1.6*dpr;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=14*dpr;ctx.stroke();}
  ctx.restore();
}

function terrain(f,b) {
  const {ctx,w,h,cy,amp,dpr,colors,t}=f;const cols=48,rows=18,step=w/(cols-1);
  ctx.save();ctx.globalCompositeOperation=f.blend;ctx.lineWidth=1*dpr;
  for(let r=0;r<rows;r++){
    ctx.beginPath();
    for(let i=0;i<cols;i++){const x=i*step,dist=Math.abs(i/(cols-1)-.5)*2,v=bandAt(b,dist);const y=cy+amp*.48+r*amp*.045-v*amp*.72*Math.exp(-r*.12)+Math.sin(i*.24+(t||0)*.6+r*.28)*amp*.025; if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
    ctx.strokeStyle=colors[r%3];ctx.globalAlpha=.12+(1-r/rows)*.48;ctx.shadowColor=colors[r%3];ctx.shadowBlur=(r===0?10:2)*dpr;ctx.stroke();
  }ctx.restore();
}

function silk(f,b) {
  const {ctx,w,cx,cy,amp,dpr,colors,t}=f;ctx.save();ctx.globalCompositeOperation=f.blend;
  for(let j=0;j<5;j++){ctx.beginPath();for(let i=0;i<=100;i++){const x=w*i/100, n=i/100, v=bandAt(b,Math.abs(n-.5)*2),y=cy+Math.sin(n* Math.PI*4+(t||0)*(.35+j*.035)+j*1.2)*amp*(.18+j*.045)+Math.sin(n*18+(t||0)*.7+j)*v*amp*.22;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
    ctx.strokeStyle=colors[j%3];ctx.globalAlpha=.28+j*.1;ctx.lineWidth=(2+j*1.3)*dpr;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=(12+j*3)*dpr;ctx.stroke();}
  ctx.restore();
}

function orbit(f,b) {
  const {ctx,cx,cy,amp,dpr,colors,t}=f;const lv=waves.levels();ctx.save();ctx.globalCompositeOperation=f.blend;
  for(let ring=0;ring<4;ring++){const rx=amp*(.48+ring*.13),ry=rx*(.42+ring*.06),rot=(t||0)*(.12+ring*.035)*(ring%2?1:-1);ctx.beginPath();
    for(let i=0;i<=180;i++){const a=i/180*Math.PI*2,v=bandAt(b,i/180),r=1+v*.14+lv.bass*.05,x=Math.cos(a)*rx*r,y=Math.sin(a)*ry*r,px=cx+x*Math.cos(rot)-y*Math.sin(rot),py=cy+x*Math.sin(rot)+y*Math.cos(rot);if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}
    ctx.strokeStyle=colors[ring%3];ctx.globalAlpha=.38+ring*.1;ctx.lineWidth=(1.4+ring*.35)*dpr;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=12*dpr;ctx.stroke();}
  ctx.restore();
}
