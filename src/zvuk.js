// Client for Zvuk (zvuk.com). The API is unofficial: it is the same GraphQL and
// "tiny" API the zvuk.com web player uses. On the phone every request is made
// from inside zvuk.com, opened in a hidden in-app browser where the user signed
// in: to Zvuk's bot protection that is an ordinary browser tab.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { settings, saveSettings, logError } from './settings.js';
import { chunk } from './util.js';
import * as web from './serviceweb.js';

const GQL_URL = 'https://zvuk.com/api/v1/graphql';
const TINY = 'https://zvuk.com/api/tiny';
const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://zvuk.com/',
  Origin: 'https://zvuk.com',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export class ZvukError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind; // network | bot | check | auth | rate | http | gql | bad | unavailable
    this.status = status;
  }
}

// Lets tests replace the network layer.
let transport = null;
export function setTransport(fn) {
  transport = fn;
}

// ---------- pacing and anti-bot protection ----------
// Zvuk's protection reacts to bursts of requests, so requests are spaced out and
// only two run at a time. When it does block, the app backs off for a while
// instead of hammering it (which only extends the block).

const pacing = { gap: 220, parallel: 2, botRetryMs: 2500 };
// first block in ten minutes: wait 30 s, then 60 s, then 2 min
const BACKOFF = [30000, 60000, 120000];
let blockTimes = [];
export function setPacing(p) {
  Object.assign(pacing, p);
}
let inFlight = 0;
let lastStart = 0;
let botUntil = 0;

export const botBlocked = () => Date.now() < botUntil;
export const botRemaining = () => Math.max(0, botUntil - Date.now());
export function resetBotState() {
  botUntil = 0;
  blockTimes = [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function slot() {
  for (;;) {
    const wait = pacing.gap - (Date.now() - lastStart);
    if (inFlight < pacing.parallel && wait <= 0) break;
    await sleep(Math.max(25, wait));
  }
  inFlight++;
  lastStart = Date.now();
}

// ---------- the in-app browser route ----------

const HOME = 'https://zvuk.com/';
const viaWeb = () => !transport && web.available() && settings.zvukWeb !== false;
let pageReady = null;
let needCheck = false;

function ensurePage() {
  if (!pageReady) {
    pageReady = web
      .open('zvuk', HOME)
      .then(() => web.nextPage('zvuk', 15000))
      .catch(() => null);
  }
  return pageReady;
}

function checkError() {
  return new ZvukError('check', 'Звук просит подтвердить, что ты не робот. Это нужно сделать один раз.', 418);
}

export const checkNeeded = () => needCheck;

// Shows zvuk.com so the user can pass Zvuk's "not a robot" check.
export async function passCheck() {
  await web.askUser('zvuk', HOME, 'Пройди проверку и нажми «Готово»');
  needCheck = false;
  pageReady = null;
  resetBotState();
}

async function httpWeb(req) {
  if (needCheck) throw checkError();
  await ensurePage();
  await slot();
  try {
    return await httpOnce(req);
  } catch (e) {
    if (e.kind !== 'bot') throw e;
  } finally {
    inFlight--;
  }
  // the site wants to look at the browser again: reload it so its own check runs, then retry
  pageReady = null;
  await ensurePage();
  await sleep(1500);
  await slot();
  try {
    return await httpOnce(req);
  } catch (e) {
    if (e.kind === 'bot') {
      needCheck = true;
      throw checkError();
    }
    throw e;
  } finally {
    inFlight--;
  }
}

async function http(req) {
  if (viaWeb()) return httpWeb(req);
  if (botBlocked()) throw botError(418);
  await slot();
  try {
    return await httpOnce(req);
  } catch (e) {
    if (e.kind !== 'bot') throw e;
  } finally {
    inFlight--;
  }
  // blocked: one calm retry, then back off
  await sleep(pacing.botRetryMs);
  await slot();
  try {
    return await httpOnce(req);
  } catch (e) {
    if (e.kind === 'bot') {
      const now = Date.now();
      blockTimes = blockTimes.filter((t) => now - t < 10 * 60 * 1000);
      blockTimes.push(now);
      botUntil = now + BACKOFF[Math.min(blockTimes.length - 1, BACKOFF.length - 1)];
      throw botError(e.status); // message with the actual wait
    }
    throw e;
  } finally {
    inFlight--;
  }
}

async function httpOnce({ method, url, params, data, token }) {
  const headers = { ...HEADERS };
  if (token) headers['X-Auth-Token'] = token;
  if (data) headers['Content-Type'] = 'application/json';
  const strParams = params ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) : undefined;

  let res;
  try {
    if (transport) {
      res = await transport({ method, url, params: strParams, data, headers });
    } else if (viaWeb()) {
      const u = new URL(url);
      if (strParams) for (const [k, v] of Object.entries(strParams)) u.searchParams.set(k, v);
      const h = { Accept: HEADERS.Accept };
      if (token) h['X-Auth-Token'] = token;
      if (data) h['Content-Type'] = 'application/json';
      const r = await web.request('zvuk', u.toString(), { method, headers: h, body: data ? JSON.stringify(data) : undefined });
      if (!r || !r.status) throw new Error((r && r.error) || 'no response');
      let parsed = r.body;
      try {
        parsed = JSON.parse(r.body);
      } catch {}
      res = { status: r.status, data: parsed };
    } else if (Capacitor.isNativePlatform()) {
      res = await CapacitorHttp.request({
        method,
        url,
        headers,
        params: strParams,
        data,
        connectTimeout: 15000,
        readTimeout: 20000,
        responseType: 'json',
      });
    } else {
      // Desktop browser during development: forbidden headers are dropped, CORS may block.
      const u = new URL(url);
      if (strParams) for (const [k, v] of Object.entries(strParams)) u.searchParams.set(k, v);
      const h = { Accept: HEADERS.Accept };
      if (token) h['X-Auth-Token'] = token;
      if (data) h['Content-Type'] = 'application/json';
      const r = await fetch(u, { method, headers: h, body: data ? JSON.stringify(data) : undefined });
      const text = await r.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {}
      res = { status: r.status, data: body };
    }
  } catch (e) {
    throw new ZvukError('network', 'Нет связи со Звуком. Проверь интернет.');
  }

  let body = res.data;
  if (res.status === 418) throw botError(418);
  if (typeof body === 'string') {
    const head = body.slice(0, 400).toLowerCase();
    if (head.includes('<html') || head.includes('bot activity')) throw botError(res.status);
    if (body.trim() === '') body = {};
    else {
      try {
        body = JSON.parse(body);
      } catch {
        throw new ZvukError('bad', `Непонятный ответ Звука (${res.status})`, res.status);
      }
    }
  }
  if (res.status === 401 || res.status === 403) throw new ZvukError('auth', 'Звук не принял токен', res.status);
  if (res.status === 429) throw new ZvukError('rate', 'Слишком много запросов к Звуку, подожди минуту', 429);
  if (res.status < 200 || res.status >= 300) {
    throw new ZvukError('http', `Ошибка Звука (${res.status})`, res.status);
  }
  return body;
}

function botError(status) {
  const sec = Math.ceil(botRemaining() / 1000);
  return new ZvukError('bot', sec ? `Звук ненадолго закрыл доступ. Повторю сам через ${sec} с` : 'Звук ненадолго закрыл доступ. Повторю сам чуть позже', status);
}

// ---------- tokens ----------

export const isLoggedIn = () => !!settings.token;

// Sign in on zvuk.com inside the app (Sber ID or phone), then take the session's token.
export async function loginViaWeb() {
  await web.askUser('zvuk', HOME, 'Войди в Звук и нажми «Готово»');
  pageReady = null;
  needCheck = false;
  resetBotState();
  const body = await http({ method: 'GET', url: TINY + '/profile' });
  const r = (body && body.result) || {};
  const anon = r.is_anonymous ?? r.isAnonymous;
  if (!r.token || anon) throw new ZvukError('auth', 'Вход не завершён: в окне Звука нужно войти в аккаунт');
  saveSettings({ token: r.token, anonToken: '' });
  return r;
}

export async function logout() {
  saveSettings({ token: '', anonToken: '' });
  pageReady = null;
  if (web.available()) await web.forget(['zvuk.com', 'id.sber.ru']).catch(() => {});
}

async function anonToken() {
  if (settings.anonToken) return settings.anonToken;
  const body = await http({ method: 'GET', url: TINY + '/profile' });
  const t = body && body.result && body.result.token;
  if (!t) throw new ZvukError('bad', 'Не удалось получить гостевой доступ к Звуку');
  saveSettings({ anonToken: t });
  return t;
}

async function currentToken() {
  return settings.token || (await anonToken());
}

async function withToken(fn) {
  const t = await currentToken();
  try {
    return await fn(t);
  } catch (e) {
    // a stale guest token is simply replaced
    if (e.kind === 'auth' && !settings.token && settings.anonToken) {
      saveSettings({ anonToken: '' });
      return fn(await anonToken());
    }
    throw e;
  }
}

async function gql(op, query, variables = {}) {
  return withToken(async (token) => {
    const body = await http({ method: 'POST', url: GQL_URL, data: { operationName: op, query, variables }, token });
    const data = body && body.data;
    if (body && body.errors && body.errors.length) {
      const msg = body.errors.map((e) => e.message).join('; ');
      const hasData = data && Object.values(data).some((v) => v !== null && v !== undefined);
      if (!hasData) {
        if (/auth|unauthori|forbidden|token/i.test(msg)) throw new ZvukError('auth', 'Нужен вход в Звук: ' + msg);
        throw new ZvukError('gql', 'Звук вернул ошибку: ' + msg);
      }
      logError('zvuk:' + op, new Error(msg));
    }
    return data || {};
  });
}

async function tiny(path, params) {
  return withToken(async (token) => {
    const body = await http({ method: 'GET', url: TINY + path, params, token });
    return body && body.result !== undefined ? body.result : body;
  });
}

// Checks a personal token and returns basic profile info.
export async function checkToken(token) {
  const body = await http({ method: 'GET', url: TINY + '/profile', token });
  const r = (body && body.result) || {};
  const anon = r.is_anonymous ?? r.isAnonymous;
  if (anon === true) throw new ZvukError('auth', 'Это гостевой токен. Сначала войди на zvuk.com, потом скопируй токен.');
  return r;
}

// ---------- models ----------

export function img(src, size = 300) {
  if (!src) return '';
  let s = String(src).replace('{size}', `${size}x${size}`).replace('{width}', size).replace('{height}', size);
  try {
    const u = new URL(s, 'https://zvuk.com');
    if (!src.includes('{size}')) u.searchParams.set('size', `${size}x${size}`);
    return u.toString();
  } catch {
    return '';
  }
}

export function normTrack(t) {
  if (!t || !t.id) return null;
  const artists = (t.artists || []).map((a) => ({ id: String(a.id), name: a.title }));
  const rel = t.release || {};
  return {
    key: 'z:' + t.id,
    src: 'zvuk',
    zid: String(t.id),
    title: t.title || 'Без названия',
    artists,
    artist: artists.map((a) => a.name).join(', '),
    album: rel.title || '',
    releaseId: rel.id ? String(rel.id) : '',
    cover: img((rel.image && rel.image.src) || (t.artists && t.artists[0] && t.artists[0].image && t.artists[0].image.src), 300),
    duration: t.duration || 0,
    explicit: !!t.explicit,
  };
}

export function normArtist(a) {
  if (!a || !a.id) return null;
  return { id: String(a.id), name: a.title, image: img(a.image && a.image.src, 300) };
}

export function normRelease(r) {
  if (!r || !r.id) return null;
  return {
    id: String(r.id),
    title: r.title,
    date: r.date || '',
    type: r.type || '',
    cover: img(r.image && r.image.src, 300),
    artist: (r.artists || []).map((a) => a.title).join(', '),
    artists: (r.artists || []).map((a) => ({ id: String(a.id), name: a.title })),
  };
}

// ---------- queries ----------

const TRACK = `id title duration explicit
  artists { id title image { src } }
  release { id title date image { src } }`;

const RELEASE = `id title date type image { src } artists { id title }`;

export async function quickSearch(query, limit = 24) {
  const q = `query quickSearch($query: String, $limit: Int) {
    quickSearch(query: $query, limit: $limit) {
      content {
        __typename
        ... on Track { ${TRACK} }
        ... on Artist { id title image { src } }
        ... on Release { ${RELEASE} }
        ... on Playlist { id title image { src } }
      }
    }
  }`;
  const data = await gql('quickSearch', q, { query, limit });
  const content = (data.quickSearch && data.quickSearch.content) || [];
  const out = { tracks: [], artists: [], releases: [], playlists: [] };
  for (const c of content) {
    if (c.__typename === 'Track') out.tracks.push(normTrack(c));
    else if (c.__typename === 'Artist') out.artists.push(normArtist(c));
    else if (c.__typename === 'Release') out.releases.push(normRelease(c));
    else if (c.__typename === 'Playlist') out.playlists.push({ id: String(c.id), title: c.title, cover: img(c.image && c.image.src) });
  }
  out.tracks = out.tracks.filter(Boolean);
  out.artists = out.artists.filter(Boolean);
  out.releases = out.releases.filter(Boolean);
  return out;
}

export async function getTracks(ids) {
  const q = `query getTracks($ids: [ID!]!) { getTracks(ids: $ids) { ${TRACK} } }`;
  const out = [];
  for (const part of chunk(ids.map(String), 100)) {
    const data = await gql('getTracks', q, { ids: part });
    for (const t of data.getTracks || []) {
      const n = normTrack(t);
      if (n) out.push(n);
    }
  }
  // keep the requested order
  const byId = new Map(out.map((t) => [t.zid, t]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

export async function streamUrl(trackId) {
  const qualities = settings.quality === 'mid' ? ['mid'] : ['high', 'mid'];
  let lastErr;
  for (const quality of qualities) {
    try {
      const r = await tiny('/track/stream', { id: trackId, quality });
      const url = r && (r.stream || r.url);
      if (url) return url;
    } catch (e) {
      lastErr = e;
      if (e.kind === 'network' || e.kind === 'bot' || e.kind === 'rate' || e.kind === 'check') throw e;
    }
  }
  if (lastErr && lastErr.kind === 'auth') {
    throw new ZvukError('unavailable', isLoggedIn() ? 'Звук не отдаёт этот трек: возможно, нужна подписка' : 'Звук не отдаёт этот трек без входа');
  }
  throw lastErr && lastErr.kind !== 'http' ? lastErr : new ZvukError('unavailable', 'Трек недоступен в Звуке');
}

export async function userPlaylists() {
  const data = await gql('userPlaylists', `query userPlaylists { collection { playlists { id } } }`);
  const ids = ((data.collection && data.collection.playlists) || []).map((p) => String(p.id));
  if (!ids.length) return [];
  const q = `query getPlaylists($ids: [ID!]!) { getPlaylists(ids: $ids) { id title image { src } tracks { id } } }`;
  const out = [];
  for (const part of chunk(ids, 50)) {
    const d = await gql('getPlaylists', q, { ids: part });
    for (const p of d.getPlaylists || []) {
      if (!p) continue;
      out.push({
        id: String(p.id),
        title: p.title || 'Плейлист',
        cover: img(p.image && p.image.src),
        trackIds: (p.tracks || []).map((t) => String(t.id)),
      });
    }
  }
  const byId = new Map(out.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function playlistTracks(id) {
  const q = `query getPlaylists($ids: [ID!]!) { getPlaylists(ids: $ids) { id title image { src } tracks { id } } }`;
  const d = await gql('getPlaylists', q, { ids: [String(id)] });
  const p = (d.getPlaylists || [])[0];
  if (!p) return { title: 'Плейлист', tracks: [] };
  const tracks = await getTracks((p.tracks || []).map((t) => String(t.id)));
  return { title: p.title, cover: img(p.image && p.image.src), tracks };
}

export async function likedTrackIds() {
  const q = `query userTracks($orderBy: TrackOrderByType, $orderDirection: OrderDirectionType) {
    collection { tracks(orderBy: $orderBy, orderDirection: $orderDirection) { id } }
  }`;
  const data = await gql('userTracks', q, { orderBy: 'dateAdded', orderDirection: 'desc' });
  return ((data.collection && data.collection.tracks) || []).map((t) => String(t.id));
}

export async function collectionArtistIds() {
  const data = await gql('userCollection', `query userCollection { collection { artists { id } } }`);
  return ((data.collection && data.collection.artists) || []).map((a) => String(a.id));
}

export async function getArtists(ids, opts = {}) {
  const q = `query getArtists($ids: [ID!]!, $withReleases: Boolean = false, $withPopTracks: Boolean = false,
      $withRelatedArtists: Boolean = false, $releasesLimit: Int = 10, $tracksLimit: Int = 10, $relatedLimit: Int = 10) {
    getArtists(ids: $ids) {
      id title image { src }
      releases(offset: 0, limit: $releasesLimit) @include(if: $withReleases) { ${RELEASE} }
      popularTracks(offset: 0, limit: $tracksLimit) @include(if: $withPopTracks) { ${TRACK} }
      relatedArtists(limit: $relatedLimit) @include(if: $withRelatedArtists) { id title image { src } }
    }
  }`;
  const out = [];
  for (const part of chunk(ids.map(String), 20)) {
    const data = await gql('getArtists', q, {
      ids: part,
      withReleases: !!opts.releases,
      withPopTracks: !!opts.tracks,
      withRelatedArtists: !!opts.related,
      releasesLimit: opts.releases || 10,
      tracksLimit: opts.tracks || 10,
      relatedLimit: opts.related || 10,
    });
    for (const a of data.getArtists || []) {
      if (!a) continue;
      out.push({
        ...normArtist(a),
        releases: (a.releases || []).map(normRelease).filter(Boolean),
        tracks: (a.popularTracks || []).map(normTrack).filter(Boolean),
        related: (a.relatedArtists || []).map(normArtist).filter(Boolean),
      });
    }
  }
  return out;
}

export async function getRelease(id) {
  const q = `query getReleases($ids: [ID!]!) { getReleases(ids: $ids) { ${RELEASE} tracks { ${TRACK} } } }`;
  const data = await gql('getReleases', q, { ids: [String(id)] });
  const r = (data.getReleases || [])[0];
  if (!r) return null;
  return { ...normRelease(r), tracks: (r.tracks || []).map(normTrack).filter(Boolean) };
}

export async function setLiked(trackId, liked) {
  const add = `mutation addItemToCollection($id: ID, $type: CollectionItemType) { collection { addItem(id: $id, type: $type) } }`;
  const del = `mutation removeItemFromCollection($id: ID, $type: CollectionItemType) { collection { removeItem(id: $id, type: $type) } }`;
  if (!isLoggedIn()) throw new ZvukError('auth', 'Чтобы ставить лайки, войди в Звук в профиле');
  await gql(liked ? 'addItemToCollection' : 'removeItemFromCollection', liked ? add : del, { id: String(trackId), type: 'track' });
}
