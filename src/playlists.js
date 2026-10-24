// The user's own playlists. They can mix Zvuk tracks and local MP3s.

import { load, save } from './settings.js';
import { uid } from './util.js';

let lists = load('playlists', []);
const listeners = new Set();

export function onPlaylistsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function commit() {
  save('playlists', lists);
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
  if (t.lid) s.lid = t.lid;
  if (t.releaseId) s.releaseId = t.releaseId;
  return s;
}

export function allPlaylists() {
  return lists;
}

export function getPlaylist(id) {
  return lists.find((p) => p.id === id) || null;
}

export function createPlaylist(name, tracks = []) {
  const p = { id: uid(), name: name.trim() || 'Новый плейлист', tracks: tracks.map(snapshot), createdAt: Date.now() };
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

export function deletePlaylist(id) {
  lists = lists.filter((p) => p.id !== id);
  commit();
}

// When a local file is deleted, its entries stay in playlists; the player
// then looks for the same song in Zvuk. Nothing to clean up here.
