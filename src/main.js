// App entry: builds the shell (tabs, mini player, full player) and wires events.

import { App } from '@capacitor/app';
import { h, icon, clear, fmtTime, afterIntro } from './util.js';
import * as nav from './nav.js';
import * as player from './player.js';
import * as online from './online.js';
import * as web from './serviceweb.js';
import { onAccountsChange, connect as connectService } from './accounts.js';
import { migrateFromZvuk } from './playlists.js';
import { toExt as zvukToExt } from './zvuk-import.js';
import { feedView, searchView, libraryView, profileView } from './views.js';
import { trackMenu, artistPage, otherPlatformsSheet, setSearchHook, isLikedSync, toggleLike, likedIds, canLike, onLikeChange, searchInApp, openExternal } from './pages.js';
import { cover, coverOf, markPlaying, refreshLocalCovers, sheet, closeSheet, isSheetOpen, snack, dragToClose, hSwipe, slideIn } from './components.js';
import { applyTheme, syncBars } from './theme.js';
import { initScreen } from './screen.js';
import { createLyricsView } from './lyrics-view.js';
import { moreLike } from './endless.js';
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

applyTheme();
initScreen();

const content = h('main', { class: 'content' });
const tabIndicator = h('div', { class: 'tab-indicator', 'aria-hidden': 'true' });
// bottom tab bar on a phone, a sidebar on a wide screen (CSS decides)
const tabsBox = h('div', { class: 'tabs' });
const tabbar = h(
  'nav',
  { class: 'tabbar' },
  h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, h('i'), h('i'), h('i'), h('i')), h('div', { class: 'brand-name' }, 'Резонанс')),
  tabsBox
);
const mini = buildMini();
const lyricsView = createLyricsView({ onSeek: (t) => player.seek(t), getDuration: () => player.duration() });
const full = buildFull();
const bgCanvas = h('canvas', { class: 'waves-bg', 'aria-hidden': 'true' });
// soft colour clouds behind the glass themes (only shown there)
const aurora = h('div', { class: 'aurora', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
document.body.insertBefore(aurora, document.getElementById('app'));
document.body.insertBefore(bgCanvas, document.getElementById('app'));
document.getElementById('app').append(content, mini.el, tabbar, full.el);

// ---------- waves ----------

waves.setSource({
  playing: () => player.state.playing,
  analysing: player.analysing,
  onSilence: () => player.reportSilence(),
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
    const c = full.art.querySelector('.cover-full:not(.cover-out)');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const area = full.art.getBoundingClientRect();
    // the waves use the whole width, the cover floats on top of them
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
  tabsBox.appendChild(b);
}
tabsBox.appendChild(tabIndicator);
nav.onTab((name) => {
  for (const [n, b] of Object.entries(tabButtons)) b.classList.toggle('active', n === name);
  tabsBox.style.setProperty('--tab-i', String(TABS.findIndex((t) => t.name === name)));
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
  const text = h('div', { class: 'mini-text' }, title, sub);
  const el = h('div', { class: 'mini', hidden: true, onclick: () => openFull() }, bar, coverBox, text, playBtn, nextBtn);
  // swipe left for the next track, right for the previous one
  const targets = () => [coverBox, text];
  hSwipe(el, { targets, ignore: 'button', onSwipe: (dir) => swipeTrack(dir, targets()) });
  return { el, coverBox, title, sub, playBtn, bar, text };
}

let miniKey = '';
function paintMini() {
  const t = player.current();
  mini.el.hidden = !t;
  if (document.body.classList.contains('has-mini') !== !!t) {
    document.body.classList.toggle('has-mini', !!t);
    requestAnimationFrame(() => waves.resize('bg')); // the waves area may have changed
  }
  if (!t) return;
  const key = t.key + '|' + coverOf(t);
  if (key !== miniKey) {
    const first = !miniKey;
    miniKey = key;
    clear(mini.coverBox).appendChild(cover(coverOf(t), 'cover cover-mini'));
    mini.title.textContent = t.title;
    mini.sub.textContent = t.artist || '';
    if (swipeDir) {
      slideIn(mini.coverBox, swipeDir, 40);
      slideIn(mini.text, swipeDir, 40);
    } else if (!first) replay(mini.el, 'swap');
  }
  paintPlayButtons();
  ensureLoop();
}

// ---------- swiping between tracks ----------

let swipeDir = ''; // the side the next track's cover comes in from
let swipeTimer = 0;
function swipeTrack(dir, flown) {
  const keyNow = () => player.current() && player.current().key;
  const before = keyNow();
  const started = Date.now();
  swipeDir = dir;
  clearTimeout(swipeTimer);
  if (dir === 'next') player.next();
  else player.prev(true);
  const check = () => {
    if (keyNow() !== before) return (swipeDir = ''); // the new track came in from the side
    // the list ended and similar music is being picked: wait for it
    if (player.state.extending && Date.now() - started < 25000) return (swipeTimer = setTimeout(check, 300));
    swipeDir = '';
    // nowhere to go (start of the list): what flew away comes back
    for (const el of flown) if (el) slideIn(el, dir === 'next' ? 'prev' : 'next');
  };
  swipeTimer = setTimeout(check, 700);
}

// Restarts a one-shot CSS animation class.
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// The play/pause icon only changes (with a little morph) when the state does.
let playShown = '';
function paintPlayButtons() {
  const busy = player.state.loading || player.state.extending;
  const playing = player.state.playing;
  const k = busy ? 'busy' : playing ? 'pause' : 'play';
  if (k === playShown) return;
  const animate = !!playShown;
  playShown = k;
  const put = (btn, small) => {
    const el = busy ? h('div', { class: small ? 'spin small' : 'spin' }) : icon(k, small ? 28 : 38);
    if (animate && !busy) el.classList.add('icon-pop'); // (a pop animation would stop the spinner turning)
    clear(btn).appendChild(el);
  };
  put(mini.playBtn, true);
  put(full.playBtn, false);
  full.el.classList.toggle('is-playing', playing && !busy);
}

// ---------- waveform seek bar ----------

// Bars are generated from the track id, so each song keeps its own shape. The
// played part fills smoothly and the bars breathe very slightly with the music.
// It is one small canvas drawn once per frame (56 DOM bars restyled every frame
// cost far more).
function buildWave(n = 56) {
  const canvas = h('canvas', { class: 'wave-canvas', 'aria-hidden': 'true' });
  const el = h('div', { class: 'wave', role: 'slider', 'aria-label': 'Перемотка', 'aria-valuemin': '0', 'aria-valuemax': '100', tabindex: '0' }, canvas);
  const ctx = canvas.getContext('2d');
  const heights = new Float32Array(n).fill(0.4);
  const levels = new Float32Array(n);
  const shown = new Float32Array(n);
  const w = { el, dragging: false, onScrub: null, onSeek: null, shapeKey: '', busy: false };
  let frac = 0;
  let grownAt = 0; // bars grow in when a new track's shape appears
  let W = 0;
  let H = 0;
  let dpr = 1;
  let colors = null;
  let dirty = true;

  const readColors = () => {
    const cs = getComputedStyle(el);
    colors = { on: cs.getPropertyValue('--lilac').trim() || '#b79cff', off: cs.getPropertyValue('--line').trim() || '#352a4f' };
    dirty = true;
  };
  window.addEventListener('rez-theme', readColors);

  const fit = () => {
    const r = el.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    dirty = true;
  };
  if (window.ResizeObserver) new ResizeObserver(() => (fit(), w.draw())).observe(el);

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
    const raw = Array.from({ length: n }, () => rand());
    for (let i = 0; i < n; i++) {
      const v = (raw[i] * 2 + (raw[i - 1] ?? raw[i]) + (raw[i + 1] ?? raw[i])) / 4;
      const env = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / n);
      heights[i] = 0.18 + 0.82 * v * env;
    }
    grownAt = performance.now();
    dirty = true;
  };
  w.setFrac = (f) => {
    f = Math.min(1, Math.max(0, f || 0));
    if (Math.abs(f - frac) * W < 0.5) return;
    frac = f;
    dirty = true;
    const v = String(Math.round(f * 100));
    if (el.getAttribute('aria-valuenow') !== v) el.setAttribute('aria-valuenow', v);
  };
  w.pulse = (beat) => {
    waves.barLevels(n, levels);
    for (let i = 0; i < n; i++) {
      const target = levels[i] * 0.1 + beat * 0.05; // a few percent of the height
      const v = shown[i] + (target - shown[i]) * 0.35;
      if (Math.abs(v - shown[i]) > 0.001) {
        shown[i] = v;
        dirty = true;
      }
    }
  };
  w.animating = () => w.busy || performance.now() - grownAt < 650;
  w.draw = (now = performance.now()) => {
    if (W <= 1 || H <= 1) fit();
    if (!colors) readColors();
    const growing = now - grownAt < 650;
    if (!dirty && !growing && !w.busy) return;
    dirty = false;
    const gap = 2 * dpr;
    const bw = (W - gap * (n - 1)) / n;
    if (!(bw > 0.5)) {
      dirty = true; // not laid out yet (player hidden): try again later
      return;
    }
    const r = Math.min(bw / 2, 2 * dpr);
    const grow = growing ? 1 - Math.pow(1 - (now - grownAt) / 650, 3) : 1;
    ctx.clearRect(0, 0, W, H);
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      const g = growing ? Math.max(0.2, Math.min(1, grow * 1.4 - (i % 4) * 0.08)) : 1;
      const hh = Math.max(3 * dpr, heights[i] * H * g * (1 + shown[i]));
      const x = i * (bw + gap);
      if (path.roundRect) path.roundRect(x, (H - hh) / 2, bw, hh, r);
      else path.rect(x, (H - hh) / 2, bw, hh);
    }
    ctx.globalAlpha = w.busy ? 0.55 + 0.45 * Math.abs(Math.sin(now / 380)) : 1;
    ctx.fillStyle = colors.off;
    ctx.fill(path);
    if (frac > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, frac * W, H);
      ctx.clip();
      ctx.fillStyle = colors.on;
      ctx.fill(path);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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
    w.draw();
    w.onScrub && w.onScrub(f);
  });
  el.addEventListener('pointermove', (e) => {
    if (!w.dragging) return;
    const f = fracAt(e.clientX);
    w.setFrac(f);
    w.draw();
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
  // two background layers, so a new cover fades in over the old one
  const bgA = h('div', { class: 'full-bg' });
  const bgB = h('div', { class: 'full-bg' });
  const bg = h('div', { class: 'full-bgs' }, bgA, bgB);
  const art = h('div', { class: 'full-art' });
  const thumb = h('div', { class: 'meta-thumb' });
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
  const lyricsBtn = h('button', { class: 'fb-btn', 'aria-pressed': 'false', onclick: () => setLyrics(!settings.lyricsOn) }, icon('lyrics', 24), h('span', null, 'Текст'));
  const el = h(
    'div',
    { class: 'full' + (settings.wavesFocus ? ' focus' : '') + (settings.lyricsOn ? ' lyrics-on' : ''), hidden: true },
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
      lyricsView.el,
      h('div', { class: 'full-meta' }, thumb, h('div', { class: 'full-meta-text' }, title, artist, via), likeBtn),
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
        lyricsBtn,
        h('button', { class: 'fb-btn', onclick: () => showWaves() }, icon('wave', 24), h('span', null, 'Волны')),
        h('button', { class: 'fb-btn', onclick: () => showQueue() }, icon('queue', 24), h('span', null, 'Очередь'))
      )
    )
  );
  wave.onScrub = (f) => (tCur.textContent = fmtTime(f * player.duration()));
  wave.onSeek = (f) => player.seek(f * player.duration());
  likeBtn.onclick = async () => {
    const t = player.current();
    if (!t || !canLike(t)) return;
    const was = isLikedSync(t);
    if (!was) replay(likeBtn, 'pop');
    await toggleLike(t);
    paintFull();
    syncNotificationLike();
  };
  artist.onclick = () => {
    const t = player.current();
    if (!t) return;
    const a = t.artists && t.artists.find((x) => x.id);
    closeFull();
    if (a) nav.push(artistPage(a.id, a.name));
    else if (t.artist) searchInApp(t.artist);
  };
  // pull the player down to close it
  dragToClose(el, el, () => closeFull(), el, { threshold: 140, ignore: '.wave, .controls, .full-bottom, .full-meta button, .sheet, .lyrics' });
  // swipe the cover sideways to change the track
  // (with the cover hidden behind the waves only the title moves: the hidden cover must stay hidden)
  // (the source line stays: it says when similar music is being picked)
  const artTargets = () => [el.classList.contains('focus') ? null : art.querySelector('.cover-full:not(.cover-out)'), title, artist];
  hSwipe(art, { targets: artTargets, onSwipe: (dir) => swipeTrack(dir, artTargets()) });
  // tap the cover: waves take the whole stage, tap again to bring the cover back
  art.addEventListener('click', () => {
    saveSettings({ wavesFocus: !settings.wavesFocus });
    el.classList.toggle('focus', settings.wavesFocus);
    waves.resize('full');
    waves.kick();
  });
  return { el, bg, bgLayers: [bgA, bgB], canvas, art, thumb, title, artist, via, likeBtn, lyricsBtn, wave, tCur, tDur, shuffleBtn, repeatBtn, playBtn };
}

const VIA_LABEL = {
  online: 'Яндекс Музыка',
  local: 'Мой MP3',
  'online-fallback': 'Яндекс Музыка — файла MP3 больше нет',
};

let fullKey = '';
let bgFront = 0;

// A new cover slides in over the old one instead of blinking.
function swapCover(src, dir = '') {
  const old = full.art.querySelector('.cover-full:not(.cover-out)');
  const next = cover(src ? src.replace(/size=\d+x\d+/, 'size=600x600') : '', 'cover cover-full');
  if (old && dir) {
    // after a swipe the old cover has already flown off; the new one follows from the other side
    old.classList.add('cover-out');
    setTimeout(() => old.remove(), 260);
    full.art.appendChild(next);
    if (!full.el.classList.contains('focus')) slideIn(next, dir, 90);
    return;
  }
  if (old) {
    old.classList.add('cover-out');
    setTimeout(() => old.remove(), 420);
    next.classList.add('cover-in');
    // the entrance must not hold the cover's look afterwards (tap-to-hide animates it)
    next.addEventListener('animationend', () => next.classList.remove('cover-in'), { once: true });
  }
  full.art.appendChild(next);
}

function swapBackground(src) {
  const [a, b] = full.bgLayers;
  const front = bgFront ? b : a;
  const back = bgFront ? a : b;
  back.style.backgroundImage = src ? `url("${src}")` : '';
  back.classList.add('on');
  front.classList.remove('on');
  bgFront = bgFront ? 0 : 1;
}

function paintFull() {
  const t = player.current();
  if (!t) return;
  const c = coverOf(t);
  const key = t.key + '|' + c;
  if (key !== fullKey) {
    const changedTrack = !fullKey.startsWith(t.key + '|');
    const first = !fullKey;
    fullKey = key;
    swapCover(c, changedTrack ? swipeDir : '');
    swapBackground(c);
    waves.burst(700);
    clear(full.thumb).appendChild(cover(c, 'cover'));
    full.title.textContent = t.title;
    full.artist.textContent = t.artist || '';
    if (changedTrack && swipeDir) {
      slideIn(full.title, swipeDir, 50);
      slideIn(full.artist, swipeDir, 50);
    }
    else if (changedTrack && !first) replay(full.el.querySelector('.full-meta-text'), 'swap');
  }
  if (settings.lyricsOn && !full.el.hidden) lyricsView.show(t);
  full.lyricsBtn.classList.toggle('active', !!settings.lyricsOn);
  full.lyricsBtn.setAttribute('aria-pressed', settings.lyricsOn ? 'true' : 'false');
  full.wave.setShape(t.key);
  full.wave.busy = !!(player.state.loading || player.state.extending);
  ensureLoop();
  const waitLeft = player.state.waitingUntil ? Math.ceil((player.state.waitingUntil - Date.now()) / 1000) : 0;
  full.via.textContent =
    waitLeft > 0
      ? `Сервис ненадолго закрыл доступ, включу сам через ${waitLeft} с`
      : player.state.extending
      ? 'Плейлист закончился — подбираю похожую музыку…'
      : player.state.loading
      ? 'Загружаю…'
      : t.unavailable
      ? 'Не удалось включить'
      : VIA_LABEL[player.state.via] || '';
  full.likeBtn.hidden = !canLike(t);
  const liked = isLikedSync(t);
  if (full.likeBtn.dataset.liked !== String(liked) || !full.likeBtn.firstChild) {
    full.likeBtn.dataset.liked = String(liked);
    clear(full.likeBtn).appendChild(icon(liked ? 'heart' : 'heartOutline', 26));
  }
  full.likeBtn.classList.toggle('liked', liked);
  full.shuffleBtn.classList.toggle('active', player.state.shuffle);
  const rep1 = player.state.repeat === 'one' ? 'repeatOne' : 'repeat';
  if (full.repeatBtn.dataset.icon !== rep1) {
    full.repeatBtn.dataset.icon = rep1;
    clear(full.repeatBtn).appendChild(icon(rep1, 24));
  }
  full.repeatBtn.classList.toggle('active', player.state.repeat !== 'off');
  paintPlayButtons();
  paintTime();
}

// ---------- progress, every frame while playing ----------

let lastSec = -1;
let lastDurSec = -1;
let lastMini = '';
function paintTime() {
  const d = player.duration();
  const p = player.position();
  const frac = d ? Math.min(1, p / d) : 0;
  const beat = player.state.playing ? waves.levels().beat : 0;
  // the line thickens a touch on each beat
  const mt = `scale(${frac.toFixed(4)}, ${(1 + beat * 0.9).toFixed(2)})`;
  if (mt !== lastMini) mini.bar.style.transform = lastMini = mt;
  if (full.el.hidden) return;
  if (!full.wave.dragging) {
    full.wave.setFrac(frac);
    const sec = Math.floor(p);
    if (sec !== lastSec) {
      lastSec = sec;
      full.tCur.textContent = fmtTime(p);
    }
  }
  const ds = Math.floor(d);
  if (ds !== lastDurSec) {
    lastDurSec = ds;
    full.tDur.textContent = fmtTime(d);
  }
  full.wave.pulse(beat);
  full.wave.draw();
  if (settings.lyricsOn) lyricsView.tick(p);
}

// Words of the song: in place of the cover on a phone, beside it on a wide screen.
function setLyrics(on) {
  saveSettings({ lyricsOn: on });
  full.el.classList.toggle('lyrics-on', on);
  waves.burst(900);
  if (on) {
    lyricsView.show(player.current());
    lastSec = -1;
    paintTime();
    setTimeout(() => lyricsView.relayout(), 420);
  } else lyricsView.hide();
  paintFull();
  setTimeout(() => waves.resize('full'), 450);
}

window.addEventListener('resize', () => {
  clearTimeout(setLyrics.t);
  setLyrics.t = setTimeout(() => {
    lyricsView.relayout();
    waves.resize('full');
  }, 200);
});

let loopId = 0;
const loopWanted = () => !!player.current() && !document.hidden && (player.state.playing || (!full.el.hidden && full.wave.animating()));
function frame() {
  loopId = 0;
  paintTime();
  if (loopWanted()) loopId = requestAnimationFrame(frame);
  else {
    // let the bars settle back
    requestAnimationFrame(() => paintTime());
  }
}
function ensureLoop() {
  if (!loopId && loopWanted()) loopId = requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', ensureLoop);

let closeTimer = 0;
function openFull() {
  if (!player.current()) return;
  clearTimeout(closeTimer);
  full.el.hidden = false;
  lastSec = -1;
  lastDurSec = -1;
  paintFull();
  // two frames: the first lays the player out below the screen, the second slides it up
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      full.el.classList.add('open');
      waves.setActive('full');
      ensureLoop();
      setTimeout(() => waves.resize('full'), 460); // measure the cover once it has slid in
    })
  );
}

function closeFull() {
  if (full.el.hidden || !full.el.classList.contains('open')) return false;
  full.el.classList.remove('open');
  waves.setActive('bg');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => (full.el.hidden = true), 460);
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

player.onPlayer((type, data) => {
  if (type === 'track' && player.endlessStarted(data)) {
    snack('Плейлист закончился — дальше похожая музыка', null, null, 4000);
  }
  if (type === 'time') {
    // the frame loop paints while playing; this covers seeks while paused
    if (!loopId) paintTime();
    return;
  }
  if (type === 'unavailable') {
    const t = data.track;
    if (data.error && data.error.kind === 'nologin') snack(data.error.message, 'Войти', () => connectService('yandex'), 8000);
    else snack(`«${t.title}»: ${data.error && data.error.message ? data.error.message : 'не играет'}`, 'Найти', () => otherPlatformsSheet(t));
  }
  if (type === 'waiting') {
    snack(`Сервис ненадолго закрыл доступ. «${data.track.title}» включится сам через ${Math.ceil(data.ms / 1000)} с`, null, null, 5000);
  }
  if (type === 'fallback') {
    snack(`«${data.track.title}»: файла MP3 больше нет — играет онлайн`, null, null, 3500);
  }
  paintMini();
  if (!full.el.hidden) paintFull();
  markPlaying();
  syncNotificationLike();
});

onLikeChange(() => {
  syncNotificationLike();
  if (!full.el.hidden) paintFull();
});

// Heart in the notification: shown for tracks of a signed-in service.
function syncNotificationLike() {
  const t = player.current();
  const enabled = !!t && canLike(t);
  player.setNotificationLike(enabled, enabled && isLikedSync(t));
}

// ---------- Android back button ----------

App.addListener('backButton', async () => {
  if (await web.back()) return; // sign-in page open on top
  if (closeSheet()) return;
  if (closeFull()) return;
  if (nav.back()) return;
  App.minimizeApp(); // keep the music playing instead of closing
}).catch(() => {});

// ---------- launch intro ----------
// The intro (index.html) is drawn over the app while it starts. As it leaves,
// the interface comes forward into place behind it.

function assemble(e) {
  const d = (e && e.detail) || {};
  syncBars(true);
  if (d.reduce) return;
  const k = d.fast ? 0.6 : 1;
  const ease = 'cubic-bezier(.16,1,.3,1)';
  const wide = window.matchMedia('(min-width: 700px)').matches;
  const rise = (el, from, duration, delay) =>
    el.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: duration * k, delay: delay * k, easing: ease, fill: 'backwards' });
  rise(content, 'scale(0.94)', 780, 60);
  rise(tabbar, wide ? 'translateX(-28px)' : 'translateY(30px)', 720, 170);
  if (!mini.el.hidden) rise(mini.el, 'translateY(22px)', 720, 220);
  const op = getComputedStyle(bgCanvas).opacity;
  bgCanvas.animate([{ opacity: 0 }, { opacity: op }], { duration: 1000 * k, delay: 150 * k, easing: 'ease-out', fill: 'backwards' });
}
window.addEventListener('rez-intro-out', assemble);
// the parts that come forward get their own GPU layers while the intro still
// covers them, so nothing has to be painted at the moment they start moving
const introOn = (on) => document.body.classList.toggle('intro-on', on);
if (window.rezIntro && window.rezIntro.active) introOn(true);
window.addEventListener('rez-intro-in', () => introOn(true));
window.addEventListener('rez-intro-done', () => introOn(false));
window.addEventListener('rez-intro-in', () => syncBars()); // replayed from the profile
const introReady = () => window.rezIntro && window.rezIntro.ready();
setTimeout(introReady, 3500); // never keep the intro waiting on a slow start

// ---------- start ----------

(async function start() {
  try {
    await requestPersistence();
    await refreshLocalCovers();
    onLocalChange(refreshLocalCovers);
    onLocalChange(() => rematchLocal().catch((e) => logError('rematch', e)));
    if (!settings.migrated11) {
      migrateFromZvuk(zvukToExt);
      saveSettings({ migrated11: true });
    }
    afterIntro(resumeMatching);
    player.setContinuation(moreLike);
    player.initMediaSession({
      onLike: async () => {
        const t = player.current();
        if (!t || !canLike(t)) return;
        await toggleLike(t);
        syncNotificationLike();
        if (!full.el.hidden) paintFull();
      },
    });
    player.restoreQueue();
    paintMini();
    if (online.isLoggedIn()) afterIntro(() => likedIds().then(syncNotificationLike).catch(() => {}));
    onAccountsChange(() => {
      resumeMatching();
      if (online.isLoggedIn()) likedIds(true).then(syncNotificationLike).catch(() => {});
      paintMini();
      if (!full.el.hidden) paintFull();
    });
  } catch (e) {
    logError('start', e);
  } finally {
    requestAnimationFrame(introReady);
  }
})();

setInterval(() => {
  if (player.state.waitingUntil && !full.el.hidden) paintFull();
}, 1000);
window.addEventListener('unhandledrejection', (e) => logError('promise', e.reason));
window.addEventListener('error', (e) => logError('js', e.error || e.message));
