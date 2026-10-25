// One player for every source: the user's MP3s are read from storage, other
// songs stream from Yandex Music. If a track can't play from its own source, the
// player looks for the same song in the other one before giving up.
//
// Two "decks", like a DJ's: while one plays, the next track waits fully loaded
// on the other and starts the instant the first one ends — no gap. Each deck has
// a plain element and an analysed one (connected to the waves).

import { MediaSession } from '@capgo/capacitor-media-session';
import { Capacitor } from '@capacitor/core';
import * as online from './online.js';
import * as graph from './audio-graph.js';
import { localBlob, localTracks } from './local.js';
import { bestMatch } from './match.js';
import { settings, saveSettings, logError, load, save } from './settings.js';
import { shuffle as shuffled, fmtTime } from './util.js';
import * as pl from './playlists.js';
import { findOnline, onlinePatch } from './matcher.js';

function makeDeck() {
  const plain = new Audio();
  const fx = new Audio();
  plain.preload = 'auto';
  fx.preload = 'auto';
  // lets the analyser read streams from hosts that allow it (see checkCors)
  fx.crossOrigin = 'anonymous';
  return { plain, fx };
}
const decks = [makeDeck(), makeDeck()];
const allElements = decks.flatMap((d) => [d.plain, d.fx]);
const isFx = (el) => decks.some((d) => d.fx === el);

let deck = 0; // the deck that plays now
let audio = decks[0].plain;
let fxBroken = false; // once the analyser path fails, this session plays everything directly
let attachFailed = false; // the phone refused the analyser altogether
let trackBypass = false; // this track only plays directly (e.g. the analyser heard nothing)
let fxReason = '';
let directUrl = ''; // the real source of the current track
let curRef = null; // { p, id } of the online stream that is playing (the track itself or its replacement)
let streamAttempts = 0;
let truncTries = 0;

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
  waitingUntil: 0, // set while waiting for a service to let the app back in
  extending: false, // the queue ended and similar music is being picked
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
// what you hear is this much behind position() (only through the analyser)
export const outputLatency = () => (isFx(audio) ? graph.latency() : 0);

// The length to show. A stream's own estimate can be far off (some MP3s report
// twice their length until fully loaded), so for online tracks the catalogue's
// length wins when the two disagree.
export const duration = () => {
  const el = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const t = current();
  const cat = (t && t.duration) || 0;
  if (!el) return cat;
  if (cat && String(state.via).startsWith('online') && Math.abs(el - cat) > 3) return cat;
  return el;
};

let objectUrl = '';
let loadSeq = 0;
let failStreak = 0;
let waitCount = 0;

function setObjectUrl(url) {
  if (objectUrl && objectUrl !== url) URL.revokeObjectURL(objectUrl);
  objectUrl = url;
}

// An element that is no longer needed: silence it now, unload it a moment later
// (unloading at once blocks the screen for a few frames on some phones).
function retire(el) {
  el.pause();
  setTimeout(() => {
    if (el === audio || (armed && armed.el === el) || (handing && handing.el === el)) return;
    el.removeAttribute('src');
    el.load();
  }, 600);
}

// ---------- source resolution ----------
// Order for every song: the user's MP3, then Yandex Music.

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

// Online stream for a track: its own service if usable, otherwise a search
// (remembered in the playlist for next time).
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
  if (!track.duration && z.duration) track.duration = z.duration;
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
// online track it downloads the audio) and finds the links for two more.

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
  const seq = loadSeq;
  const next = upcoming(3);
  const keep = new Set(next.map((t) => t.key));
  for (let k = 0; k < next.length; k++) {
    const t = next[k];
    if (!t || t.src === 'local' || t.unavailable) continue;
    if (armed && armed.key === t.key) continue; // already waiting on the other deck
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
        const r = await fetch(proxied(p.url)); // streamed by the app's proxy, not through the JS bridge
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

// Which element of deck `d` should play `url`, and with what address.
function pick(d, url) {
  const dk = decks[d];
  let el = dk.plain;
  let src = url;
  if (wantFx()) {
    if (url.startsWith('blob:')) el = dk.fx;
    else if (Capacitor.isNativePlatform() && /^https?:/.test(url)) {
      el = dk.fx;
      src = corsKnownOk(url) ? url : proxied(url);
    }
  }
  if (el === dk.fx && !graph.attach(dk.fx)) {
    fxBroken = true;
    attachFailed = true;
    fxReason = 'телефон не дал подключиться к звуку';
    el = dk.plain;
    src = url;
  }
  return { el, src };
}

// Puts `url` on the current deck (a hard switch: used when loading a track).
function setSource(url) {
  directUrl = url;
  const { el, src } = pick(deck, url);
  if (el !== audio) {
    retire(audio);
    audio = el;
  }
  audio.src = src;
  if (isFx(audio)) graph.resume();
}

function seekWhenReady(at, el = audio) {
  if (!(at > 0)) return;
  const go = () => {
    try {
      el.currentTime = at;
    } catch {}
  };
  if (el.readyState >= 1) go();
  else el.addEventListener('loadedmetadata', go, { once: true });
}

// Moves the playing track to the other element of the same deck without a gap:
// the new one loads and starts at the same moment, and only then the old one
// stops. Used when the waves mode changes or the analyser gives up.
let handing = null;
function handOver(url) {
  const { el, src } = pick(deck, url);
  if (el === audio) return;
  const old = audio;
  if (old.paused) {
    directUrl = url;
    const at = old.currentTime;
    retire(old);
    audio = el;
    el.src = src;
    seekWhenReady(at, el);
    emit('state');
    return;
  }
  const h = { el, done: false };
  handing = h;
  const giveUp = setTimeout(() => finish(false), 7000);
  const cleanup = () => {
    el.removeEventListener('loadedmetadata', onMeta);
    el.removeEventListener('seeked', onSeeked);
    el.removeEventListener('error', onFail);
  };
  function finish(ok) {
    if (h.done) return;
    h.done = true;
    clearTimeout(giveUp);
    cleanup();
    if (handing === h) handing = null;
    if (!ok) {
      // fall back to a plain switch
      const at = old.currentTime;
      directUrl = url;
      retire(old);
      audio = el;
      el.src = src;
      seekWhenReady(at, el);
      el.play().catch((e) => logError('handover', e));
      emit('state');
      return;
    }
    directUrl = url;
    audio = el;
    if (isFx(el)) graph.resume();
    retire(old);
    emit('state');
  }
  function onMeta() {
    try {
      el.currentTime = old.currentTime + 0.12; // it takes a moment to start
    } catch {
      finish(false);
    }
  }
  function onSeeked() {
    el.play()
      .then(() => finish(true))
      .catch(() => finish(false));
  }
  function onFail() {
    finish(false);
  }
  el.addEventListener('loadedmetadata', onMeta, { once: true });
  el.addEventListener('seeked', onSeeked, { once: true });
  el.addEventListener('error', onFail, { once: true });
  el.src = src;
  el.load();
}

// True when the waves can use the real sound of the current track.
export const analysing = () => isFx(audio) && graph.state() === 'running';

// One line for the settings screen: do the waves hear the music right now, and if not, why.
export function waveStatus() {
  if (settings.wavesStyle === 'off') return 'Волны выключены';
  if (settings.wavesReactive === false) return 'Простой режим: волны двигаются сами, звук идёт напрямую';
  if (!current() || !state.playing) return 'Включи трек — здесь будет видно, слышат ли волны музыку';
  if (analysing()) return 'Волны слышат музыку';
  if (fxBroken || trackBypass) return 'Простой режим: ' + (fxReason || 'анализатор недоступен');
  if (!isFx(audio)) return 'Простой режим для этого трека';
  return 'Подключаю волны к звуку… (' + graph.state() + ')';
}

// Moves the current track to the direct element, e.g. when the analyser path goes
// silent. scope 'track': only this track; 'session': until the app restarts or the
// user switches the waves back to listening.
export function bypassAnalyser(reason, scope = 'track') {
  if (!isFx(audio)) return;
  if (scope === 'session') fxBroken = true;
  else trackBypass = true;
  fxReason = reason;
  logError('waves', new Error(reason));
  handOver(directUrl);
}

// The waves report that the analyser hears nothing. Only give up on it when the
// track is really moving forward (not buffering, not a quiet intro after a seek).
let silentMark = null;
export function reportSilence() {
  if (!isFx(audio) || audio.paused || audio.seeking || audio.readyState < 3) {
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

// The switch "Слышат музыку / Простой режим". Applies to the playing track at
// once, without a gap in the sound.
export function setWaveMode(reactive) {
  saveSettings({ wavesReactive: reactive });
  if (reactive) {
    if (!attachFailed) fxBroken = false;
    trackBypass = false;
    fxReason = '';
  }
  disarm(); // the waiting next track was prepared for the old mode
  if (!directUrl || !current()) return;
  const want = wantFx();
  if (want === isFx(audio)) return;
  const routable = directUrl.startsWith('blob:') || (Capacitor.isNativePlatform() && /^https?:/.test(directUrl));
  if (want && !routable) return;
  handOver(directUrl);
}

// ---------- playback ----------

// How long a track took to start, logged when it was slow (to find out why).
let startLog = null; // { seq, t0, resolved }
function noteStart() {
  const s = startLog;
  if (!s || s.seq !== loadSeq || s.done) return;
  s.done = true;
  const total = performance.now() - s.t0;
  if (total < 3500) return;
  const r = s.resolved ? Math.round(s.resolved - s.t0) : -1;
  logError('slow-start', new Error(`«${(current() || {}).title || ''}» запускался ${(total / 1000).toFixed(1)} с: ссылка ${r >= 0 ? (r / 1000).toFixed(1) + ' с' : '—'}, звук ${r >= 0 ? ((total - r) / 1000).toFixed(1) + ' с' : '—'} (${state.via || '?'})`));
}

async function load_(index, autoplay = true, auto = false) {
  const seq = ++loadSeq;
  startLog = { seq, t0: performance.now(), resolved: 0, done: !autoplay };
  disarm();
  state.index = index;
  const track = current();
  if (!track) return;
  state.loading = true;
  state.error = '';
  state.via = '';
  streamAttempts = 0;
  truncTries = 0;
  curRef = null;
  trackBypass = false;
  silentMark = null;
  emit('track', track);
  updateMetadata(track);
  audio.pause();
  try {
    const src = await resolve(track);
    if (startLog && startLog.seq === seq) startLog.resolved = performance.now();
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
    maybeExtend();
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

// A service has blocked the app for a moment and this track has neither a
// preloaded copy nor an MP3: on automatic track changes, jump to the next track
// that can play anyway; otherwise wait quietly and start this one afterwards.
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

// The track that plays when this one ends by itself, or -1.
function autoNextIndex() {
  if (state.index < state.queue.length - 1) return state.index + 1;
  if (state.repeat === 'all' && state.queue.length > 1) return 0;
  return -1;
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
  endlessNoted = false;
  saveQueue();
  load_(Math.max(0, Math.min(startIndex, state.queue.length - 1)));
}

export function playAt(index, auto = false) {
  if (index < 0 || index >= state.queue.length) return;
  if (!auto) failStreak = 0;
  // the next track already waiting on the other deck starts at once
  if (armed && armed.index === index && armed.ready) {
    startArmed();
    return;
  }
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
  if (isFx(audio)) graph.resume();
  // Paused for minutes and still on the stream (the copy didn't make it): the old
  // link has probably expired, so ask for a fresh one instead of waiting for it to fail.
  const idle = pausedAt ? Date.now() - pausedAt : 0;
  if (idle > 90000 && /^https?:/.test(directUrl) && curRef && !state.loading) {
    const seq = loadSeq;
    const at = audio.currentTime;
    state.loading = true;
    emit('state');
    online
      .streamFor(curRef)
      .then((url) => {
        if (seq === loadSeq) moveTo(url, at, true);
      })
      .catch(() => {
        if (seq === loadSeq) audio.play().catch(() => load_(state.index));
      })
      .finally(() => {
        if (seq !== loadSeq) return;
        state.loading = false;
        emit('state');
      });
    return;
  }
  audio.play().catch((e) => {
    if (e && e.name === 'AbortError') return; // a quick pause right after play: nothing broke
    logError('resume', e);
    load_(state.index); // the stream link may have expired
  });
}

export function pause() {
  clearTimeout(earlyTimer);
  earlyTimer = 0;
  audio.pause();
}

export function next(auto = false) {
  if (!state.queue.length) return;
  if (state.index < state.queue.length - 1) return playAt(state.index + 1, auto);
  // the end of the queue
  if (state.repeat === 'all') return playAt(0, auto);
  if (settings.endless) {
    // carry on with similar music; while it is being picked, more presses don't pile up
    if (state.extending) return;
    state.extending = true;
    emit('state');
    extendQueue().then((added) => {
      state.extending = false;
      if (added) playAt(state.index + 1, true);
      else if (auto) pause();
      else playAt(0, false);
      emit('state');
    });
    return;
  }
  if (!auto) return playAt(0, false);
  pause();
}

// A swipe always goes to the previous track; the button restarts a track that
// has played for a while, like every player.
export function prev(force = false) {
  if (!state.queue.length) return;
  if (!force && audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }
  playAt(state.index > 0 ? state.index - 1 : state.repeat === 'all' ? state.queue.length - 1 : 0);
}

// ---------- the next track, waiting on the other deck ----------

let armed = null; // { index, key, d, el, url, via, ref, blobUrl, match, ready }
let arming = false;
let earlyTimer = 0;

function disarm() {
  clearTimeout(earlyTimer);
  earlyTimer = 0;
  if (!armed) return;
  const a = armed;
  armed = null;
  a.el.pause();
  a.el.removeAttribute('src');
  a.el.load();
  if (a.blobUrl) URL.revokeObjectURL(a.blobUrl);
}

async function arm() {
  if (armed || arming || settings.gapless === false || state.repeat === 'one') return;
  const ni = autoNextIndex();
  const t = ni >= 0 ? state.queue[ni] : null;
  if (!t || t.unavailable) return;
  arming = true;
  const seq = loadSeq;
  try {
    const src = await resolve(t);
    if (seq !== loadSeq || autoNextIndex() !== ni || state.queue[ni] !== t) {
      if (src.url.startsWith('blob:')) URL.revokeObjectURL(src.url);
      return;
    }
    if (wantFx() && Capacitor.isNativePlatform() && /^https?:/.test(src.url)) await checkCors(src.url);
    if (seq !== loadSeq) {
      if (src.url.startsWith('blob:')) URL.revokeObjectURL(src.url);
      return;
    }
    const d = 1 - deck;
    const { el, src: s } = pick(d, src.url);
    const a = { index: ni, key: t.key, d, el, url: src.url, via: src.via, ref: src.ref || null, blobUrl: src.url.startsWith('blob:') ? src.url : '', match: src.match, ready: false };
    armed = a;
    el.src = s;
    el.load();
    el.addEventListener('canplaythrough', () => (a.ready = true), { once: true });
    el.addEventListener('canplay', () => (a.ready = true), { once: true });
    el.addEventListener(
      'error',
      () => {
        if (armed === a) disarm();
      },
      { once: true }
    );
  } catch {
    // it will be loaded the usual way when its turn comes
  } finally {
    arming = false;
  }
}

// The waiting track takes over — instantly, it is already loaded.
function startArmed() {
  const a = armed;
  armed = null;
  clearTimeout(earlyTimer);
  earlyTimer = 0;
  ++loadSeq;
  const old = audio;
  const oldBlob = objectUrl;
  deck = a.d;
  audio = a.el;
  directUrl = a.url;
  objectUrl = a.blobUrl;
  curRef = a.ref;
  streamAttempts = 0;
  truncTries = 0;
  trackBypass = false;
  silentMark = null;
  state.index = a.index;
  state.via = a.via;
  state.loading = false;
  state.error = '';
  state.waitingUntil = 0;
  const track = current();
  if (track) track.unavailable = false;
  if (isFx(audio)) graph.resume();
  audio.play().catch((e) => handlePlayError(e, loadSeq));
  old.pause();
  setTimeout(() => {
    if (old !== audio && !(armed && armed.el === old)) {
      old.removeAttribute('src');
      old.load();
    }
    if (oldBlob && oldBlob !== objectUrl) URL.revokeObjectURL(oldBlob);
  }, 600);
  dropFullCopy();
  failStreak = 0;
  emit('track', track);
  updateMetadata(track);
  emit('state');
  saveQueue();
  if (a.via.endsWith('fallback')) emit('fallback', { track, via: a.via, match: a.match });
  maybeExtend();
}

// Can the element's own length be trusted to the last fraction of a second?
function lengthTrusted() {
  const t = current();
  const el = audio.duration;
  return isFinite(el) && el > 0 && t && t.duration > 0 && Math.abs(el - t.duration) < 1.5;
}

// Called on every timeupdate: get the next track ready in time, and start it a
// hair before the end so there is no gap at all.
function gaplessTick() {
  if (settings.gapless === false || audio.paused) return;
  const el = audio.duration;
  if (!isFinite(el) || el <= 0) return;
  const rem = el - audio.currentTime;
  if (!armed && !arming && rem < 25) arm();
  if (armed && armed.ready && !earlyTimer && rem < 0.6 && rem > 0 && lengthTrusted() && armed.index === autoNextIndex()) {
    earlyTimer = setTimeout(() => {
      earlyTimer = 0;
      if (armed && !audio.paused && armed.index === autoNextIndex()) startArmed();
    }, Math.max(0, (rem - 0.06) * 1000));
  }
}

// ---------- the end of the queue: endless music ----------

let continuation = null; // async (recentTracks) => tracks
let extending = null;
let endlessNoted = false;

export function setContinuation(fn) {
  continuation = fn;
}

async function extendQueue() {
  if (!continuation) return 0;
  if (extending) return extending;
  extending = (async () => {
    try {
      const have = new Set(state.queue.map((t) => t.key));
      const recent = state.queue.slice(Math.max(0, state.index - 8), state.index + 1);
      const more = ((await continuation(recent)) || []).filter((t) => t && !have.has(t.key)).slice(0, 25);
      if (!more.length) return 0;
      for (const t of more) state.queue.push({ ...t, auto: true });
      if (state.original) state.original.push(...more.map((t) => ({ ...t, auto: true })));
      saveQueue();
      emit('queue');
      schedulePreload(500);
      return more.length;
    } catch (e) {
      logError('endless', e);
      return 0;
    } finally {
      setTimeout(() => (extending = null), 0);
    }
  })();
  return extending;
}

// Near the end of the queue, fetch what comes next in advance (so it can be
// prepared and start without a gap too).
function maybeExtend() {
  if (!settings.endless || state.repeat !== 'off') return;
  if (state.queue.length - 1 - state.index > 1) return;
  extendQueue();
}

export function endlessStarted(track) {
  if (!track || !track.auto || endlessNoted) return false;
  endlessNoted = true;
  return true;
}

// ---------- seeking a stream that goes through the proxy ----------

let fullCopy = null; // { key, url, loading } — the whole current track, downloaded in the background

function dropFullCopy() {
  if (fullCopy && fullCopy.url) URL.revokeObjectURL(fullCopy.url);
  fullCopy = null;
}

const viaProxyNow = () => isFx(audio) && String(audio.src).includes('_capacitor_http_interceptor_');

function isBuffered(t) {
  const b = audio.buffered;
  for (let i = 0; i < b.length; i++) if (t >= b.start(i) - 0.5 && t <= b.end(i) - 0.5) return true;
  return false;
}

// Downloads the whole track while it plays, so a jump far ahead (or a stream that
// breaks off) can switch to the downloaded copy. `force`: also for a stream that
// plays directly (used while paused, see prepareResume).
function startFullCopy(force = false) {
  const track = current();
  if (!track || (fullCopy && fullCopy.key === track.key)) return fullCopy;
  if (!(force ? /^https?:/.test(directUrl) && String(state.via).startsWith('online') : viaProxyNow())) return null;
  const copy = { key: track.key, url: '', loading: true, onReady: null };
  fullCopy = copy;
  const url = directUrl;
  fetch(Capacitor.isNativePlatform() ? proxied(url) : url)
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => {
      if (fullCopy !== copy || !blob || blob.size < 50000) return;
      copy.url = URL.createObjectURL(blob);
      if (copy.onReady) copy.onReady();
    })
    .catch((e) => logError('stream-copy', e))
    .finally(() => (copy.loading = false));
  return copy;
}

// ---------- a long pause ----------
// After a while on pause the phone lets go of the stream (and its link expires),
// so pressing play again used to take seconds. Some time into a pause the track
// quietly moves to a complete copy in memory: play then starts at once.

let pausedAt = 0;
let restTimer = 0;

function quietSwap(url) {
  if (!audio.paused) return false;
  const at = audio.currentTime;
  const { el, src } = pick(deck, url);
  directUrl = url;
  if (el !== audio) {
    retire(audio);
    audio = el;
  }
  audio.src = src;
  seekWhenReady(at);
  emit('state');
  return true;
}

function useCopy(copy) {
  const t = current();
  if (!copy || !copy.url || !t || copy.key !== t.key || !audio.paused || state.loading) return;
  if (fullCopy === copy) fullCopy = null;
  setObjectUrl(copy.url);
  quietSwap(copy.url);
}

function prepareResume() {
  const t = current();
  if (!t || !audio.paused || state.loading || !/^https?:/.test(directUrl) || !String(state.via).startsWith('online')) return;
  const copy = fullCopy && fullCopy.key === t.key ? fullCopy : startFullCopy(true);
  if (!copy) return;
  if (copy.url) useCopy(copy);
  else copy.onReady = () => useCopy(copy);
}

function moveTo(url, at, wasPlaying) {
  setSource(url);
  seekWhenReady(at);
  if (wasPlaying) audio.play().catch((e) => logError('seek', e));
  emit('state');
}

export function seek(sec) {
  if (!isFinite(sec)) return;
  clearTimeout(earlyTimer);
  earlyTimer = 0;
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

// The track "ended" long before its real length: the stream broke off. Carry on
// from the same place instead of skipping the rest of the song.
function recoverTruncated() {
  const t = current();
  const exp = t && t.duration;
  const pos = audio.currentTime;
  if (!exp || pos > exp - 6 || truncTries >= 2 || !String(state.via).startsWith('online')) return false;
  // a file that really is that short (a 30-second preview without Plus) ended normally
  if (isFinite(audio.duration) && audio.duration > 0 && pos >= audio.duration - 6) return false;
  truncTries++;
  logError('stream', new Error(`Поток оборвался на ${fmtTime(pos)} из ${fmtTime(exp)} — продолжаю с того же места`));
  if (fullCopy && fullCopy.url && fullCopy.key === t.key) {
    const u = fullCopy.url;
    fullCopy = null;
    setObjectUrl(u);
    moveTo(u, pos, true);
    return true;
  }
  if (curRef) {
    const seq = loadSeq;
    online
      .streamFor(curRef)
      .then((url) => {
        if (seq !== loadSeq) return;
        trackBypass = true; // straight from the host this time
        fxReason = 'поток прервался';
        moveTo(url, pos, true);
      })
      .catch(() => {
        if (seq === loadSeq) next(true);
      });
    return true;
  }
  return false;
}

export function setShuffle(on) {
  const cur = current();
  if (on === state.shuffle || !cur) {
    state.shuffle = on;
    emit('state');
    return;
  }
  disarm();
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
  disarm();
  saveQueue();
  emit('state');
  maybeExtend();
}

export function playNext(track) {
  if (!current()) return playQueue([track]);
  disarm();
  state.queue.splice(state.index + 1, 0, { ...track });
  if (state.original) state.original.push({ ...track });
  saveQueue();
  emit('queue');
  schedulePreload(2000);
}

export function addToQueue(track) {
  if (!current()) return playQueue([track]);
  if (armed && autoNextIndex() === -1) disarm();
  state.queue.push({ ...track });
  if (state.original) state.original.push({ ...track });
  saveQueue();
  emit('queue');
}

export function removeFromQueue(i) {
  if (i === state.index || i < 0 || i >= state.queue.length) return;
  disarm();
  state.queue.splice(i, 1);
  if (i < state.index) state.index--;
  saveQueue();
  emit('queue');
}

// ---------- audio element events ----------

function setPlaying(p) {
  if (state.playing === p) return;
  state.playing = p;
  emit('state');
  MediaSession.setPlaybackState({ playbackState: current() ? (p ? 'playing' : 'paused') : 'none' }).catch(() => {});
}

const mine = (fn) => (e) => {
  if (e.target === audio) fn(e);
};
let lastPosPush = 0;

for (const el of allElements) {
  el.addEventListener(
    'playing',
    mine(() => {
      setPlaying(true);
      pausedAt = 0;
      clearTimeout(restTimer);
      pushPosition();
      schedulePreload(800);
      setTimeout(startFullCopy, 1500);
      noteStart();
    })
  );
  el.addEventListener(
    'pause',
    mine(() => {
      clearTimeout(earlyTimer);
      earlyTimer = 0;
      setPlaying(false);
      pausedAt = Date.now();
      clearTimeout(restTimer);
      restTimer = setTimeout(prepareResume, 10000);
    })
  );
  el.addEventListener(
    'ended',
    mine(() => {
      if (state.repeat === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      if (recoverTruncated()) return;
      if (armed && armed.index === autoNextIndex()) return startArmed();
      next(true);
    })
  );
  el.addEventListener('error', mine(onError));
  el.addEventListener(
    'timeupdate',
    mine(() => {
      emit('time');
      gaplessTick();
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
  const viaProxy = isFx(audio) && !directUrl.startsWith('blob:');
  logError('audio', new Error('Ошибка воспроизведения, код ' + code + (viaProxy ? ' (через прокси)' : '')));
  // Stream links expire: fetch a fresh one, keeping the position. The second try
  // skips the proxy in case the proxy itself is the problem.
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
  } else if (viaProxy === false && isFx(audio) && !fxBroken) {
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
  if (!isFx(audio) || audio.paused || fxBroken) {
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
  if (isFx(audio)) graph.resume();
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

// After the user signed in: try the current track again.
export function retryCurrent() {
  if (current()) load_(state.index, true, false);
}
