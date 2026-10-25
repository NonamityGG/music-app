// Резонанс OS: the TV's apps — favourites (in the user's order), the rest,
// hidden ones — and the colour of each app (for its tile and for the light in
// the room when it is focused).

import { tv, on } from './tv.js';
import { S, save, cacheGet, cacheSet } from './store.js';

let list = [];
const listeners = [];
export const onApps = (fn) => listeners.push(fn);
export const byPkg = (pkg) => list.find((a) => a.pkg === pkg) || null;

let shownSig = '';

export function load() {
  list = tv.apps() || [];
  firstFavourites();
  // the system says "packages changed" often (updates in the background):
  // rebuild only when the list of apps really changed
  const sig = list.map((a) => a.pkg + '|' + a.label + '|' + (a.banner ? 1 : 0)).join(',');
  if (sig === shownSig) return;
  shownSig = sig;
  for (const fn of listeners) fn();
}

let reloadTimer = 0;
on('apps', () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 1200);
});

// on the first start: the video apps people open most, then other TV apps
const LIKED = [/okko|окко/i, /кинопоиск|kinopoisk/i, /youtube/i, /wink/i, /\bivi\b|иви/i, /premier|премьер/i, /кион|kion/i, /rutube/i, /vk ?видео|vk video/i, /start/i, /смотрим|smotrim/i, /more\.?tv/i, /амедиатека|amediateka/i, /резонанс|музык|music/i];
const UTILITY = /настройк|settings|файл|file|браузер|browser|магазин|store|каталог|обновлен|update|помощь|help/i;

function firstFavourites() {
  if (Array.isArray(S.favs) || !list.length) return;
  const picks = [];
  for (const re of LIKED) {
    const a = list.find((x) => re.test(x.label) && picks.indexOf(x.pkg) < 0);
    if (a) picks.push(a.pkg);
    if (picks.length >= 6) break;
  }
  for (const a of list) {
    if (picks.length >= 6) break;
    if (a.tv && picks.indexOf(a.pkg) < 0 && !UTILITY.test(a.label)) picks.push(a.pkg);
  }
  save({ favs: picks, seen: list.map((a) => a.pkg) });
}

const coll = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('ru') : null;
const byLabel = (a, b) => (coll ? coll.compare(a.label, b.label) : a.label < b.label ? -1 : 1);
const hidden = (a) => (S.hidden || []).indexOf(a.pkg) >= 0;

export function favourites() {
  return (S.favs || []).map(byPkg).filter((a) => a && !hidden(a));
}

export function others() {
  const favs = S.favs || [];
  return list.filter((a) => favs.indexOf(a.pkg) < 0 && !hidden(a)).sort((a, b) => (a.tv === b.tv ? byLabel(a, b) : a.tv ? -1 : 1));
}

export function everything() {
  return list.filter((a) => !hidden(a)).sort(byLabel);
}

export function hiddenApps() {
  return list.filter(hidden).sort(byLabel);
}

export const isFav = (pkg) => (S.favs || []).indexOf(pkg) >= 0;
export const isNew = (a) => (S.seen || []).indexOf(a.pkg) < 0;

export function markSeen(pkg) {
  if ((S.seen || []).indexOf(pkg) >= 0) return;
  save({ seen: (S.seen || []).concat(pkg) });
}

export function toggleFav(pkg) {
  const favs = (S.favs || []).slice();
  const i = favs.indexOf(pkg);
  if (i >= 0) favs.splice(i, 1);
  else favs.push(pkg);
  save({ favs });
  return i < 0;
}

export function moveFav(pkg, delta) {
  const favs = (S.favs || []).slice();
  const i = favs.indexOf(pkg);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= favs.length) return false;
  favs.splice(i, 1);
  favs.splice(j, 0, pkg);
  save({ favs });
  return true;
}

export function hide(pkg) {
  save({ hidden: (S.hidden || []).concat(pkg), favs: (S.favs || []).filter((p) => p !== pkg) });
}

export function unhide(pkg) {
  save({ hidden: (S.hidden || []).filter((p) => p !== pkg) });
}

// ---------- colours ----------

const pending = {};

// The app's own colour from its banner or icon: the most vivid hue, as rgb.
export function colorOf(app) {
  const key = 'col.' + app.pkg;
  const hit = cacheGet(key, 7 * 24 * 3600e3);
  if (hit !== null) return Promise.resolve(hit || null);
  if (!pending[app.pkg]) {
    pending[app.pkg] = imageColor(tv.iconUrl(app.pkg, app.banner)).then((c) => {
      cacheSet(key, c || 0);
      delete pending[app.pkg];
      return c;
    });
  }
  return pending[app.pkg];
}

export function imageColor(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const N = 28;
        const c = document.createElement('canvas');
        c.width = c.height = N;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, N, N);
        const d = x.getImageData(0, 0, N, N).data;
        const bins = {};
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          const [h, s, l] = hsl(d[i], d[i + 1], d[i + 2]);
          if (l < 0.1 || l > 0.94 || s < 0.18) continue;
          const k = Math.round(h / 24) % 15;
          const w = s * s * (1 - Math.abs(l - 0.52));
          const b = bins[k] || (bins[k] = { w: 0, h: 0, s: 0 });
          b.w += w;
          b.h += h * w;
          b.s += s * w;
        }
        let best = null;
        for (const k in bins) if (!best || bins[k].w > best.w) best = bins[k];
        if (!best || best.w < 0.8) return resolve(null);
        resolve(rgb(best.h / best.w, Math.min(1, Math.max(0.55, (best.s / best.w) * 1.1)), 0.52));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function rgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [f(0), f(8), f(4)];
}

export const rgba = (c, a) => (c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : null);
export const shade = (c, k) => (c ? [0, 1, 2].map((i) => Math.round(c[i] * k)) : null);
