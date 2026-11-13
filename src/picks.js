// Резонанс's own picks for the feed: "this music resonates with you — play it?".
// They come from what you actually listen to here, so the app keeps a short
// history of plays (the last 300, on the phone only):
//   * "Резонирует с вами": Yandex's station around the song you've played most
//     in the last two weeks (music like it);
//   * "Давно не слушали": songs you played many times, then not for two weeks;
//   * "Открытия": songs of similar artists (from the feed) you haven't heard.

import { load, save } from './settings.js';
import { snapshot } from './playlists.js';
import { shuffle, uniqBy } from './util.js';

const MAX = 300;
const DAY = 864e5;

// ---------- the history of plays ----------

let history = load('history', []); // [{ t: track snapshot, at: [timestamps…] }], latest first
let saveTimer = 0;

export function recordPlay(track) {
  if (!track || !track.key || track.auto === 'feed-preview') return;
  const now = Date.now();
  const i = history.findIndex((h) => h.t.key === track.key);
  const entry = i >= 0 ? history.splice(i, 1)[0] : { t: snapshot(track), at: [] };
  // a play counts once per 10 minutes (a skip back and forth isn't two plays)
  if (!entry.at.length || now - entry.at[0] > 10 * 60000) entry.at.unshift(now);
  entry.at = entry.at.slice(0, 30);
  entry.t = { ...snapshot(track), ...(track.yid ? { yid: track.yid } : {}) };
  history.unshift(entry);
  history = history.slice(0, MAX);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save('history', history), 1500);
}

export const playsIn = (entry, days, now = Date.now()) => entry.at.filter((a) => now - a < days * DAY).length;

// ---------- the picks ----------

// The song you've played most in the last two weeks (and played more than once).
export function topRecent(list = history, now = Date.now()) {
  let best = null;
  for (const h of list) {
    const n = playsIn(h, 14, now);
    if (n >= 2 && (!best || n > best.n)) best = { t: h.t, n };
  }
  return best;
}

// Songs played at least 3 times, but not in the last two weeks.
export function forgotten(list = history, now = Date.now()) {
  return list.filter((h) => h.at.length >= 3 && now - h.at[0] > 14 * DAY).map((h) => h.t);
}

// The picks for the feed. feed: the built feed (its discover pool).
// Each pick: { id, title, sub, cover, tracks? , station? } — a station is read when played.
export function buildPicks(feed, now = Date.now()) {
  const out = [];
  const top = topRecent(history, now);
  if (top && top.t.yid) {
    out.push({
      id: 'resonates',
      title: 'Эта музыка резонирует с вами',
      sub: `Похожее на «${top.t.title}» — вы слушали её ${top.n} раз за две недели. Может, включим?`,
      cover: top.t.cover || '',
      station: 'track:' + top.t.yid,
      seed: top.t,
    });
  }
  const old = forgotten(history, now);
  if (old.length >= 5) {
    out.push({
      id: 'forgotten',
      title: 'Давно не слушали',
      sub: 'Песни, которые вы раньше крутили часто, — вспомним?',
      cover: (old.find((t) => t.cover) || {}).cover || '',
      tracks: shuffle(old).slice(0, 40),
    });
  }
  const heard = new Set(history.map((h) => h.t.key));
  const disc = uniqBy((feed && feed.discover) || [], (t) => t.key).filter((t) => !heard.has(t.key));
  if (disc.length >= 6) {
    out.push({
      id: 'discover',
      title: 'Открытия',
      sub: 'Артисты, похожие на ваших, — их вы ещё не слышали',
      cover: (disc.find((t) => t.cover) || {}).cover || '',
      tracks: disc.slice(0, 40),
    });
  }
  return out;
}

// for tests
export function _setHistory(list) {
  history = list;
}
