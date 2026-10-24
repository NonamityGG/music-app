// Spotify — only to bring playlists over (it can't stream to other apps). The
// user signs in on Spotify's own site inside the app; the app then borrows the
// web player's access key and reads the playlists through Spotify's public API.
// Spotify's site has to open where the user is (in Russia usually with a VPN).

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import * as web from './serviceweb.js';
import { extTrack, ImportError } from './importers.js';
import { settings, saveSettings, logError } from './settings.js';

const API = 'https://api.spotify.com/v1';
const PLAYER = 'https://open.spotify.com/';
const LOGIN = 'https://accounts.spotify.com/login?continue=' + encodeURIComponent(PLAYER);

let token = '';
let tokenUntil = 0;

let transport = null;
export function setSpotifyTransport(fn) {
  transport = fn;
}

// for tests
export function setToken(t, ms = 3600000) {
  token = t;
  tokenUntil = Date.now() + ms;
}

export const isLoggedIn = () => (!!token && Date.now() < tokenUntil) || !!settings.spName;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the access key ----------

// Three ways, tried in order: the session the page carries, the web player's
// own token address, and catching the key the player sends with its requests.
const FROM_PAGE = `(function(){
  try {
    var el = document.getElementById('session') || document.querySelector('script[data-testid="session"]');
    if (el) { var j = JSON.parse(el.textContent); if (j && j.accessToken && !j.isAnonymous) return JSON.stringify({ t: j.accessToken, exp: j.accessTokenExpirationTimestampMs || 0 }); }
  } catch (e) {}
  if (!window.__rezHooked) {
    window.__rezHooked = true;
    var grab = function (v) { if (v && /^Bearer\\s+/i.test(v)) window.__rezTok = String(v).replace(/^Bearer\\s+/i, ''); };
    try {
      var of = window.fetch;
      window.fetch = function (input, init) {
        try {
          var h = (init && init.headers) || (input && input.headers);
          if (h) { if (typeof h.get === 'function') grab(h.get('authorization')); else for (var k in h) if (String(k).toLowerCase() === 'authorization') grab(h[k]); }
        } catch (e) {}
        return of.apply(this, arguments);
      };
      var sh = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (String(k).toLowerCase() === 'authorization') grab(v); } catch (e) {} return sh.apply(this, arguments); };
    } catch (e) {}
  }
  return JSON.stringify({ t: window.__rezTok || '' });
})()`;

async function tokenFromSite() {
  await web.open('spotify', PLAYER);
  await web.nextPage('spotify', 20000);
  // 1–3: the page itself, then (while waiting for the player's own requests) its token address
  for (let i = 0; i < 20; i++) {
    let r = null;
    try {
      const raw = await web.run('spotify', FROM_PAGE);
      r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}
    if (r && r.t) return { t: r.t, exp: r.exp || Date.now() + 50 * 60 * 1000 };
    if (i === 1 || i === 8) {
      const res = await web.request('spotify', PLAYER + 'get_access_token?reason=transport&productType=web_player', { headers: { Accept: 'application/json' } });
      try {
        const j = JSON.parse(res.body || '');
        if (j.accessToken && !j.isAnonymous) return { t: j.accessToken, exp: j.accessTokenExpirationTimestampMs || 0 };
        if (j.isAnonymous) return null; // not signed in
      } catch {
        logError('spotify:token', new Error(`ответ ${res.status}: ${String(res.body || res.error || '').slice(0, 120)}`));
      }
    }
    await sleep(1000);
  }
  return null;
}

async function ensureToken() {
  if (token && Date.now() < tokenUntil - 60000) return token;
  if (!web.available()) throw new ImportError('Вход в Spotify работает в приложении на телефоне');
  const r = await tokenFromSite();
  if (!r) {
    saveSettings({ spName: '' });
    throw new ImportError('Не получилось войти в Spotify. Если сайт Spotify у тебя не открывается, включи VPN и попробуй ещё раз.');
  }
  token = r.t;
  tokenUntil = r.exp > Date.now() ? r.exp : Date.now() + 50 * 60 * 1000;
  return token;
}

// ---------- API ----------

async function get(url) {
  const t = await ensureToken();
  const u = url.startsWith('http') ? url : API + url;
  const headers = { Authorization: 'Bearer ' + t, Accept: 'application/json' };
  let res;
  try {
    if (transport) res = await transport({ url: u, headers });
    else if (Capacitor.isNativePlatform()) res = await CapacitorHttp.request({ url: u, method: 'GET', headers, responseType: 'json', connectTimeout: 15000, readTimeout: 20000 });
    else {
      const r = await fetch(u, { headers });
      res = { status: r.status, data: await r.json().catch(() => null) };
    }
  } catch {
    throw new ImportError('Нет связи со Spotify. Проверь интернет (и VPN, если нужен).');
  }
  if (res.status === 401) {
    token = '';
    throw new ImportError('Spotify попросил войти заново');
  }
  if (res.status === 429) {
    await sleep(3000);
    return get(url);
  }
  if (res.status < 200 || res.status >= 300) {
    const e = new ImportError(`Ошибка Spotify (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

async function all(url, pick = (j) => j.items || []) {
  const out = [];
  let next = url;
  while (next) {
    const j = await get(next);
    out.push(...pick(j));
    next = j.next || '';
  }
  return out;
}

export function toExt(t) {
  if (!t || !t.name) return null;
  return extTrack({
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(', '),
    album: (t.album && t.album.name) || '',
    duration: (t.duration_ms || 0) / 1000,
  });
}

// ---------- sign in / out ----------

export async function loginViaWeb() {
  await web.askUser('spotify', LOGIN, 'Вход в Spotify', { watch: PLAYER });
  token = '';
  await ensureToken();
  let name = '';
  try {
    const me = await get('/me');
    name = me.display_name || me.id || '';
  } catch (e) {
    logError('spotify:me', e);
  }
  saveSettings({ spName: name || 'Spotify' });
  return { name };
}

export async function logout() {
  token = '';
  tokenUntil = 0;
  saveSettings({ spName: '' });
  if (web.available()) await web.forget(['open.spotify.com', 'accounts.spotify.com', 'spotify.com']).catch(() => {});
}

// ---------- everything of the user ----------

const FIELDS = 'items(track(name,duration_ms,artists(name),album(name))),next';

export async function importAll({ onStep, onList, skip = new Set() }) {
  onStep('Смотрю, какие у тебя плейлисты…');
  const lists = await all('/me/playlists?limit=50');
  let done = 0;
  if (!skip.has('spotify:liked')) {
    onStep('Переношу «Любимые треки»…');
    const liked = await all('/me/tracks?limit=50', (j) => (j.items || []).map((x) => x.track));
    const tracks = liked.map(toExt).filter(Boolean);
    if (tracks.length) onList({ name: 'Любимые треки (Spotify)', tracks, origin: 'spotify:liked' });
  }
  for (const p of lists) {
    done++;
    if (!p || skip.has('spotify:' + p.id)) continue;
    onStep(`Переношу «${p.name}» (${done} из ${lists.length})…`);
    try {
      const items = await all(`/playlists/${p.id}/tracks?limit=100&fields=${encodeURIComponent(FIELDS)}`, (j) => (j.items || []).map((x) => x.track));
      const tracks = items.map(toExt).filter(Boolean);
      if (tracks.length) onList({ name: p.name || 'Плейлист', tracks, origin: 'spotify:' + p.id });
    } catch (e) {
      if (e.status === 404 || e.status === 403) continue; // Spotify's own mixes can't be read
      throw e;
    }
  }
  return lists.length;
}
