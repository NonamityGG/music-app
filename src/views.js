// Root screens of the four tabs: Лента, Поиск, Медиатека, Профиль.

import { h, icon, clear, debounce, tracksWord, toast } from './util.js';
import * as nav from './nav.js';
import * as player from './player.js';
import * as zvuk from './zvuk.js';
import * as pl from './playlists.js';
import { localTracks, searchLocal, onLocalChange } from './local.js';
import { buildFeed, cachedFeed, feedIsStale, favArtists, setFav } from './feed.js';
import { settings, saveSettings, getJournal, clearJournal, load, save, logError } from './settings.js';
import { storageEstimate } from './db.js';
import { wavesPicker } from './wave-settings.js';
import { PLATFORMS } from './platforms.js';
import {
  trackList,
  section,
  spinner,
  errorBox,
  emptyState,
  releaseCard,
  artistCard,
  hscroll,
  cover,
  coverOf,
  askText,
  confirmSheet,
} from './components.js';
import {
  trackMenu,
  artistPage,
  releasePage,
  zvukPlaylistPage,
  likedPage,
  customPlaylistPage,
  localPage,
  mixPage,
  openExternal,
  likedIds,
} from './pages.js';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// ===================== Лента =====================

export function feedView() {
  let building = false;
  const refreshBtn = h('button', { class: 'icon-btn', 'aria-label': 'Обновить ленту' }, icon('refresh', 24));
  const el = nav.page({ title: 'Лента', actions: [refreshBtn] });
  const body = nav.pageBody(el);

  const render = (feed) => {
    clear(body);
    if (!feed || feed.empty) {
      body.append(
        emptyState(
          'feed',
          'Лента строится по твоим артистам',
          'Войди в Звук, добавь свои MP3 или выбери любимых артистов — и здесь появятся новинки, похожие артисты и микс.',
          h('button', { class: 'btn btn-primary', onclick: () => nav.switchTab('search') }, icon('star', 20), 'Выбрать артистов'),
          zvuk.isLoggedIn() ? null : h('button', { class: 'btn btn-ghost', onclick: () => nav.switchTab('profile') }, 'Войти в Звук')
        )
      );
      return;
    }
    const mix = feed.mix || [];
    if (mix.length) {
      body.append(
        h(
          'div',
          { class: 'mix-card' },
          h('div', { class: 'mix-label' }, 'Микс для тебя'),
          h('div', { class: 'mix-sub' }, `${tracksWord(mix.length)} от похожих артистов и твоих любимых`),
          h(
            'div',
            { class: 'mix-buttons' },
            h('button', { class: 'btn btn-white', onclick: () => player.playQueue(mix, 0) }, icon('play', 20), 'Слушать'),
            h('button', { class: 'btn btn-glass', onclick: () => player.playQueue(mix, 0, { shuffle: true, randomStart: true }) }, icon('shuffle', 20), 'Вперемешку')
          )
        ),
        trackList(mix.slice(0, 5), { onPlay: (i) => player.playQueue(mix, i), menu: (t) => trackMenu(t) }),
        h('button', { class: 'btn btn-text', onclick: () => nav.push(mixPage(feed)) }, 'Весь микс')
      );
    }
    if (feed.releases && feed.releases.length) {
      body.append(section('Новинки твоих артистов', null, hscroll(feed.releases.map((r) => releaseCard(r, () => nav.push(releasePage(r.id)))))));
    }
    if (feed.related && feed.related.length) {
      body.append(section('Похожие артисты', null, hscroll(feed.related.map((a) => artistCard(a, () => nav.push(artistPage(a.id, a.name)))))));
    }
    if (feed.seeds && feed.seeds.length) {
      body.append(
        section(
          'Лента учитывает',
          h('button', { class: 'btn btn-text small', onclick: () => nav.switchTab('search') }, '+ артист'),
          h(
            'div',
            { class: 'chips' },
            feed.seeds.map((a) => h('button', { class: 'chip', onclick: () => nav.push(artistPage(a.id, a.name)) }, a.name))
          )
        )
      );
    }
    const at = new Date(feed.at);
    body.append(h('div', { class: 'list-meta center' }, `Обновлено ${at.toLocaleDateString('ru-RU')} в ${at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`));
  };

  const rebuild = async () => {
    if (building) return;
    building = true;
    refreshBtn.classList.add('spinning');
    const status = spinner('Собираю ленту…');
    const old = cachedFeed();
    if (!old || old.empty) clear(body).appendChild(status);
    else body.prepend(status);
    try {
      const feed = await buildFeed((step) => {
        const t = status.querySelector('.loading-text');
        if (t) t.textContent = step + '…';
      });
      render(feed);
    } catch (e) {
      logError('feed', e);
      status.remove();
      if (!old || old.empty) {
        clear(body).appendChild(errorBox(e, rebuild));
      } else {
        toast(e.message);
      }
    } finally {
      building = false;
      refreshBtn.classList.remove('spinning');
    }
  };

  refreshBtn.onclick = rebuild;
  const cached = cachedFeed();
  if (cached && !cached.empty) render(cached);
  el._onShow = () => {
    const f = cachedFeed();
    if (feedIsStale(f)) rebuild();
  };
  return el;
}

// ===================== Поиск =====================

export function searchView() {
  const input = h('input', { class: 'search-input', type: 'search', placeholder: 'Треки, артисты, альбомы', enterkeyhint: 'search' });
  const clearBtn = h('button', { class: 'icon-btn search-clear', 'aria-label': 'Очистить', hidden: true }, icon('close', 20));
  const results = h('div', { class: 'search-results' });
  const el = nav.page(
    { title: 'Поиск' },
    h('div', { class: 'search-bar' }, icon('search', 22, 'search-icon'), input, clearBtn),
    results
  );
  let seq = 0;

  const recent = () => load('recentSearches', []);
  const remember = (q) => save('recentSearches', [q, ...recent().filter((x) => x !== q)].slice(0, 10));

  const showIdle = () => {
    clear(results);
    const fav = favArtists();
    const rec = recent();
    if (rec.length) {
      results.append(
        section(
          'Недавние',
          h('button', { class: 'btn btn-text small', onclick: () => (save('recentSearches', []), showIdle()) }, 'Очистить'),
          h('div', { class: 'chips' }, rec.map((q) => h('button', { class: 'chip', onclick: () => run(q) }, q)))
        )
      );
    }
    results.append(
      section(
        'Любимые артисты для ленты',
        null,
        fav.length
          ? hscroll(fav.map((a) => artistCard(a, () => nav.push(artistPage(a.id, a.name)))))
          : h('div', { class: 'muted pad' }, 'Найди артиста и нажми «Добавить в ленту» на его странице — лента начнёт подбирать музыку под него.')
      )
    );
  };

  const run = async (q) => {
    input.value = q;
    clearBtn.hidden = !q;
    q = q.trim();
    const my = ++seq;
    if (!q) return showIdle();
    clear(results).appendChild(spinner());
    const [localRes, zRes] = await Promise.allSettled([searchLocal(q), zvuk.quickSearch(q, 30)]);
    if (my !== seq) return;
    clear(results);
    const local = localRes.status === 'fulfilled' ? localRes.value : [];
    if (local.length) {
      results.append(section('В твоих MP3', null, trackList(local.slice(0, 10), { onPlay: (i) => player.playQueue(local, i), menu: (t) => trackMenu(t, { allowDelete: true }) })));
    }
    if (zRes.status === 'rejected') {
      results.append(errorBox(zRes.reason, () => run(input.value)));
      if (zRes.reason && (zRes.reason.kind === 'bot' || zRes.reason.kind === 'rate')) {
        const qq = encodeURIComponent(q);
        results.append(
          section(
            'Поискать там',
            null,
            h(
              'div',
              { class: 'chips' },
              PLATFORMS.map((p) => h('button', { class: 'chip', onclick: () => openExternal(p.url(qq)) }, p.name))
            )
          )
        );
      }
      return;
    }
    const r = zRes.value;
    if (r.artists.length) {
      results.append(section('Артисты', null, hscroll(r.artists.map((a) => artistCard(a, () => nav.push(artistPage(a.id, a.name)))))));
    }
    if (r.tracks.length) {
      results.append(section('Треки в Звуке', null, trackList(r.tracks, { onPlay: (i) => player.playQueue(r.tracks, i), menu: (t) => trackMenu(t) })));
    }
    if (r.releases.length) {
      results.append(section('Альбомы', null, hscroll(r.releases.map((x) => releaseCard(x, () => nav.push(releasePage(x.id)))))));
    }
    if (!local.length && !r.tracks.length && !r.artists.length && !r.releases.length) {
      results.append(
        emptyState(
          'search',
          'Ничего не нашлось',
          'Попробуй по-другому написать название — или поищи на других площадках.',
          h(
            'button',
            { class: 'btn btn-ghost', onclick: () => openExternal(`https://vk.com/audio?q=${encodeURIComponent(q)}`) },
            'Искать в VK Музыке'
          )
        )
      );
    } else {
      remember(q);
    }
  };

  const debounced = debounce((q) => run(q), 450);
  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    debounced(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
      run(input.value);
    }
  });
  clearBtn.onclick = () => {
    run('');
    input.focus();
  };
  el._search = (q) => {
    run(q);
    if (!q) setTimeout(() => input.focus(), 150);
  };
  el._onShow = () => {
    if (!input.value) showIdle();
  };
  showIdle();
  return el;
}

// ===================== Медиатека =====================

export function libraryView() {
  const el = nav.page({ title: 'Медиатека' });
  const body = nav.pageBody(el);
  let zvukLists = null;
  let zvukErr = null;
  let loadingZvuk = false;

  const loadZvuk = async (force) => {
    if (!zvuk.isLoggedIn() || loadingZvuk) return;
    if (zvukLists && !force) return;
    loadingZvuk = true;
    zvukErr = null;
    try {
      zvukLists = await zvuk.userPlaylists();
    } catch (e) {
      zvukErr = e;
      logError('library', e);
    }
    loadingZvuk = false;
    render();
  };

  const tile = (iconName, title, sub, onClick, cls = '') =>
    h('button', { class: 'tile ' + cls, onclick: onClick }, h('div', { class: 'tile-icon' }, icon(iconName, 26)), h('div', { class: 'tile-title' }, title), h('div', { class: 'tile-sub' }, sub));

  const playlistRow = (img, title, sub, onClick) =>
    h('div', { class: 'list-row', role: 'button', onclick: onClick }, cover(img, 'cover cover-sm', 'queue'), h('div', { class: 'track-text' }, h('div', { class: 'track-title' }, title), h('div', { class: 'track-sub' }, sub)));

  const render = async () => {
    const localCount = (await localTracks()).length;
    clear(body);
    body.append(
      h(
        'div',
        { class: 'tiles' },
        tile('heart', 'Мне нравится', zvuk.isLoggedIn() ? 'Звук' : 'нужен вход в Звук', () => (zvuk.isLoggedIn() ? nav.push(likedPage()) : nav.switchTab('profile')), 'tile-liked'),
        tile('folder', 'Мои MP3', localCount ? tracksWord(localCount) : 'добавить файлы', () => nav.push(localPage()), 'tile-local')
      )
    );

    const mine = pl.allPlaylists();
    body.append(
      section(
        'Мои плейлисты',
        h(
          'button',
          {
            class: 'btn btn-text small',
            onclick: async () => {
              const name = await askText('Новый плейлист', '', 'Создать');
              if (name) {
                const p = pl.createPlaylist(name);
                nav.push(customPlaylistPage(p.id));
              }
            },
          },
          '+ Создать'
        ),
        mine.length
          ? h(
              'div',
              { class: 'list' },
              mine.map((p) => {
                const local = p.tracks.filter((t) => t.src === 'local').length;
                return playlistRow(coverOf(p.tracks.find((t) => coverOf(t))), p.name, tracksWord(p.tracks.length) + (local ? `, из них ${local} MP3` : ''), () =>
                  nav.push(customPlaylistPage(p.id))
                );
              })
            )
          : h('div', { class: 'muted pad' }, 'Здесь можно смешивать треки из Звука и свои MP3 в одном плейлисте.')
      )
    );

    if (zvuk.isLoggedIn()) {
      let content;
      if (zvukErr) content = errorBox(zvukErr, () => loadZvuk(true));
      else if (!zvukLists) content = spinner();
      else if (!zvukLists.length) content = h('div', { class: 'muted pad' }, 'В Звуке у тебя пока нет плейлистов.');
      else
        content = h(
          'div',
          { class: 'list' },
          zvukLists.map((p) => playlistRow(p.cover, p.title, tracksWord(p.trackIds.length), () => nav.push(zvukPlaylistPage(p))))
        );
      body.append(section('Плейлисты из Звука', h('button', { class: 'icon-btn small', 'aria-label': 'Обновить', onclick: () => loadZvuk(true) }, icon('refresh', 20)), content));
    } else {
      body.append(
        section(
          'Плейлисты из Звука',
          null,
          h('div', { class: 'muted pad' }, 'Войди в Звук в профиле, и здесь появятся твои плейлисты.'),
          h('button', { class: 'btn btn-ghost', onclick: () => nav.switchTab('profile') }, 'Войти в Звук')
        )
      );
    }
  };

  pl.onPlaylistsChange(render);
  onLocalChange(render);
  el._onShow = () => {
    render();
    loadZvuk(false);
  };
  return el;
}

// ===================== Профиль =====================

export function profileView() {
  const el = nav.page({ title: 'Профиль' });
  const body = nav.pageBody(el);

  const toggleRow = (label, sub, value, onChange) => {
    const sw = h('input', { type: 'checkbox', class: 'switch' });
    sw.checked = value;
    sw.addEventListener('change', () => onChange(sw.checked));
    return h('label', { class: 'setting-row' }, h('div', null, h('div', null, label), sub ? h('div', { class: 'muted small' }, sub) : null), sw);
  };

  const render = async () => {
    clear(body);

    // --- Zvuk account ---
    const logged = zvuk.isLoggedIn();
    const tokenInput = h('input', { class: 'input', type: 'password', placeholder: 'Вставь токен сюда', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const showBtn = h('button', { class: 'btn btn-text small' }, 'Показать');
    showBtn.onclick = () => {
      const hidden = tokenInput.type === 'password';
      tokenInput.type = hidden ? 'text' : 'password';
      showBtn.textContent = hidden ? 'Скрыть' : 'Показать';
    };
    const saveBtn = h('button', { class: 'btn btn-primary' }, 'Войти');
    saveBtn.onclick = async () => {
      const t = tokenInput.value.trim().replace(/^"+|"+$/g, '');
      if (!t) return toast('Сначала вставь токен');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Проверяю…';
      try {
        await zvuk.checkToken(t);
        saveSettings({ token: t });
        save('feed', null);
        await likedIds(true);
        toast('Готово, Звук подключён');
        render();
      } catch (e) {
        toast(e.kind === 'auth' ? 'Токен не подошёл. ' + e.message : e.message, 5000);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Войти';
      }
    };

    const howTo = h(
      'ol',
      { class: 'howto' },
      h('li', null, 'Открой zvuk.com в браузере на телефоне и войди в свой аккаунт.'),
      h('li', null, 'Нажми кнопку «Открыть страницу токена» ниже — откроется страница с текстом.'),
      h('li', null, 'Найди в тексте "token":"…" и скопируй то, что внутри кавычек после двоеточия.'),
      h('li', null, 'Вернись сюда, вставь в поле и нажми «Войти».')
    );

    body.append(
      section(
        'Звук',
        null,
        h(
          'div',
          { class: 'card-box' },
          logged
            ? [
                h('div', { class: 'status ok' }, icon('check', 20), 'Аккаунт подключён'),
                h('div', { class: 'muted small' }, 'Твои плейлисты, лайки и высокое качество (если есть подписка).'),
                h(
                  'button',
                  {
                    class: 'btn btn-ghost',
                    onclick: async () => {
                      if (await confirmSheet('Выйти из Звука?', 'Токен удалится с телефона. MP3 и твои плейлисты останутся.', 'Выйти')) {
                        saveSettings({ token: '' });
                        save('feed', null);
                        render();
                      }
                    },
                  },
                  'Выйти'
                ),
              ]
            : [
                h('div', { class: 'status' }, 'Сейчас гостевой режим'),
                h('div', { class: 'muted small' }, 'Поиск и прослушивание работают, но без твоих плейлистов и лайков. Для входа нужен токен — это ключ от твоего аккаунта, им ни с кем не делись.'),
                howTo,
                h('button', { class: 'btn btn-ghost', onclick: () => openExternal('https://zvuk.com/api/tiny/profile') }, icon('link', 20), 'Открыть страницу токена'),
                h('div', { class: 'token-row' }, tokenInput, showBtn),
                saveBtn,
              ]
        )
      )
    );

    // --- playback ---
    body.append(
      section(
        'Воспроизведение',
        null,
        h(
          'div',
          { class: 'card-box' },
          toggleRow('Высокое качество', 'Если выключить, треки грузятся быстрее и тратят меньше трафика', settings.quality !== 'mid', (v) => saveSettings({ quality: v ? 'high' : 'mid' })),
          toggleRow('Замена из другого источника', 'Нет трека в Звуке — играет твой MP3, и наоборот', settings.autoFallback, (v) => saveSettings({ autoFallback: v })),
          h(
            'div',
            null,
            h('div', null, 'Если Звук закрыл доступ'),
            h('div', { class: 'muted small' }, 'Когда Звук принимает приложение за бота, а MP3 этого трека нет, трек откроется здесь'),
            h(
              'div',
              { class: 'chips choice' },
              [...PLATFORMS, { id: 'off', name: 'Никуда' }].map((p) =>
                h(
                  'button',
                  {
                    class: 'chip' + (settings.fallbackPlatform === p.id ? ' chip-on' : ''),
                    'aria-pressed': settings.fallbackPlatform === p.id ? 'true' : 'false',
                    onclick: () => {
                      saveSettings({ fallbackPlatform: p.id });
                      render();
                    },
                  },
                  p.name
                )
              )
            )
          )
        )
      )
    );

    // --- waves ---
    body.append(
      section(
        'Волны',
        null,
        h(
          'div',
          { class: 'card-box' },
          wavesPicker(),
          toggleRow(
            'Двигаются под музыку',
            'Волны слышат трек и прыгают в такт. Если при выключенном экране обрывается звук, выключи — волны станут спокойнее, а звук пойдёт напрямую',
            settings.wavesReactive,
            (v) => saveSettings({ wavesReactive: v })
          )
        )
      )
    );

    // --- favourite artists ---
    const fav = favArtists();
    body.append(
      section(
        'Артисты для ленты',
        h('button', { class: 'btn btn-text small', onclick: () => nav.switchTab('search') }, '+ Найти'),
        fav.length
          ? h(
              'div',
              { class: 'chips' },
              fav.map((a) =>
                h(
                  'button',
                  {
                    class: 'chip chip-x',
                    onclick: () => {
                      setFav(a, false);
                      render();
                    },
                  },
                  a.name,
                  icon('close', 16)
                )
              )
            )
          : h('div', { class: 'muted pad' }, 'Пока никого. Добавляй артистов на их страницах.')
      )
    );

    // --- storage ---
    const est = await storageEstimate();
    const count = (await localTracks()).length;
    body.append(
      section(
        'Память',
        null,
        h(
          'div',
          { class: 'card-box' },
          h('div', null, `MP3 в приложении: ${tracksWord(count)}`),
          est && est.usage > 1048576 ? h('div', { class: 'muted small' }, `Занято на телефоне: ${Math.round(est.usage / 1048576)} МБ`) : null
        )
      )
    );

    // --- error journal ---
    const journal = getJournal().slice(0, 15);
    body.append(
      section(
        'Журнал ошибок',
        journal.length ? h('button', { class: 'btn btn-text small', onclick: () => (clearJournal(), render()) }, 'Очистить') : null,
        journal.length
          ? h(
              'div',
              { class: 'journal' },
              journal.map((j) =>
                h('div', { class: 'journal-row' }, h('span', { class: 'muted small' }, new Date(j.at).toLocaleString('ru-RU') + ', ' + j.where), h('div', null, j.msg))
              )
            )
          : h('div', { class: 'muted pad' }, 'Ошибок нет. Если что-то сломается — сделай скриншот этого раздела.')
      )
    );

    body.append(h('div', { class: 'list-meta center' }, `Резонанс ${VERSION}`));
  };

  el._onShow = render;
  return el;
}
