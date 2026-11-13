// Brought-in playlists, kept up to date: the source (the link it was brought in
// by, or the list of the signed-in account) is read again and the songs added
// there since come into the playlist here — in the source's order, without
// touching the user's own order or the songs they removed. A playlist that
// doesn't remember where it came from (brought in by a link before 1.2) asks for
// the link once and keeps it.

import * as sp from './spotify.js';
import { detectZvukLink, importZvukLink, likedTracks as zvukLiked } from './zvuk-import.js';
import { importFromLink, detectLink, ImportError } from './importers.js';
import * as pl from './playlists.js';
import { queueMatch } from './matcher.js';

// what can be refreshed: playlists brought in from Zvuk, Yandex Music or Spotify
// (VK and "other" come in as text lists — there is nothing to read again)
export const canRefresh = (p) => !!(p && ['zvuk', 'yandex', 'spotify'].includes(p.source));

async function readLink(link, onWait) {
  if (detectZvukLink(link)) return (await importZvukLink(link, onWait)).tracks;
  if (!detectLink(link)) throw new ImportError('Не понял ссылку. Нужна ссылка на плейлист в Яндекс Музыке, Звуке или Spotify.');
  return (await importFromLink(link)).tracks;
}

// the source's songs now, or null when the playlist doesn't know its source
async function readSource(p, onWait) {
  if (p.link) return readLink(p.link, onWait);
  const o = p.origin || '';
  let m;
  if (o === 'zvuk:liked') return zvukLiked(onWait);
  if ((m = /^zvuk:r(\d+)$/.exec(o))) return readLink('https://zvuk.com/release/' + m[1], onWait);
  if ((m = /^zvuk:(\d+)$/.exec(o))) return readLink('https://zvuk.com/playlist/' + m[1], onWait);
  if (o === 'spotify:liked') {
    if (!sp.isLoggedIn()) throw new ImportError('Чтобы обновить «Любимые треки» из Spotify, войди в Spotify');
    return sp.likedTracks();
  }
  if ((m = /^spotify:(.+)$/.exec(o))) {
    if (sp.isLoggedIn()) return sp.playlistTracks(m[1]);
    return readLink('https://open.spotify.com/playlist/' + m[1], onWait);
  }
  return null;
}

// askLink(): asks the user for the link (resolves with it, or '' to give up).
// Resolves with { added, total }, or null if there was nothing to read.
export async function refreshPlaylist(id, { askLink, onWait = () => {} } = {}) {
  let p = pl.getPlaylist(id);
  if (!p) return null;
  let tracks = await readSource(p, onWait);
  if (!tracks) {
    const link = askLink ? String((await askLink()) || '').trim() : '';
    if (!link) return null;
    tracks = await readLink(link, onWait); // read first: a wrong link isn't kept
    pl.setLink(id, link);
    p = pl.getPlaylist(id);
  }
  if (!tracks || !tracks.length) throw new ImportError('В источнике не нашлось песен — может, плейлист стал закрытым?');
  const added = pl.mergeFrom(id, tracks);
  if (added) queueMatch(id);
  return { added, total: tracks.length };
}
