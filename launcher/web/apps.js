// Резонанс Лаунчер: the phone's apps — the list, the colour and kind of every
// icon, how often each is opened (for "Частые"), and search (also when the
// keyboard was on the wrong language).

import { rez, on } from './bridge.js';
import { S, L, saveLayout } from './store.js';

let list = [];
let meta = rez.meta(); // the colours and kinds of icons from the last time
const listeners = [];
export const onApps = (fn) => listeners.push(fn);
export const byPkg = (pkg) => list.find((a) => a.pkg === pkg) || null;
export const all = () => list;
export const metaOf = (pkg) => meta[pkg] || null;

let sig = '';
function fire() {
  for (const fn of listeners) fn();
}

export function load() {
  list = rez.apps() || [];
  for (const a of list) a.m = meta[a.pkg] || null;
  const s = list.map((a) => a.pkg + '|' + a.label + '|' + (a.updated || 0)).join(',');
  if (s === sig) return false;
  sig = s;
  fire();
  return true;
}

let reload = 0;
on('apps', () => {
  clearTimeout(reload);
  reload = setTimeout(load, 900);
});

// the phone drew every icon: now their colours and kinds are known
on('meta', (m) => {
  meta = m || {};
  for (const a of list) a.m = meta[a.pkg] || null;
  fire();
});

// ---------- sorting, kinds ----------

const coll = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('ru') : null;
export const byLabel = (a, b) => (coll ? coll.compare(a.label, b.label) : a.label < b.label ? -1 : 1);
export const hidden = (a) => (L.hidden || []).indexOf(a.pkg) >= 0;
export const visible = () => list.filter((a) => !hidden(a)).sort(byLabel);

export const CATS = [
  { id: 'all', name: 'Все' },
  { id: 'game', name: 'Игры', cats: [0] },
  { id: 'media', name: 'Музыка и видео', cats: [1, 2] },
  { id: 'social', name: 'Общение', cats: [4] },
  { id: 'work', name: 'Работа', cats: [7, 5] },
  { id: 'photo', name: 'Фото', cats: [3] },
  { id: 'maps', name: 'Карты', cats: [6] },
  { id: 'new', name: 'Новые' },
];

export function inCat(a, id) {
  const c = CATS.find((x) => x.id === id);
  if (!c || id === 'all') return true;
  if (id === 'new') return isNew(a);
  return c.cats.indexOf(a.cat) >= 0;
}

export const isNew = (a) => (L.seen || []).indexOf(a.pkg) < 0 && Date.now() - (a.installed || 0) < 7 * 24 * 3600e3;

// the first letter for the drawer's headings and the fast scroll
export function letterOf(a) {
  const ch = (a.label || '?').trim().charAt(0).toUpperCase();
  return /[A-ZА-ЯЁ]/.test(ch) ? ch : '#';
}

// ---------- how often an app is opened ----------

export function used(pkg) {
  const u = (L.usage[pkg] = L.usage[pkg] || { n: 0, at: 0 });
  u.n += 1;
  u.at = Date.now();
  saveLayout();
}

// the apps opened most (recent opens count more)
export function frequent(n, skip) {
  const now = Date.now();
  return list
    .filter((a) => !hidden(a) && L.usage[a.pkg] && (!skip || skip.indexOf(a.pkg) < 0))
    .map((a) => {
      const u = L.usage[a.pkg];
      const days = (now - u.at) / 86400e3;
      return { a, score: u.n * Math.exp(-days / 10) };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, n)
    .map((x) => x.a);
}

// ---------- search ----------

const RU = 'йцукенгшщзхъфывапролджэячсмитьбю';
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const toEn = (s) => s.replace(/[а-яё]/g, (c) => EN[RU.indexOf(c)] || c);
const toRu = (s) => s.replace(/[a-z\[\];',.]/g, (c) => RU[EN.indexOf(c)] || c);
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

function score(label, q) {
  const l = norm(label);
  if (l.startsWith(q)) return 3;
  if (l.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 2;
  if (l.indexOf(q) >= 0) return 1;
  return 0;
}

export function search(raw) {
  const q = norm(raw).trim();
  if (!q) return [];
  const variants = [q];
  const sw = /[а-яё]/.test(q) ? toEn(q) : toRu(q);
  if (sw !== q) variants.push(sw);
  const out = [];
  for (const a of list) {
    if (hidden(a)) continue;
    let best = 0;
    for (const v of variants) best = Math.max(best, score(a.label, v));
    if (best) out.push({ a, s: best * 100 + Math.min(50, ((L.usage[a.pkg] || {}).n || 0)) });
  }
  return out.sort((x, y) => y.s - x.s || byLabel(x.a, y.a)).map((x) => x.a);
}

// "12*(3+4)" → 84: a quick sum in the search field
export function calc(raw) {
  const s = String(raw || '').replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!/^[\d+\-*/().%^]+$/.test(s) || !/[+\-*/%^]/.test(s.replace(/^-/, '')) || /^[\d.]+$/.test(s)) return null;
  try {
    // only digits and operators got here
    const v = Function('"use strict";return (' + s.replace(/\^/g, '**').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)') + ')')();
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return String(Math.round(v * 1e8) / 1e8).replace('.', ',');
  } catch {
    return null;
  }
}

export function webUrl(q) {
  const e = encodeURIComponent(q);
  return S.engine === 'google' ? 'https://www.google.com/search?q=' + e : S.engine === 'ddg' ? 'https://duckduckgo.com/?q=' + e : 'https://yandex.ru/search/?text=' + e;
}

export const engineName = () => (S.engine === 'google' ? 'Google' : S.engine === 'ddg' ? 'DuckDuckGo' : 'Яндекс');
