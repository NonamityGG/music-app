// Резонанс для ПК: the words of the playing song for the wallpaper (LRCLIB, the
// same open lyrics library the phone app uses). Synced lyrics when there are any,
// plain text otherwise. Answers are kept on disk, so a song is looked up once.

'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://lrclib.net/api';
const UA = 'Rezonans PC (https://github.com/NonamityGG/music-app)';
const MAX = 400;

let cache = null;
let cacheFile = '';
let saveTimer = 0;

// electron is loaded only when used, so the text helpers can be tested in plain node
const electron = () => require('electron');

function load() {
  if (cache) return;
  cacheFile = path.join(electron().app.getPath('userData'), 'lyrics-cache.json');
  try {
    cache = new Map(Object.entries(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))));
  } catch {
    cache = new Map();
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      while (cache.size > MAX) cache.delete(cache.keys().next().value);
      fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(cache)));
    } catch {}
  }, 1500);
}

// "Song (feat. X) [Remastered 2011] - Radio Edit" -> "Song"
function clean(s) {
  return String(s || '')
    .replace(/\s*[([](feat|ft|prod|with)\.?\s[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*(remaster|version|edit|mix|live|official|video|audio|lyric|explicit|clean|hd|4k|mv)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstArtist(s) {
  return String(s || '')
    .split(/\s*(?:,|&|;|\sfeat\.?\s|\sft\.?\s|\sx\s|\svs\.?\s)\s*/i)[0]
    .trim();
}

// LRCLIB is often busy for a moment (503) or the connection drops: try again a
// couple of times before giving up
const RETRY_MS = [1500, 4000, 8000];

async function get(url) {
  for (let i = 0; ; i++) {
    let r;
    try {
      r = await electron().net.fetch(url, { headers: { 'User-Agent': UA, 'Lrclib-Client': UA } });
    } catch (e) {
      if (i >= RETRY_MS.length) throw e;
    }
    if (r) {
      if (r.status === 404) return null;
      if (r.ok) return r.json();
      if (r.status < 500 || i >= RETRY_MS.length) throw new Error('LRCLIB ' + r.status);
    }
    await new Promise((res) => setTimeout(res, RETRY_MS[i]));
  }
}

// [mm:ss.xx] lines -> [{ t, text }], sorted; several stamps on one line allowed
function parseLrc(lrc) {
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
  if (rec.plainLyrics) {
    const lines = rec.plainLyrics
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ t: -1, text }));
    if (lines.length) return { synced: false, lines };
  }
  return null;
}

async function lookup(title, artist, album, sec) {
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) q.set('album_name', album);
  if (sec > 0) q.set('duration', String(Math.round(sec)));
  // exact match first (fast, the right version of the song)
  let found = fromRecord(await get(`${API}/get?${q}`));
  if (found && (found.synced || found.instrumental)) return found;
  // then a search: the closest length, synced lyrics preferred
  const s = new URLSearchParams({ track_name: title, artist_name: artist });
  const list = (await get(`${API}/search?${s}`)) || [];
  const scored = list
    .filter((r) => r && (r.syncedLyrics || r.plainLyrics))
    .map((r) => ({ r, diff: sec > 0 && r.duration ? Math.abs(r.duration - sec) : 0 }))
    .filter((x) => x.diff <= 4)
    .sort((a, b) => !!b.r.syncedLyrics - !!a.r.syncedLyrics || a.diff - b.diff);
  if (scored.length) return fromRecord(scored[0].r) || found;
  return found;
}

// "not found" is kept for a day only: LRCLIB grows, and the song may get its words
const MISS_TTL = 24 * 3600 * 1000;

// a cache entry -> { hit, res }; misses saved before they had a time count as old
function fromCache(entry, now) {
  if (entry === undefined) return { hit: false };
  if (entry === null || entry.miss !== undefined) return { hit: now - ((entry && entry.miss) || 0) < MISS_TTL, res: null };
  return { hit: true, res: entry };
}

const pending = new Map();

// m: what Windows says is playing. Resolves to { synced, lines } or null.
// fresh: ask LRCLIB again even if the answer is cached ("search again" button).
function find(m, fresh = false) {
  load();
  const title = clean(m.title);
  const artist = firstArtist(m.artist);
  const sec = m.dur > 0 ? m.dur / 1000 : 0;
  const key = `${title.toLowerCase()}|${artist.toLowerCase()}|${Math.round(sec / 2)}`;
  const c = fresh ? { hit: false } : fromCache(cache.get(key), Date.now());
  if (c.hit) return Promise.resolve(c.res);
  // the same song asked twice while the first answer is on its way: one request
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    // a video in a browser: "Artist - Song" in the title, the channel as the artist
    const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
    let res = null;
    if (title && artist) res = await lookup(title, artist, clean(m.album), sec);
    if (!res && dash) res = await lookup(clean(dash[2]), firstArtist(dash[1]), '', sec);
    cache.delete(key); // re-added at the end: the newest answers outlive the trim in save()
    cache.set(key, res || { miss: Date.now() });
    save();
    return res;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

module.exports = { find, fromCache, parseLrc, clean, firstArtist };
