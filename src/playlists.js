// Playlists kept in the app: the user's own, and ones brought in from other
// services (each remembers its source, which decides its folder). Tracks can be
// MP3s, Zvuk tracks, or songs from another service ("ext") that play from an MP3
// or from Zvuk once matched.

import { load, logError } from './settings.js';
import { uid } from './util.js';

let lists = load('playlists', []);
const listeners = new Set();

export function onPlaylistsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let saveTimer = 0;
function commit(now = true) {
  const write = () => {
    try {
      localStorage.setItem('rez.playlists', JSON.stringify(lists));
    } catch (e) {
      logError('playlists', new Error('Не хватает места для плейлистов: ' + e.message));
    }
  };
  clearTimeout(saveTimer);
  if (now) write();
  else saveTimer = setTimeout(write, 600);
  for (const fn of listeners) fn();
}

// Only the fields needed to show and play a track are stored.
export function snapshot(t) {
  const s = {
    key: t.key,
    src: t.src,
    title: t.title,
    artist: t.artist,
    artists: t.artists || [],
    album: t.album || '',
    // local covers are large data URLs; they are looked up from the MP3 library instead
    cover: t.src === 'local' ? '' : t.cover || '',
    duration: t.duration || 0,
  };
  if (t.zid) s.zid = t.zid;
  if (t.yid) s.yid = t.yid;
  if (t.lid) s.lid = t.lid;
  if (t.releaseId) s.releaseId = t.releaseId;
  if (t.ambiguous) s.ambiguous = true;
  if (t.match) s.match = t.match;
  return s;
}

export function allPlaylists() {
  return lists;
}

export function playlistsFrom(source) {
  return lists.filter((p) => (p.source || 'mine') === source);
}

export function getPlaylist(id) {
  return lists.find((p) => p.id === id) || null;
}

export function createPlaylist(name, tracks = [], source = 'mine', extra = {}) {
  const p = { id: uid(), name: String(name || '').trim() || 'Новый плейлист', source, tracks: tracks.map(snapshot), createdAt: Date.now(), ...extra };
  lists.unshift(p);
  commit();
  return p;
}

export function addTracks(id, tracks) {
  const p = getPlaylist(id);
  if (!p) return 0;
  const have = new Set(p.tracks.map((t) => t.key));
  let added = 0;
  for (const t of tracks) {
    if (have.has(t.key)) continue;
    p.tracks.push(snapshot(t));
    have.add(t.key);
    added++;
  }
  commit();
  return added;
}

// Stores what a song was matched to (MP3 or Zvuk) in every playlist that has it.
export function rememberMatch(key, patch) {
  let changed = false;
  for (const p of lists) {
    for (const t of p.tracks) {
      if (t.key !== key) continue;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) {
          if (k in t) {
            delete t[k];
            changed = true;
          }
        } else if (t[k] !== v) {
          t[k] = v;
          changed = true;
        }
      }
    }
  }
  if (changed) commit(false);
}

export function removeTrackAt(id, index) {
  const p = getPlaylist(id);
  if (!p) return;
  p.tracks.splice(index, 1);
  commit();
}

export function moveTrack(id, from, to) {
  const p = getPlaylist(id);
  if (!p || to < 0 || to >= p.tracks.length) return;
  const [t] = p.tracks.splice(from, 1);
  p.tracks.splice(to, 0, t);
  commit();
}

export function renamePlaylist(id, name) {
  const p = getPlaylist(id);
  if (!p) return;
  p.name = name.trim() || p.name;
  commit();
}

// 1.1: Zvuk no longer plays. Its tracks in playlists become plain "songs from
// another service" that play from an MP3 or Yandex Music once matched.
export function migrateFromZvuk(toExt) {
  let changed = false;
  for (const p of lists) {
    p.tracks = p.tracks.map((t) => {
      if (t.src === 'zvuk') {
        changed = true;
        return snapshot(toExt(t));
      }
      if (t.src === 'ext' && t.match === 'zvuk') {
        changed = true;
        const { match, zid, ...rest } = t;
        return rest;
      }
      return t;
    });
  }
  if (changed) commit();
  return changed;
}

export function deletePlaylist(id) {
  lists = lists.filter((p) => p.id !== id);
  commit();
}
