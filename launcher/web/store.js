// What the person chose: the apps on the home screen and in the dock, the look,
// how often each app is opened. Kept in the page's storage and, as a copy that
// survives clearing it, on the Android side.

import { rez } from './bridge.js';

const KEY = 'rez-launcher-2';
const DEFAULTS = {
  home: null, // [pkg] — null until first filled from the installed apps
  dock: null,
  palette: 'violet',
  style: 'ribbons',
  hear: false, // the waves hear what plays (needs the microphone permission)
  labels: true,
  syncWall: false, // the phone's wallpaper follows the palette
  uses: {}, // pkg -> { n, at }
};

function load() {
  for (const src of [() => localStorage.getItem(KEY), () => rez.storeGet()]) {
    try {
      const s = src();
      if (s) return { ...DEFAULTS, ...JSON.parse(s) };
    } catch {}
  }
  return { ...DEFAULTS };
}

export const S = load();
const listeners = [];
export const onChange = (fn) => listeners.push(fn);

let timer = 0;
export function save(patch) {
  if (patch) Object.assign(S, patch);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const s = JSON.stringify(S);
    try {
      localStorage.setItem(KEY, s);
    } catch {}
    rez.storeSet(s);
  }, 250);
  if (patch) for (const fn of listeners) fn(patch);
}

export function used(pkg) {
  const u = S.uses[pkg] || { n: 0, at: 0 };
  u.n++;
  u.at = Date.now();
  S.uses[pkg] = u;
  save();
}
