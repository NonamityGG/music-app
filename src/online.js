// One door to the online services. The user may be signed in to Zvuk, to Yandex
// Music, or both; search, likes, the feed and matching use the main one, while
// artist/album/playlist pages and playback go to whichever service an id belongs
// to (Yandex ids start with "y:").

import * as zvuk from './zvuk.js';
import * as ya from './yandex.js';
import { settings } from './settings.js';

export const SERVICES = { zvuk, yandex: ya };
export const NAMES = { zvuk: 'Звук', yandex: 'Яндекс Музыка' };

export function connected() {
  const c = [];
  if (zvuk.isLoggedIn()) c.push('zvuk');
  if (ya.isLoggedIn()) c.push('yandex');
  return c;
}

export function primaryId() {
  const c = connected();
  if (c.includes(settings.primaryService)) return settings.primaryService;
  return c[0] || 'zvuk'; // nobody signed in: Zvuk's guest access
}

const primary = () => SERVICES[primaryId()];
const forId = (id) => (String(id).startsWith('y:') ? ya : zvuk);

export const isLoggedIn = () => connected().length > 0;
export const primaryName = () => NAMES[primaryId()];

export const quickSearch = (q, n) => primary().quickSearch(q, n);
export const getTracks = (ids, service) => (service ? SERVICES[service] : primary()).getTracks(ids);
// Liked ids are asked for by the feed, the menus and the player; one request per
// few minutes is enough.
const likedCache = new Map(); // service -> { at, ids }
export async function likedTrackIds(service, fresh = false) {
  const svc = service || primaryId();
  const c = likedCache.get(svc);
  if (!fresh && c && Date.now() - c.at < 5 * 60 * 1000) return c.ids;
  const ids = await SERVICES[svc].likedTrackIds();
  likedCache.set(svc, { at: Date.now(), ids });
  return ids;
}
export const collectionArtistIds = () => primary().collectionArtistIds();
export const userPlaylists = (service) => (service ? SERVICES[service] : primary()).userPlaylists();
export const playlistTracks = (id) => forId(id).playlistTracks(id);
export const getRelease = (id) => forId(id).getRelease(id);

export async function getArtists(ids, opts) {
  const y = ids.filter((id) => String(id).startsWith('y:'));
  const z = ids.filter((id) => !String(id).startsWith('y:'));
  const [ry, rz] = await Promise.all([y.length ? ya.getArtists(y, opts) : [], z.length ? zvuk.getArtists(z, opts) : []]);
  const all = new Map([...ry, ...rz].map((a) => [a.id, a]));
  return ids.map((id) => all.get(String(id))).filter(Boolean);
}

// Where a track streams from: { p: 'zvuk' | 'yandex', id } or null.
export function refOf(track) {
  if (!track) return null;
  if (track.src === 'yandex' || (track.src === 'ext' && track.yid)) return track.yid ? { p: 'yandex', id: track.yid } : null;
  if (track.zid) return { p: 'zvuk', id: track.zid };
  return null;
}

// Zvuk works without signing in (guest), Yandex only after sign-in.
export const usable = (p) => p === 'zvuk' || ya.isLoggedIn();

export const streamFor = (ref) => (ref.p === 'yandex' ? ya.streamUrl(ref.id) : zvuk.streamUrl(ref.id));

// Track's own service, if it is one we can act on as the user (likes).
export function serviceOf(track) {
  if (!track) return '';
  if (track.src === 'yandex') return ya.isLoggedIn() ? 'yandex' : '';
  if (track.src === 'zvuk') return zvuk.isLoggedIn() ? 'zvuk' : '';
  return '';
}

export function likeKey(track) {
  return track.src === 'yandex' || track.yid ? 'y:' + track.yid : track.zid ? 'z:' + track.zid : '';
}

export function setLiked(track, liked) {
  likedCache.delete(track.src === 'yandex' ? 'yandex' : 'zvuk');
  return track.src === 'yandex' ? ya.setLiked(track.yid, liked) : zvuk.setLiked(track.zid, liked);
}

export const blocked = () => primaryId() === 'zvuk' && zvuk.botBlocked();
export const blockedRemaining = () => zvuk.botRemaining();
