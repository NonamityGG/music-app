// Root screens of the four tabs: Лента, Поиск, Медиатека, Профиль.

import { h, icon, clear, debounce, tracksWord, toast, plural, add } from './util.js';
import * as nav from './nav.js';
import * as player from './player.js';
import * as ya from './yandex.js';
import * as online from './online.js';
import * as accounts from './accounts.js';
import * as pl from './playlists.js';
import { localTracks, searchLocal, onLocalChange } from './local.js';
import { buildFeed, cachedFeed, feedIsStale, favArtists, setFav } from './feed.js';
import { settings, saveSettings, getJournal, clearJournal, load, save, logError } from './settings.js';
import { storageEstimate } from './db.js';
import { wavesPicker } from './wave-settings.js';
import { SOURCES } from './importers.js';
import { THEMES, setTheme, currentTheme } from './theme.js';
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
  customPlaylistPage,
  localPage,
  mixPage,
  folderPage,
  importPage,
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
      add(body, 
        emptyState(
          'feed',
          'Лента строится по твоим артистам',
          online.isLoggedIn()
            ? 'Добавь свои MP3, ставь лайки в Яндекс Музыке или выбери любимых артистов — и здесь появятся новинки, похожие артисты и микс.'
            : 'Лента собирается из Яндекс Музыки: войди через Яндекс ID — и здесь появятся новинки твоих артистов, похожие артисты и микс.',
          online.isLoggedIn()
            ? h('button', { class: 'btn btn-primary', onclick: () => nav.switchTab('search') }, icon('star', 20), 'Выбрать артистов')
            : h('button', { class: 'btn btn-primary', onclick: () => accounts.connect('yandex') }, 'Войти через Яндекс ID')
        )
      );
      return;
    }
    const mix = feed.mix || [];
    if (mix.length) {
      add(body, 
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
      add(body, section('Новинки твоих артистов', null, hscroll(feed.releases.map((r) => releaseCard(r, () => nav.push(releasePage(r.id)))))));
    }
    if (feed.related && feed.related.length) {
      add(body, section('Похожие артисты', null, hscroll(feed.related.map((a) => artistCard(a, () => nav.push(artistPage(a.id, a.name)))))));
    }
    if (feed.seeds && feed.seeds.length) {
      add(body, 
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
    add(body, h('div', { class: 'list-meta center' }, `Обновлено ${at.toLocaleDateString('ru-RU')} в ${at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`));
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
      if (e.kind === 'bot' || e.kind === 'rate') setTimeout(rebuild, online.blockedRemaining() + 2500);
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
      add(results, 
        section(
          'Недавние',
          h('button', { class: 'btn btn-text small', onclick: () => (save('recentSearches', []), showIdle()) }, 'Очистить'),
          h('div', { class: 'chips' }, rec.map((q) => h('button', { class: 'chip', onclick: () => run(q) }, q)))
        )
      );
    }
    add(results, 
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
    const [localRes, zRes] = await Promise.allSettled([searchLocal(q), online.quickSearch(q, 30)]);
    if (my !== seq) return;
    clear(results);
    const local = localRes.status === 'fulfilled' ? localRes.value : [];
    if (local.length) {
      add(results, section('В твоих MP3', null, trackList(local.slice(0, 10), { onPlay: (i) => player.playQueue(local, i), menu: (t) => trackMenu(t, { allowDelete: true }) })));
    }
    if (zRes.status === 'rejected') {
      if (zRes.reason && zRes.reason.kind === 'nologin') {
        add(
          results,
          emptyState(
            'search',
            local.length ? 'Остальное найдёт Яндекс Музыка' : 'Онлайн-поиск — через Яндекс Музыку',
            'Войди через Яндекс ID, и здесь будут треки, артисты и альбомы. Твои MP3 ищутся и без входа.',
            h('button', { class: 'btn btn-primary', onclick: () => accounts.connect('yandex') }, 'Войти через Яндекс ID')
          )
        );
      } else add(results, errorBox(zRes.reason, () => run(input.value)));
      return;
    }
    const r = zRes.value;
    if (r.artists.length) {
      add(results, section('Артисты', null, hscroll(r.artists.map((a) => artistCard(a, () => nav.push(artistPage(a.id, a.name)))))));
    }
    if (r.tracks.length) {
      add(results, section('Треки', null, trackList(r.tracks, { onPlay: (i) => player.playQueue(r.tracks, i), menu: (t) => trackMenu(t) })));
    }
    if (r.releases.length) {
      add(results, section('Альбомы', null, hscroll(r.releases.map((x) => releaseCard(x, () => nav.push(releasePage(x.id)))))));
    }
    if (!local.length && !r.tracks.length && !r.artists.length && !r.releases.length) {
      add(results, 
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
  const el = nav.page({ title: 'Медиатека', actions: [h('button', { class: 'icon-btn', 'aria-label': 'Перенести плейлист', onclick: () => nav.push(importPage()) }, icon('add', 26))] });
  const body = nav.pageBody(el);
  const liveCount = {}; // service -> number of playlists in the service

  const loadCounts = async () => {
    for (const svc of online.connected()) {
      if (liveCount[svc] !== undefined) continue;
      try {
        liveCount[svc] = (await online.userPlaylists(svc)).length;
        render();
      } catch {}
    }
  };

  const tile = (iconName, title, sub, onClick, cls = '') =>
    h('button', { class: 'tile ' + cls, onclick: onClick }, h('div', { class: 'tile-icon' }, icon(iconName, 26)), h('div', { class: 'tile-title' }, title), h('div', { class: 'tile-sub' }, sub));

  const folder = (src) => {
    let sub;
    if (src.id in online.SERVICES && accounts.loggedIn(src.id)) {
      const n = (liveCount[src.id] ?? 0) + pl.playlistsFrom(src.id).length;
      sub = liveCount[src.id] === undefined ? 'загружаю…' : plWord(n);
    } else {
      const n = pl.playlistsFrom(src.id).length;
      sub = n ? plWord(n) : src.id === 'mine' ? 'создать' : 'перенести';
    }
    return h(
      'button',
      { class: 'folder', style: { '--src': src.color }, onclick: () => nav.push(folderPage(src.id)) },
      h('div', { class: 'folder-icon' }, icon(src.id === 'mine' ? 'queue' : 'folder', 22)),
      h('div', { class: 'folder-text' }, h('div', { class: 'folder-name' }, src.name), h('div', { class: 'folder-sub' }, sub))
    );
  };

  const render = async () => {
    const localCount = (await localTracks()).length;
    clear(body);
    add(body, 
      h('div', { class: 'tiles' }, tile('folder', 'Мои MP3', localCount ? tracksWord(localCount) : 'добавить файлы', () => nav.push(localPage()), 'tile-local'), tile('add', 'Перенести плейлист', 'Звук, Яндекс, VK и другие', () => nav.push(importPage()), 'tile-import')),
      section('Папки', null, h('div', { class: 'folders' }, SOURCES.map(folder)))
    );
  };

  pl.onPlaylistsChange(render);
  onLocalChange(render);
  accounts.onAccountsChange((svc) => {
    delete liveCount[svc];
    render();
  });
  el._onShow = () => {
    render();
    loadCounts();
  };
  return el;
}

function plWord(n) {
  return `${n} ${plural(n, 'плейлист', 'плейлиста', 'плейлистов')}`;
}

// ===================== Профиль =====================

// A paste-the-key fallback, in case signing in on the page doesn't work.
function tokenForm(placeholder, check) {
  const input = h('input', { class: 'input', type: 'password', placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const showBtn = h('button', { class: 'btn btn-text small' }, 'Показать');
  showBtn.onclick = () => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    showBtn.textContent = hidden ? 'Скрыть' : 'Показать';
  };
  const go = h('button', { class: 'btn btn-ghost' }, 'Войти по токену');
  go.onclick = async () => {
    const t = input.value.trim().replace(/^"+|"+$/g, '');
    if (!t) return toast('Сначала вставь токен');
    go.disabled = true;
    go.textContent = 'Проверяю…';
    try {
      await check(t);
    } catch (e) {
      toast(e.kind === 'auth' ? 'Токен не подошёл. ' + e.message : e.message, 5000);
    } finally {
      go.disabled = false;
      go.textContent = 'Войти по токену';
    }
  };
  return h('div', { class: 'token-box' }, h('div', { class: 'token-row' }, input, showBtn), go);
}

const SERVICE_INFO = {
  yandex: {
    title: 'Яндекс Музыка',
    color: '#ffcc33',
    login: 'Войти через Яндекс ID',
    about: 'Откроется вход Яндекса прямо в приложении — войди и подтверди, окно закроется само.',
    guest: 'Через неё играет всё, чего нет в твоих MP3: поиск, лента, перенесённые плейлисты. С Плюсом треки играют целиком.',
    tokenHelp: 'Токен Яндекс Музыки (OAuth), если вход на странице не сработал.',
  },
};

function serviceCard(svc, rerender) {
  const info = SERVICE_INFO[svc];
  const logged = accounts.loggedIn(svc);
  const busy = accounts.isBusy(svc);
  const head = h('div', { class: 'service-head', style: { '--src': info.color } }, h('div', { class: 'service-dot' }), h('div', { class: 'service-name' }, info.title));
  if (logged) {
    const who = [settings.yaName || settings.yaLogin, settings.yaPlus ? 'Плюс есть' : 'без Плюса — только отрывки'].filter(Boolean).join(' · ');
    return h(
      'div',
      { class: 'card-box service-card' },
      head,
      h('div', { class: 'status ok' }, icon('check', 20), 'Подключено'),
      h('div', { class: 'muted small' }, who),
      h(
        'button',
        {
          class: 'btn btn-ghost',
          onclick: async () => {
            if (await confirmSheet(`Выйти из «${info.title}»?`, 'Вход удалится с телефона. MP3 и твои плейлисты останутся.', 'Выйти')) {
              await accounts.disconnect(svc);
              rerender();
            }
          },
        },
        'Выйти'
      )
    );
  }
  const loginBtn = h(
    'button',
    {
      class: 'btn btn-primary',
      disabled: busy,
      onclick: async () => {
        if (await accounts.connect(svc)) rerender();
      },
    },
    busy ? 'Вход…' : info.login
  );
  const check = async (t) => {
    await ya.loginWithToken(t);
    toast('Готово, Яндекс Музыка подключена');
    accounts.notify(svc);
    rerender();
  };
  return h(
    'div',
    { class: 'card-box service-card' },
    head,
    h('div', { class: 'muted small' }, info.guest),
    loginBtn,
    h('div', { class: 'muted small' }, info.about),
    h('details', { class: 'more' }, h('summary', null, 'Не получается войти?'), h('div', { class: 'muted small' }, info.tokenHelp), tokenForm('Вставь токен сюда', check))
  );
}

// Accounts used only to bring playlists over: Zvuk and Spotify.
function transferAccounts(rerender) {
  const row = (svc, title, color, how) => {
    const logged = accounts.loggedIn(svc);
    const busy = accounts.isBusy(svc);
    const who = svc === 'spotify' && settings.spName && settings.spName !== 'Spotify' ? settings.spName : '';
    return h(
      'div',
      { class: 'acc-row' },
      h('div', { class: 'service-dot', style: { '--src': color } }),
      h('div', { class: 'acc-text' }, h('div', { class: 'acc-name' }, title), h('div', { class: 'muted small' }, logged ? 'вход выполнен' + (who ? ' · ' + who : '') : how)),
      logged
        ? h(
            'button',
            {
              class: 'btn btn-ghost small-btn',
              onclick: async () => {
                await accounts.disconnect(svc);
                rerender();
              },
            },
            'Выйти'
          )
        : h(
            'button',
            {
              class: 'btn btn-primary small-btn',
              disabled: busy,
              onclick: async () => {
                if (await accounts.connect(svc)) rerender();
              },
            },
            busy ? 'Вход…' : 'Войти'
          )
    );
  };
  return h(
    'div',
    { class: 'card-box' },
    row('zvuk', 'Звук', '#8a5cff', 'Сбер ID или телефон'),
    row('spotify', 'Spotify', '#1ed760', 'нужен открывающийся сайт Spotify'),
    h('div', { class: 'muted small' }, 'Отсюда только переносятся плейлисты: Медиатека → «Перенести плейлист». Играет всё из твоих MP3 и Яндекс Музыки.')
  );
}

// Theme cards: each one is a tiny mock of the app drawn with that theme's own colours.
function themePicker() {
  const grid = h('div', { class: 'theme-grid' });
  const paint = () => {
    clear(grid);
    const cur = currentTheme().id;
    for (const t of THEMES) {
      const preview = h(
        'div',
        { class: 'theme-preview', 'data-theme': t.id, 'data-glass': t.glass ? '' : null, 'data-light': t.light ? '' : null },
        t.glass ? h('div', { class: 'tp-aura' }) : null,
        h('div', { class: 'tp-card' }, h('i', { class: 'tp-dot' }), h('div', { class: 'tp-lines' }, h('i'), h('i'))),
        h('div', { class: 'tp-bars' }, [0.5, 0.9, 0.65, 1, 0.75, 0.45].map((v) => h('i', { style: { height: v * 100 + '%' } }))),
        h('div', { class: 'tp-tab' }, h('i', { class: 'on' }), h('i'), h('i'))
      );
      grid.appendChild(
        h(
          'button',
          {
            class: 'theme-card' + (t.id === cur ? ' active' : ''),
            'aria-pressed': t.id === cur ? 'true' : 'false',
            onclick: () => {
              if (t.id === currentTheme().id) return;
              setTheme(t.id);
              paint();
            },
          },
          preview,
          h('div', { class: 'theme-name' }, t.name),
          h('div', { class: 'theme-sub' }, t.sub)
        )
      );
    }
  };
  paint();
  return grid;
}

export function profileView() {
  const el = nav.page({ title: 'Профиль', narrow: true });
  const body = nav.pageBody(el);

  const toggleRow = (label, sub, value, onChange) => {
    const sw = h('input', { type: 'checkbox', class: 'switch' });
    sw.checked = value;
    sw.addEventListener('change', () => onChange(sw.checked));
    return h('label', { class: 'setting-row' }, h('div', null, h('div', null, label), sub ? h('div', { class: 'muted small' }, sub) : null), sw);
  };

  const render = async () => {
    clear(body);

    // --- music services ---
    add(body, section('Музыка онлайн', null, serviceCard('yandex', render)));
    add(body, section('Перенос плейлистов', null, transferAccounts(render)));

    // --- look ---
    const replay = h('button', { class: 'btn-text small intro-replay', onclick: () => window.rezIntro && window.rezIntro.play(false) }, 'Посмотреть заставку');
    add(body,
      section(
        'Оформление',
        null,
        themePicker(),
        h(
          'div',
          { class: 'card-box intro-box' },
          toggleRow('Заставка при запуске', 'Короткая анимация, когда открываешь приложение', settings.intro !== false, (v) => saveSettings({ intro: v })),
          replay
        )
      )
    );

    // --- playback ---
    add(body, 
      section(
        'Воспроизведение',
        null,
        h(
          'div',
          { class: 'card-box' },
          toggleRow('Высокое качество', 'Если выключить, треки грузятся быстрее и тратят меньше трафика', settings.quality !== 'mid', (v) => saveSettings({ quality: v ? 'high' : 'mid' })),
          toggleRow('Замена из другого источника', 'Нет трека онлайн — играет твой MP3, и наоборот', settings.autoFallback, (v) => saveSettings({ autoFallback: v })),
          toggleRow('Без пауз между треками', 'Следующий трек заранее загружается и начинается ровно в момент, когда закончился текущий', settings.gapless !== false, (v) => saveSettings({ gapless: v })),
          toggleRow('Бесконечная музыка', 'Когда плейлист закончится, продолжит играть похожая музыка', settings.endless !== false, (v) => saveSettings({ endless: v }))
        )
      )
    );

    // --- waves ---
    add(body, 
      section(
        'Волны',
        null,
        h(
          'div',
          { class: 'card-box' },
          wavesPicker()
        )
      )
    );

    // --- favourite artists ---
    const fav = favArtists();
    add(body, 
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
    add(body, 
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
    add(body, 
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

    add(body, h('div', { class: 'list-meta center' }, `Резонанс ${VERSION}`));
  };

  accounts.onAccountsChange(() => render());
  el._onShow = render;
  return el;
}
