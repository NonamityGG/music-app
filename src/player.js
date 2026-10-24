// One player for every source. Zvuk tracks are streamed, local MP3s are read from
// storage. If a track can't be played from its own source, the player looks for
// the same song in the other one before giving up.

import { MediaSession } from '@capgo/capacitor-media-session';
import { Capacitor } from '@capacitor/core';
import * as zvuk from './zvuk.js';
import * as graph from './audio-graph.js';
import { localBlob, localTracks } from './local.js';
import { bestMatch } from './match.js';
import { settings, logError, load, save } from './settings.js';
import { shuffle as shuffled } from './util.js';

// Two elements: `fx` is connected to the analyser that drives the waves and only
// ever gets same-origin sources; `plain` plays everything else directly.
const plain = new Audio();
const fx = new Audio();
plain.preload = 'auto';
fx.preload = 'auto';
let audio = plain;
let fxBroken = false; // once the analyser path fails, this session plays everything directly
let fxReason = '';
let directUrl = ''; // the real source of the current track
let curZid = ''; // Zvuk id whose stream is playing (the track itself or its replacement)
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

async function localMatch(track) {
  const all = await localTracks();
  return bestMatch(track, all);
}

async function zvukMatch(track) {
  const q = `${track.artist || ''} ${track.title}`.trim();
  const res = await zvuk.quickSearch(q, 12);
  return bestMatch(track, res.tracks);
}

async function resolve(track) {
  if (track.src === 'local') {
    const blob = await localBlob(track.lid);
    if (blob) return { url: URL.createObjectURL(blob), via: 'local', blobUrl: true };
    if (settings.autoFallback) {
      const m = await zvukMatch(track).catch(() => null);
      if (m) return { url: await zvuk.streamUrl(m.zid), via: 'zvuk-fallback', match: m, zid: m.zid };
    }
    throw new Error('Файла больше нет в медиатеке');
  }

  // Zvuk track. Offline: try the local copy first.
  if (!navigator.onLine && settings.autoFallback) {
    const m = await localMatch(track);
    if (m) {
      const blob = await localBlob(m.lid);
      if (blob) return { url: URL.createObjectURL(blob), via: 'local-fallback', match: m };
    }
  }
  const pre = takePreloaded(track.zid);
  if (pre) return pre;
  try {
    return { url: await zvuk.streamUrl(track.zid), via: 'zvuk', zid: track.zid };
  } catch (e) {
    if (settings.autoFallback) {
      const m = await localMatch(track);
      if (m) {
        const blob = await localBlob(m.lid);
        if (blob) return { url: URL.createObjectURL(blob), via: 'local-fallback', match: m };
      }
    }
    throw e;
  }
}

// ---------- preloading ----------
// While a track plays, the app quietly gets stream links for the next three Zvuk
// tracks and the audio of the next one. Switching tracks then needs no request to
// Zvuk at all, so a short block by Zvuk's protection goes unnoticed.

const ahead = new Map(); // zid -> { url, urlAt, blob, loading }
const LINK_TTL = 10 * 60 * 1000;
let preloadTimer = 0;

function takePreloaded(zid) {
  const p = ahead.get(zid);
  if (!p) return null;
  if (p.blob) {
    ahead.delete(zid);
    return { url: URL.createObjectURL(p.blob), via: 'zvuk', zid, preloaded: true };
  }
  if (p.url && Date.now() - p.urlAt < LINK_TTL) {
    ahead.delete(zid);
    return { url: p.url, via: 'zvuk', zid };
  }
  return null;
}

function hasPreloadedAudio(t) {
  const p = t && t.zid && ahead.get(t.zid);
  return !!(p && p.blob);
}

function schedulePreload(delay = 6000) {
  clearTimeout(preloadTimer);
  preloadTimer = setTimeout(preloadAhead, delay);
}

async function preloadAhead() {
  if (zvuk.botBlocked()) return schedulePreload(zvuk.botRemaining() + 3000);
  const seq = loadSeq;
  const keep = new Set();
  for (let k = 1; k <= 3; k++) {
    const t = state.queue[state.index + k];
    if (!t || t.src !== 'zvuk' || !t.zid) continue;
    keep.add(t.zid);
    const p = ahead.get(t.zid) || {};
    ahead.set(t.zid, p);
    if (!p.url || Date.now() - p.urlAt > LINK_TTL) {
      try {
        p.url = await zvuk.streamUrl(t.zid);
        p.urlAt = Date.now();
      } catch (e) {
        if (e.kind === 'bot' || e.kind === 'network' || e.kind === 'rate') break;
        continue;
      }
    }
    if (seq !== loadSeq) return;
    if (k === 1 && !p.blob && !p.loading && Capacitor.isNativePlatform()) {
      p.loading = true;
      try {
        const r = await fetch(proxied(p.url));
        if (r.ok) {
          const blob = await r.blob();
          if (blob.size > 50000 && seq === loadSeq) p.blob = blob;
        }
      } catch (e) {
        logError('preload', e);
      } finally {
        p.loading = false;
      }
    }
  }
  for (const id of [...ahead.keys()]) if (!keep.has(id)) ahead.delete(id);
}

// ---------- which element plays the source ----------

function wantFx() {
  return settings.wavesReactive !== false && settings.wavesStyle !== 'off' && !fxBroken && graph.available();
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
      src = proxied(url);
    }
  }
  if (el === fx && !graph.attach(fx)) {
    fxBroken = true;
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
export const analysing = () => audio === fx && !fxBroken && graph.state() === 'running';

// One line for the settings screen: do the waves hear the music right now, and if not, why.
export function waveStatus() {
  if (settings.wavesStyle === 'off') return 'Волны выключены';
  if (settings.wavesReactive === false) return 'Спокойный режим: «Двигаются под музыку» выключено';
  if (!current() || !state.playing) return 'Включи трек — здесь будет видно, слышат ли волны музыку';
  if (analysing()) return 'Волны слышат музыку';
  if (fxBroken) return 'Простой режим: ' + (fxReason || 'анализатор недоступен');
  if (audio === plain) return 'Простой режим для этого трека';
  return 'Подключаю волны к звуку… (' + graph.state() + ')';
}

// Moves the current track to the direct element, e.g. when the analyser path goes silent.
export function bypassAnalyser(reason) {
  if (audio !== fx || fxBroken) return;
  fxBroken = true;
  fxReason = reason;
  logError('waves', new Error(reason));
  const at = audio.currentTime;
  const wasPlaying = !audio.paused;
  setSource(directUrl);
  seekWhenReady(at);
  if (wasPlaying) audio.play().catch((e) => logError('bypass', e));
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
  curZid = '';
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
    curZid = src.zid || '';
    track.unavailable = false;
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
    track.unavailable = true;
    state.error = e.message || String(e);
    logError('play', e);
    emit('unavailable', { track, error: e });
    if (failStreak < 5 && state.queue.length > 1 && hasNext()) {
      setTimeout(() => {
        if (seq === loadSeq) next(true);
      }, 1200);
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
  const ms = Math.max(4000, zvuk.botRemaining() + 1500);
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

export function seek(sec) {
  if (!isFinite(sec)) return;
  try {
    audio.currentTime = Math.max(0, Math.min(sec, duration() || sec));
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
      schedulePreload(6000);
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
  if (curZid && streamAttempts < 2) {
    streamAttempts++;
    if (streamAttempts === 2 && viaProxy) fxBroken = true;
    const at = audio.currentTime;
    try {
      const url = await zvuk.streamUrl(curZid);
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
  if (++ctxStalls >= 2) bypassAnalyser('Звуковой движок остановился, волны переключены в простой режим');
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

export function initMediaSession() {
  const on = (action, fn) => MediaSession.setActionHandler({ action }, fn).catch(() => {});
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
