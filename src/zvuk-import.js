// Bringing playlists over from Zvuk. Zvuk blocks apps that play from it, so
// since 1.1 it is only a source of playlists: by a share link, or all of the
// user's playlists at once after signing in. Requests go slowly through zvuk.com
// opened inside the app; if Zvuk refuses, the import waits and carries on, and a
// shared playlist can also be read straight from its web page.

import * as zvuk from './zvuk.js';
import * as web from './serviceweb.js';
import { extTrack, ImportError } from './importers.js';
import { logError } from './settings.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function detectZvukLink(text) {
  const s = String(text || '').trim();
  const m = s.match(/(?:sber-)?zvuk\.com\/(playlist|release|album)\/(\d+)/i);
  if (m) return { kind: m[1].toLowerCase() === 'playlist' ? 'playlist' : 'release', id: m[2], url: `https://zvuk.com/${m[1].toLowerCase()}/${m[2]}` };
  const u = s.match(/https?:\/\/[^\s]*zvuk\.com\/[^\s]+/i);
  if (u) return { kind: 'page', id: '', url: u[0] };
  return null;
}

export function toExt(t) {
  return extTrack({ title: t.title, artist: t.artist, album: t.album, duration: t.duration, cover: t.cover });
}

// Zvuk asks the app to slow down: wait as long as it says, a few times.
async function patiently(step, onWait) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await step();
    } catch (e) {
      if ((e.kind === 'bot' || e.kind === 'rate') && attempt < 4) {
        const ms = Math.max(5000, zvuk.botRemaining() + 1500);
        if (onWait) onWait(ms);
        await sleep(ms);
        continue;
      }
      throw e;
    }
  }
}

// ---------- reading a playlist from its web page ----------

// Finds the longest list of track-like objects anywhere in the page data.
export function findTracksIn(data) {
  let best = null;
  let bestTitle = '';
  const seen = new Set();
  const artistOf = (o) => {
    if (Array.isArray(o.artists) && o.artists.length) {
      const names = o.artists.map((a) => (typeof a === 'string' ? a : a && (a.title || a.name))).filter(Boolean);
      if (names.length) return names.join(', ');
    }
    if (Array.isArray(o.artistNames) && o.artistNames.length) return o.artistNames.join(', ');
    if (Array.isArray(o.artist_names) && o.artist_names.length) return o.artist_names.join(', ');
    if (typeof o.artist === 'string') return o.artist;
    if (typeof o.credits === 'string') return o.credits;
    return '';
  };
  const isTrack = (o) => o && typeof o === 'object' && !Array.isArray(o) && typeof o.title === 'string' && o.title && !!artistOf(o);
  const walk = (node, parent, depth) => {
    if (!node || typeof node !== 'object' || depth > 40 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const tracks = node.filter(isTrack);
      if (tracks.length >= 1 && tracks.length >= node.length * 0.6 && (!best || tracks.length > best.length)) {
        best = tracks;
        bestTitle = parent && typeof parent.title === 'string' ? parent.title : '';
      }
      for (const x of node) walk(x, node, depth + 1);
      return;
    }
    for (const v of Object.values(node)) walk(v, node, depth + 1);
  };
  walk(data, null, 0);
  if (!best) return null;
  const tracks = best.map((o) => {
    let duration = Number(o.duration || o.durationSec || o.duration_sec || (o.durationMs ? o.durationMs / 1000 : 0)) || 0;
    if (duration > 10000) duration /= 1000; // milliseconds
    const rel = o.release || o.album || {};
    return {
      title: o.title,
      artist: artistOf(o),
      album: typeof rel === 'object' ? rel.title || '' : String(rel),
      duration,
      cover: '',
    };
  });
  return { title: bestTitle, tracks };
}

const EXTRACT = `(function(){
  var out=[];
  var ss=document.querySelectorAll('script');
  for(var i=0;i<ss.length;i++){
    var s=ss[i],t=s.textContent||'';
    if(t.length>8000000)continue;
    var c=t.trim().charAt(0);
    if(s.id==='__NEXT_DATA__'||s.type==='application/json'||s.type==='application/ld+json'||((c==='{'||c==='[')&&t.indexOf('"title"')>=0))out.push(t);
  }
  try{if(window.__NEXT_DATA__)out.push(JSON.stringify(window.__NEXT_DATA__));}catch(e){}
  try{if(window.__APOLLO_STATE__)out.push(JSON.stringify(window.__APOLLO_STATE__));}catch(e){}
  var h1=document.querySelector('h1');
  return JSON.stringify({title:(h1&&h1.textContent)||document.title||'',blobs:out.slice(0,8)});
})()`;

async function readPage(url) {
  if (!web.available()) throw new ImportError('Чтение страницы Звука работает в приложении на телефоне');
  await web.open('zvuk', url);
  await web.nextPage('zvuk', 20000);
  // the page may first show Zvuk's browser check, which reloads it: try a few times
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    let res = null;
    try {
      const raw = await web.run('zvuk', EXTRACT);
      res = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      logError('zvuk:page', e);
    }
    if (!res) continue;
    let found = null;
    for (const b of res.blobs || []) {
      let data;
      try {
        data = JSON.parse(b);
      } catch {
        continue;
      }
      const f = findTracksIn(data);
      if (f && (!found || f.tracks.length > found.tracks.length)) found = f;
    }
    if (found && found.tracks.length) {
      const title = String(res.title || found.title || '').replace(/\s*[|—-]\s*(Звук|Zvuk).*$/i, '').trim();
      return { name: title || found.title || 'Плейлист из Звука', tracks: found.tracks.map(toExt) };
    }
  }
  throw new ImportError('Не получилось прочитать плейлист со страницы Звука. Попробуй перенести его списком.');
}

// ---------- by link ----------

export async function importZvukLink(text, onWait) {
  const link = detectZvukLink(text);
  if (!link) throw new ImportError('Не понял ссылку. Нужна ссылка на плейлист или альбом в Звуке.');
  if (link.kind !== 'page') {
    try {
      if (link.kind === 'playlist') {
        const r = await patiently(() => zvuk.playlistTracks(link.id), onWait);
        if (r.tracks.length) return { name: r.title || 'Плейлист из Звука', tracks: r.tracks.map(toExt), origin: 'zvuk:' + link.id };
      } else {
        const r = await patiently(() => zvuk.getRelease(link.id), onWait);
        if (r && r.tracks.length) return { name: r.title, tracks: r.tracks.map(toExt), origin: 'zvuk:r' + link.id };
      }
    } catch (e) {
      logError('zvuk:import', e);
    }
  }
  // the API refused or the link is a short one: read the page itself
  const r = await readPage(link.url);
  return { ...r, origin: link.id ? 'zvuk:' + link.id : '' };
}

// ---------- everything of a signed-in user ----------

// onStep(text) shows progress; onList(group) is called for every playlist as soon
// as it is read, so a stop half-way keeps what was already brought over.
export async function importAllMine({ onStep, onList, skip = new Set() }) {
  if (!zvuk.isLoggedIn()) throw new ImportError('Сначала войди в Звук');
  const wait = (ms) => onStep(`Звук попросил подождать — продолжу через ${Math.ceil(ms / 1000)} с`);
  onStep('Смотрю, какие у тебя плейлисты…');
  const lists = await patiently(() => zvuk.userPlaylists(), wait);
  let done = 0;
  const total = lists.length + 1;

  const tracksOf = async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) out.push(...(await patiently(() => zvuk.getTracks(ids.slice(i, i + 100)), wait)));
    return out;
  };

  onStep('Переношу «Мне нравится»…');
  if (!skip.has('zvuk:liked')) {
    const tracks = await tracksOf(await patiently(() => zvuk.likedTrackIds(), wait));
    if (tracks.length) onList({ name: 'Мне нравится (Звук)', tracks: tracks.map(toExt), origin: 'zvuk:liked' });
  }
  done++;

  for (const p of lists) {
    done++;
    if (skip.has('zvuk:' + p.id)) continue;
    onStep(`Переношу «${p.title}» (${done} из ${total})…`);
    const tracks = await tracksOf(p.trackIds || []);
    if (tracks.length) onList({ name: p.title, tracks: tracks.map(toExt), origin: 'zvuk:' + p.id });
  }
  return lists.length;
}
