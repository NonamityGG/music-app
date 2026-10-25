// Резонанс OS: settings and the user's choices, kept in the page's storage.

const KEY = 'rez.tv.settings';

export const DEFAULTS = {
  bg: 'glass-violet',
  palette: 'violet',
  style: 'capsules',
  hear: true, // the waves hear what the TV plays
  tint: true, // the focused app lights up the background
  clockSec: false,
  weather: true,
  np: true,
  tools: true,
  saver: 5, // minutes, 0 = never
  saverLook: 'clock',
  fx: 'auto', // auto | max | eco (auto: eco on a weak box)
  guard: true,
  favs: null, // [pkg] in order; null until first chosen
  hidden: [],
  seen: [], // packages already shown (others get the "Новое" badge)
};

function load() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    // 1.0.2: effects follow the box unless chosen again
    if (!s.v) {
      s.v = 2;
      if (s.fx === 'max') s.fx = 'auto';
    }
    return s;
  } catch {
    return { ...DEFAULTS, v: 2 };
  }
}

export const S = load();
const listeners = [];

export function save(patch) {
  Object.assign(S, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {}
  for (const fn of listeners) fn(patch);
}

export const onChange = (fn) => listeners.push(fn);

// small cache for other things (colours of apps, weather, place)
export function cacheGet(key, maxAgeMs) {
  try {
    const v = JSON.parse(localStorage.getItem('rez.tv.c.' + key) || 'null');
    if (!v || (maxAgeMs && Date.now() - v.at > maxAgeMs)) return null;
    return v.v;
  } catch {
    return null;
  }
}

export function cacheSet(key, v) {
  try {
    localStorage.setItem('rez.tv.c.' + key, JSON.stringify({ at: Date.now(), v }));
  } catch {}
}
