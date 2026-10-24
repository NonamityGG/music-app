// One door to online music. Since 1.1 that is Yandex Music only: Zvuk kept
// blocking the app, so it is used just to bring playlists over (importers).
// Search, likes, the feed, matching and playback of anything that isn't the
// user's own MP3 go through Yandex Music once the user has signed in.

import * as ya from './yandex.js';

export const SERVICES = { yandex: ya };
export const NAMES = { yandex: 'Яндекс Музыка' };

export function connected() {
  return ya.isLoggedIn() ? ['yandex'] : [];
}

export const primaryId = () => 'yandex';
export const isLoggedIn = () => ya.isLoggedIn();
export const primaryName = () => NAMES.yandex;

export class OfflineError extends Error {
  constructor() {
    super('Подключи Яндекс Музыку в профиле — без неё играют только твои MP3');
    this.kind = 'nologin';
  }
}

function need() {
  if (!ya.isLoggedIn()) throw new OfflineError();
}

export async function quickSearch(q, n) {
  need();
  return ya.quickSearch(q, n);
}
export async function getTracks(ids) {
  need();
  return ya.getTracks(ids);
}
export async function collectionArtistIds() {
  need();
  return ya.collectionArtistIds();
}
export async function userPlaylists() {
  need();
  return ya.userPlaylists();
}
export async function playlistTracks(id) {
  need();
  return ya.playlistTracks(id);
}
export async function getRelease(id) {
  need();
  return ya.getRelease(id);
}
export async function getArtists(ids, opts) {
  need();
  return ya.getArtists(
    ids.filter((id) => String(id).startsWith('y:')),
    opts
  );
}

// Liked ids are asked for by the feed, the menus and the player; one request per
// few minutes is enough.
let likedCache = null; // { at, ids }
export async function likedTrackIds(_service, fresh = false) {
  need();
  if (!fresh && likedCache && Date.now() - likedCache.at < 5 * 60 * 1000) return likedCache.ids;
  const ids = await ya.likedTrackIds();
  likedCache = { at: Date.now(), ids };
  return ids;
}

// Where a track streams from: { p: 'yandex', id } or null.
export function refOf(track) {
  if (!track) return null;
  if ((track.src === 'yandex' || track.src === 'ext') && track.yid) return { p: 'yandex', id: track.yid };
  return null;
}

export const usable = (p) => p === 'yandex' && ya.isLoggedIn();

export const streamFor = (ref) => ya.streamUrl(ref.id);

// Track's own service, if the user can like it there.
export function serviceOf(track) {
  return track && track.src === 'yandex' && ya.isLoggedIn() ? 'yandex' : '';
}

export function likeKey(track) {
  return track && track.yid ? 'y:' + track.yid : '';
}

export function setLiked(track, liked) {
  likedCache = null;
  return ya.setLiked(track.yid, liked);
}

// Kept for the player and matcher: Yandex doesn't throttle the app.
export const blocked = () => false;
export const blockedRemaining = () => 0;
