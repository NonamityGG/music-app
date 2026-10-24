// Detail pages (artist, album, playlists, MP3 library) and the track menu.

import { h, icon, clear, tracksWord, toast } from './util.js';
import * as nav from './nav.js';
import * as player from './player.js';
import * as zvuk from './zvuk.js';
import * as pl from './playlists.js';
import { localTracks, importFiles, removeLocal, onLocalChange } from './local.js';
import { setFav, isFav } from './feed.js';
import { logError } from './settings.js';
import { AppLauncher } from '@capacitor/app-launcher';
import { PLATFORMS, platformUrl } from './platforms.js';
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

let likedSet = null;
export async function likedIds(force = false) {
  if (!zvuk.isLoggedIn()) return new Set();
  if (!likedSet || force) {
    try {
      likedSet = new Set(await zvuk.likedTrackIds());
    } catch (e) {
      logError('liked', e);
      likedSet = likedSet || new Set();
    }
  }
  return likedSet;
}
export function isLikedSync(t) {
  return !!(likedSet && t && t.zid && likedSet.has(t.zid));
}
export async function toggleLike(t) {
  const set = await likedIds();
  const liked = set.has(t.zid);
  try {
    await zvuk.setLiked(t.zid, !liked);
    if (liked) set.delete(t.zid);
    else set.add(t.zid);
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
          label: 'В Звуке (внутри приложения)',
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
  if (t.src === 'zvuk' && zvuk.isLoggedIn()) {
    const liked = isLikedSync(t);
    items.push({ icon: liked ? 'heart' : 'heartOutline', label: liked ? 'Убрать из «Мне нравится»' : 'Нравится', onClick: () => toggleLike(t) });
  }
  const artist = t.artists && t.artists.find((a) => a.id);
  if (artist) items.push({ icon: 'user', label: `Артист: ${artist.name}`, onClick: () => nav.push(artistPage(artist.id, artist.name)) });
  else if (t.src === 'local' && t.artist) items.push({ icon: 'search', label: `Найти артиста в Звуке`, onClick: () => searchInApp(t.artist) });
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
        if (await confirmSheet('Удалить файл?', 'Файл удалится из приложения. В плейлистах трек останется: приложение попробует найти его в Звуке.')) {
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
    const [a] = await zvuk.getArtists([id], { tracks: 12, releases: 30, related: 12 });
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
    const r = await zvuk.getRelease(id);
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

// ---------- Zvuk playlist ----------

export function zvukPlaylistPage(p) {
  const el = nav.page({ title: p.title, back: true });
  asyncBody(el, async () => {
    const data = await zvuk.playlistTracks(p.id);
    const tracks = data.tracks;
    return h(
      'div',
      null,
      hero(data.cover || p.cover, data.title || p.title, `${tracksWord(tracks.length)} в Звуке`),
      h('div', { class: 'center-row' }, playButtons(async () => tracks)),
      h(
        'div',
        { class: 'center-row' },
        h(
          'button',
          {
            class: 'btn btn-ghost',
            onclick: () => {
              const copy = pl.createPlaylist(data.title || p.title, tracks);
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

export function likedPage() {
  const el = nav.page({ title: 'Мне нравится', back: true });
  asyncBody(el, async () => {
    const ids = [...(await likedIds(true))];
    const tracks = await zvuk.getTracks(ids);
    if (!tracks.length) return emptyState('heartOutline', 'Пока пусто', 'Ставь лайки трекам в Звуке или здесь — они появятся в этом списке.');
    return h(
      'div',
      null,
      hero('', 'Мне нравится', `${tracksWord(tracks.length)} в Звуке`, false, 'heart'),
      h('div', { class: 'center-row' }, playButtons(async () => tracks)),
      trackList(tracks, { onPlay: (i) => player.playQueue(tracks, i), menu: (t) => trackMenu(t) })
    );
  });
  return el;
}

// ---------- own playlist ----------

export function customPlaylistPage(id) {
  const p0 = pl.getPlaylist(id);
  const el = nav.page({ title: p0 ? p0.name : 'Плейлист', back: true });
  const body = nav.pageBody(el);
  const render = () => {
    const p = pl.getPlaylist(id);
    clear(body);
    if (!p) {
      body.appendChild(emptyState('queue', 'Плейлист удалён'));
      return;
    }
    el.querySelector('.page-title').textContent = p.name;
    const local = p.tracks.filter((t) => t.src === 'local').length;
    const sub = tracksWord(p.tracks.length) + (local ? `, из них ${local} MP3` : '');
    body.append(
      hero(coverOf(p.tracks.find((t) => coverOf(t))), p.name, sub),
      h('div', { class: 'center-row' }, playButtons(async () => pl.getPlaylist(id).tracks)),
      h(
        'div',
        { class: 'center-row' },
        h('button', { class: 'btn btn-ghost', onclick: () => searchInApp('') }, icon('add', 20), 'Добавить треки'),
        h(
          'button',
          {
            class: 'icon-btn',
            'aria-label': 'Действия',
            onclick: () =>
              sheet(p.name, [
                {
                  icon: 'edit',
                  label: 'Переименовать',
                  onClick: async () => {
                    const name = await askText('Новое название', p.name);
                    if (name) pl.renamePlaylist(id, name);
                  },
                },
                {
                  icon: 'trash',
                  label: 'Удалить плейлист',
                  danger: true,
                  onClick: async () => {
                    if (await confirmSheet('Удалить плейлист?', `«${p.name}» удалится. Треки и файлы останутся.`)) {
                      pl.deletePlaylist(id);
                      nav.back();
                    }
                  },
                },
              ]),
          },
          icon('more', 22)
        )
      ),
      p.tracks.length
        ? trackList(p.tracks, {
            onPlay: (i) => player.playQueue(pl.getPlaylist(id).tracks, i),
            menu: (t, i) => trackMenu(t, { playlistId: id, index: i }),
          })
        : emptyState('queue', 'Плейлист пустой', 'Добавляй треки из Звука и свои MP3 через меню «⋮» у любого трека.')
    );
  };
  render();
  el._cleanup.push(pl.onPlaylistsChange(render), onLocalChange(async () => (await refreshLocalCovers(), render())));
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
