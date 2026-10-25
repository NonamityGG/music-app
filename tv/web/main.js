// Резонанс OS — the home screen for a TV box. Starts everything, takes the
// remote's keys and sends them where they belong.

import { tv, on } from './tv.js';
import { S, onChange } from './store.js';
import * as apps from './apps.js';
import * as nav from './nav.js';
import * as layers from './layers.js';
import * as look from './look.js';
import * as home from './home.js';
import * as weather from './weather.js';
import * as intro from './intro.js';
import { grid, menu, settings, ambient, toast, launch, setInfo, setCity, homePlace } from './overlays.js';

const homeEl = document.getElementById('home');
let visible = true;
let skipIntro = null;
let info = {};

// ---------- start ----------

function refreshInfo() {
  info = tv.info() || {};
  setInfo(info);
  home.setStock(info.stock ? info.stockLabel || 'экран приставки' : '');
}

function boot() {
  look.apply();
  homePlace();
  refreshInfo();
  apps.onApps(() => home.render(true));
  apps.load();
  home.render(false);
  nav.setScope(homeEl, document.querySelector('#rows .card'));
  home.tick();
  home.setNet(tv.network());
  setInterval(() => home.setNet(tv.network()), 30000);
  const m = tv.mediaState();
  home.setMedia(m);
  look.setWaveState({ music: !!(m && m.active && m.playing) });
  weather.start((w) => {
    home.setWeather(w);
    setCity(w && w.city);
  });
  tv.visualizer(S.hear);
  tv.setGuard(S.guard);
  tv.log(`Резонанс OS запущен: ${apps.everything().length} приложений, ${navigator.userAgent.match(/Chrome\/[\d.]+/) || ''}`);

  const startIntro = () => {
    skipIntro = intro.play(() => {
      skipIntro = null;
      resetIdle();
    });
  };
  // the intro waits for the fonts (a moment), so the name doesn't jump
  if (document.fonts && document.fonts.ready) {
    let started = false;
    const go = () => {
      if (!started) {
        started = true;
        startIntro();
      }
    };
    document.fonts.ready.then(go);
    setTimeout(go, 900);
  } else startIntro();
}

// ---------- events from the TV ----------

on('media', (m) => {
  home.setMedia(m);
  look.setWaveState({ music: !!(m && m.active && m.playing) });
  if (layers.isOpen(ambient)) ambient.tick();
});

on('visible', (v) => {
  visible = !!v;
  look.setWaveState({ visible });
  if (visible) {
    refreshInfo();
    settings.refresh();
    home.setNet(tv.network());
    home.tick();
    resetIdle();
  } else {
    clearTimeout(idleTimer);
    if (layers.isOpen(ambient)) layers.pop(ambient);
  }
});

on('key', (k) => {
  if (skipIntro) {
    skipIntro();
    return;
  }
  if (layers.isOpen(ambient)) {
    layers.pop(ambient);
    resetIdle();
    return;
  }
  resetIdle();
  if (k === 'back') back();
  else if (k === 'menu') menuKey();
  else if (k === 'home') goHome();
});

onChange((patch) => {
  const keys = Object.keys(patch);
  const has = (...ks) => ks.some((k) => keys.indexOf(k) >= 0);
  if (has('bg', 'palette', 'style', 'fx', 'tint')) look.apply();
  if (has('tint') && !S.tint) look.tint(null);
  if (has('hear')) tv.visualizer(S.hear);
  if (has('guard')) tv.setGuard(S.guard);
  if (has('favs', 'hidden', 'tools')) home.render(true);
  if (has('np')) home.setMedia(home.media());
  if (has('clockSec')) home.tick();
  if (has('weather')) weather.start((w) => home.setWeather(w));
  if (has('saver')) resetIdle();
});

// ---------- the remote ----------

const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', ' ': 'ok' };
const CODES = { 38: 'up', 40: 'down', 37: 'left', 39: 'right', 13: 'ok', 23: 'ok', 66: 'ok' };
const keyOf = (e) => KEYS[e.key] || CODES[e.keyCode] || null;

let okAt = 0;
let okRepeats = 0;
let longDone = false;
let lastMove = 0;
let moving = null; // a favourite being moved: its package

document.addEventListener(
  'keydown',
  (e) => {
    const k = keyOf(e);
    if (skipIntro) {
      e.preventDefault();
      skipIntro();
      return;
    }
    if (layers.isOpen(ambient)) {
      e.preventDefault();
      layers.pop(ambient);
      resetIdle();
      return;
    }
    resetIdle();
    if (!k) return;
    e.preventDefault();
    if (k === 'ok') {
      if (!e.repeat || !okAt) {
        okAt = performance.now();
        okRepeats = 0;
        longDone = false;
      } else {
        okRepeats++;
        // a remote repeats a held key only after ~0.4 s: a few repeats are a long press
        if (!longDone && (performance.now() - okAt > 600 || okRepeats >= 4)) {
          longDone = true;
          long();
        }
      }
      return;
    }
    const now = performance.now();
    if (e.repeat && now - lastMove < 95) return;
    lastMove = now;
    if (moving) return moveKey(k);
    const t = layers.top();
    if (t && t.key && t.key(k)) return;
    nav.move(k);
  },
  true
);

document.addEventListener(
  'keyup',
  (e) => {
    if (keyOf(e) !== 'ok' || !okAt) return;
    e.preventDefault();
    const held = performance.now() - okAt;
    okAt = 0;
    if (longDone) return;
    // some remotes send no repeats: a long hold is still a long press
    if (held > 650) long();
    else ok();
  },
  true
);

const label = (c) => (c ? (c._app ? c._app.label : c._tool || c._act || (c._item && (c._item.key || c._item.act)) || c.className) : '—');

function ok() {
  const c = nav.current();
  tv.log('OK: ' + label(c) + (layers.top() ? ' (поверх: ' + layers.top().el.id + ')' : ''));
  if (moving) return endMove();
  const t = layers.top();
  if (t) return t.ok && t.ok(c);
  if (!c) return;
  if (c._app) return launch(c._app, c);
  tool(c._tool, c);
}

function long() {
  const c = nav.current();
  if (!c || !c._app || moving) return;
  const t = layers.top();
  if (t && t !== grid) return;
  menu.open(c._app, c);
}

function back() {
  tv.log('Назад' + (layers.top() ? ' (закрываю ' + layers.top().el.id + ')' : ''));
  if (moving) return endMove();
  const t = layers.top();
  if (t) return t.back ? t.back() : layers.pop(t);
  home.toTop();
}

function menuKey() {
  const c = nav.current();
  const t = layers.top();
  if (c && c._app && (!t || t === grid)) menu.open(c._app, c);
  else if (!t) openSettings();
}

function goHome() {
  if (moving) endMove();
  layers.closeAll();
  home.toTop();
}

function openSettings(focusKey) {
  refreshInfo();
  settings.open('main', focusKey);
}

function tool(id) {
  const m = home.media();
  switch (id) {
    case 'allApps':
      grid.open();
      break;
    case 'saver':
      ambient.open();
      break;
    case 'settings':
      openSettings();
      break;
    case 'tvSettings':
      if (!tv.openSettings()) toast('Эта приставка не открывает свои настройки отсюда');
      break;
    case 'stock':
      if (!tv.openStockHome(5)) toast('Не получилось открыть экран приставки');
      break;
    case 'npOpen':
      if (m.app) tv.launch(m.app);
      break;
    case 'npPrev':
      tv.media('prev');
      break;
    case 'npNext':
      tv.media('next');
      break;
    case 'npToggle':
      tv.media('toggle');
      home.setMedia({ ...m, playing: !m.playing });
      break;
    default:
      break;
  }
}

settings.onAct = (act) => {
  if (act === 'saverNow') {
    layers.pop(settings);
    ambient.open();
  } else if (act === 'tvSettings') tool('tvSettings');
  else if (act === 'stock') tool('stock');
  else if (act === 'reload') location.reload();
  else if (act === 'mic') {
    if (!tv.requestMic()) toast('Эта приставка не спрашивает разрешения — его даст установщик с компьютера');
  } else if (act === 'notif') {
    if (!tv.openNotificationAccess()) toast('На этой приставке нет такой настройки — её включит установщик с компьютера');
  } else if (act === 'guardOn') {
    if (!tv.openAccessibility()) toast('На этой приставке нет специальных возможностей — их включит установщик с компьютера');
  } else if (act === 'homeApp') {
    if (!tv.openHomeSettings()) toast('Эта приставка не даёт выбрать главный экран — помогут служба «Домой» или установщик');
  }
};

// back from the system's question or settings: show what changed
on('perm', () => {
  refreshInfo();
  settings.refresh();
});

// ---------- moving a favourite ----------

menu.onMove = (app) => {
  moving = app.pkg;
  markMoving();
  toast('Стрелками влево и вправо, потом OK');
};

function markMoving() {
  for (const c of document.querySelectorAll('.card.moving')) c.classList.remove('moving');
  const c = nav.current();
  if (moving && c && c._app && c._app.pkg === moving) c.classList.add('moving');
}

function moveKey(k) {
  if (k !== 'left' && k !== 'right') return;
  if (apps.moveFav(moving, k === 'right' ? 1 : -1)) {
    // the row was built again with the card in its new place
    const c = Array.prototype.find.call(document.querySelectorAll('[data-row="favs"] .card'), (x) => x._app && x._app.pkg === moving);
    if (c) nav.focus(c);
    markMoving();
  } else nav.bump(k);
}

function endMove() {
  moving = null;
  markMoving();
  toast('Готово');
}

// ---------- the screen saver comes after a while without keys ----------

let idleTimer = 0;
function resetIdle() {
  clearTimeout(idleTimer);
  if (!visible || !(S.saver > 0) || skipIntro) return;
  idleTimer = setTimeout(() => {
    if (!visible || layers.isOpen(ambient) || moving) return;
    layers.closeAll();
    ambient.open();
  }, S.saver * 60000);
}

boot();
