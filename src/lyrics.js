// Words of the song. Where they come from, in order:
//   1. the MP3 file itself (USLT tag), for the user's own tracks
//   2. Yandex Music (synced LRC when it has it), for tracks that play from there
//   3. LRCLIB (lrclib.net), an open library of synced lyrics, for everything else
// Results — including "nothing found" — are remembered for a while.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import * as ya from './yandex.js';
import { localBlob, localTracks } from './local.js';
import { readLyricsTag } from './id3.js';
import { bestMatch, norm } from './match.js';
import { load, save, logError } from './settings.js';

const LRCLIB = 'https://lrclib.net/api';
const UA = 'Rezonans/1.1 (https://github.com/NonamityGG/music-app)';
const KEEP = 90; // remembered tracks
const RETRY_MISS = 3 * 24 * 3600 * 1000; // ask again for "no lyrics" after 3 days

let transport = null;
export function setLyricsTransport(fn) {
  transport = fn;
}

async function getText(url, params) {
  const u = new URL(url);
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  if (transport) return transport({ url: u.toString() });
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({ url: u.toString(), method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/json' }, responseType: 'json', connectTimeout: 10000, readTimeout: 15000 });
    return { status: r.status, data: r.data };
  }
  const r = await fetch(u.toString());
  let data = await r.text();
  try {
    data = JSON.parse(data);
  } catch {}
  return { status: r.status, data };
}

// ---------- LRC ----------

// "[01:02.50]Слова" → { t: 62.5, text: 'Слова' }. Several stamps on one line are
// allowed; [offset:+300] shifts everything. Text without stamps is plain lyrics.
export function parseLrc(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  let offset = 0;
  const lines = [];
  const plain = [];
  for (const row of text.split('\n')) {
    const off = row.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) {
      offset = Number(off[1]) / 1000;
      continue;
    }
    if (/^\s*\[(ar|ti|al|by|au|length|re|ve|la|#):/i.test(row)) continue;
    const stamps = [];
    let rest = row;
    let m;
    while ((m = rest.match(/^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/))) {
      stamps.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')));
      rest = rest.slice(m[0].length);
    }
    // word-level stamps some files carry: <00:12.34>
    rest = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    if (stamps.length) for (const t of stamps) lines.push({ t: Math.max(0, t - offset), text: rest });
    else plain.push(row.trim());
  }
  if (lines.length >= 2) {
    lines.sort((a, b) => a.t - b.t);
    return { synced: true, lines };
  }
  // plain text: keep stanza breaks but not runs of empty lines
  const out = [];
  for (const l of plain) if (l || (out.length && out[out.length - 1].text)) out.push({ t: null, text: l });
  while (out.length && !out[out.length - 1].text) out.pop();
  return { synced: false, lines: out };
}

// ---------- cache ----------

// "lyrics2": results from before the stricter matching (1.1.7) are not reused
const CACHE = 'lyrics2';
let cache = load(CACHE, {});

function remember(key, value) {
  cache[key] = { at: Date.now(), v: value };
  const keys = Object.keys(cache);
  if (keys.length > KEEP) {
    keys.sort((a, b) => cache[a].at - cache[b].at);
    for (const k of keys.slice(0, keys.length - KEEP)) delete cache[k];
  }
  save(CACHE, cache);
}

function recalled(key) {
  const c = cache[key];
  if (!c) return undefined;
  if (!c.v && Date.now() - c.at > RETRY_MISS) return undefined;
  return c.v;
}

const cacheKey = (t) => (t.yid ? 'y:' + t.yid : 'k:' + norm(t.artist || '') + '|' + norm(t.title || ''));

// ---------- sources ----------

async function fromFile(track) {
  let lid = track.src === 'local' || track.match === 'local' ? track.lid : '';
  if (!lid && track.src !== 'local') {
    const m = bestMatch(track, await localTracks());
    if (m) lid = m.lid;
  }
  if (!lid) return null;
  const blob = await localBlob(lid);
  if (!blob) return null;
  const text = await readLyricsTag(blob);
  return text.trim() ? { text, source: 'файл MP3' } : null;
}

async function fromYandex(track) {
  if (!track.yid || !ya.isLoggedIn()) return null;
  const r = await ya.lyrics(track.yid);
  return r ? { text: r.text, source: 'Яндекс Музыка' } : null;
}

// Synced words are only trusted for the very same recording: a version that is a
// few seconds longer or shorter (another intro, a radio edit) runs ahead or
// behind the whole time. Such a version gives its words without timings.
const SYNC_SLACK = 3; // seconds of length difference still taken as the same recording

const unstamped = (lrc) =>
  String(lrc || '')
    .split('\n')
    .map((l) => l.replace(/^(\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim())
    .filter((l, i, arr) => l || (i > 0 && arr[i - 1]))
    .join('\n');

// Picks the LRCLIB result for the same song: close in length, synced if possible.
export function pickLrclib(track, results) {
  if (!Array.isArray(results) || !results.length) return null;
  const cands = results
    .filter((r) => r && (r.syncedLyrics || r.plainLyrics) && !r.instrumental)
    .map((r) => ({ ...r, title: r.trackName || r.name || '', artist: r.artistName || '', duration: r.duration || 0 }));
  if (!cands.length) return null;
  const best = bestMatch({ title: track.title, artist: track.artist, duration: track.duration }, cands, 0.6);
  if (!best) return null;
  // among results for that song, prefer synced and the closest length
  const same = cands.filter((c) => norm(c.title) === norm(best.title) && norm(c.artist) === norm(best.artist));
  same.sort((a, b) => {
    const sa = a.syncedLyrics ? 0 : 1;
    const sb = b.syncedLyrics ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const d = track.duration || 0;
    return Math.abs((a.duration || 0) - d) - Math.abs((b.duration || 0) - d);
  });
  const r = same[0] || best;
  const diff = track.duration && r.duration ? Math.abs(r.duration - track.duration) : 0;
  if (diff > 12) return null;
  if (diff > SYNC_SLACK) return r.plainLyrics || unstamped(r.syncedLyrics) || null;
  return r.syncedLyrics || r.plainLyrics;
}

async function fromLrclib(track) {
  if (!track.title) return null;
  // the exact recording first: LRCLIB matches it by length
  if (track.duration) {
    const g = await getText(LRCLIB + '/get', { track_name: track.title, artist_name: track.artist || '', duration: Math.round(track.duration) });
    if (g.status === 200 && g.data && typeof g.data === 'object') {
      const text = pickLrclib(track, [g.data]);
      if (text) return { text, source: 'LRCLIB' };
    }
  }
  let res = await getText(LRCLIB + '/search', { track_name: track.title, artist_name: track.artist || '' });
  let text = res.status === 200 ? pickLrclib(track, res.data) : null;
  if (!text) {
    res = await getText(LRCLIB + '/search', { q: `${track.artist || ''} ${track.title}`.trim() });
    text = res.status === 200 ? pickLrclib(track, res.data) : null;
  }
  return text ? { text, source: 'LRCLIB' } : null;
}

// { synced, lines, source } or null.
export async function lyricsFor(track) {
  if (!track) return null;
  const key = cacheKey(track);
  const known = recalled(key);
  if (known !== undefined) return known;
  let found = null;
  for (const source of [fromFile, fromYandex, fromLrclib]) {
    try {
      found = await source(track);
    } catch (e) {
      if (e && e.kind === 'network') throw e; // offline: don't remember a miss
      logError('lyrics', e);
    }
    if (found) break;
  }
  let value = found ? { ...parseLrc(found.text), source: found.source } : null;
  // timings that run past the end of the track belong to another recording
  if (value && value.synced && track.duration && value.lines.length && value.lines[value.lines.length - 1].t > track.duration + 4) {
    value = { ...parseLrc(unstamped(found.text)), source: found.source };
  }
  if (value && !value.lines.length) {
    remember(key, null);
    return null;
  }
  remember(key, value);
  return value;
}
