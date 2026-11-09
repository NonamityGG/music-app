// Резонанс Лаунчер: the settings and the layout of the home screen, kept in the
// page's storage — and a copy on the Android side, so clearing the browser data
// of the WebView doesn't lose a carefully arranged desktop.

import { rez } from './bridge.js';

const KEY = 'rez.l.state';

export const DEFAULTS = {
  // the wallpaper
  wall: 'waves', // waves (drawn by the page) | live (the live wallpaper of the phone) | system (the picture the phone has)
  bg: 'glass-violet',
  palette: 'violet',
  style: 'ribbons',
  motion: 'calm', // off | calm | lively
  fps: 30,
  parallax: true,
  hear: true, // the waves hear the music
  // icons
  shape: 'squircle', // original | squircle | circle | round | drop
  plate: 'auto', // auto | tint | glass — under icons that have no shape of their own
  themed: false, // one-colour icons in the palette (where the app has them)
  iconSize: 1, // 0.8 … 1.3
  labels: true,
  badges: true,
  // the grid
  grid: 'auto', // auto | 4x5 | 5x6 | 6x6
  dockLabels: false,
  drawerButton: true,
  addNew: true, // new apps appear on the desktop
  // the pages
  feed: true, // the page on the left: the clock, the weather, what's playing
  clockStyle: 'big', // big | slim
  weather: true,
  city: null, // { name, lat, lon }
  // gestures
  swipeDown: 'shade', // shade | search | none
  orient: 'auto', // auto | portrait
  // the drawer
  drawerStyle: 'grid', // grid | list
  drawerCats: true,
  drawerKeyboard: false,
  engine: 'yandex', // yandex | google | ddg
  sounds: true, // vibration on long press and drop
};

export const LAYOUT = {
  pages: [[]], // each page is a list of items: {k:'a',p:pkg} | {k:'f',id} | {k:'w',t:kind,c,r}
  dock: [],
  folders: {}, // id -> { name, apps: [pkg] }
  seeded: false,
  seen: [], // packages already met (the others are new)
  hidden: [], // packages hidden from the drawer
  usage: {}, // pkg -> { n, at }
};

function parse(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function load() {
  let st = null;
  try {
    st = parse(localStorage.getItem(KEY));
  } catch {}
  if (!st) st = parse(rez.storeGet()); // storage cleared: the copy kept by the phone
  const s = { ...DEFAULTS, ...((st && st.s) || {}) };
  const l = { ...JSON.parse(JSON.stringify(LAYOUT)), ...((st && st.l) || {}) };
  if (!Array.isArray(l.pages) || !l.pages.length) l.pages = [[]];
  return { s, l };
}

const state = load();
export const S = state.s;
export const L = state.l;
const listeners = [];

let timer = 0;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const blob = JSON.stringify({ s: S, l: L });
    try {
      localStorage.setItem(KEY, blob);
    } catch {}
    rez.storeSet(blob);
  }, 350);
}

// a setting changed: everyone who listens is told which ones
export function save(patch) {
  Object.assign(S, patch);
  persist();
  for (const fn of listeners) fn(patch);
}
export const onChange = (fn) => listeners.push(fn);

// the layout changed (the caller edited L in place)
export function saveLayout() {
  persist();
}

// a small cache for other things (weather, the place)
export function cacheGet(key, maxAgeMs) {
  try {
    const v = JSON.parse(localStorage.getItem('rez.l.c.' + key) || 'null');
    if (!v || (maxAgeMs && Date.now() - v.at > maxAgeMs)) return null;
    return v.v;
  } catch {
    return null;
  }
}

export function cacheSet(key, v) {
  try {
    localStorage.setItem('rez.l.c.' + key, JSON.stringify({ at: Date.now(), v }));
  } catch {}
}

let uid = Date.now() % 100000;
export const newId = (p) => p + (uid++).toString(36);
