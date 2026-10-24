// App entry: builds the shell (tabs, mini player, full player) and wires events.

import { App } from '@capacitor/app';
import { h, icon, clear, fmtTime } from './util.js';
import * as nav from './nav.js';
import * as player from './player.js';
import * as zvuk from './zvuk.js';
import * as online from './online.js';
import * as web from './serviceweb.js';
import { onAccountsChange } from './accounts.js';
import { feedView, searchView, libraryView, profileView } from './views.js';
import { trackMenu, artistPage, otherPlatformsSheet, setSearchHook, isLikedSync, toggleLike, likedIds, canLike, searchInApp, openExternal } from './pages.js';
import { cover, coverOf, markPlaying, refreshLocalCovers, sheet, closeSheet, isSheetOpen, snack } from './components.js';
import { onLocalChange } from './local.js';
import { resumeMatching, rematchLocal } from './matcher.js';
import { requestPersistence } from './db.js';
import { logError, settings, saveSettings } from './settings.js';
import * as waves from './waves.js';
import { wavesPicker, applyWaveSettings } from './wave-settings.js';

const TABS = [
  { name: 'feed', label: 'Лента', icon: 'feed', view: feedView },
  { name: 'search', label: 'Поиск', icon: 'search', view: searchView },
  { name: 'library', label: 'Медиатека', icon: 'library', view: libraryView },
  { name: 'profile', label: 'Профиль', icon: 'user', view: profileView },
];

const content = h('main', { class: 'content' });
const tabbar = h('nav', { class: 'tabbar' });
const mini = buildMini();
const full = buildFull();
const bgCanvas = h('canvas', { class: 'waves-bg', 'aria-hidden': 'true' });
document.body.insertBefore(bgCanvas, document.getElementById('app'));
document.getElementById('app').append(content, mini.el, tabbar, full.el);

// ---------- waves ----------

waves.setSource({
  playing: () => player.state.playing,
  analysing: player.analysing,
  onSilence: () => player.bypassAnalyser('Анализатор не слышит звук, волны переключены в простой режим'),
});
applyWaveSettings();
waves.addSurface('bg', bgCanvas, { dpr: 1, place: 'center', ampScale: 0.23 });
waves.addSurface('full', full.canvas, {
  dpr: 1.5,
  full: true,
  center: () => {
    if (settings.wavesFocus) {
      const r = full.art.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: 0, amp: Math.min(r.width, r.height) * 0.42 };
    }
    const c = full.art.querySelector('.cover-full');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const area = full.art.getBoundingClientRect();
    // the waves use the whole art area, the cover floats on top of them
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2, amp: Math.max(r.height / 2, area.height / 2) };
  },
});
player.onPlayer((type) => {
  if (type === 'state') waves.kick();
});

// ---------- tabs ----------

const tabButtons = {};
for (const t of TABS) {
  const b = h('button', { class: 'tab', onclick: () => nav.switchTab(t.name, { reset: nav.activeTab() === t.name }) }, icon(t.icon, 24), h('span', null, t.label));
  tabButtons[t.name] = b;
  tabbar.appendChild(b);
}
nav.onTab((name) => {
  for (const [n, b] of Object.entries(tabButtons)) b.classList.toggle('active', n === name);
});
nav.initNav(content, Object.fromEntries(TABS.map((t) => [t.name, t.view])), 'feed');

setSearchHook((q) => {
  closeFull();
  nav.switchTab('search');
  const root = document.querySelector('.tab-pane[data-tab="search"] .page');
  if (root && root._search) root._search(q);
});

// ---------- mini player ----------

function buildMini() {
  const coverBox = h('div', { class: 'mini-cover' });
  const title = h('div', { class: 'mini-title' });
  const sub = h('div', { class: 'mini-sub' });
  const playBtn = h('button', { class: 'icon-btn', 'aria-label': 'Пауза/играть', onclick: (e) => (e.stopPropagation(), player.toggle()) });
  const nextBtn = h('button', { class: 'icon-btn', 'aria-label': 'Следующий', onclick: (e) => (e.stopPropagation(), player.next()) }, icon('next', 26));
  const bar = h('div', { class: 'mini-progress' });
  const el = h('div', { class: 'mini', hidden: true, onclick: () => openFull() }, bar, coverBox, h('div', { class: 'mini-text' }, title, sub), playBtn, nextBtn);
  return { el, coverBox, title, sub, playBtn, bar };
}

function paintMini() {
  const t = player.current();
  mini.el.hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  if (!t) return;
  clear(mini.coverBox).appendChild(cover(coverOf(t), 'cover cover-mini'));
  mini.title.textContent = t.title;
  mini.sub.textContent = t.artist || '';
  paintPlayButtons();
}

function paintPlayButtons() {
  const busy = player.state.loading;
  const playing = player.state.playing;
  clear(mini.playBtn).appendChild(busy ? h('div', { class: 'spin small' }) : icon(playing ? 'pause' : 'play', 28));
  clear(full.playBtn).appendChild(busy ? h('div', { class: 'spin' }) : icon(playing ? 'pause' : 'play', 38));
}

// ---------- waveform seek bar ----------

// Bars are generated from the track id, so each song keeps its own shape.
function buildWave(n = 56) {
  const el = h('div', { class: 'wave', role: 'slider', 'aria-label': 'Перемотка', 'aria-valuemin': '0', 'aria-valuemax': '100', tabindex: '0' });
  const bars = [];
  for (let i = 0; i < n; i++) {
    const b = h('i');
    bars.push(b);
    el.appendChild(b);
  }
  const w = { el, dragging: false, onScrub: null, onSeek: null, shapeKey: '' };
  w.setShape = (key) => {
    if (key === w.shapeKey) return;
    w.shapeKey = key;
    let seed = 2166136261;
    for (const ch of String(key)) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
    const rand = () => {
      seed = Math.imul(seed ^ (seed >>> 15), 2246822507);
      seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
      return ((seed ^= seed >>> 16) >>> 0) / 4294967296;
    };
    const raw = bars.map(() => rand());
    bars.forEach((b, i) => {
      const v = (raw[i] * 2 + (raw[i - 1] ?? raw[i]) + (raw[i + 1] ?? raw[i])) / 4;
      const env = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / n);
      b.style.height = Math.round(18 + 82 * v * env) + '%';
    });
  };
  w.setFrac = (f) => {
    const on = Math.round(f * n);
    bars.forEach((b, i) => b.classList.toggle('on', i < on));
    el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  };
  const fracAt = (x) => {
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  };
  el.addEventListener('pointerdown', (e) => {
    w.dragging = true;
    el.setPointerCapture(e.pointerId);
    const f = fracAt(e.clientX);
    w.setFrac(f);
    w.onScrub && w.onScrub(f);
  });
  el.addEventListener('pointermove', (e) => {
    if (!w.dragging) return;
    const f = fracAt(e.clientX);
    w.setFrac(f);
    w.onScrub && w.onScrub(f);
  });
  const end = (e) => {
    if (!w.dragging) return;
    w.dragging = false;
    w.onSeek && w.onSeek(fracAt(e.clientX));
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => (w.dragging = false));
  el.addEventListener('keydown', (e) => {
    const d = player.duration();
    if (!d) return;
    if (e.key === 'ArrowRight') player.seek(player.position() + 10);
    if (e.key === 'ArrowLeft') player.seek(player.position() - 10);
  });
  return w;
}

// ---------- full player ----------

function buildFull() {
  const bg = h('div', { class: 'full-bg' });
  const art = h('div', { class: 'full-art' });
  const title = h('div', { class: 'full-title' });
  const artist = h('button', { class: 'full-artist' });
  const via = h('div', { class: 'full-via' });
  const likeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Нравится' });
  const wave = buildWave();
  const tCur = h('span', null, '0:00');
  const tDur = h('span', null, '0:00');
  const shuffleBtn = h('button', { class: 'icon-btn', 'aria-label': 'Перемешать', onclick: () => player.setShuffle(!player.state.shuffle) }, icon('shuffle', 24));
  const repeatBtn = h('button', { class: 'icon-btn', 'aria-label': 'Повтор', onclick: () => player.cycleRepeat() });
  const playBtn = h('button', { class: 'play-big', 'aria-label': 'Пауза/играть', onclick: () => player.toggle() });
  const canvas = h('canvas', { class: 'waves-full', 'aria-hidden': 'true' });
  const el = h(
    'div',
    { class: 'full' + (settings.wavesFocus ? ' focus' : ''), hidden: true },
    bg,
    canvas,
    h(
      'div',
      { class: 'full-inner' },
      h(
        'div',
        { class: 'full-top' },
        h('button', { class: 'icon-btn', 'aria-label': 'Свернуть', onclick: () => closeFull() }, icon('down', 30)),
        h('div', { class: 'full-top-label' }, 'Сейчас играет'),
        h('button', { class: 'icon-btn', 'aria-label': 'Ещё', onclick: () => player.current() && trackMenu(player.current()) }, icon('more', 26))
      ),
      art,
      h('div', { class: 'full-meta' }, h('div', { class: 'full-meta-text' }, title, artist, via), likeBtn),
      h('div', { class: 'seek-wrap' }, wave.el, h('div', { class: 'seek-times' }, tCur, tDur)),
      h(
        'div',
        { class: 'controls' },
        shuffleBtn,
        h('button', { class: 'icon-btn big', 'aria-label': 'Предыдущий', onclick: () => player.prev() }, icon('prev', 36)),
        playBtn,
        h('button', { class: 'icon-btn big', 'aria-label': 'Следующий', onclick: () => player.next() }, icon('next', 36)),
        repeatBtn
      ),
      h(
        'div',
        { class: 'full-bottom' },
        h('button', { class: 'btn btn-text', onclick: () => showQueue() }, icon('queue', 22), 'Очередь'),
        h('button', { class: 'btn btn-text', onclick: () => showWaves() }, icon('wave', 22), 'Волны'),
        h('button', { class: 'btn btn-text', onclick: () => player.current() && otherPlatformsSheet(player.current()) }, icon('link', 22), 'Площадки')
      )
    )
  );
  wave.onScrub = (f) => (tCur.textContent = fmtTime(f * player.duration()));
  wave.onSeek = (f) => player.seek(f * player.duration());
  likeBtn.onclick = async () => {
    const t = player.current();
    if (!t || !canLike(t)) return;
    await toggleLike(t);
    paintFull();
  };
  artist.onclick = () => {
    const t = player.current();
    if (!t) return;
    const a = t.artists && t.artists.find((x) => x.id);
    closeFull();
    if (a) nav.push(artistPage(a.id, a.name));
    else if (t.artist) searchInApp(t.artist);
  };
  // tap the cover: waves take the whole stage, tap again to bring the cover back
  art.addEventListener('click', () => {
    saveSettings({ wavesFocus: !settings.wavesFocus });
    el.classList.toggle('focus', settings.wavesFocus);
    waves.resize('full');
    waves.kick();
  });
  return { el, bg, canvas, art, title, artist, via, likeBtn, wave, tCur, tDur, shuffleBtn, repeatBtn, playBtn };
}

const VIA_LABEL = {
  zvuk: 'Онлайн',
  local: 'Мой MP3',
  'zvuk-fallback': 'Онлайн — файла MP3 больше нет',
  waiting: 'Звук ненадолго закрыл доступ, жду…',
  check: 'Звук просит подтвердить, что ты не робот',
};

function paintFull() {
  const t = player.current();
  if (!t) return;
  const c = coverOf(t);
  full.bg.style.backgroundImage = c ? `url("${c}")` : '';
  clear(full.art).appendChild(cover(c ? c.replace(/size=\d+x\d+/, 'size=600x600') : '', 'cover cover-full'));
  full.title.textContent = t.title;
  full.artist.textContent = t.artist || '';
  full.wave.setShape(t.key);
  full.wave.el.classList.toggle('busy', player.state.loading);
  const waitLeft = player.state.waitingUntil ? Math.ceil((player.state.waitingUntil - Date.now()) / 1000) : 0;
  full.via.textContent =
    waitLeft > 0
      ? `Звук ненадолго закрыл доступ, включу сам через ${waitLeft} с`
      : player.state.loading
      ? 'Загружаю…'
      : t.unavailable
      ? 'Не удалось включить'
      : VIA_LABEL[player.state.via] || '';
  full.likeBtn.hidden = !canLike(t);
  clear(full.likeBtn).appendChild(icon(isLikedSync(t) ? 'heart' : 'heartOutline', 26));
  full.likeBtn.classList.toggle('liked', isLikedSync(t));
  full.shuffleBtn.classList.toggle('active', player.state.shuffle);
  clear(full.repeatBtn).appendChild(icon(player.state.repeat === 'one' ? 'repeatOne' : 'repeat', 24));
  full.repeatBtn.classList.toggle('active', player.state.repeat !== 'off');
  paintPlayButtons();
  paintTime();
}

function paintTime() {
  const d = player.duration();
  const p = player.position();
  const frac = d ? Math.min(1, p / d) : 0;
  mini.bar.style.width = (frac * 100).toFixed(2) + '%';
  if (full.el.hidden) return;
  if (!full.wave.dragging) {
    full.wave.setFrac(frac);
    full.tCur.textContent = fmtTime(p);
  }
  full.tDur.textContent = fmtTime(d);
}

function openFull() {
  if (!player.current()) return;
  full.el.hidden = false;
  paintFull();
  requestAnimationFrame(() => {
    full.el.classList.add('open');
    waves.setActive('full');
    setTimeout(() => waves.resize('full'), 340); // measure the cover once it has slid in
  });
}

function closeFull() {
  if (full.el.hidden) return false;
  full.el.classList.remove('open');
  waves.setActive('bg');
  setTimeout(() => (full.el.hidden = true), 250);
  return true;
}

function showWaves() {
  sheet('Волны', wavesPicker());
}

function showQueue() {
  const q = player.state.queue;
  const list = h('div', { class: 'queue-list' });
  q.forEach((t, i) => {
    const row = h(
      'div',
      { class: 'track' + (i === player.state.index ? ' playing' : '') + (t.unavailable ? ' unavailable' : ''), role: 'button' },
      cover(coverOf(t), 'cover cover-sm'),
      h('div', { class: 'track-text' }, h('div', { class: 'track-title' }, t.title), h('div', { class: 'track-sub' }, t.src === 'local' ? h('span', { class: 'badge' }, 'MP3') : null, t.artist || '')),
      i !== player.state.index
        ? h(
            'button',
            {
              class: 'icon-btn',
              'aria-label': 'Убрать',
              onclick: (e) => {
                e.stopPropagation();
                player.removeFromQueue(i);
                showQueue();
              },
            },
            icon('close', 20)
          )
        : null
    );
    row.onclick = () => {
      closeSheet();
      player.playAt(i);
    };
    list.appendChild(row);
  });
  const el = sheet(`Очередь (${q.length})`, list);
  const cur = el.querySelector('.track.playing');
  if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 250);
}

// ---------- player events ----------

let paintPending = false;
player.onPlayer((type, data) => {
  if (type === 'time') {
    if (!paintPending) {
      paintPending = true;
      requestAnimationFrame(() => {
        paintPending = false;
        paintTime();
      });
    }
    return;
  }
  if (type === 'unavailable') {
    const t = data.track;
    snack(`«${t.title}»: ${data.error && data.error.message ? data.error.message : 'не играет'}`, 'Найти', () => otherPlatformsSheet(t));
  }
  if (type === 'waiting') {
    snack(`Звук ненадолго закрыл доступ. «${data.track.title}» включится сам через ${Math.ceil(data.ms / 1000)} с`, null, null, 5000);
  }
  if (type === 'needCheck') {
    snack('Звук просит один раз подтвердить, что ты не робот', 'Пройти', passZvukCheck, 15000);
  }
  if (type === 'fallback') {
    snack(`«${data.track.title}»: файла MP3 больше нет — играет онлайн`, null, null, 3500);
  }
  paintMini();
  if (!full.el.hidden) paintFull();
  markPlaying();
});

// Shows zvuk.com so the user passes its check, then plays the track again.
async function passZvukCheck() {
  try {
    await zvuk.passCheck();
    player.retryCurrent();
  } catch (e) {
    logError('check', e);
  }
}

// ---------- Android back button ----------

App.addListener('backButton', async () => {
  if (await web.back()) return; // sign-in page open on top
  if (closeSheet()) return;
  if (closeFull()) return;
  if (nav.back()) return;
  App.minimizeApp(); // keep the music playing instead of closing
}).catch(() => {});

// ---------- start ----------

(async function start() {
  try {
    await requestPersistence();
    await refreshLocalCovers();
    onLocalChange(refreshLocalCovers);
    onLocalChange(() => rematchLocal().catch((e) => logError('rematch', e)));
    resumeMatching();
    player.initMediaSession();
    player.restoreQueue();
    paintMini();
    if (online.isLoggedIn()) likedIds().catch(() => {});
    onAccountsChange(() => {
      if (online.isLoggedIn()) likedIds(true).catch(() => {});
      paintMini();
      if (!full.el.hidden) paintFull();
    });
  } catch (e) {
    logError('start', e);
  }
})();

setInterval(() => {
  if (player.state.waitingUntil && !full.el.hidden) paintFull();
}, 1000);
window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason));
window.addEventListener('error', (e) => logError('js', e.error || e.message));
