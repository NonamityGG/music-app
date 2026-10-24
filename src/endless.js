// Endless music: when the queue runs out, more of the same mood keeps playing.
// With Yandex Music: its station built around the last track (the same engine as
// "My Wave"). Without it: the user's own MP3s that haven't played recently.

import * as online from './online.js';
import * as ya from './yandex.js';
import { findOnline } from './matcher.js';
import { localTracks } from './local.js';
import { shuffle } from './util.js';
import { logError } from './settings.js';

async function yidOf(t) {
  if (t.yid) return t.yid;
  if (!t.title) return '';
  try {
    const m = await findOnline(t);
    return m ? m.yid : '';
  } catch {
    return '';
  }
}

// recent: the last tracks of the queue, oldest first.
export async function moreLike(recent) {
  const seeds = recent.slice().reverse();
  if (online.isLoggedIn()) {
    for (const t of seeds.slice(0, 3)) {
      const yid = await yidOf(t);
      if (!yid) continue;
      try {
        const tracks = await ya.stationTracks('track:' + yid, yid);
        if (tracks.length) return tracks;
      } catch (e) {
        if (e.kind === 'network') throw e;
        logError('endless', e);
      }
    }
  }
  const played = new Set(recent.map((t) => t.key));
  const locals = (await localTracks()).filter((t) => !played.has(t.key));
  return shuffle(locals).slice(0, 20);
}
