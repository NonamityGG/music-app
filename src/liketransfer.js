// Bringing likes over: the songs of a playlist that came from another service
// (Звук's «Мне нравится», Spotify's liked songs, any list) are found in Yandex
// Music and added to «Мне нравится» there. The list's first song ends up on top,
// like in the original. Songs already liked are left alone.

import * as pl from './playlists.js';
import * as online from './online.js';
import * as ya from './yandex.js';
import { findOnline, onlinePatch } from './matcher.js';
import { logError } from './settings.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The lists that look like someone's favourites go first in the picker.
export const looksLiked = (p) => /:liked$/.test(p.origin || '') || /нравится|любим|избран|liked|favou?rite/i.test(p.name || '');

export function transferable() {
  return pl
    .allPlaylists()
    .filter((p) => p.tracks.length && (p.source || 'mine') !== 'mine')
    .sort((a, b) => Number(looksLiked(b)) - Number(looksLiked(a)));
}

// onStep(text, done, total). Returns { added, already, missing: [tracks] }.
export async function likeInYandex(id, onStep = () => {}) {
  if (!online.isLoggedIn()) throw new Error('Сначала войди в Яндекс Музыку в профиле');
  const p = pl.getPlaylist(id);
  if (!p) throw new Error('Плейлиста больше нет');
  const seen = new Set();
  const tracks = p.tracks.filter((t) => !seen.has(t.key) && seen.add(t.key));
  const total = tracks.length;

  onStep('Смотрю, что уже есть в «Мне нравится»', 0, total);
  const liked = new Set((await online.likedTrackIds(null, true)).map(String));

  // 1. a Yandex id for every song (most were found when the list came over)
  const yids = [];
  const missing = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    let yid = t.yid ? String(t.yid) : '';
    if (!yid && t.match !== 'none' && t.title) {
      try {
        const z = await findOnline(t);
        if (z && z.yid) {
          yid = String(z.yid);
          // a song that plays from an MP3 keeps doing so; it just learns its Yandex id
          pl.rememberMatch(t.key, t.match ? { yid } : onlinePatch(t, z));
        } else if (!t.match) pl.rememberMatch(t.key, { match: 'none' });
      } catch (e) {
        if (e.kind === 'network' || e.kind === 'nologin' || e.kind === 'auth') throw e;
        logError('like-transfer', e);
      }
    }
    if (yid) yids.push(yid);
    else missing.push(t);
    if (i % 3 === 0 || i === tracks.length - 1) onStep('Ищу песни в Яндекс Музыке', i + 1, total);
  }

  // 2. likes, last song first, so the order matches the original list
  const todo = [...new Set(yids)].filter((y) => !liked.has(y)).reverse();
  const already = new Set(yids).size - todo.length;
  for (let i = 0; i < todo.length; i += 50) {
    onStep('Ставлю лайки', Math.min(todo.length, i + 50), todo.length);
    await ya.likeMany(todo.slice(i, i + 50));
    if (i + 50 < todo.length) await sleep(350);
  }
  online.forgetLiked();
  return { added: todo.length, already, missing };
}
