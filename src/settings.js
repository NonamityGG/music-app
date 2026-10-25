// Persistent settings and small JSON stores in localStorage.

const PREFIX = 'rez.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn('save failed', key, e);
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {}
}

const DEFAULTS = {
  token: '',        // personal Zvuk token
  anonToken: '',    // anonymous Zvuk token (search and preview without login)
  quality: 'high',  // 'high' | 'mid'
  autoFallback: true,
  wavesStyle: 'neon', // see waves.js STYLES, or 'off'
  wavesPalette: 'violet',
  wavesReactive: true, // waves follow the real sound
  wavesFocus: false, // full player shows waves instead of the cover
  zvukWeb: true, // Zvuk requests go through zvuk.com opened inside the app
  yaToken: '', // Yandex Music sign-in
  yaUid: '',
  yaLogin: '',
  yaName: '',
  yaPlus: false,
  theme: 'dark', // see theme.js
  gapless: true, // the next track starts the instant the current one ends
  endless: true, // when the queue ends, similar music keeps playing
  intro: true, // launch animation (read by the inline intro in index.html)
  fullscreen: true, // no system bars; the app shows its own time/network/battery line
};

export const settings = Object.assign({}, DEFAULTS, load('settings', {}));

export function saveSettings(patch) {
  Object.assign(settings, patch);
  save('settings', settings);
}

// Error journal, shown in the profile screen so problems can be screenshotted.
const MAX_LOG = 60;
let journal = load('journal', []);

export function logError(where, err) {
  const msg = err && err.message ? err.message : String(err);
  journal.unshift({ at: Date.now(), where, msg });
  journal = journal.slice(0, MAX_LOG);
  save('journal', journal);
  console.warn('[' + where + ']', err);
}

export function getJournal() {
  return journal;
}

export function clearJournal() {
  journal = [];
  save('journal', journal);
}
