// Recommendation feed. Built from the artists you listen to: liked tracks and
// artists in the main service (Zvuk or Yandex Music), your own playlists, your MP3s and artists you pick by hand.
// For them it gathers new releases, similar artists and a mix of their songs.

import * as online from './online.js';
import { load, save, logError } from './settings.js';
import { localArtists } from './local.js';
import { allPlaylists } from './playlists.js';
import { norm } from './match.js';
import { shuffle, uniqBy } from './util.js';

const TTL = 6 * 60 * 60 * 1000;

// ---------- hand-picked artists ----------

export function favArtists() {
  return load('favArtists', []);
}

export function isFav(id) {
  return favArtists().some((a) => a.id === String(id));
}

export function setFav(artist, on) {
  let list = favArtists().filter((a) => a.id !== String(artist.id));
  if (on) list.unshift({ id: String(artist.id), name: artist.name, image: artist.image || '' });
  save('favArtists', list.slice(0, 100));
  // the feed should reflect the change next time it is opened
  const f = load('feed', null);
  if (f) save('feed', { ...f, at: 0 });
}

// ---------- feed ----------

export function cachedFeed() {
  return load('feed', null);
}

export function feedIsStale(f) {
  return !f || Date.now() - (f.at || 0) > TTL || (f.svc && f.svc !== online.primaryId());
}

function releaseTime(r) {
  const t = Date.parse(r.date);
  return isNaN(t) ? 0 : t;
}

// Spreads tracks so one artist doesn't play several times in a row.
function spreadByArtist(tracks) {
  const groups = new Map();
  for (const t of tracks) {
    const k = (t.artists[0] && t.artists[0].id) || t.artist;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const lists = shuffle([...groups.values()].map((g) => shuffle(g)));
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const g of lists) {
      if (g.length) {
        out.push(g.shift());
        added = true;
      }
    }
  }
  return out;
}

export async function buildFeed(onStep = () => {}) {
  const svc = online.primaryId();
  const seeds = new Map(); // id -> { id, name, image, w }
  const add = (a, w) => {
    if (!a || !a.id) return;
    const id = String(a.id);
    const cur = seeds.get(id) || { id, name: a.name || '', image: a.image || '', w: 0 };
    cur.w += w;
    if (!cur.name && a.name) cur.name = a.name;
    seeds.set(id, cur);
  };
  const knownKeys = new Set();

  onStep('Смотрю твоих артистов');
  for (const a of favArtists()) add(a, 12);

  for (const p of allPlaylists()) {
    for (const t of p.tracks) {
      knownKeys.add(t.key);
      if (t.src === svc) for (const a of t.artists || []) add(a, 1);
    }
  }

  if (online.isLoggedIn()) {
    try {
      const ids = await online.collectionArtistIds();
      for (const id of ids.slice(0, 40)) add({ id }, 5);
    } catch (e) {
      logError('feed:artists', e);
    }
    try {
      onStep(`Смотрю, что тебе нравится в ${svc === 'yandex' ? 'Яндекс Музыке' : 'Звуке'}`);
      const liked = await online.likedTrackIds();
      for (const id of liked) knownKeys.add((svc === 'yandex' ? 'y:' : 'z:') + id);
      const tracks = await online.getTracks(liked.slice(0, 300));
      for (const t of tracks) for (const a of t.artists) add(a, 1);
    } catch (e) {
      logError('feed:liked', e);
    }
  }

  try {
    const locals = (await localArtists()).slice(0, 8);
    if (locals.length) onStep('Ищу артистов из твоих MP3');
    for (const la of locals) {
      try {
        const res = await online.quickSearch(la.name, 6);
        const hit = res.artists.find((a) => norm(a.name) === norm(la.name));
        if (hit) add(hit, 2 + la.count * 1.5);
      } catch (e) {
        if (e.kind === 'network' || e.kind === 'bot') throw e;
      }
    }
  } catch (e) {
    logError('feed:local', e);
  }

  const top = [...seeds.values()].sort((a, b) => b.w - a.w).slice(0, 14);
  if (!top.length) {
    const empty = { at: Date.now(), svc, empty: true, seeds: [], releases: [], related: [], mix: [] };
    save('feed', empty);
    return empty;
  }

  onStep('Собираю новинки и похожих артистов');
  const seedInfo = await online.getArtists(
    top.map((s) => s.id),
    { related: 10, tracks: 6, releases: 6 }
  );
  const seedIds = new Set(seedInfo.map((a) => a.id));

  // new releases of your artists
  const yearAgo = Date.now() - 365 * 24 * 3600 * 1000;
  let releases = uniqBy(
    seedInfo.flatMap((a) => a.releases),
    (r) => r.id
  ).sort((a, b) => releaseTime(b) - releaseTime(a));
  const fresh = releases.filter((r) => releaseTime(r) > yearAgo);
  releases = (fresh.length >= 4 ? fresh : releases).slice(0, 14);

  // similar artists, ranked by how many of your artists point to them
  const tally = new Map();
  for (const a of seedInfo) {
    a.related.forEach((r, i) => {
      if (seedIds.has(r.id)) return;
      const cur = tally.get(r.id) || { ...r, score: 0 };
      cur.score += 1 + (10 - i) / 20;
      tally.set(r.id, cur);
    });
  }
  const related = [...tally.values()].sort((a, b) => b.score - a.score).slice(0, 18);

  onStep('Собираю микс');
  let fromRelated = [];
  try {
    const rel = await online.getArtists(
      related.slice(0, 14).map((r) => r.id),
      { tracks: 4 }
    );
    fromRelated = rel.flatMap((a) => a.tracks);
  } catch (e) {
    logError('feed:mix', e);
  }
  const fromSeeds = seedInfo.flatMap((a) => a.tracks.slice(0, 3));
  const pool = uniqBy([...fromRelated, ...fromSeeds], (t) => t.key).filter((t) => !knownKeys.has(t.key));
  const mix = spreadByArtist(pool).slice(0, 60);

  const feed = {
    at: Date.now(),
    svc,
    seeds: seedInfo.map(({ id, name, image }) => ({ id, name, image })),
    releases,
    related: related.map(({ id, name, image }) => ({ id, name, image })),
    mix,
  };
  save('feed', feed);
  return feed;
}
