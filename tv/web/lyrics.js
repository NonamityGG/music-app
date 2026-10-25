// Резонанс OS: the words of the playing song, for the screen saver (LRCLIB, the
// open lyrics library the phone and PC apps use). Synced lyrics when there are
// any, the title otherwise. Answers are kept, so a song is looked up once.

import { tv } from './tv.js';

const API = 'https://lrclib.net/api';
const STORE = 'rez.tv.lyrics';
const MAX = 60;

let memo = null;
function cache() {
  if (memo) return memo;
  try {
    memo = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
  } catch {
    memo = {};
  }
  return memo;
}
function keep(key, v) {
  const c = cache();
  delete c[key];
  c[key] = v;
  const keys = Object.keys(c);
  for (let i = 0; i < keys.length - MAX; i++) delete c[keys[i]];
  try {
    localStorage.setItem(STORE, JSON.stringify(c));
  } catch {
    // full: start again
    memo = {};
    try {
      localStorage.removeItem(STORE);
    } catch {}
  }
}

// "Song (feat. X) [Remastered 2011] - Radio Edit" -> "Song"
export function clean(s) {
  return String(s || '')
    .replace(/\s*[([](feat|ft|prod|with)\.?\s[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*(remaster|version|edit|mix|live|official|video|audio|lyric|explicit|clean|hd|4k|mv)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstArtist(s) {
  return String(s || '')
    .split(/\s*(?:,|&|;|\sfeat\.?\s|\sft\.?\s|\sx\s|\svs\.?\s)\s*/i)[0]
    .trim();
}

async function get(url) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), 12000);
  try {
    const r = await fetch(tv.net(url), ctl ? { signal: ctl.signal } : undefined);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('LRCLIB ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// [mm:ss.xx] lines -> [{ t, text }], sorted
export function parseLrc(lrc) {
  const out = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [];
    let rest = raw;
    let m;
    while ((m = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/.exec(rest))) {
      stamps.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')));
      rest = rest.slice(m[0].length);
    }
    const text = rest.replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    for (const t of stamps) out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

function fromRecord(rec) {
  if (!rec) return null;
  if (rec.instrumental) return { synced: false, instrumental: true, lines: [] };
  if (rec.syncedLyrics) {
    const lines = parseLrc(rec.syncedLyrics);
    if (lines.length > 2) return { synced: true, lines };
  }
  return null; // plain text can't follow the song: the title is shown instead
}

const qs = (o) =>
  Object.keys(o)
    .filter((k) => o[k] !== '' && o[k] != null)
    .map((k) => `${k}=${encodeURIComponent(o[k])}`)
    .join('&');

async function lookup(title, artist, album, sec) {
  let found = null;
  try {
    found = fromRecord(await get(`${API}/get?${qs({ track_name: title, artist_name: artist, album_name: album, duration: sec > 0 ? Math.round(sec) : '' })}`));
  } catch {}
  if (found) return found;
  const list = (await get(`${API}/search?${qs({ track_name: title, artist_name: artist })}`)) || [];
  const scored = list
    .filter((r) => r && r.syncedLyrics)
    .map((r) => ({ r, diff: sec > 0 && r.duration ? Math.abs(r.duration - sec) : 0 }))
    .filter((x) => x.diff <= 4)
    .sort((a, b) => a.diff - b.diff);
  return scored.length ? fromRecord(scored[0].r) : null;
}

export const keyOf = (m) => `${clean(m.title).toLowerCase()}|${firstArtist(m.artist).toLowerCase()}|${Math.round((m.dur || 0) / 2000)}`;

const pending = {};

// m: what the TV says is playing. Resolves to { synced, lines } or null.
export function find(m) {
  const key = keyOf(m);
  const c = cache();
  if (key in c) return Promise.resolve(c[key]);
  if (pending[key]) return pending[key];
  const title = clean(m.title);
  const artist = firstArtist(m.artist);
  const sec = m.dur > 0 ? m.dur / 1000 : 0;
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
  pending[key] = (async () => {
    let res = null;
    let failed = false;
    try {
      if (title && artist) res = await lookup(title, artist, clean(m.album), sec);
      if (!res && dash) res = await lookup(clean(dash[2]), firstArtist(dash[1]), '', sec);
    } catch (e) {
      failed = true;
      tv.log('текст песни: ' + (e && e.message ? e.message : e));
    }
    // a network failure isn't remembered: the song is asked again next time
    if (!failed) keep(key, res);
    delete pending[key];
    return res;
  })();
  return pending[key];
}

// the line sung at this second: its index, or -1 before the first
export function lineAt(lines, sec) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= sec) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
