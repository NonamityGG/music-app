// Persistent settings and small JSON stores in localStorage.

const PREFIX = 'slukh.';

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
