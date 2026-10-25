// Recommendation feed. The mix comes first of all from Yandex's own "Моя волна"
// (picked from the user's whole listening history), topped up with songs of
// similar artists; Yandex's personal playlists (Плейлист дня, Дежавю…) are shown
// as they are. New releases and similar artists come from the artists you listen
// to: liked tracks and artists in Yandex Music (recent likes count more), your
// own playlists, your MP3s and artists you pick by hand.

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
  // feeds built before 1.1.5 have no "Моя волна" yet: rebuild them once
  return !f || Date.now() - (f.at || 0) > TTL || (f.svc && f.svc !== online.primaryId()) || (!f.empty && !f.mixFrom);
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
  if (!online.isLoggedIn()) {
    // everything below comes from Yandex Music
    const empty = { at: Date.now(), svc, empty: true, nologin: true, seeds: [], releases: [], related: [], mix: [] };
    save('feed', empty);
    return empty;
  }

  onStep('Смотрю твоих артистов');
  // artists picked before 1.1 may have Zvuk ids: those are found again by name
  const byName = [];
  for (const a of favArtists()) {
    if (String(a.id).startsWith('y:')) add(a, 12);
    else if (a.name) byName.push({ name: a.name, w: 12 });
  }

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
      onStep('Смотрю, что тебе нравится в Яндекс Музыке');
      const liked = await online.likedTrackIds();
      for (const id of liked) knownKeys.add('y:' + id);
      const tracks = await online.getTracks(liked.slice(0, 300));
      // the list starts with the latest likes: what you like now weighs more
      tracks.forEach((t, i) => {
        const w = 1 + 2 * Math.max(0, 1 - i / 120);
        for (const a of t.artists) add(a, w);
      });
    } catch (e) {
      logError('feed:liked', e);
    }
  }

  try {
    const locals = (await localArtists()).slice(0, 8);
    for (const la of locals) byName.push({ name: la.name, w: 2 + la.count * 1.5 });
    if (byName.length) onStep('Ищу твоих артистов');
    for (const la of byName.slice(0, 14)) {
      try {
        const res = await online.quickSearch(la.name, 6);
        const hit = res.artists.find((a) => norm(a.name) === norm(la.name));
        if (hit) add(hit, la.w);
      } catch (e) {
        if (e.kind === 'network' || e.kind === 'nologin') throw e;
      }
    }
  } catch (e) {
    logError('feed:local', e);
  }

  // Yandex's own picks for this user
  let wave = [];
  let personal = [];
  try {
    onStep('Слушаю твою волну');
    wave = await online.myWave(50);
  } catch (e) {
    logError('feed:wave', e);
  }
  try {
    personal = await online.personalPlaylists();
  } catch (e) {
    logError('feed:personal', e);
  }

  const top = [...seeds.values()].sort((a, b) => b.w - a.w).slice(0, 14);
  if (!top.length) {
    if (wave.length) {
      const feed = { at: Date.now(), svc, seeds: [], releases: [], related: [], mix: wave.slice(0, 60), mixFrom: 'wave', personal };
      save('feed', feed);
      return feed;
    }
    const empty = { at: Date.now(), svc, empty: true, seeds: [], releases: [], related: [], mix: [], personal };
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
  // the wave keeps Yandex's order (it is deliberate); a few songs of similar
  // artists are woven in, and they fill up the rest when the wave is short
  const extra = spreadByArtist(pool);
  let mix;
  if (wave.length >= 12) {
    mix = [];
    let k = 0;
    wave.forEach((t, i) => {
      mix.push(t);
      if (i % 5 === 4 && k < extra.length) mix.push(extra[k++]);
    });
    mix = mix.concat(extra.slice(k));
  } else mix = wave.concat(extra);
  mix = uniqBy(mix, (t) => t.key).slice(0, 60);

  const feed = {
    at: Date.now(),
    svc,
    seeds: seedInfo.map(({ id, name, image }) => ({ id, name, image })),
    releases,
    related: related.map(({ id, name, image }) => ({ id, name, image })),
    mix,
    mixFrom: wave.length >= 12 ? 'wave' : 'related',
    personal,
  };
  save('feed', feed);
  return feed;
}
