// Резонанс Лаунчер: everything is put together here — the start, the gestures,
// the Back and Home buttons, the widget picker, and what the phone tells the page.

import { rez, on } from './bridge.js';
import { S, L, save, onChange } from './store.js';
import * as look from './look.js';
import * as apps from './apps.js';
import * as home from './home.js';
import * as drag from './drag.js';
import * as drawer from './drawer.js';
import * as folder from './folder.js';
import * as settings from './settings.js';
import * as widgets from './widgets.js';
import * as weather from './weather.js';
import * as intro from './intro.js';
import './graph.js';

const $ = (id) => document.getElementById(id);
const el = home.el;
const body = document.body;
const homeEl = home.homeEl;
const params = new URLSearchParams(location.search);

let INFO = {};
let skipIntro = null;

window.addEventListener('error', (e) => rez.log('JS: ' + (e.message || e) + ' @' + (e.filename || '').split('/').pop() + ':' + (e.lineno || 0)));
window.addEventListener('unhandledrejection', (e) => rez.log('JS promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

function refreshInfo() {
  INFO = rez.info();
  look.setInfo(INFO);
  settings.setInfo(INFO);
}

// ---------- the toast ----------

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}
document.addEventListener('rez-toast', (e) => toast(e.detail));

// ---------- the widget picker ----------

const wgBox = $('widgets');
let wgOpen = false;

function openWidgets() {
  wgOpen = true;
  const b = $('wgbody');
  b.textContent = '';
  b.style.setProperty('--is', home.geo.is + 'px');
  b.style.setProperty('--ch', home.geo.ch + 'px');
  const list = el('div', 'wg-list');
  for (const [id, k] of Object.entries(widgets.KINDS)) {
    const [c, r] = k.sizes[0];
    const card = el('div', 'wg');
    const prev = el('div', 'wg-prev');
    prev.style.setProperty('--cols', Math.min(c, home.geo.cols));
    prev.style.width = Math.min(100, (Math.min(c, home.geo.cols) / home.geo.cols) * 100) + '%';
    const w = widgets.build({ k: 'w', t: id, id: 'pv-' + id, c: Math.min(c, home.geo.cols), r }, { static: true });
    prev.append(w);
    const t = el('div', 'wg-t');
    const tx = el('div');
    tx.append(el('b', '', k.name), el('span', '', k.hint));
    const add = el('button', 'btn', 'Добавить');
    add.addEventListener('click', () => {
      closeWidgets();
      drag.addWidget(id);
      toast('Виджет добавлен');
    });
    t.append(tx, add);
    card.append(prev, t);
    list.append(card);
  }
  b.append(list);
  b.scrollTop = 0;
  wgBox.classList.add('on');
}

function closeWidgets() {
  wgOpen = false;
  wgBox.classList.remove('on');
}
$('wgclose').addEventListener('click', closeWidgets);
$('wgscrim').addEventListener('click', closeWidgets);
document.addEventListener('rez-open-widgets', () => {
  settings.close();
  openWidgets();
});

// ---------- wiring the parts ----------

drag.hooks.closeDrawer = (instant) => drawer.closeDrawer(instant);
drag.hooks.closeFolder = (instant) => folder.closeFolder(instant);
drag.hooks.openFolder = (id, rect) => folder.openFolder(id, rect);
drag.hooks.openSettings = (page) => settings.open(page);
drag.hooks.openWidgets = openWidgets;
drag.hooks.toast = toast;
drag.hooks.rename = (id) => folder.rename(id);
drag.hooks.dragging = (on) => homeEl.classList.toggle('dragging', on);
drag.attach($('home'));
drag.attach($('drawer'));
drag.attach($('folder'));

document.addEventListener('rez-open-settings', () => settings.open());
document.addEventListener('rez-open-search', () => drawer.openDrawer({ focus: true }));
$('handle').addEventListener('click', () => drawer.openDrawer());

// the buttons inside widgets (the press of the desktop does not take them)
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('.np-b, .sr-pill') && e.target.closest('#home')) widgets.press(e.target);
});

// ---------- Back and Home ----------

function closeAll() {
  drag.hideMenu();
  let any = false;
  if (settings.opened()) {
    settings.close();
    any = true;
  }
  if (wgOpen) {
    closeWidgets();
    any = true;
  }
  if (folder.isOpen()) {
    folder.closeFolder();
    any = true;
  }
  if (drawer.isOpen()) {
    drawer.closeDrawer();
    any = true;
  }
  return any;
}

function onBack() {
  if (skipIntro) return skipIntro();
  if (hello.on) return hideHello();
  if (drag.isDragging()) return;
  const menu = $('menu');
  if (menu.classList.contains('on')) return drag.hideMenu();
  if (settings.opened()) return void settings.back();
  if (wgOpen) return closeWidgets();
  if (folder.isOpen()) return folder.closeFolder();
  if (drawer.isOpen()) return drawer.closeDrawer();
  if (home.pageIndex() !== 0 || home.onFeed()) home.gotoGrid(0, true);
}

function onHome() {
  if (skipIntro) return skipIntro();
  if (drag.isDragging()) return;
  if (closeAll()) return;
  if (home.pageIndex() !== 0 || home.onFeed()) home.gotoGrid(0, true);
  else if (S.feed && !home.geo.split) home.goto(0, true); // Home once more: the page «Сегодня»
}

on('key', (k) => {
  if (k === 'back') onBack();
  else if (k === 'home') onHome();
});

// ---------- the gestures of the desktop ----------

let sw = null;

homeEl.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || drag.isDragging()) return;
  if (e.target.closest('.np-b, .sr-pill, .f-title')) return;
  if (settings.opened() || wgOpen || folder.isOpen() || drawer.isOpen()) return;
  sw = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), mode: '', last: 0, lt: 0, vy: 0 };
});

window.addEventListener('pointermove', (e) => {
  if (!sw || e.pointerId !== sw.id) return;
  if (drag.isDragging() || $('menu').classList.contains('on')) {
    sw = null;
    return;
  }
  const dx = e.clientX - sw.x;
  const dy = e.clientY - sw.y;
  const now = performance.now();
  if (!sw.mode) {
    if (Math.hypot(dx, dy) < 14) return;
    if (Math.abs(dy) > Math.abs(dx) * 1.25) {
      if (dy < 0) sw.mode = 'up';
      else if (S.swipeDown !== 'none') sw.mode = 'down';
      else {
        sw = null;
        return;
      }
    } else {
      sw = null; // sideways: the pages scroll themselves
      return;
    }
  }
  if (sw.mode === 'up') {
    const p = Math.min(1, -dy / (home.geo.H * 0.5));
    drawer.follow(p);
    if (sw.lt) sw.vy = (e.clientY - sw.last) / Math.max(1, now - sw.lt);
    sw.last = e.clientY;
    sw.lt = now;
  }
});

function endSwipe(e, cancelled) {
  if (!sw || e.pointerId !== sw.id) return;
  const s = sw;
  sw = null;
  if (s.mode === 'up') {
    const dy = e.clientY - s.y;
    const p = -dy / (home.geo.H * 0.5);
    // a quick flick (vy < 0 is upwards) or a long enough pull
    drawer.settle(!cancelled && (p > 0.28 || s.vy < -0.5));
  } else if (s.mode === 'down' && !cancelled) {
    const dy = e.clientY - s.y;
    if (dy > 70) {
      if (S.swipeDown === 'shade') {
        if (!rez.notifications()) toast('Шторку открыть не вышло');
      } else if (S.swipeDown === 'search') drawer.openDrawer({ focus: true });
    }
  }
}
window.addEventListener('pointerup', (e) => endSwipe(e, false));
window.addEventListener('pointercancel', (e) => endSwipe(e, true));

// ---------- what the phone tells ----------

on('insets', (d) => {
  const old = home.insets();
  home.setInsets(d);
  if (d.t !== old.t || d.b !== old.b || d.l !== old.l || d.r !== old.r) relayout();
});

let relayoutTimer = 0;
function relayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    const a = document.activeElement;
    if (a && a.tagName === 'INPUT') return; // the keyboard: the screen only looks smaller
    home.render();
    if (drawer.isOpen()) drawer.render();
    look.apply();
  }, 140);
}
let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  // a change of width is a turn or a folding; of height only — the keyboard
  if (w !== lastW) {
    lastW = w;
    relayout();
  } else if (!(document.activeElement && document.activeElement.tagName === 'INPUT') && home.insets().ime === 0) relayout();
});

on('visible', (v) => {
  const visible = v === true || v === 'true';
  look.setWaveState({ visible });
  if (visible) {
    refreshInfo();
    widgets.setBattery(rez.battery());
    widgets.tick();
    home.setBadges(rez.badges());
    if (settings.opened()) settings.refresh();
  }
});

on('perm', () => {
  refreshInfo();
  rez.visualizer(S.hear);
  if (settings.opened()) settings.refresh();
});

on('media', (m) => {
  widgets.setMedia(m);
  look.setWaveState({ music: !!(m && m.active && m.playing) });
  if (S.palette === 'cover' && m && m.active && m.art) look.coverPalette(rez.artUrl(m.art));
});

on('badges', (b) => home.setBadges(b));

// the icons were drawn: colours of plates and kinds of apps are known
on('meta', () => {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => home.render(), 200);
});

function onWeather(w) {
  widgets.setWeather(w);
}

// ---------- what changed in the settings ----------

onChange((patch) => {
  const keys = Object.keys(patch);
  const has = (...ks) => ks.some((k) => keys.indexOf(k) >= 0);
  if (has('bg', 'palette', 'style', 'motion', 'fps', 'parallax', 'hear', 'wall')) look.apply();
  if (has('hear')) rez.visualizer(S.hear);
  if (has('orient')) rez.orientation(S.orient);
  if (has('city')) weather.refresh();
  if (has('weather') && S.weather) weather.start(onWeather);
  homeEl.classList.toggle('no-handle', !S.drawerButton);
  if (has('shape', 'plate', 'themed', 'iconSize', 'labels', 'badges', 'grid', 'dockLabels', 'addNew', 'feed', 'clockStyle', 'weather')) {
    home.render();
    home.setBadges(rez.badges());
  }
  if (has('drawerStyle', 'drawerCats', 'engine', 'shape', 'plate', 'themed', 'iconSize') && drawer.isOpen()) drawer.render();
});

// ---------- the first run: «make Резонанс the home screen» ----------

const hello = { on: false };
function showHello() {
  const box = $('hello');
  box.textContent = '';
  const row = el('div', 'row');
  const yes = el('button', 'btn', 'Выбрать');
  const no = el('button', 'btn ghost', 'Позже');
  yes.addEventListener('click', () => {
    hideHello();
    rez.openHomeSettings();
  });
  no.addEventListener('click', hideHello);
  row.append(yes, no);
  box.append(el('b', '', 'Сделать Резонанс главным?'), el('p', '', 'Тогда кнопка «Домой» и свайп с края экрана будут открывать этот рабочий стол. Вернуть другой лаунчер можно в любой момент в настройках телефона.'), row);
  box.classList.add('on');
  hello.on = true;
}
function hideHello() {
  $('hello').classList.remove('on');
  hello.on = false;
  save({ homeAsked: true });
}

// ---------- the start ----------

function startIntro(then) {
  const run = () => {
    skipIntro = intro.play(() => {
      skipIntro = null;
      save({ introSeen: true });
      if (then) then();
    });
  };
  if (document.fonts && document.fonts.ready) {
    let started = false;
    const go = () => {
      if (!started) {
        started = true;
        run();
      }
    };
    document.fonts.ready.then(go);
    setTimeout(go, 900);
  } else run();
}
document.addEventListener('rez-play-intro', () => {
  closeAll();
  body.classList.add('intro-on');
  startIntro();
});
body.addEventListener('pointerdown', () => skipIntro && skipIntro(), true);

function boot() {
  refreshInfo();
  home.setInsets(INFO.insets || {});
  look.apply();
  homeEl.classList.toggle('no-handle', !S.drawerButton);
  apps.onApps(() => home.render());
  apps.load();
  home.render();
  home.setBadges(rez.badges());
  widgets.setBattery(rez.battery());
  setInterval(() => widgets.setBattery(rez.battery()), 60000);
  let lastMin = -1;
  setInterval(() => {
    const m = new Date().getMinutes();
    if (m !== lastMin) {
      lastMin = m;
      widgets.tick();
    }
  }, 5000);
  const m = rez.mediaState();
  widgets.setMedia(m);
  look.setWaveState({ music: !!(m && m.active && m.playing) });
  weather.start(onWeather);
  rez.visualizer(S.hear);
  rez.orientation(S.orient);
  rez.log(`Резонанс Лаунчер запущен: ${apps.all().length} приложений, ${home.geo.W}×${home.geo.H}, сетка ${home.geo.cols}×${home.geo.rows}, ${(navigator.userAgent.match(/Chrome\/[\d.]+/) || [''])[0]}`);

  const afterIntro = () => {
    if (!S.homeAsked && !INFO.home && INFO.app) setTimeout(showHello, 1200);
  };
  if (params.has('nointro') || S.introSeen) {
    body.classList.remove('intro-on');
    afterIntro();
  } else startIntro(afterIntro);
}

boot();
