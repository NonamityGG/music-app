// Yandex Music. The user signs in with Yandex ID on the real Yandex site inside
// the app; the signed-in site hands out its own session token, and with it the
// app talks to the same API the Yandex Music apps use. Everything here returns
// the same shapes as zvuk.js, with ids prefixed "y:" so the rest of the app can
// tell the services apart.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import * as web from './serviceweb.js';
import { settings, saveSettings, logError } from './settings.js';
import { md5 } from './md5.js';
import { chunk } from './util.js';

const API = 'https://api.music.yandex.net';
const MUSIC = 'https://music.yandex.ru/';
// Yandex ID sign-in for the Yandex Music app; after it the page goes to
// music.yandex.ru/#access_token=…, which the in-app browser catches.
const OAUTH = 'https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d';

export function tokenFromUrl(url) {
  const m = String(url || '').match(/[#&?]access_token=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export class YandexError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind; // network | auth | notfound | http | bad | unavailable
    this.status = status;
  }
}

let transport = null;
export function setYandexTransport(fn) {
  transport = fn;
}

export const isLoggedIn = () => !!settings.yaToken;
const uid = () => settings.yaUid;
export const strip = (id) => String(id).replace(/^y:/, '');

// ---------- network ----------

async function raw(url, { method = 'GET', headers = {}, data, text = false } = {}) {
  let res;
  try {
    if (transport) res = await transport({ url, method, headers, data });
    else if (Capacitor.isNativePlatform()) {
      res = await CapacitorHttp.request({ url, method, headers, data, connectTimeout: 15000, readTimeout: 20000, responseType: text ? 'text' : 'json' });
    } else {
      const r = await fetch(url, { method, headers, body: data });
      const t = await r.text();
      let body = t;
      if (!text) {
        try {
          body = JSON.parse(t);
        } catch {}
      }
      res = { status: r.status, data: body };
    }
  } catch {
    throw new YandexError('network', 'Нет связи с Яндекс Музыкой. Проверь интернет.');
  }
  return res;
}

async function api(method, path, { params, form } = {}) {
  const u = new URL(API + path);
  if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const headers = { Accept: 'application/json', 'Accept-Language': 'ru', 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621' };
  if (settings.yaToken) headers.Authorization = 'OAuth ' + settings.yaToken;
  let data;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    data = new URLSearchParams(form).toString();
  }
  const res = await raw(u.toString(), { method, headers, data });
  let body = res.data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (res.status === 401 || res.status === 403) throw new YandexError('auth', 'Яндекс просит войти заново', res.status);
  if (res.status === 404) throw new YandexError('notfound', 'Не найдено в Яндекс Музыке', 404);
  if (res.status < 200 || res.status >= 300 || !body) throw new YandexError('http', `Ошибка Яндекс Музыки (${res.status})`, res.status);
  return body.result !== undefined ? body.result : body;
}

// ---------- sign in ----------

// Ask the signed-in Yandex Music site for its session token.
async function tokenFromSite() {
  await web.open('yandex', MUSIC);
  await web.nextPage('yandex', 15000);
  const attempts = [
    MUSIC + 'api/v2.1/handlers/auth?external-domain=music.yandex.ru&overembed=no',
    MUSIC + 'api/v2.1/handlers/auth',
  ];
  for (const url of attempts) {
    const r = await web.request('yandex', url, { headers: { Accept: 'application/json', 'X-Retpath-Y': MUSIC } });
    let j = null;
    try {
      j = JSON.parse(r.body || '');
    } catch {}
    const token = j && (j.token || j.access_token || (j.result && (j.result.token || j.result.access_token)));
    if (token) return token;
    logError('yandex:auth', new Error(`ответ ${r.status}: ${String(r.body || r.error || '').slice(0, 160)}`));
  }
  return '';
}

export async function account() {
  const r = await api('GET', '/account/status');
  const acc = r.account || {};
  return { uid: String(acc.uid || ''), login: acc.login || '', name: acc.displayName || acc.fullName || acc.login || '', plus: !!(r.plus && r.plus.hasPlus) };
}

export async function loginViaWeb() {
  const ev = await web.askUser('yandex', OAUTH, 'Вход через Яндекс ID', { watch: 'access_token=' });
  let token = tokenFromUrl(ev.url);
  if (!token) token = await tokenFromSite();
  if (!token) throw new YandexError('auth', 'Не получилось войти в Яндекс Музыку. Проверь, что вход прошёл, и попробуй ещё раз.');
  saveSettings({ yaToken: token });
  try {
    const a = await account();
    if (!a.uid) throw new YandexError('auth', 'Яндекс не узнал аккаунт');
    saveSettings({ yaUid: a.uid, yaLogin: a.login, yaName: a.name, yaPlus: a.plus });
    return a;
  } catch (e) {
    saveSettings({ yaToken: '' });
    throw e;
  }
}

// Fallback: the user pasted a token by hand.
export async function loginWithToken(token) {
  const prev = settings.yaToken;
  saveSettings({ yaToken: token });
  try {
    const a = await account();
    if (!a.uid) throw new YandexError('auth', 'Яндекс не узнал аккаунт');
    saveSettings({ yaUid: a.uid, yaLogin: a.login, yaName: a.name, yaPlus: a.plus });
    return a;
  } catch (e) {
    saveSettings({ yaToken: prev });
    throw e;
  }
}

export async function logout() {
  saveSettings({ yaToken: '', yaUid: '', yaLogin: '', yaName: '', yaPlus: false });
  if (web.available()) await web.forget(['music.yandex.ru', 'yandex.ru', 'passport.yandex.ru']).catch(() => {});
}

// ---------- shapes ----------

export function cover(uri, size = 300) {
  if (!uri) return '';
  const u = String(uri).replace('%%', `${size}x${size}`);
  return u.startsWith('http') ? u : 'https://' + u;
}

export function normTrack(t) {
  if (!t || !t.id || !t.title) return null;
  const album = (t.albums && t.albums[0]) || {};
  const artists = (t.artists || []).map((a) => ({ id: 'y:' + a.id, name: a.name }));
  return {
    key: 'y:' + t.id,
    src: 'yandex',
    yid: String(t.id),
    title: t.version ? `${t.title} (${t.version})` : t.title,
    artists,
    artist: artists.map((a) => a.name).join(', '),
    album: album.title || '',
    releaseId: album.id ? 'y:' + album.id : '',
    cover: cover(t.coverUri || album.coverUri),
    duration: Math.round((t.durationMs || 0) / 1000),
    explicit: t.contentWarning === 'explicit',
  };
}

export function normArtist(a) {
  if (!a || !a.id) return null;
  const c = a.cover && (a.cover.uri || (a.cover.itemsUri && a.cover.itemsUri[0]));
  return { id: 'y:' + a.id, name: a.name, image: cover(c || a.ogImage) };
}

export function normRelease(al) {
  if (!al || !al.id) return null;
  const artists = (al.artists || []).map((a) => ({ id: 'y:' + a.id, name: a.name }));
  return {
    id: 'y:' + al.id,
    title: al.title,
    date: al.releaseDate || (al.year ? `${al.year}-01-01` : ''),
    type: al.type === 'single' ? 'single' : 'album',
    cover: cover(al.coverUri),
    artist: artists.map((a) => a.name).join(', '),
    artists,
  };
}

// ---------- catalogue ----------

export async function quickSearch(query, limit = 24) {
  const r = await api('GET', '/search', { params: { text: query, type: 'all', page: 0, nocorrect: 'false' } });
  const pick = (k) => ((r[k] && r[k].results) || []).slice(0, limit);
  return {
    tracks: pick('tracks').map(normTrack).filter(Boolean),
    artists: pick('artists').map(normArtist).filter(Boolean),
    releases: pick('albums').map(normRelease).filter(Boolean),
    playlists: [],
  };
}

export async function getTracks(ids) {
  const out = [];
  for (const part of chunk(ids.map(strip), 100)) {
    const r = await api('POST', '/tracks', { form: { 'track-ids': part.join(','), 'with-positions': 'false' } });
    for (const t of r || []) {
      const n = normTrack(t);
      if (n) out.push(n);
    }
  }
  const byId = new Map(out.map((t) => [t.yid, t]));
  return ids.map((id) => byId.get(strip(id).split(':')[0])).filter(Boolean);
}

export async function streamUrl(yid) {
  const infos = await api('GET', `/tracks/${strip(yid)}/download-info`);
  const mp3 = (infos || []).filter((i) => i.codec === 'mp3' && i.downloadInfoUrl).sort((a, b) => b.bitrateInKbps - a.bitrateInKbps);
  if (!mp3.length) throw new YandexError('unavailable', 'Яндекс не отдаёт этот трек');
  const info = settings.quality === 'mid' ? mp3.find((i) => i.bitrateInKbps <= 192) || mp3[mp3.length - 1] : mp3[0];
  const res = await raw(info.downloadInfoUrl, { text: true });
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
  const field = (name) => {
    const m = text.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || text.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`));
    return m ? m[1] : '';
  };
  const host = field('host');
  const path = field('path');
  const ts = field('ts');
  const s = field('s');
  if (!host || !path) throw new YandexError('unavailable', 'Яндекс не отдал ссылку на трек');
  const sign = md5('XGRlBW9FXlekgbPrRHuSiA' + path.slice(1) + s);
  return `https://${host}/get-mp3/${sign}/${ts}${path}`;
}

export async function userPlaylists() {
  if (!uid()) return [];
  const r = await api('GET', `/users/${uid()}/playlists/list`);
  return (r || []).map((p) => ({
    id: `y:${uid()}:${p.kind}`,
    title: p.title || 'Плейлист',
    cover: cover((p.cover && (p.cover.uri || (p.cover.itemsUri && p.cover.itemsUri[0]))) || p.ogImage),
    trackCount: p.trackCount || 0,
    trackIds: [],
  }));
}

async function fillTracks(items) {
  const missing = items.filter((it) => !it.track && it.id).map((it) => (it.albumId ? `${it.id}:${it.albumId}` : String(it.id)));
  const full = new Map();
  for (const part of chunk(missing, 100)) {
    const r = await api('POST', '/tracks', { form: { 'track-ids': part.join(','), 'with-positions': 'false' } });
    for (const t of r || []) full.set(String(t.id), t);
  }
  return items.map((it) => it.track || full.get(String(it.id))).filter(Boolean);
}

export async function playlistTracks(id) {
  const [, owner, kind] = String(id).split(':');
  const r = await api('GET', `/users/${owner}/playlists/${kind}`);
  const tracks = (await fillTracks(r.tracks || [])).map(normTrack).filter(Boolean);
  return { title: r.title, cover: cover(r.cover && (r.cover.uri || (r.cover.itemsUri && r.cover.itemsUri[0]))), tracks };
}

export async function likedTrackIds() {
  if (!uid()) return [];
  const r = await api('GET', `/users/${uid()}/likes/tracks`);
  const list = (r.library && r.library.tracks) || [];
  return list.map((t) => String(t.id));
}

export async function collectionArtistIds() {
  if (!uid()) return [];
  const r = await api('GET', `/users/${uid()}/likes/artists`, { params: { 'with-timestamps': 'false' } });
  return (r || []).map((x) => 'y:' + ((x.artist && x.artist.id) || x.id)).filter((x) => x !== 'y:undefined');
}

export async function getArtists(ids, opts = {}) {
  const out = [];
  for (const id of ids) {
    try {
      const r = await api('GET', `/artists/${strip(id)}/brief-info`);
      const a = normArtist(r.artist);
      if (!a) continue;
      out.push({
        ...a,
        releases: (r.albums || []).slice(0, opts.releases || 10).map(normRelease).filter(Boolean),
        tracks: (r.popularTracks || []).slice(0, opts.tracks || 10).map(normTrack).filter(Boolean),
        related: (r.similarArtists || []).slice(0, opts.related || 10).map(normArtist).filter(Boolean),
      });
    } catch (e) {
      if (e.kind === 'network' || e.kind === 'auth') throw e;
      logError('yandex:artist', e);
    }
  }
  return out;
}

export async function getRelease(id) {
  const r = await api('GET', `/albums/${strip(id)}/with-tracks`);
  const rel = normRelease(r);
  if (!rel) return null;
  return { ...rel, tracks: (r.volumes || []).flat().map(normTrack).filter(Boolean) };
}

// ---------- lyrics ----------
// The apps sign lyrics requests: HMAC-SHA256 of "<track id><unix time>".
const LYRICS_KEY = 'p93jhgh689SBReK6ghtw62';

export async function signLyrics(trackId, ts) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(LYRICS_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${trackId}${ts}`)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

// { text, synced } or null when Yandex has no words for the track.
export async function lyrics(yid) {
  const id = strip(yid).split(':')[0];
  for (const format of ['LRC', 'TEXT']) {
    const ts = Math.floor(Date.now() / 1000);
    let info;
    try {
      info = await api('GET', `/tracks/${id}/lyrics`, { params: { format, timeStamp: ts, sign: await signLyrics(id, ts) } });
    } catch (e) {
      if (e.kind === 'network' || e.kind === 'auth') throw e;
      continue; // no words in this format
    }
    if (!info || !info.downloadUrl) continue;
    const res = await raw(info.downloadUrl, { text: true });
    const text = typeof res.data === 'string' ? res.data : '';
    if (res.status >= 200 && res.status < 300 && text.trim()) return { text, synced: format === 'LRC' };
  }
  return null;
}

export async function setLiked(yid, liked) {
  if (!isLoggedIn() || !uid()) throw new YandexError('auth', 'Чтобы ставить лайки, войди в Яндекс в профиле');
  await api('POST', `/users/${uid()}/likes/tracks/${liked ? 'add-multiple' : 'remove'}`, { form: { 'track-ids': strip(yid) } });
}
