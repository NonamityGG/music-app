// One player for every source. Zvuk tracks are streamed, local MP3s are read from
// storage. If a track can't be played from its own source, the player looks for
// the same song in the other one before giving up.

import { MediaSession } from '@capgo/capacitor-media-session';
import { Capacitor } from '@capacitor/core';
import * as online from './online.js';
import * as graph from './audio-graph.js';
import { localBlob, localTracks } from './local.js';
import { bestMatch } from './match.js';
import { settings, saveSettings, logError, load, save } from './settings.js';
import { shuffle as shuffled } from './util.js';
import * as pl from './playlists.js';
import { findOnline, onlinePatch } from './matcher.js';

// Two elements: `fx` is connected to the analyser that drives the waves and only
// ever gets same-origin sources; `plain` plays everything else directly.
const plain = new Audio();
const fx = new Audio();
plain.preload = 'auto';
fx.preload = 'auto';
// lets the analyser read streams from hosts that allow it (see checkCors)
fx.crossOrigin = 'anonymous';
let audio = plain;
let fxBroken = false; // once the analyser path fails, this session plays everything directly
let attachFailed = false; // the phone refused the analyser altogether
let trackBypass = false; // this track only plays directly (e.g. the analyser heard nothing)
let fxReason = '';
let directUrl = ''; // the real source of the current track
let curRef = null; // { p, id } of the online stream that is playing (the track itself or its replacement)
let streamAttempts = 0;

export const state = {
  queue: [],
  original: null, // queue order before shuffle
  index: -1,
  shuffle: false,
  repeat: 'off', // off | all | one
  playing: false,
  loading: false,
  via: '', // where the current track actually plays from
  error: '',
  waitingUntil: 0, // set while waiting for Zvuk to let the app back in
};

const listeners = new Set();
export function onPlayer(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(type, data) {
  for (const fn of listeners) {
    try {
      fn(type, data);
    } catch (e) {
      console.warn(e);
    }
  }
}

export const current = () => state.queue[state.index] || null;
export const position = () => audio.currentTime || 0;
export const duration = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (current() && current().duration) || 0);

let objectUrl = '';
let loadSeq = 0;
let failStreak = 0;
let waitCount = 0;

function setObjectUrl(url) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = url;
}

// ---------- source resolution ----------
// Order for every song: the user's MP3, then Zvuk. Zvuk stays in the background.

async function localMatch(track) {
  const all = await localTracks();
  if (track.lid) {
    const byId = all.find((t) => t.lid === track.lid);
    if (byId) return byId;
  }
  return bestMatch(track, all);
}

async function localSource(track) {
  const m = await localMatch(track);
  if (!m) return null;
  const blob = await localBlob(m.lid);
  return blob ? { url: URL.createObjectURL(blob), via: 'local', match: m } : null;
}

// Online stream for a track: its own service if usable, otherwise a search on
// the main connected service (remembered in the playlist for next time).
async function refFor(track) {
  const own = online.refOf(track);
  if (own && online.usable(own.p)) return own;
  if (!online.isLoggedIn()) throw new online.OfflineError();
  if (track.src === 'ext' && track.match === 'none') return null;
  const z = await findOnline(track);
  if (track.src === 'ext') pl.rememberMatch(track.key, z ? onlinePatch(track, z) : { match: 'none' });
  if (!z) return null;
  if (track.src === 'ext') {
    track.yid = z.yid;
    track.cover = track.cover || z.cover;
  }
  return online.refOf(z);
}

async function resolve(track) {
  const pre = takePrepared(track);
  if (pre) return pre;

  if (track.src === 'local') {
    const blob = await localBlob(track.lid);
    if (blob) return { url: URL.createObjectURL(blob), via: 'local' };
    if (settings.autoFallback) {
      const m = await findOnline(track).catch(() => null);
      const ref = m && online.refOf(m);
      if (ref) return { url: await online.streamFor(ref), via: 'online-fallback', match: m, ref };
    }
    throw new Error('Файла больше нет в медиатеке');
  }

  if (track.src === 'ext' || settings.autoFallback) {
    const loc = await localSource(track);
    if (loc) return loc;
  }
  const ref = await refFor(track);
  if (!ref) throw new Error('Этого трека нет ни в твоих MP3, ни онлайн');
  return { url: await online.streamFor(ref), via: 'online', ref };
}

// ---------- getting the next tracks ready ----------
// Right after a track starts, the app prepares the next one completely (for an
// online track it downloads the audio) and finds the links for two more. When the
// track ends or you press "next", the prepared one starts at once, with no
// request to Zvuk at all — so a short block by Zvuk's protection goes unnoticed too.

const ahead = new Map(); // track key -> { ref, url, urlAt, blob, loading, local }
const LINK_TTL = 10 * 60 * 1000;
let prepTimer = 0;

function takePrepared(track) {
  const p = ahead.get(track.key);
  if (!p) return null;
  if (p.blob) {
    ahead.delete(track.key);
    return { url: URL.createObjectURL(p.blob), via: 'online', ref: p.ref, preloaded: true };
  }
  if (p.url && Date.now() - p.urlAt < LINK_TTL) {
    ahead.delete(track.key);
    return { url: p.url, via: 'online', ref: p.ref };
  }
  return null;
}

function hasPreloadedAudio(t) {
  const p = t && ahead.get(t.key);
  return !!(p && (p.blob || p.local));
}

function schedulePreload(delay = 800) {
  clearTimeout(prepTimer);
  prepTimer = setTimeout(prepareAhead, delay);
}

function upcoming(n) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    let i = state.index + k;
    if (i >= state.queue.length) {
      if (state.repeat !== 'all') break;
      i -= state.queue.length;
    }
    if (i === state.index) break;
    out.push(state.queue[i]);
  }
  return out;
}

async function prepareAhead() {
  if (online.blocked()) return schedulePreload(online.blockedRemaining() + 3000);
  const seq = loadSeq;
  const next = upcoming(3);
  const keep = new Set(next.map((t) => t.key));
  for (let k = 0; k < next.length; k++) {
    const t = next[k];
    if (!t || t.src === 'local' || t.unavailable) continue;
    const p = ahead.get(t.key) || {};
    ahead.set(t.key, p);
    try {
      if (t.src === 'ext' || settings.autoFallback) {
        if (await localMatch(t)) {
          p.local = true; // an MP3 starts instantly anyway
          continue;
        }
      }
      if (!p.ref) p.ref = await refFor(t);
      if (!p.ref) continue;
      if (!p.url || Date.now() - p.urlAt > LINK_TTL) {
        p.url = await online.streamFor(p.ref);
        p.urlAt = Date.now();
      }
    } catch (e) {
      if (e.kind === 'bot' || e.kind === 'network' || e.kind === 'rate' || e.kind === 'nologin') break;
      continue;
    }
    if (seq !== loadSeq) return;
    if (k === 0 && !p.blob && !p.loading && Capacitor.isNativePlatform()) {
      p.loading = true;
      try {
        const r = await fetch(proxied(p.url));
        if (r.ok) {
          const blob = await r.blob();
          if (blob.size > 50000 && ahead.get(t.key) === p) p.blob = blob;
        }
      } catch (e) {
        logError('preload', e);
      } finally {
        p.loading = false;
      }
    }
  }
  for (const key of [...ahead.keys()]) if (!keep.has(key)) ahead.delete(key);
}

// ---------- which element plays the source ----------

function wantFx() {
  return settings.wavesReactive !== false && settings.wavesStyle !== 'off' && !fxBroken && !trackBypass && graph.available();
}

// ---------- streaming straight from the music host ----------
// If the host allows other sites to read its files (CORS), the analysed element
// plays the stream directly: seeking and buffering work like in any browser. The
// app's proxy below is only the fallback, and it can't seek into parts of the
// file it hasn't loaded yet, so seeking there is handled separately (seek()).

const corsHosts = new Map(); // host family -> true | false
const hostKey = (url) => {
  try {
    return new URL(url).host.split('.').slice(-3).join('.');
  } catch {
    return '';
  }
};
const corsKnownOk = (url) => corsHosts.get(hostKey(url)) === true;

async function checkCors(url) {
  const key = hostKey(url);
  if (!key) return false;
  if (corsHosts.has(key)) return corsHosts.get(key);
  // the browser's own fetch (Capacitor replaces window.fetch with a native one
  // that ignores CORS, which would make the check meaningless)
  const raw = window.CapacitorWebFetch;
  if (typeof raw !== 'function') {
    corsHosts.set(key, false);
    return false;
  }
  let ok = false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await raw(url, { signal: ctrl.signal, cache: 'no-store' });
    ok = r.ok || r.status === 206;
  } catch {}
  ctrl.abort(); // only the answer's headers were needed
  clearTimeout(timer);
  corsHosts.set(key, ok);
  return ok;
}

// Routes a remote stream through the app's own origin (Capacitor's native proxy),
// so the analyser is allowed to read it.
function proxied(url) {
  const base = new URL(Capacitor.getServerUrl ? Capacitor.getServerUrl() : location.origin);
  base.pathname = '/_capacitor_http_interceptor_';
  base.search = '';
  base.searchParams.append('u', url);
  return base.toString();
}

function setSource(url) {
  directUrl = url;
  let el = plain;
  let src = url;
  if (wantFx()) {
    if (url.startsWith('blob:')) el = fx;
    else if (Capacitor.isNativePlatform() && /^https?:/.test(url)) {
      el = fx;
      src = corsKnownOk(url) ? url : proxied(url);
    }
  }
  if (el === fx && !graph.attach(fx)) {
    fxBroken = true;
    attachFailed = true;
    fxReason = 'телефон не дал подключиться к звуку';
    el = plain;
    src = url;
  }
  if (el !== audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = el;
  }
  audio.src = src;
  if (audio === fx) graph.resume();
}

function seekWhenReady(at) {
  if (!(at > 0)) return;
  const el = audio;
  const go = () => {
    try {
      el.currentTime = at;
    } catch {}
  };
  if (el.readyState >= 1) go();
  else el.addEventListener('loadedmetadata', go, { once: true });
}

// True when the waves can use the real sound of the current track.
export const analysing = () => audio === fx && graph.state() === 'running';

// One line for the settings screen: do the waves hear the music right now, and if not, why.
export function waveStatus() {
  if (settings.wavesStyle === 'off') return 'Волны выключены';
  if (settings.wavesReactive === false) return 'Простой режим: волны двигаются сами, звук идёт напрямую';
  if (!current() || !state.playing) return 'Включи трек — здесь будет видно, слышат ли волны музыку';
  if (analysing()) return 'Волны слышат музыку';
  if (fxBroken || trackBypass) return 'Простой режим: ' + (fxReason || 'анализатор недоступен');
  if (audio === plain) return 'Простой режим для этого трека';
  return 'Подключаю волны к звуку… (' + graph.state() + ')';
}

// Moves the current track to the direct element, e.g. when the analyser path goes
// silent. scope 'track': only this track; 'session': until the app restarts or the
// user switches the waves back to listening.
export function bypassAnalyser(reason, scope = 'track') {
  if (audio !== fx) return;
  if (scope === 'session') fxBroken = true;
  else trackBypass = true;
  fxReason = reason;
  logError('waves', new Error(reason));
  const at = audio.currentTime;
  const wasPlaying = !audio.paused;
  setSource(directUrl);
  seekWhenReady(at);
  if (wasPlaying) audio.play().catch((e) => logError('bypass', e));
}

// The waves report that the analyser hears nothing. Only give up on it when the
// track is really moving forward (not buffering, not a quiet intro after a seek).
let silentMark = null;
export function reportSilence() {
  if (audio !== fx || audio.paused || audio.seeking || audio.readyState < 3) {
    silentMark = null;
    return;
  }
  const now = Date.now();
  const pos = audio.currentTime;
  if (!silentMark || now - silentMark.at > 12000 || pos < silentMark.pos) {
    silentMark = { at: now, pos };
    return;
  }
  if (pos - silentMark.pos >= 4) {
    silentMark = null;
    bypassAnalyser('анализатор не услышал этот трек');
  }
}

// The switch "Слышат музыку / Простой режим". Applies to the playing track at once.
export function setWaveMode(reactive) {
  saveSettings({ wavesReactive: reactive });
  if (reactive) {
    if (!attachFailed) fxBroken = false;
    trackBypass = false;
    fxReason = '';
  }
  if (!directUrl || !current()) return;
  const want = wantFx();
  if (want === (audio === fx)) return;
  const routable = directUrl.startsWith('blob:') || (Capacitor.isNativePlatform() && /^https?:/.test(directUrl));
  if (want && !routable) return;
  const at = audio.currentTime;
  const wasPlaying = !audio.paused;
  setSource(directUrl);
  seekWhenReady(at);
  if (wasPlaying) audio.play().catch((e) => logError('wave-mode', e));
}

// ---------- playback ----------

async function load_(index, autoplay = true, auto = false) {
  const seq = ++loadSeq;
  state.index = index;
  const track = current();
  if (!track) return;
  state.loading = true;
  state.error = '';
  state.via = '';
  streamAttempts = 0;
  curRef = null;
  trackBypass = false;
  silentMark = null;
  emit('track', track);
  updateMetadata(track);
  audio.pause();
  try {
    const src = await resolve(track);
    if (seq !== loadSeq) {
      if (src.url.startsWith('blob:')) URL.revokeObjectURL(src.url);
      return;
    }
    setObjectUrl(src.url.startsWith('blob:') ? src.url : '');
    state.via = src.via;
    curRef = src.ref || null;
    track.unavailable = false;
    if (wantFx() && Capacitor.isNativePlatform() && /^https?:/.test(src.url)) {
      await checkCors(src.url); // once per host, then cached
      if (seq !== loadSeq) return;
    }
    dropFullCopy();
    setSource(src.url);
    if (autoplay) await audio.play().catch((e) => handlePlayError(e, seq));
    failStreak = 0;
    waitCount = 0;
    state.waitingUntil = 0;
    if (src.via.endsWith('fallback')) emit('fallback', { track, via: src.via, match: src.match });
  } catch (e) {
    if (seq !== loadSeq) return;
    if ((e.kind === 'bot' || e.kind === 'rate') && waitOut(track, index, auto, seq)) return;
    failStreak++;
    track.unavailable = e.kind !== 'nologin';
    state.error = e.message || String(e);
    if (e.kind !== 'nologin') logError('play', e);
    emit('unavailable', { track, error: e });
    if (failStreak < 5 && state.queue.length > 1 && hasNext()) {
      const known = track.src === 'ext' && track.match === 'none';
      setTimeout(() => {
        if (seq === loadSeq) next(true);
      }, known ? 250 : 1200);
    } else {
      setPlaying(false);
    }
  } finally {
    if (seq === loadSeq) {
      state.loading = false;
      emit('state');
    }
  }
}

// Zvuk has blocked the app for a moment and this track has neither a preloaded
// copy nor an MP3. Everything stays inside the app: on automatic track changes,
// jump to the next track that can play without Zvuk; otherwise wait quietly and
// start this track as soon as the block is over.
function waitOut(track, index, auto, seq) {
  if (auto) {
    const n = state.queue.findIndex((t, i) => i > index && (t.src === 'local' || hasPreloadedAudio(t)));
    if (n > 0) {
      load_(n, true, true);
      return true;
    }
  }
  if (++waitCount > 4) {
    waitCount = 0;
    state.waitingUntil = 0;
    return false; // the usual "unavailable" message
  }
  const ms = Math.max(4000, online.blockedRemaining() + 1500);
  state.waitingUntil = Date.now() + ms;
  state.via = 'waiting';
  track.unavailable = false;
  setPlaying(false);
  emit('waiting', { track, ms });
  emit('state');
  setTimeout(() => {
    if (seq === loadSeq) load_(index, true, auto);
  }, ms);
  return true;
}

function handlePlayError(e, seq) {
  if (seq !== loadSeq) return;
  if (e && e.name === 'AbortError') return; // replaced by a newer load
  logError('audio.play', e);
}

function hasNext() {
  return state.index < state.queue.length - 1 || state.repeat === 'all';
}

export function playQueue(tracks, startIndex = 0, opts = {}) {
  const list = tracks.filter(Boolean).map((t) => ({ ...t }));
  if (!list.length) return;
  state.original = null;
  state.shuffle = !!opts.shuffle;
  if (state.shuffle) {
    state.original = list.slice();
    const first = opts.randomStart ? null : list[startIndex];
    const rest = shuffled(first ? list.filter((_, i) => i !== startIndex) : list);
    state.queue = first ? [first, ...rest] : rest;
    startIndex = 0;
  } else {
    state.queue = list;
  }
  failStreak = 0;
  saveQueue();
  load_(Math.max(0, Math.min(startIndex, state.queue.length - 1)));
}

export function playAt(index, auto = false) {
  if (index < 0 || index >= state.queue.length) return;
  if (!auto) failStreak = 0;
  load_(index, true, auto);
  saveQueue();
}

export function toggle() {
  if (!current()) return;
  if (audio.paused) resume();
  else pause();
}

export function resume() {
  if (!current()) return;
  if (!audio.getAttribute('src')) return load_(state.index);
  if (audio === fx) graph.resume();
  audio.play().catch((e) => {
    if (e && e.name === 'AbortError') return; // a quick pause right after play: nothing broke
    logError('resume', e);
    load_(state.index); // stream URL may have expired
  });
}

export function pause() {
  audio.pause();
}

export function next(auto = false) {
  if (!state.queue.length) return;
  if (state.index < state.queue.length - 1) return playAt(state.index + 1, auto);
  if (state.repeat === 'all' || !auto) return playAt(0, auto);
  pause();
}

export function prev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }
  playAt(state.index > 0 ? state.index - 1 : state.repeat === 'all' ? state.queue.length - 1 : 0);
}

// ---------- seeking a stream that goes through the proxy ----------

let fullCopy = null; // { key, url, loading } — the whole current track, downloaded in the background

function dropFullCopy() {
  if (fullCopy && fullCopy.url) URL.revokeObjectURL(fullCopy.url);
  fullCopy = null;
}

const viaProxyNow = () => audio === fx && String(audio.src).includes('_capacitor_http_interceptor_');

function isBuffered(t) {
  const b = audio.buffered;
  for (let i = 0; i < b.length; i++) if (t >= b.start(i) - 0.5 && t <= b.end(i) - 0.5) return true;
  return false;
}

// Starts downloading the whole track while it plays, so a jump far ahead can
// switch to the downloaded copy.
function startFullCopy() {
  const track = current();
  if (!track || !viaProxyNow() || (fullCopy && fullCopy.key === track.key)) return;
  const copy = { key: track.key, url: '', loading: true };
  fullCopy = copy;
  const url = directUrl;
  fetch(proxied(url))
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => {
      if (fullCopy !== copy || !blob || blob.size < 50000) return;
      copy.url = URL.createObjectURL(blob);
    })
    .catch((e) => logError('stream-copy', e))
    .finally(() => (copy.loading = false));
}

function moveTo(url, at, wasPlaying) {
  setSource(url);
  seekWhenReady(at);
  if (wasPlaying) audio.play().catch((e) => logError('seek', e));
  emit('state');
}

export function seek(sec) {
  if (!isFinite(sec)) return;
  const t = Math.max(0, Math.min(sec, duration() || sec));
  if (viaProxyNow() && !isBuffered(t)) {
    // the proxy can't jump into the part of the file it hasn't loaded yet
    const wasPlaying = !audio.paused;
    if (fullCopy && fullCopy.key === (current() && current().key) && fullCopy.url) {
      const blobUrl = fullCopy.url;
      fullCopy = null;
      setObjectUrl(blobUrl);
      moveTo(blobUrl, t, wasPlaying);
    } else {
      // play this track straight from the host; the waves move on their own until the next one
      trackBypass = true;
      fxReason = 'перемотка, пока трек загружается';
      moveTo(directUrl, t, wasPlaying);
    }
    pushPosition();
    return;
  }
  try {
    audio.currentTime = t;
  } catch {}
  pushPosition();
}

export function setShuffle(on) {
  const cur = current();
  if (on === state.shuffle || !cur) {
    state.shuffle = on;
    emit('state');
    return;
  }
  if (on) {
    state.original = state.queue.slice();
    const rest = shuffled(state.queue.filter((_, i) => i !== state.index));
    state.queue = [cur, ...rest];
    state.index = 0;
  } else if (state.original) {
    const idx = state.original.findIndex((t) => t.key === cur.key);
    state.queue = state.original;
    state.index = idx >= 0 ? idx : 0;
    state.original = null;
  }
  state.shuffle = on;
  saveQueue();
  emit('queue');
  emit('state');
  schedulePreload(2000);
}

export function cycleRepeat() {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  saveQueue();
  emit('state');
}

export function playNext(track) {
  if (!current()) return playQueue([track]);
  state.queue.splice(state.index + 1, 0, { ...track });
  if (state.original) state.original.push({ ...track });
  saveQueue();
  emit('queue');
  schedulePreload(2000);
}

export function addToQueue(track) {
  if (!current()) return playQueue([track]);
  state.queue.push({ ...track });
  if (state.original) state.original.push({ ...track });
  saveQueue();
  emit('queue');
}

export function removeFromQueue(i) {
  if (i === state.index || i < 0 || i >= state.queue.length) return;
  state.queue.splice(i, 1);
  if (i < state.index) state.index--;
  saveQueue();
  emit('queue');
}

// ---------- audio element events ----------

function setPlaying(p) {
  state.playing = p;
  emit('state');
  MediaSession.setPlaybackState({ playbackState: current() ? (p ? 'playing' : 'paused') : 'none' }).catch(() => {});
}

const mine = (fn) => (e) => {
  if (e.target === audio) fn(e);
};
let lastPosPush = 0;

for (const el of [plain, fx]) {
  el.addEventListener(
    'playing',
    mine(() => {
      setPlaying(true);
      pushPosition();
      schedulePreload(800);
      setTimeout(startFullCopy, 1500);
    })
  );
  el.addEventListener('pause', mine(() => setPlaying(false)));
  el.addEventListener(
    'ended',
    mine(() => {
      if (state.repeat === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      next(true);
    })
  );
  el.addEventListener('error', mine(onError));
  el.addEventListener(
    'timeupdate',
    mine(() => {
      emit('time');
      if (Date.now() - lastPosPush > 5000) pushPosition();
    })
  );
  el.addEventListener(
    'durationchange',
    mine(() => {
      emit('time');
      pushPosition();
    })
  );
}

async function onError() {
  const track = current();
  if (!track || !audio.getAttribute('src')) return;
  const seq = loadSeq;
  const code = audio.error ? audio.error.code : 0;
  const viaProxy = audio === fx && !directUrl.startsWith('blob:');
  logError('audio', new Error('Ошибка воспроизведения, код ' + code + (viaProxy ? ' (через прокси)' : '')));
  // Zvuk stream links expire: fetch a fresh one, keeping the position. The second
  // try skips the proxy in case the proxy itself is the problem.
  if (curRef && streamAttempts < 2) {
    streamAttempts++;
    if (streamAttempts === 2 && viaProxy) fxBroken = true;
    const at = audio.currentTime;
    try {
      const url = await online.streamFor(curRef);
      if (seq !== loadSeq) return;
      setSource(url);
      seekWhenReady(at);
      await audio.play();
      return;
    } catch (e) {
      logError('stream-retry', e);
    }
  } else if (viaProxy === false && audio === fx && !fxBroken) {
    // a local file failing on the analysed element: try it directly once
    const at = audio.currentTime;
    fxBroken = true;
    setSource(directUrl);
    seekWhenReady(at);
    if (await audio.play().then(() => true).catch(() => false)) return;
  }
  if (seq !== loadSeq) return;
  track.unavailable = true;
  emit('unavailable', { track, error: new Error('Не удалось воспроизвести') });
  if (hasNext()) next(true);
  else setPlaying(false);
}

// If the system pauses the audio graph (it shouldn't, but some phones do), wake it
// up; if it refuses, continue the track without the analyser so music never stops.
let ctxStalls = 0;
setInterval(() => {
  if (audio !== fx || audio.paused || fxBroken) {
    ctxStalls = 0;
    return;
  }
  if (graph.state() === 'running') {
    ctxStalls = 0;
    return;
  }
  graph.resume();
  if (++ctxStalls >= 2) bypassAnalyser('звуковой движок телефона остановился', 'session');
}, 2500);
document.addEventListener('visibilitychange', () => {
  if (audio === fx) graph.resume();
});

function pushPosition() {
  lastPosPush = Date.now();
  const d = duration();
  if (!d) return;
  MediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime || 0, d), playbackRate: 1 }).catch(() => {});
}

// ---------- lock screen / notification ----------

async function updateMetadata(track) {
  let artwork = [];
  let cover = track.cover;
  if (!cover && track.src === 'local') {
    const all = await localTracks();
    const m = all.find((t) => t.lid === track.lid);
    cover = m ? m.cover : '';
  }
  if (cover) artwork = [{ src: cover, sizes: '300x300', type: 'image/jpeg' }];
  MediaSession.setMetadata({ title: track.title, artist: track.artist || '', album: track.album || '', artwork }).catch(() => {});
}

// The heart in the notification (added to the plugin by tools/patch-plugins.mjs).
let likeShown = '';
export function setNotificationLike(enabled, liked) {
  const k = `${enabled}:${liked}`;
  if (k === likeShown) return;
  likeShown = k;
  if (Capacitor.isNativePlatform()) MediaSession.setLikeState({ enabled, liked }).catch(() => {});
}

export function initMediaSession({ onLike } = {}) {
  const on = (action, fn) => MediaSession.setActionHandler({ action }, fn).catch(() => {});
  if (onLike) on('like', () => onLike());
  on('play', () => resume());
  on('pause', () => pause());
  on('nexttrack', () => next());
  on('previoustrack', () => prev());
  on('seekto', (d) => d && d.seekTime != null && seek(d.seekTime));
}

// ---------- persistence of the queue between launches ----------

let saveTimer;
function saveQueue() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const strip = (t) => {
      const { unavailable, ...rest } = t;
      if (rest.src === 'local') rest.cover = '';
      return rest;
    };
    save('queue', {
      queue: state.queue.slice(0, 500).map(strip),
      index: state.index,
      shuffle: state.shuffle,
      repeat: state.repeat,
    });
  }, 400);
}

export function restoreQueue() {
  const q = load('queue', null);
  if (!q || !q.queue || !q.queue.length) return;
  state.queue = q.queue;
  state.index = Math.min(Math.max(0, q.index || 0), q.queue.length - 1);
  state.shuffle = !!q.shuffle;
  state.repeat = q.repeat || 'off';
  emit('track', current());
  emit('state');
}

window.addEventListener('online', () => emit('state'));

// After the user passed a check or signed in: try the current track again.
export function retryCurrent() {
  if (current()) load_(state.index, true, false);
}
