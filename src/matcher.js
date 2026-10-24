// Finds where each imported song can play from: the user's MP3 first, Zvuk
// second. Runs in the background one playlist at a time, slowly enough not to
// upset Zvuk, and remembers the result in the playlist.

import * as pl from './playlists.js';
import * as online from './online.js';
import { localTracks } from './local.js';
import { bestMatch } from './match.js';
import { logError } from './settings.js';

const queue = [];
const progress = new Map(); // playlist id -> { done, total }
const listeners = new Set();
let running = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function onMatchProgress(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(id) {
  for (const fn of listeners) fn(id);
}

export function matchProgress(id) {
  return progress.get(id) || null;
}

// Searches the main connected service (Zvuk or Yandex Music) for the same song.
export async function findOnline(t) {
  const q = `${t.artist || ''} ${t.title}`.trim();
  const res = await online.quickSearch(q, 10);
  return bestMatch(t, res.tracks, t.artist ? 0.7 : 0.55);
}

export function onlinePatch(t, z) {
  const ya = z.src === 'yandex';
  return {
    match: ya ? 'online' : 'zvuk',
    zid: ya ? undefined : z.zid,
    yid: ya ? z.yid : undefined,
    cover: t.cover || z.cover,
    duration: t.duration || z.duration,
    album: t.album || z.album,
    releaseId: z.releaseId || undefined,
  };
}

export function queueMatch(id) {
  if (!queue.includes(id)) queue.push(id);
  run();
}

// Called at start-up: finish whatever was left unmatched last time.
export function resumeMatching() {
  for (const p of pl.allPlaylists()) {
    if (p.tracks.some((t) => t.src === 'ext' && !t.match)) queueMatch(p.id);
  }
}

// After MP3s are added or removed: update which songs now play from a file.
export async function rematchLocal() {
  const locals = await localTracks();
  const lids = new Set(locals.map((t) => t.lid));
  const seen = new Set();
  for (const p of pl.allPlaylists()) {
    for (const t of p.tracks) {
      if (t.src !== 'ext' || seen.has(t.key)) continue;
      seen.add(t.key);
      if (t.match === 'local' && t.lid && lids.has(t.lid)) continue;
      const m = bestMatch(t, locals);
      if (m) pl.rememberMatch(t.key, { match: 'local', lid: m.lid });
      else if (t.match === 'local') pl.rememberMatch(t.key, { match: undefined, lid: undefined });
    }
  }
  resumeMatching();
}

async function run() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      await matchOne(queue[0]);
      queue.shift();
    }
  } finally {
    running = false;
  }
}

async function matchOne(id) {
  const p = pl.getPlaylist(id);
  if (!p) return;
  const locals = await localTracks();
  const todo = p.tracks.filter((t) => t.src === 'ext' && !t.match);
  if (!todo.length) return;
  const prog = { done: 0, total: todo.length };
  progress.set(id, prog);
  emit(id);
  const done = new Set();
  for (const t of todo) {
    if (done.has(t.key)) {
      prog.done++;
      continue;
    }
    done.add(t.key);
    const m = bestMatch(t, locals);
    if (m) {
      pl.rememberMatch(t.key, { match: 'local', lid: m.lid });
    } else {
      let z = null;
      let gaveUp = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          z = await findOnline(t);
          break;
        } catch (e) {
          if (e.kind === 'bot' || e.kind === 'rate') {
            await sleep(online.blockedRemaining() + 1500);
            continue;
          }
          if (e.kind === 'network' || e.kind === 'check' || e.kind === 'auth') {
            gaveUp = true; // offline: try again next time the app starts
            break;
          }
          logError('match', e);
          break;
        }
      }
      if (gaveUp) break;
      pl.rememberMatch(t.key, z ? onlinePatch(t, z) : { match: 'none' });
    }
    prog.done++;
    emit(id);
  }
  progress.delete(id);
  emit(id);
}
