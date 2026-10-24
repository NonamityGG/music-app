// Bringing playlists in from other services. What arrives is a list of songs
// (artist + title); the sound comes later from the user's MP3s or Yandex Music.
//
// - Zvuk: see zvuk-import.js (by link, or all playlists after signing in)
// - Yandex Music: by link to an open playlist or album
// - Spotify: by link to a public playlist or album
// - VK and anything else: a pasted list, or a CSV/TXT export file

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { norm } from './match.js';

export const SOURCES = [
  { id: 'mine', name: 'Мои плейлисты', short: 'Мои', color: '#b79cff' },
  { id: 'zvuk', name: 'Звук', short: 'Звук', color: '#8a5cff' },
  { id: 'yandex', name: 'Яндекс Музыка', short: 'Яндекс', color: '#ffcc33' },
  { id: 'vk', name: 'VK Музыка', short: 'VK', color: '#2f87ff' },
  { id: 'spotify', name: 'Spotify', short: 'Spotify', color: '#1ed760' },
  { id: 'other', name: 'Другие', short: 'Другие', color: '#9c92b8' },
];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || SOURCES[0];

export class ImportError extends Error {}

// ---------- network (native on the phone, so other sites' CORS rules don't apply) ----------

let transport = null;
export function setImportTransport(fn) {
  transport = fn;
}

async function get(url, { headers = {}, method = 'GET', data } = {}) {
  let res;
  try {
    if (transport) res = await transport({ url, method, headers, data });
    else if (Capacitor.isNativePlatform()) {
      res = await CapacitorHttp.request({ url, method, headers, data, connectTimeout: 15000, readTimeout: 20000 });
    } else {
      const r = await fetch(url, { method, headers, body: data });
      const text = await r.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {}
      res = { status: r.status, data: body };
    }
  } catch {
    throw new ImportError('Нет связи с сервисом. Проверь интернет.');
  }
  return res;
}

// ---------- a song from any source ----------

export function extTrack({ title, artist = '', album = '', duration = 0, cover = '', ambiguous = false }) {
  title = String(title || '').trim();
  artist = String(artist || '').trim();
  const artists = artist
    .split(/\s*(?:,|&|\sfeat\.?\s|\sft\.?\s)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((name) => ({ id: '', name }));
  return {
    key: 'x:' + norm(artist) + '|' + norm(title),
    src: 'ext',
    title: title || 'Без названия',
    artist,
    artists,
    album: String(album || ''),
    cover,
    duration: Math.round(duration || 0),
    ...(ambiguous ? { ambiguous: true } : {}),
  };
}

function dedupe(tracks) {
  const seen = new Set();
  return tracks.filter((t) => {
    if (!t.title || seen.has(t.key)) return false;
    seen.add(t.key);
    return true;
  });
}

// ---------- links ----------

export function detectLink(text) {
  const s = String(text || '').trim();
  let m = s.match(/music\.yandex\.[a-z]+\/users\/([^/?#\s]+)\/playlists\/(\d+)/i);
  if (m) return { service: 'yandex', kind: 'user-playlist', owner: decodeURIComponent(m[1]), id: m[2] };
  m = s.match(/music\.yandex\.[a-z]+\/playlists\/([\w.-]+)/i);
  if (m) return { service: 'yandex', kind: 'playlist-uuid', id: m[1] };
  m = s.match(/music\.yandex\.[a-z]+\/album\/(\d+)/i);
  if (m) return { service: 'yandex', kind: 'album', id: m[1] };
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track)\/([A-Za-z0-9]+)/i);
  if (m) return { service: 'spotify', kind: m[1].toLowerCase(), id: m[2] };
  if (/vk\.com|vk\.ru|music\.vk/i.test(s)) return { service: 'vk', kind: 'unsupported' };
  return null;
}

export async function importFromLink(text) {
  const link = detectLink(text);
  if (!link) throw new ImportError('Не понял ссылку. Нужна ссылка на плейлист или альбом.');
  if (link.service === 'yandex') return importYandex(link);
  if (link.service === 'spotify') return importSpotify(link);
  throw new ImportError('VK не открывает плейлисты по ссылке. Скопируй список треков и вставь его текстом.');
}

// --- Yandex Music: public API used by its own apps; open playlists need no login ---

const YA = 'https://api.music.yandex.net';
const YA_HEADERS = { Accept: 'application/json', 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621' };

function yaTrack(t) {
  if (!t || !t.title) return null;
  const album = (t.albums && t.albums[0]) || {};
  const cover = t.coverUri || album.coverUri || '';
  return extTrack({
    title: t.version ? `${t.title} (${t.version})` : t.title,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: album.title || '',
    duration: (t.durationMs || 0) / 1000,
    cover: cover ? 'https://' + cover.replace('%%', '300x300') : '',
  });
}

async function yaGet(path) {
  const res = await get(YA + path, { headers: YA_HEADERS });
  if (res.status === 404) throw new ImportError('Плейлист не найден. Проверь ссылку.');
  if (res.status === 401 || res.status === 403) throw new ImportError('Яндекс не показывает этот плейлист: он закрытый. Сделай его открытым или вставь список текстом.');
  if (res.status !== 200 || !res.data || !res.data.result) throw new ImportError(`Яндекс не отдал плейлист (${res.status}). Можно вставить список текстом.`);
  return res.data.result;
}

async function yaFillTracks(items) {
  // some answers list only ids; ask for the full tracks then
  const missing = items.filter((it) => !it.track && it.id).map((it) => (it.albumId ? `${it.id}:${it.albumId}` : String(it.id)));
  const full = new Map();
  for (let i = 0; i < missing.length; i += 200) {
    const part = missing.slice(i, i + 200);
    const res = await get(YA + '/tracks', {
      method: 'POST',
      headers: { ...YA_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'track-ids=' + encodeURIComponent(part.join(',')) + '&with-positions=false',
    });
    for (const t of (res.data && res.data.result) || []) full.set(String(t.id), t);
  }
  return items.map((it) => it.track || full.get(String(it.id))).filter(Boolean);
}

async function importYandex(link) {
  let result;
  if (link.kind === 'album') {
    result = await yaGet(`/albums/${link.id}/with-tracks`);
    const tracks = (result.volumes || []).flat().map(yaTrack).filter(Boolean);
    return { name: result.title || 'Альбом', service: 'yandex', tracks: dedupe(tracks) };
  }
  result = link.kind === 'user-playlist' ? await yaGet(`/users/${encodeURIComponent(link.owner)}/playlists/${link.id}`) : await yaGet(`/playlist/${link.id}`);
  const raw = await yaFillTracks(result.tracks || []);
  const tracks = raw.map(yaTrack).filter(Boolean);
  if (!tracks.length) throw new ImportError('В плейлисте не нашлось треков. Если он закрытый, вставь список текстом.');
  return { name: result.title || 'Плейлист', service: 'yandex', tracks: dedupe(tracks) };
}

// --- Spotify: the public embed page carries the track list ---

function findTrackList(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return null;
  if (Array.isArray(obj.trackList)) return obj;
  for (const v of Object.values(obj)) {
    const r = findTrackList(v, depth + 1);
    if (r) return r;
  }
  return null;
}

async function importSpotify(link) {
  const res = await get(`https://open.spotify.com/embed/${link.kind}/${link.id}`, { headers: { Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' } });
  const html = typeof res.data === 'string' ? res.data : '';
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (res.status !== 200 || !m) throw new ImportError('Spotify не открылся. Выгрузи плейлист в файл через сервис переноса и загрузи файл сюда.');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new ImportError('Spotify прислал непонятную страницу. Попробуй через файл.');
  }
  const entity = findTrackList(data);
  if (!entity) throw new ImportError('В этом плейлисте Spotify не нашлось треков.');
  const tracks = entity.trackList.map((t) =>
    extTrack({ title: t.title, artist: String(t.subtitle || '').replace(/ /g, ' '), duration: (t.duration || 0) / 1000 })
  );
  return { name: entity.name || entity.title || 'Плейлист Spotify', service: 'spotify', tracks: dedupe(tracks) };
}

// ---------- pasted lists ----------

const DURATION = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const SEP = /\s+[-–—]\s+/;

function cleanLine(s) {
  return s
    .replace(/^\s*\d{1,4}[.)]\s+/, '') // "12. " numbering
    .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/, '') // trailing duration
    .replace(/[​﻿]/g, '')
    .trim();
}

function toSeconds(d) {
  const p = d.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

// "Artist - Title" per line, or blocks copied from a web page:
//   Title / Artist / 3:45   (order unknown, so the matcher tries both)
export function parseTextList(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const withSep = lines.filter((l) => SEP.test(cleanLine(l))).length;
  const durations = lines.filter((l) => DURATION.test(l)).length;
  const out = [];
  if (withSep >= lines.length * 0.5 || durations === 0) {
    for (const l of lines) {
      if (DURATION.test(l)) continue;
      const c = cleanLine(l);
      if (!c) continue;
      const parts = c.split(SEP);
      if (parts.length >= 2) out.push(extTrack({ artist: parts[0], title: parts.slice(1).join(' - ') }));
      else out.push(extTrack({ title: c, ambiguous: true }));
    }
  } else {
    let block = [];
    for (const l of lines) {
      if (DURATION.test(l)) {
        const texts = block.map(cleanLine).filter(Boolean);
        if (texts.length >= 2) {
          const [a, b] = texts.slice(-2);
          out.push(extTrack({ title: a, artist: b, duration: toSeconds(l), ambiguous: true }));
        } else if (texts.length === 1) {
          const parts = texts[0].split(SEP);
          if (parts.length >= 2) out.push(extTrack({ artist: parts[0], title: parts.slice(1).join(' - '), duration: toSeconds(l) }));
          else out.push(extTrack({ title: texts[0], duration: toSeconds(l), ambiguous: true }));
        }
        block = [];
      } else block.push(l);
    }
  }
  return dedupe(out);
}

// ---------- CSV / TXT export files ----------

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const COLS = {
  title: ['track name', 'track', 'title', 'name', 'song', 'song name', 'название', 'трек', 'песня'],
  artist: ['artist name(s)', 'artist names', 'artist name', 'artist', 'artists', 'исполнитель', 'артист', 'исполнители'],
  album: ['album name', 'album', 'альбом'],
  duration: ['duration (ms)', 'track duration (ms)', 'duration_ms', 'duration', 'длительность'],
  playlist: ['playlist name', 'playlist', 'плейлист'],
};

function findCol(header, names) {
  const h = header.map((x) => x.trim().toLowerCase().replace(/^﻿/, ''));
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

// Returns [{ name, tracks }] — export files may hold several playlists.
export function parseExportFile(text, fileName = '') {
  text = String(text || '').replace(/^﻿/, '');
  const base = fileName.replace(/\.[a-z0-9]+$/i, '') || 'Плейлист';
  if (/\.csv$/i.test(fileName) || /^[^\n]*(track|title|artist|название|исполнитель)[^\n]*[,;\t]/i.test(text)) {
    const rows = parseCsv(text);
    if (rows.length > 1) {
      const header = rows[0];
      const ti = findCol(header, COLS.title);
      const ai = findCol(header, COLS.artist);
      if (ti >= 0) {
        const al = findCol(header, COLS.album);
        const di = findCol(header, COLS.duration);
        const pi = findCol(header, COLS.playlist);
        const groups = new Map();
        for (const r of rows.slice(1)) {
          const title = r[ti];
          if (!title || !title.trim()) continue;
          let dur = di >= 0 ? Number(String(r[di]).replace(',', '.')) || 0 : 0;
          if (dur > 10000) dur /= 1000; // milliseconds
          else if (di >= 0 && DURATION.test(String(r[di]).trim())) dur = toSeconds(String(r[di]).trim());
          const name = (pi >= 0 && r[pi] && r[pi].trim()) || base;
          if (!groups.has(name)) groups.set(name, []);
          groups.get(name).push(extTrack({ title, artist: ai >= 0 ? r[ai] : '', album: al >= 0 ? r[al] : '', duration: dur, ambiguous: ai < 0 }));
        }
        return [...groups.entries()].map(([name, tracks]) => ({ name, tracks: dedupe(tracks) })).filter((g) => g.tracks.length);
      }
    }
  }
  const tracks = parseTextList(text);
  return tracks.length ? [{ name: base, tracks }] : [];
}
