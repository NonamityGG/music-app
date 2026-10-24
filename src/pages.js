// Detail pages (artist, album, playlists, MP3 library) and the track menu.

import { h, icon, clear, tracksWord, toast, add } from './util.js';
import * as nav from './nav.js';
import * as player from './player.js';
import * as online from './online.js';
import * as accounts from './accounts.js';
import * as pl from './playlists.js';
import { localTracks, importFiles, removeLocal, onLocalChange } from './local.js';
import { setFav, isFav } from './feed.js';
import { logError } from './settings.js';
import { AppLauncher } from '@capacitor/app-launcher';
import { PLATFORMS, platformUrl } from './platforms.js';
import { SOURCES, sourceById, importFromLink, parseTextList, parseExportFile, detectLink, ImportError } from './importers.js';
import { matchProgress, onMatchProgress, queueMatch, rematchLocal } from './matcher.js';
import {
  trackList,
  section,
  spinner,
  errorBox,
  emptyState,
  playButtons,
  releaseCard,
  artistCard,
  hscroll,
  cover,
  coverOf,
  sheet,
  askText,
  confirmSheet,
  refreshLocalCovers,
} from './components.js';

// ---------- liked tracks cache (for the heart in menus and the player) ----------

// Liked tracks of each signed-in service, as keys "z:<id>" / "y:<id>".
const likedSets = new Map();
const PREFIX = { zvuk: 'z:', yandex: 'y:' };

async function likedOf(service, force) {
  if (!online.SERVICES[service].isLoggedIn()) return new Set();
  if (!likedSets.has(service) || force) {
    try {
      const ids = await online.likedTrackIds(service);
      likedSets.set(service, new Set(ids.map((id) => PREFIX[service] + id)));
    } catch (e) {
      logError('liked', e);
      if (!likedSets.has(service)) likedSets.set(service, new Set());
    }
  }
  return likedSets.get(service);
}

export async function likedIds(force = false) {
  const all = new Set();
  for (const s of online.connected()) for (const k of await likedOf(s, force)) all.add(k);
  return all;
}
export const canLike = (t) => !!online.serviceOf(t);
export function isLikedSync(t) {
  const s = online.serviceOf(t);
  const set = s && likedSets.get(s);
  return !!(set && set.has(online.likeKey(t)));
}
export async function toggleLike(t) {
  const s = online.serviceOf(t);
  if (!s) return false;
  const set = await likedOf(s);
  const key = online.likeKey(t);
  const liked = set.has(key);
  try {
    await online.setLiked(t, !liked);
    if (liked) set.delete(key);
    else set.add(key);
    toast(liked ? 'Убрано из «Мне нравится»' : 'Добавлено в «Мне нравится»');
    return !liked;
  } catch (e) {
    toast(e.message);
    return liked;
  }
}

// ---------- other platforms ----------

export function openExternal(url) {
  AppLauncher.openUrl({ url }).catch(() => window.open(url, '_blank'));
}

export function otherPlatformsSheet(t) {
  sheet(`Найти «${t.title}»`, [
    t.src === 'local'
      ? {
          icon: 'search',
          label: `В ${online.primaryId() === 'yandex' ? 'Яндекс Музыке' : 'Звуке'} (внутри приложения)`,
          onClick: () => searchInApp(`${t.artist || ''} ${t.title}`.trim()),
        }
      : null,
    ...PLATFORMS.map((p) => ({ icon: 'link', label: p.name, onClick: () => openExternal(platformUrl(p.id, t)) })),
  ]);
}

let searchHook = null;
export function setSearchHook(fn) {
  searchHook = fn;
}
export function searchInApp(q) {
  if (searchHook) searchHook(q);
}

// ---------- add to playlist ----------

export function addToPlaylistSheet(tracks) {
  const lists = pl.allPlaylists();
  const items = [
    {
      icon: 'add',
      label: 'Новый плейлист',
      onClick: async () => {
        const name = await askText('Новый плейлист', '', 'Создать');
        if (!name) return;
        pl.createPlaylist(name, tracks);
        toast(`Плейлист «${name}» создан`);
      },
    },
    ...lists.map((p) => ({
      icon: 'queue',
      label: `${p.name} (${p.tracks.length})`,
      onClick: () => {
        const n = pl.addTracks(p.id, tracks);
        toast(n ? `Добавлено в «${p.name}»` : 'Уже есть в плейлисте');
      },
    })),
  ];
  sheet(tracks.length > 1 ? `Добавить ${tracksWord(tracks.length)}` : 'Добавить в плейлист', items);
}

// ---------- track menu ----------

// ctx: { playlistId, index, onChange }
export function trackMenu(t, ctx = {}) {
  const items = [
    { icon: 'next', label: 'Играть следующим', onClick: () => (player.playNext(t), toast('Будет следующим')) },
    { icon: 'queue', label: 'Добавить в очередь', onClick: () => (player.addToQueue(t), toast('Добавлено в очередь')) },
    { icon: 'add', label: 'Добавить в плейлист', onClick: () => addToPlaylistSheet([t]) },
  ];
  if (canLike(t)) {
    const liked = isLikedSync(t);
    items.push({ icon: liked ? 'heart' : 'heartOutline', label: liked ? 'Убрать из «Мне нравится»' : 'Нравится', onClick: () => toggleLike(t) });
  }
  const artist = t.artists && t.artists.find((a) => a.id);
  if (artist) items.push({ icon: 'user', label: `Артист: ${artist.name}`, onClick: () => nav.push(artistPage(artist.id, artist.name)) });
  else if (t.src === 'local' && t.artist) items.push({ icon: 'search', label: 'Найти артиста онлайн', onClick: () => searchInApp(t.artist) });
  if (t.releaseId) items.push({ icon: 'library', label: `Альбом: ${t.album || 'открыть'}`, onClick: () => nav.push(releasePage(t.releaseId)) });
  items.push({ icon: 'link', label: 'Найти на других площадках', onClick: () => otherPlatformsSheet(t) });
  if (ctx.playlistId) {
    items.push({
      icon: 'close',
      label: 'Убрать из плейлиста',
      danger: true,
      onClick: () => {
        pl.removeTrackAt(ctx.playlistId, ctx.index);
        ctx.onChange && ctx.onChange();
      },
    });
  }
  if (t.src === 'local' && ctx.allowDelete) {
    items.push({
      icon: 'trash',
      label: 'Удалить файл из приложения',
      danger: true,
      onClick: async () => {
        if (await confirmSheet('Удалить файл?', 'Файл удалится из приложения. В плейлистах трек останется: приложение попробует найти его онлайн.')) {
          await removeLocal(t.lid);
          toast('Удалено');
        }
      },
    });
  }
  sheet(t.title, items);
}

// Renders an async page body: spinner → content or error with retry.
function asyncBody(el, loader) {
  const body = nav.pageBody(el);
  const run = async () => {
    clear(body).appendChild(spinner());
    try {
      const content = await loader();
      clear(body).appendChild(content);
    } catch (e) {
      logError('page', e);
      clear(body).appendChild(errorBox(e, run));
    }
  };
  run();
  return run;
}

function hero(imgSrc, title, sub, round = false, fallbackIcon = null) {
  return h(
    'div',
    { class: 'hero' },
    cover(imgSrc, 'cover cover-hero' + (round ? ' round' : '') + (fallbackIcon === 'heart' ? ' liked-cover' : ''), fallbackIcon || (round ? 'user' : 'note')),
    h('div', { class: 'hero-title' }, title),
    sub ? h('div', { class: 'hero-sub' }, sub) : null
  );
}

// ---------- artist ----------

export function artistPage(id, name = '') {
  const el = nav.page({ title: name || 'Артист', back: true });
  asyncBody(el, async () => {
    const [a] = await online.getArtists([id], { tracks: 12, releases: 30, related: 12 });
    if (!a) throw new Error('Артист не найден');
    const favBtn = h('button', { class: 'btn btn-ghost' });
    const paintFav = () => {
      clear(favBtn);
      const on = isFav(a.id);
      favBtn.append(icon(on ? 'check' : 'star', 20), on ? 'В ленте' : 'Добавить в ленту');
      favBtn.classList.toggle('active', on);
    };
    favBtn.onclick = () => {
      const on = !isFav(a.id);
      setFav(a, on);
      paintFav();
      toast(on ? 'Артист будет влиять на ленту' : 'Артист убран из ленты');
    };
    paintFav();
    const albums = a.releases.filter((r) => r.type !== 'single');
    const singles = a.releases.filter((r) => r.type === 'single');
    return h(
      'div',
      null,
      hero(a.image, a.name, null, true),
      h('div', { class: 'center-row' }, playButtons(async () => a.tracks)),
      h('div', { class: 'center-row' }, favBtn),
      a.tracks.length
        ? section('Популярные треки', null, trackList(a.tracks, { onPlay: (i) => player.playQueue(a.tracks, i), menu: (t) => trackMenu(t) }))
        : null,
      albums.length ? section('Альбомы', null, hscroll(albums.map((r) => releaseCard(r, () => nav.push(releasePage(r.id)))))) : null,
      singles.length ? section('Синглы и EP', null, hscroll(singles.map((r) => releaseCard(r, () => nav.push(releasePage(r.id)))))) : null,
      a.related.length ? section('Похожие', null, hscroll(a.related.map((r) => artistCard(r, () => nav.push(artistPage(r.id, r.name)))))) : null
    );
  });
  return el;
}

// ---------- release ----------

export function releasePage(id) {
  const el = nav.page({ title: 'Альбом', back: true });
  asyncBody(el, async () => {
    const r = await online.getRelease(id);
    if (!r) throw new Error('Альбом не найден');
    el.querySelector('.page-title').textContent = r.title;
    const year = r.date ? String(r.date).slice(0, 4) : '';
    const artistLinks = h(
      'div',
      { class: 'hero-sub' },
      r.artists.map((a, i) => [i ? ', ' : '', h('a', { class: 'link', onclick: () => nav.push(artistPage(a.id, a.name)) }, a.name)]),
      year ? `, ${year}` : ''
    );
    return h(
      'div',
      null,
      h('div', { class: 'hero' }, cover(r.cover, 'cover cover-hero'), h('div', { class: 'hero-title' }, r.title), artistLinks),
      h('div', { class: 'center-row' }, playButtons(async () => r.tracks)),
      h(
        'div',
        { class: 'center-row' },
        h('button', { class: 'btn btn-ghost', onclick: () => addToPlaylistSheet(r.tracks) }, icon('add', 20), 'В плейлист')
      ),
      trackList(r.tracks, { numbered: true, onPlay: (i) => player.playQueue(r.tracks, i), menu: (t) => trackMenu(t) })
    );
  });
  return el;
}

// ---------- a playlist that lives in Zvuk or Yandex Music ----------

const IN = { zvuk: 'в Звуке', yandex: 'в Яндекс Музыке' };
const serviceOfId = (id) => (String(id).startsWith('y:') ? 'yandex' : 'zvuk');

export function servicePlaylistPage(p) {
  const el = nav.page({ title: p.title, back: true });
  asyncBody(el, async () => {
    const data = await online.playlistTracks(p.id);
    const tracks = data.tracks;
    return h(
      'div',
      null,
      hero(data.cover || p.cover, data.title || p.title, `${tracksWord(tracks.length)} ${IN[serviceOfId(p.id)]}`),
      h('div', { class: 'center-row' }, playButtons(async () => tracks)),
      h(
        'div',
        { class: 'center-row' },
        h(
          'button',
          {
            class: 'btn btn-ghost',
            onclick: () => {
              const copy = pl.createPlaylist(data.title || p.title, tracks, serviceOfId(p.id));
              toast(`Копия «${copy.name}» в твоих плейлистах. Туда можно добавлять MP3.`);
            },
          },
          icon('add', 20),
          'Копия в мои плейлисты'
        )
      ),
      tracks.length
        ? trackList(tracks, { onPlay: (i) => player.playQueue(tracks, i), menu: (t) => trackMenu(t) })
        : emptyState('note', 'Плейлист пустой')
    );
  });
  return el;
}

// ---------- liked tracks ----------

export function likedPage(service = online.primaryId()) {
  const el = nav.page({ title: 'Мне нравится', back: true });
  asyncBody(el, async () => {
    const ids = [...(await likedOf(service, true))].map((k) => k.slice(2));
    const tracks = await online.getTracks(ids, service);
    if (!tracks.length) return emptyState('heartOutline', 'Пока пусто', `Ставь лайки трекам ${IN[service]} или здесь — они появятся в этом списке.`);
    return h(
      'div',
      null,
      hero('', 'Мне нравится', `${tracksWord(tracks.length)} ${IN[service]}`, false, 'heart'),
      h('div', { class: 'center-row' }, playButtons(async () => tracks)),
      trackList(tracks, { onPlay: (i) => player.playQueue(tracks, i), menu: (t) => trackMenu(t) })
    );
  });
  return el;
}

// ---------- playlist kept in the app (own or imported) ----------

const isMissing = (t) => t.src === 'ext' && t.match === 'none';
const isPending = (t) => t.src === 'ext' && !t.match;

function playable(tracks) {
  return tracks.filter((t) => !isMissing(t));
}

export function customPlaylistPage(id) {
  const p0 = pl.getPlaylist(id);
  const el = nav.page({ title: p0 ? p0.name : 'Плейлист', back: true });
  const body = nav.pageBody(el);
  let onlyMissing = false;

  const render = () => {
    const p = pl.getPlaylist(id);
    const scroll = el.scrollTop;
    clear(body);
    if (!p) {
      body.appendChild(emptyState('queue', 'Плейлист удалён'));
      return;
    }
    const src = sourceById(p.source || 'mine');
    el.querySelector('.page-title').textContent = p.name;
    const missing = p.tracks.filter(isMissing).length;
    const pending = p.tracks.filter(isPending).length;
    const mp3 = p.tracks.filter((t) => t.src === 'local' || t.match === 'local').length;
    const parts = [tracksWord(p.tracks.length)];
    if (mp3) parts.push(`${mp3} из MP3`);
    if (missing) parts.push(`нет у тебя ${missing}`);
    const prog = matchProgress(id);

    const menu = () =>
      sheet(p.name, [
        {
          icon: 'edit',
          label: 'Переименовать',
          onClick: async () => {
            const name = await askText('Новое название', p.name);
            if (name) pl.renamePlaylist(id, name);
          },
        },
        p.source && p.source !== 'mine'
          ? {
              icon: 'refresh',
              label: 'Поискать недостающие ещё раз',
              onClick: () => {
                for (const t of p.tracks) if (isMissing(t)) pl.rememberMatch(t.key, { match: undefined });
                queueMatch(id);
                toast('Ищу заново');
              },
            }
          : null,
        {
          icon: 'trash',
          label: 'Удалить плейлист',
          danger: true,
          onClick: async () => {
            if (await confirmSheet('Удалить плейлист?', `«${p.name}» удалится. Файлы MP3 останутся.`)) {
              pl.deletePlaylist(id);
              nav.back();
            }
          },
        },
      ]);

    const shown = onlyMissing ? p.tracks.filter(isMissing) : p.tracks;
    add(body, 
      hero(coverOf(p.tracks.find((t) => coverOf(t))), p.name, parts.join(', ')),
      p.source && p.source !== 'mine' ? h('div', { class: 'source-tag', style: { '--src': src.color } }, src.name) : null,
      prog
        ? h(
            'div',
            { class: 'match-progress' },
            h('div', { class: 'match-text' }, `Ищу, откуда играть: ${prog.done} из ${prog.total}`),
            h('div', { class: 'match-bar' }, h('i', { style: { width: Math.round((prog.done / Math.max(1, prog.total)) * 100) + '%' } }))
          )
        : null,
      h('div', { class: 'center-row' }, playButtons(async () => playable(pl.getPlaylist(id).tracks))),
      h(
        'div',
        { class: 'center-row' },
        (p.source || 'mine') === 'mine' ? h('button', { class: 'btn btn-ghost', onclick: () => searchInApp('') }, icon('add', 20), 'Добавить треки') : null,
        missing
          ? h(
              'button',
              {
                class: 'btn btn-ghost' + (onlyMissing ? ' active' : ''),
                onclick: () => {
                  onlyMissing = !onlyMissing;
                  render();
                },
              },
              onlyMissing ? 'Показать все' : `Чего нет: ${missing}`
            )
          : null,
        h('button', { class: 'icon-btn', 'aria-label': 'Действия', onclick: menu }, icon('more', 22))
      ),
      onlyMissing ? h('div', { class: 'muted small pad center' }, 'Этих треков нет в твоих MP3 и онлайн. Добавь файлы — и они заиграют.') : null,
      shown.length
        ? trackList(shown, {
            onPlay: (i) => {
              const all = playable(pl.getPlaylist(id).tracks);
              const at = all.findIndex((t) => t.key === shown[i].key);
              if (at >= 0) player.playQueue(all, at);
              else toast('Этого трека пока нет ни в MP3, ни онлайн');
            },
            menu: (t) => trackMenu(t, { playlistId: id, index: pl.getPlaylist(id).tracks.findIndex((x) => x.key === t.key) }),
          })
        : emptyState('queue', 'Плейлист пустой', (p.source || 'mine') === 'mine' ? 'Добавляй треки и свои MP3 через меню «⋮» у любого трека.' : '')
    );
    el.scrollTop = scroll;
    if (pending && !prog) queueMatch(id);
  };

  // matching updates the playlist many times a second; redraw calmly
  let pendingRender = 0;
  const soon = () => {
    if (pendingRender) return;
    pendingRender = setTimeout(() => {
      pendingRender = 0;
      render();
    }, 700);
  };
  render();
  el._cleanup.push(
    pl.onPlaylistsChange(soon),
    onMatchProgress((pid) => pid === id && soon()),
    onLocalChange(async () => (await refreshLocalCovers(), soon()))
  );
  return el;
}

// ---------- folders: one per service ----------

function playlistRow(p, onClick) {
  const missing = p.tracks.filter(isMissing).length;
  const prog = matchProgress(p.id);
  const sub = prog ? `ищу треки: ${prog.done} из ${prog.total}` : tracksWord(p.tracks.length) + (missing ? `, нет у тебя ${missing}` : '');
  return h(
    'div',
    { class: 'list-row', role: 'button', onclick: onClick },
    cover(coverOf(p.tracks.find((t) => coverOf(t))), 'cover cover-sm', 'queue'),
    h('div', { class: 'track-text' }, h('div', { class: 'track-title' }, p.name), h('div', { class: 'track-sub' }, sub))
  );
}

const SIGN_IN = {
  zvuk: { how: 'через Сбер ID или номер телефона', button: 'Войти в Звук' },
  yandex: { how: 'через Яндекс ID', button: 'Войти через Яндекс ID' },
};

function signInCard(service, text) {
  const busy = accounts.isBusy(service);
  return emptyState(
    'library',
    `Плейлисты ${service === 'yandex' ? 'Яндекс Музыки' : 'Звука'} появятся сами`,
    text || `Войди ${SIGN_IN[service].how} прямо в приложении — плейлисты и «Мне нравится» подтянутся сюда, а треки будут играть отсюда.`,
    h('button', { class: 'btn btn-primary', disabled: busy, onclick: () => accounts.connect(service) }, busy ? 'Вход…' : SIGN_IN[service].button)
  );
}

export function folderPage(sourceId) {
  const src = sourceById(sourceId);
  const isService = sourceId in online.SERVICES;
  const addBtn =
    sourceId === 'zvuk'
      ? null
      : h(
          'button',
          {
            class: 'icon-btn',
            'aria-label': sourceId === 'mine' ? 'Создать' : 'Перенести',
            onclick: async () => {
              if (sourceId === 'mine') {
                const name = await askText('Новый плейлист', '', 'Создать');
                if (name) nav.push(customPlaylistPage(pl.createPlaylist(name).id));
              } else nav.push(importPage(sourceId));
            },
          },
          icon('add', 26)
        );
  const el = nav.page({ title: src.name, back: true, actions: addBtn ? [addBtn] : [] });
  const body = nav.pageBody(el);
  let live = null; // playlists that live in the service
  let liveErr = null;

  const importedList = (lists) => h('div', { class: 'list' }, lists.map((p) => playlistRow(p, () => nav.push(customPlaylistPage(p.id)))));

  const render = () => {
    clear(body);
    const lists = pl.playlistsFrom(sourceId);
    if (isService) {
      if (!accounts.loggedIn(sourceId)) {
        add(body, signInCard(sourceId));
        if (lists.length) add(body, section('Перенесённые', null, importedList(lists)));
        return;
      }
      add(
        body,
        h(
          'div',
          { class: 'list-row', role: 'button', onclick: () => nav.push(likedPage(sourceId)) },
          h('div', { class: 'cover cover-sm cover-box liked-cover' }, icon('heart', 22)),
          h('div', { class: 'track-text' }, h('div', { class: 'track-title' }, 'Мне нравится'), h('div', { class: 'track-sub' }, `лайки ${IN[sourceId]}`))
        )
      );
      if (liveErr) add(body, errorBox(liveErr, () => loadLive(true)));
      else if (!live) add(body, spinner());
      else
        add(
          body,
          h(
            'div',
            { class: 'list' },
            live.map((p) =>
              h(
                'div',
                { class: 'list-row', role: 'button', onclick: () => nav.push(servicePlaylistPage(p)) },
                cover(p.cover, 'cover cover-sm', 'queue'),
                h('div', { class: 'track-text' }, h('div', { class: 'track-title' }, p.title), h('div', { class: 'track-sub' }, tracksWord(p.trackCount ?? p.trackIds.length)))
              )
            )
          )
        );
      if (lists.length) add(body, section('Перенесённые и копии', null, importedList(lists)));
      return;
    }
    if (!lists.length) {
      add(
        body,
        sourceId === 'mine'
          ? emptyState('queue', 'Своих плейлистов пока нет', 'Собирай в них треки из любых источников и свои MP3.', addBtn && h('button', { class: 'btn btn-primary', onclick: () => addBtn.click() }, icon('add', 20), 'Создать'))
          : emptyState('library', `Из «${src.name}» пока ничего`, 'Перенеси плейлист — треки будут играть из твоих MP3, а чего нет — онлайн.', h('button', { class: 'btn btn-primary', onclick: () => nav.push(importPage(sourceId)) }, icon('add', 20), 'Перенести плейлист'))
      );
      return;
    }
    add(body, importedList(lists));
  };

  const loadLive = async (force) => {
    if (!isService || !accounts.loggedIn(sourceId)) return;
    if (live && !force) return;
    liveErr = null;
    try {
      live = await online.userPlaylists(sourceId);
    } catch (e) {
      liveErr = e;
    }
    render();
  };

  render();
  loadLive(false);
  let t = 0;
  const soon = () => {
    if (!t) t = setTimeout(() => ((t = 0), render()), 700);
  };
  el._cleanup.push(
    pl.onPlaylistsChange(soon),
    onMatchProgress(soon),
    accounts.onAccountsChange((svc) => {
      if (svc !== sourceId) return;
      live = null;
      render();
      loadLive(true);
    })
  );
  return el;
}

// ---------- bringing a playlist in ----------

const HOWTO = {
  yandex: [
    'Открой плейлист в Яндекс Музыке → «Поделиться» → «Скопировать ссылку».',
    'Плейлист должен быть открытым. «Мне нравится» обычно закрыт — его проще перенести списком или файлом.',
  ],
  spotify: ['Открой плейлист → «Поделиться» → «Скопировать ссылку на плейлист».', 'Если Spotify не откроется, выгрузи плейлист в файл через любой сервис переноса и загрузи файл ниже.'],
  vk: [
    'VK не отдаёт плейлисты по ссылке, поэтому переносим списком.',
    'На компьютере открой плейлист на vk.com, выдели все треки мышкой, скопируй и вставь сюда. Подойдёт и файл CSV/TXT из сервиса переноса.',
  ],
  other: ['Вставь список треков: по одному на строку, «Исполнитель — Название».', 'Или загрузи файл CSV/TXT — например, выгрузку из сервиса переноса плейлистов.'],
};

export function importPage(preselect = 'yandex') {
  const choices = SOURCES.filter((s) => ['yandex', 'vk', 'spotify', 'other'].includes(s.id));
  let current = choices.some((c) => c.id === preselect) ? preselect : 'yandex';
  const el = nav.page({ title: 'Перенести плейлист', back: true });
  const body = nav.pageBody(el);
  const fileInput = h('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', hidden: true });

  const finish = (groups, source) => {
    const made = groups.map((g) => pl.createPlaylist(g.name, g.tracks, source));
    made.forEach((p) => queueMatch(p.id));
    const total = groups.reduce((n, g) => n + g.tracks.length, 0);
    toast(made.length > 1 ? `Перенесено плейлистов: ${made.length}, треков: ${total}` : `Перенесено: ${tracksWord(total)}`);
    nav.back();
    nav.push(made.length === 1 ? customPlaylistPage(made[0].id) : folderPage(source));
  };

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const groups = parseExportFile(text, f.name);
      if (!groups.length) return toast('В файле не нашлось треков', 4000);
      finish(groups, current);
    } catch (e) {
      toast('Не получилось прочитать файл: ' + e.message, 5000);
    }
  });

  const render = () => {
    clear(body);
    const src = sourceById(current);
    const byLink = current === 'yandex' || current === 'spotify';
    const linkInput = h('input', { class: 'input', type: 'url', placeholder: 'Ссылка на плейлист', autocapitalize: 'off', autocomplete: 'off' });
    const textArea = h('textarea', { class: 'input textarea', placeholder: 'Кино — Группа крови\nБаста — Сансара\n…', rows: '8' });
    const status = h('div', { class: 'import-status', hidden: true });
    const go = h('button', { class: 'btn btn-primary' }, 'Перенести');
    go.onclick = async () => {
      const link = byLink ? linkInput.value.trim() : '';
      const text = textArea.value.trim();
      if (!link && !text) return toast(byLink ? 'Вставь ссылку или список' : 'Вставь список треков');
      go.disabled = true;
      status.hidden = false;
      status.textContent = 'Переношу…';
      try {
        if (link || detectLink(text)) {
          const r = await importFromLink(link || text);
          finish([{ name: r.name, tracks: r.tracks }], r.service || current);
        } else {
          const tracks = parseTextList(text);
          if (!tracks.length) throw new ImportError('Не нашёл в тексте ни одного трека');
          const name = (await askText('Как назвать плейлист?', src.short + ' — плейлист', 'Готово')) || src.short + ' — плейлист';
          finish([{ name, tracks }], current);
        }
      } catch (e) {
        status.textContent = e.message || String(e);
        status.classList.add('error');
      } finally {
        go.disabled = false;
      }
    };

    add(body, 
      h(
        'div',
        { class: 'chips choice' },
        choices.map((c) =>
          h(
            'button',
            {
              class: 'chip' + (c.id === current ? ' chip-on' : ''),
              'aria-pressed': c.id === current ? 'true' : 'false',
              style: { '--src': c.color },
              onclick: () => {
                current = c.id;
                render();
              },
            },
            h('span', { class: 'src-dot' }),
            c.name
          )
        )
      ),
      h('ol', { class: 'howto' }, HOWTO[current].map((line) => h('li', null, line))),
      byLink ? linkInput : null,
      byLink ? h('div', { class: 'muted small or' }, 'или списком') : null,
      textArea,
      h('div', { class: 'row-start' }, go, h('button', { class: 'btn btn-ghost', onclick: () => fileInput.click() }, icon('folder', 20), 'Файл CSV/TXT')),
      status,
      fileInput
    );
  };
  render();
  return el;
}

// ---------- MP3 library ----------

export function localPage() {
  const input = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav', multiple: true, hidden: true });
  const progress = h('div', { class: 'import-progress', hidden: true });
  const el = nav.page(
    {
      title: 'Мои MP3',
      back: true,
      actions: [h('button', { class: 'icon-btn', 'aria-label': 'Добавить', onclick: () => input.click() }, icon('add', 26))],
    },
    input,
    progress,
    h('div', { class: 'local-list' })
  );
  const list = el.querySelector('.local-list');

  input.addEventListener('change', async () => {
    const files = input.files;
    if (!files || !files.length) return;
    progress.hidden = false;
    try {
      const res = await importFiles(files, (i, n, name) => {
        progress.textContent = i < n ? `Добавляю ${i + 1} из ${n}: ${name}` : 'Готово';
      });
      await refreshLocalCovers();
      toast(`Добавлено: ${res.added}` + (res.skipped ? `, пропущено: ${res.skipped}` : ''));
    } catch (e) {
      logError('import', e);
      toast('Не получилось добавить: ' + e.message);
    } finally {
      progress.hidden = true;
      input.value = '';
    }
  });

  const render = async () => {
    const tracks = await localTracks();
    clear(list);
    if (!tracks.length) {
      list.append(
        emptyState(
          'folder',
          'Здесь будут твои MP3',
          'Выбери файлы на телефоне — приложение сохранит их у себя, прочитает название, артиста и обложку.',
          h('button', { class: 'btn btn-primary', onclick: () => input.click() }, icon('add', 20), 'Добавить MP3')
        )
      );
      return;
    }
    list.append(
      h('div', { class: 'list-meta' }, tracksWord(tracks.length)),
      h('div', { class: 'center-row' }, playButtons(async () => localTracks())),
      h(
        'div',
        { class: 'center-row' },
        h('button', { class: 'btn btn-ghost', onclick: () => input.click() }, icon('add', 20), 'Добавить ещё'),
        h('button', { class: 'btn btn-ghost', onclick: () => addToPlaylistSheet(tracks) }, icon('queue', 20), 'Все в плейлист')
      ),
      trackList(tracks, { onPlay: (i) => player.playQueue(tracks, i), menu: (t) => trackMenu(t, { allowDelete: true }) })
    );
  };
  render();
  el._cleanup.push(onLocalChange(render));
  return el;
}

// ---------- full list of the feed mix ----------

export function mixPage(feed) {
  const tracks = feed.mix || [];
  return nav.page(
    { title: 'Микс для тебя', back: true },
    h('div', { class: 'center-row' }, playButtons(async () => tracks)),
    trackList(tracks, { onPlay: (i) => player.playQueue(tracks, i), menu: (t) => trackMenu(t) })
  );
}
