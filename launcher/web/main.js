// Резонанс Лаунчер: the home screen (clock, what's playing, the person's apps,
// the dock), the drawer with every app and the search, and the touch: a swipe
// up opens the drawer under the finger, a swipe down pulls the notification
// shade, a long press opens an icon's menu (and, moved, drags the icon), a long
// press on an empty place opens the settings.

import { rez, on, native } from './bridge.js';
import { S, save } from './store.js';
import * as apps from './apps.js';
import * as look from './look.js';
import { $, icon, launch, toast, ghost, lift, drop, menu, openMenu, closeMenu, openSheet, closeSheet, isSheet, setBadges, ICONS } from './ui.js';
import './graph.js';

const body = document.body;
const root = document.documentElement;
const home = $('#home');
const drawer = $('#drawer');
const grid = $('#grid');
const dock = $('#dock');
const scroller = $('#d-scroll');
const q = $('#q');

const H = () => window.innerHeight;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LONG = 420;
const cap = (el, id) => {
  try {
    el.setPointerCapture(id);
  } catch {}
};
const SLOP = 10;

// ---------- the bars, the keyboard ----------

function insets(i) {
  if (!i) return;
  root.style.setProperty('--t', (i.t || 0) + 'px');
  root.style.setProperty('--b', (i.b || 0) + 'px');
  root.style.setProperty('--l', (i.l || 0) + 'px');
  root.style.setProperty('--r', (i.r || 0) + 'px');
  root.style.setProperty('--ime', Math.max(0, (i.ime || 0) - (i.b || 0)) + 'px');
}
on('insets', insets);

// ---------- clock, date, battery ----------

const fmtDay = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
let clockT = 0;
function clock() {
  const d = new Date();
  $('#time').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('#day').textContent = fmtDay.format(d);
  const b = rez.battery();
  const bt = $('#batt');
  bt.textContent = b.level >= 0 ? b.level + '%' : '';
  bt.classList.toggle('low', b.level >= 0 && b.level <= 15 && !b.charging);
  bt.classList.toggle('charging', !!b.charging);
  clearTimeout(clockT);
  clockT = setTimeout(clock, 60000 - (Date.now() % 60000) + 30);
}

const findApp = (re) => apps.all().find((a) => re.test(a.pkg));

// ---------- what's playing ----------

let media = { active: false };
let mediaAt = 0;
let barT = 0;
function setMedia(m) {
  media = m || { active: false };
  mediaAt = performance.now();
  const np = $('#np');
  const show = !!media.active && !!(media.title || media.artist);
  np.hidden = !show;
  look.set({ music: show && !!media.playing });
  if (!show) return;
  $('#np-title').textContent = media.title || media.appLabel || '';
  $('#np-artist').textContent = media.artist || media.appLabel || '';
  const art = $('#np-art');
  const src = media.art ? rez.artUrl(media.art) : rez.iconUrl(media.app);
  if (art.dataset.src !== src) {
    art.dataset.src = src;
    art.src = src;
  }
  np.classList.toggle('paused', !media.playing);
  $('.np-play').setAttribute('aria-label', media.playing ? 'Пауза' : 'Играть');
  bar();
}
function bar() {
  clearTimeout(barT);
  const i = $('#np-bar i');
  if (!media.active || !media.dur) return (i.style.transform = 'scaleX(0)');
  const pos = media.pos + (media.playing ? performance.now() - mediaAt : 0);
  i.style.transform = `scaleX(${clamp(pos / media.dur, 0, 1).toFixed(4)})`;
  if (media.playing && !document.hidden) barT = setTimeout(bar, 1000);
}
on('media', setMedia);
for (const b of document.querySelectorAll('.np-b')) {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    rez.haptic('tick');
    const a = b.dataset.a;
    rez.media(a);
    if (a === 'toggle') setMedia({ ...media, playing: !media.playing, pos: media.pos + (media.playing ? performance.now() - mediaAt : 0) });
  });
}

// ---------- the home screen ----------

const homeEls = new Map(); // pkg -> element on the home screen or the dock

function homeEl(pkg, where) {
  let el = homeEls.get(pkg);
  const a = apps.get(pkg);
  if (!a) return null;
  if (!el) {
    el = icon(a, where);
    homeEls.set(pkg, el);
  }
  el.dataset.where = where;
  return el;
}

// draws the grid and the dock; icons that only moved glide to their new place
function renderHome(animate) {
  const before = new Map();
  if (animate) for (const [p, el] of homeEls) if (el.isConnected) before.set(p, el.getBoundingClientRect());
  const fill = (box, list, where) => {
    const els = list.map((p) => homeEl(p, where)).filter(Boolean);
    els.forEach((el, i) => {
      if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
    });
    while (box.children.length > els.length) box.lastChild.remove();
  };
  fill(grid, S.home || [], 'home');
  fill(dock, S.dock || [], 'dock');
  dock.style.setProperty('--cols', Math.max(4, (S.dock || []).length));
  const keep = new Set([...(S.home || []), ...(S.dock || [])]);
  for (const p of [...homeEls.keys()]) if (!keep.has(p)) homeEls.delete(p);
  if (!animate) return;
  for (const [p, el] of homeEls) {
    const a = before.get(p);
    if (!a || !el.isConnected) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px,${dy}px)`;
    void el.offsetWidth;
    el.style.transition = 'transform 0.32s cubic-bezier(0.22, 0.8, 0.24, 1)';
    el.style.transform = '';
  }
}

// ---------- the drawer ----------

let p = 0; // 0 home … 1 drawer
let drawerOpen = false;
function setP(v) {
  p = v;
  const h = H();
  home.style.transform = p ? `translate3d(0,${(-p * h * 0.04).toFixed(1)}px,0) scale(${(1 - 0.06 * p).toFixed(4)})` : '';
  // a crossfade with little overlap: the home screen is gone before the drawer is fully there
  home.style.opacity = clamp(1 - p * 1.7, 0, 1).toFixed(3);
  drawer.style.transform = `translate3d(0,${((1 - p) * h * 0.4).toFixed(1)}px,0)`;
  drawer.style.opacity = clamp((p - 0.12) * 1.6, 0, 1).toFixed(3);
}
let settleT = 0;
function settle(open, animate = true) {
  drawerOpen = open;
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  clearTimeout(settleT);
  if (animate) {
    body.classList.add('anim');
    body.classList.toggle('opening', open);
    // the class must be on before the final values for the transition to run
    void home.offsetWidth;
  }
  setP(open ? 1 : 0);
  look.set({ covered: false });
  settleT = setTimeout(
    () => {
      body.classList.remove('anim');
      look.set({ covered: open });
      if (!open) {
        if (q.value) {
          q.value = '';
          renderSearch();
        }
        scroller.scrollTop = 0;
      }
    },
    animate ? 440 : 0,
  );
  if (!open) q.blur();
}
function openDrawer(withKeyboard) {
  if (!drawerOpen) renderFreq();
  settle(true);
  if (withKeyboard) q.focus();
}
const closeDrawer = (animate = true) => drawerOpen && settle(false, animate);

let letters = [];
function renderDrawer() {
  const all = $('#d-all');
  all.innerHTML = '';
  letters = [];
  const frag = document.createDocumentFragment();
  let last = '';
  for (const a of apps.all()) {
    const el = icon(a, 'drawer');
    const L = apps.letter(a);
    if (L !== last) {
      letters.push([L, el]);
      last = L;
    }
    frag.appendChild(el);
  }
  all.appendChild(frag);
  const rail = $('#rail');
  rail.innerHTML = letters.map(([L]) => `<b>${L}</b>`).join('');
  renderFreq();
}
function renderFreq() {
  const f = $('#d-freq');
  f.innerHTML = '';
  const list = apps.frequent(4);
  for (const a of list) f.appendChild(icon(a, 'drawer'));
  $('#d-freq-wrap').classList.toggle('has', list.length >= 2);
}

function renderSearch() {
  const text = q.value.trim();
  $('#q-x').hidden = !q.value;
  drawer.classList.toggle('searching', !!text);
  $('#d-all').hidden = !!text;
  $('#d-freq-wrap').hidden = !!text;
  const found = $('#d-found');
  const web = $('#d-web');
  found.hidden = !text;
  web.hidden = !text;
  if (!text) return;
  found.innerHTML = '';
  for (const a of apps.search(text).slice(0, 24)) found.appendChild(icon(a, 'drawer'));
  web.innerHTML = '';
  const row = (ic, title, sub, url) => {
    const b = document.createElement('button');
    b.className = 'webq glass';
    b.innerHTML = `<i>${ic}</i><div><b></b><span></span></div>`;
    b.querySelector('b').textContent = title;
    b.querySelector('span').textContent = sub;
    b.onclick = () => {
      rez.haptic('tick');
      rez.openUrl(url);
    };
    web.appendChild(b);
  };
  const enc = encodeURIComponent(text);
  row(ICONS.web, `«${text}»`, 'Найти в интернете', `https://yandex.ru/search/?text=${enc}`);
  row(ICONS.store, `«${text}»`, 'Найти в Google Play', `https://play.google.com/store/search?q=${enc}&c=apps`);
  scroller.scrollTop = 0;
}
q.addEventListener('input', renderSearch);
q.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = $('#d-found .app');
  if (first) launch(first);
  else if (q.value.trim()) $('#d-web .webq')?.click();
});
$('#q-x').addEventListener('click', () => {
  q.value = '';
  renderSearch();
  q.focus();
});

// the letters along the edge: slide a finger to jump
{
  const rail = $('#rail');
  const bubble = $('#rail-bubble');
  let lastL = '';
  const at = (y) => {
    const r = rail.getBoundingClientRect();
    const kids = rail.children;
    if (!kids.length) return;
    let i = 0;
    for (; i < kids.length - 1; i++) {
      const k = kids[i].getBoundingClientRect();
      if (y < k.bottom) break;
    }
    const [L, el] = letters[i];
    if (L === lastL) return;
    for (const k of kids) k.classList.remove('on');
    kids[i].classList.add('on');
    lastL = L;
    bubble.textContent = L;
    const k = kids[i].getBoundingClientRect();
    bubble.style.top = clamp(k.top + k.height / 2 - 32, r.top, r.bottom - 64) + 'px';
    bubble.classList.add('on');
    scroller.scrollTop = el.offsetTop - 16;
    rez.haptic('tick');
  };
  rail.addEventListener('pointerdown', (e) => {
    cap(rail, e.pointerId);
    q.blur();
    lastL = '';
    at(e.clientY);
  });
  rail.addEventListener('pointermove', (e) => rail.hasPointerCapture(e.pointerId) && at(e.clientY));
  const end = () => {
    bubble.classList.remove('on');
    for (const k of rail.children) k.classList.remove('on');
  };
  rail.addEventListener('pointerup', end);
  rail.addEventListener('pointercancel', end);
}

// ---------- touch ----------

// a finger's way: where it started, where it is, how fast it goes
function track(e) {
  return { x0: e.clientX, y0: e.clientY, t0: performance.now(), pts: [[e.clientX, e.clientY, performance.now()]] };
}
function step(t, x, y) {
  t.pts.push([x, y, performance.now()]);
  if (t.pts.length > 6) t.pts.shift();
}
function speedY(t) {
  const a = t.pts[0];
  const b = t.pts[t.pts.length - 1];
  const dt = b[2] - a[2];
  return dt > 0 ? (b[1] - a[1]) / dt : 0;
}

// drawer under the finger: up from home, down from the drawer
const span = () => H() * 0.42;
function release(v) {
  const open = v < -0.35 ? true : v > 0.35 ? false : p > 0.4;
  if (open && !drawerOpen) renderFreq();
  settle(open);
}

let g = null; // the current gesture on the home screen
home.addEventListener('pointerdown', (e) => {
  if (g || e.button > 0) return;
  if (e.target.closest('.np-b')) return;
  if (menu.open || isSheet()) return;
  cap(home, e.pointerId);
  const item = e.target.closest('.app');
  g = { ...track(e), id: e.pointerId, item, target: e.target, mode: null };
  if (item) item.classList.add('down');
  g.timer = setTimeout(() => {
    if (!g || g.mode) return;
    g.mode = 'long';
    if (item) {
      item.classList.remove('down');
      openMenu(item, item.dataset.where, () => renderHome(true));
    } else if (!e.target.closest('#np, #find, #top')) openSheet();
    else g.mode = 'none';
  }, LONG);
});
home.addEventListener('pointermove', (e) => {
  if (!g || e.pointerId !== g.id) return;
  step(g, e.clientX, e.clientY);
  const dx = e.clientX - g.x0;
  const dy = e.clientY - g.y0;
  const far = Math.hypot(dx, dy) > SLOP;
  if (g.mode === 'drag') return dragMove(e.clientX, e.clientY);
  if (g.mode === 'long') {
    if (far && g.item && menu.open) {
      g.mode = 'drag';
      dragStart(g.item.dataset.pkg, e.clientX, e.clientY);
    }
    return;
  }
  if (g.mode === 'drawer') return setP(clamp(-dy / span(), 0, 1));
  if (g.mode || !far) return;
  clearTimeout(g.timer);
  if (g.item) g.item.classList.remove('down');
  if (Math.abs(dy) > Math.abs(dx)) {
    g.mode = dy < 0 ? 'drawer' : 'shade';
    if (g.mode === 'drawer') {
      renderFreq();
      drawer.classList.add('open');
    }
  } else g.mode = 'none';
});
function homeUp(e, cancelled) {
  if (!g || e.pointerId !== g.id) return;
  const t = g;
  g = null;
  clearTimeout(t.timer);
  if (t.item) t.item.classList.remove('down');
  const dy = e.clientY - t.y0;
  if (t.mode === 'drawer') return release(speedY(t));
  if (t.mode === 'shade') {
    if (!cancelled && dy > 50) rez.notifications();
    return;
  }
  if (t.mode === 'drag') return dragEnd(cancelled);
  if (t.mode || cancelled) return;
  // a tap
  if (t.item) return launch(t.item);
  const el = t.target;
  if (el.closest('#clock')) {
    const a = findApp(/deskclock|\.clock$|clock/);
    if (a) rez.launch(a.pkg);
  } else if (el.closest('#date')) {
    const a = findApp(/calendar/);
    if (a) rez.launch(a.pkg);
  } else if (el.closest('#find')) {
    rez.haptic('tick');
    openDrawer(true);
  } else if (el.closest('#np') && media.app) rez.launch(media.app);
}
home.addEventListener('pointerup', (e) => homeUp(e, false));
home.addEventListener('pointercancel', (e) => homeUp(e, true));

// the drawer's head: pulled down, the drawer goes
{
  const head = $('#d-head');
  let t = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#q-wrap')) return;
    cap(head, e.pointerId);
    t = track(e);
  });
  head.addEventListener('pointermove', (e) => {
    if (!t) return;
    step(t, e.clientX, e.clientY);
    const dy = e.clientY - t.y0;
    if (dy > SLOP || t.moved) {
      if (!t.moved) q.blur();
      t.moved = true;
      setP(clamp(1 - dy / span(), 0, 1));
    }
  });
  const up = () => {
    if (t && t.moved) release(speedY(t));
    t = null;
  };
  head.addEventListener('pointerup', up);
  head.addEventListener('pointercancel', up);
}

// the drawer's list: scrolls by itself; pulled down at the top, the drawer goes;
// a tap opens an app; a long press opens its menu, and moved, takes it home
{
  let t = null;
  scroller.addEventListener('touchstart', (e) => {
    const k = e.touches[0];
    t = { x0: k.clientX, y0: k.clientY, top: scroller.scrollTop <= 0, pull: false, pts: [[k.clientX, k.clientY, performance.now()]] };
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (!t) return;
    const k = e.touches[0];
    step(t, k.clientX, k.clientY);
    const dy = k.clientY - t.y0;
    if (d && d.long) return e.preventDefault(); // a long press holds the list still
    if (!t.pull && t.top && scroller.scrollTop <= 0 && dy > SLOP && Math.abs(dy) > Math.abs(k.clientX - t.x0)) {
      t.pull = true;
      q.blur();
      cancelPress();
    }
    if (t.pull) {
      e.preventDefault();
      setP(clamp(1 - (dy - SLOP) / span(), 0, 1));
    }
  }, { passive: false });
  const end = () => {
    if (t && t.pull) release(speedY(t));
    t = null;
  };
  scroller.addEventListener('touchend', end);
  scroller.addEventListener('touchcancel', end);
  scroller.addEventListener('scroll', () => q === document.activeElement && Math.abs(scroller.scrollTop) > 40 && q.blur(), { passive: true });

  let d = null;
  const cancelPress = () => {
    if (!d) return;
    clearTimeout(d.timer);
    d.item.classList.remove('down');
    if (!d.long) d = null;
  };
  scroller.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.app');
    if (!item || d) return;
    d = { item, x0: e.clientX, y0: e.clientY, id: e.pointerId, long: false };
    item.classList.add('down');
    d.timer = setTimeout(() => {
      if (!d) return;
      d.long = true;
      item.classList.remove('down');
      cap(scroller, d.id);
      q.blur();
      openMenu(item, 'drawer', () => renderHome(false));
    }, LONG);
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > SLOP;
    if (d.drag) return dragMove(e.clientX, e.clientY);
    if (d.long && far && menu.open) {
      d.drag = true;
      settle(false);
      dragStart(d.item.dataset.pkg, e.clientX, e.clientY, true);
    } else if (!d.long && far) cancelPress();
  });
  const up = (e, cancelled) => {
    if (!d || e.pointerId !== d.id) return;
    const x = d;
    d = null;
    clearTimeout(x.timer);
    x.item.classList.remove('down');
    if (x.drag) return dragEnd(cancelled);
    if (!x.long && !cancelled) launch(x.item);
  };
  scroller.addEventListener('pointerup', (e) => up(e, false));
  scroller.addEventListener('pointercancel', (e) => up(e, true));
}

$('#scrim').addEventListener('pointerdown', () => {
  closeMenu();
  closeSheet();
});

// ---------- dragging an icon ----------

let dr = null;
const trash = $('#trash');
function dragStart(pkg, x, y, fromDrawer) {
  if (!ghost) return;
  closeMenu(true);
  rez.haptic('context');
  ghost.g.classList.add('drag');
  dr = { pkg, fromDrawer, w: ghost.r.width, h: ghost.r.height, hot: false, last: 0 };
  if (fromDrawer && !(S.home || []).includes(pkg) && !(S.dock || []).includes(pkg)) {
    dr.added = true;
    if (S.home.length >= 20) {
      toast('На главном экране нет места');
      dr.full = true;
    } else {
      S.home = [...S.home, pkg];
      renderHome(false);
    }
  }
  const el = homeEls.get(pkg);
  if (el) el.classList.add('hole', 'lift');
  if (!fromDrawer) trash.classList.add('on');
  dragMove(x, y);
}

function dragMove(x, y) {
  if (!dr || !ghost) return;
  ghost.g.style.transform = `translate3d(${x - dr.w / 2}px,${y - dr.h * 0.75}px,0) scale(1.12)`;
  // over the "remove" pill
  const tr = trash.getBoundingClientRect();
  const hot = trash.classList.contains('on') && y < tr.bottom + 24;
  if (hot !== dr.hot) {
    dr.hot = hot;
    trash.classList.toggle('hot', hot);
    if (hot) rez.haptic('tick');
  }
  if (hot || dr.full) return;
  const now = performance.now();
  if (now - dr.last < 90) return;
  // the nearest place in the grid or the dock
  const dk = dock.getBoundingClientRect();
  const inDock = y > dk.top - 12;
  const box = inDock ? dock : grid;
  const list = inDock ? S.dock : S.home;
  const from = S.home.includes(dr.pkg) ? 'home' : 'dock';
  let best = -1;
  let bd = 1e9;
  [...box.children].forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const dd = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  });
  const to = inDock ? 'dock' : 'home';
  if (best >= 0) {
    const r = box.children[best].getBoundingClientRect();
    if (x > r.right && best === box.children.length - 1 && to !== from) best++;
  } else best = 0;
  const cur = list.indexOf(dr.pkg);
  if (to === from && (best === cur || best < 0)) return;
  if (to === 'dock' && from !== 'dock' && S.dock.length >= 5) return;
  dr.last = now;
  const home2 = S.home.filter((p) => p !== dr.pkg);
  const dock2 = S.dock.filter((p) => p !== dr.pkg);
  (to === 'dock' ? dock2 : home2).splice(Math.min(best, (to === 'dock' ? dock2 : home2).length), 0, dr.pkg);
  S.home = home2;
  S.dock = dock2;
  renderHome(true);
  const el = homeEls.get(dr.pkg);
  if (el) el.classList.add('hole', 'lift');
  ghost.el = el || ghost.el;
  rez.haptic('tick');
}

function dragEnd() {
  if (!dr) return;
  const x = dr;
  dr = null;
  trash.classList.remove('on', 'hot');
  if (x.hot) {
    S.home = S.home.filter((p) => p !== x.pkg);
    S.dock = S.dock.filter((p) => p !== x.pkg);
    if (ghost) {
      ghost.g.style.transition = 'transform 0.25s, opacity 0.25s';
      ghost.g.style.opacity = '0';
      const g0 = ghost.g;
      setTimeout(() => g0.remove(), 260);
    }
    drop(true);
    renderHome(true);
    toast(`${apps.get(x.pkg)?.label || 'Значок'} — убран с экрана`);
  } else {
    const el = homeEls.get(x.pkg);
    if (el && ghost) ghost.el = el;
    drop();
  }
  save({ home: S.home, dock: S.dock });
}

// ---------- the keys, the screen coming and going ----------

on('key', (k) => {
  if (dr) return;
  if (menu.open) return closeMenu();
  if (isSheet()) return closeSheet();
  if (k === 'back') {
    if (drawerOpen) closeDrawer();
    return;
  }
  if (k === 'home') {
    if (drawerOpen) closeDrawer();
  }
});

function setVisible(v) {
  look.set({ visible: v });
  if (v) {
    clock();
    setMedia(rez.mediaState());
    setBadges(rez.badges());
  } else {
    // coming back, the person finds the home screen, not the drawer they left
    closeMenu();
    drop(true);
    closeSheet();
    closeDrawer(false);
    clearTimeout(barT);
  }
}
on('visible', setVisible);
document.addEventListener('visibilitychange', () => setVisible(!document.hidden));
on('badges', (b) => setBadges(typeof b === 'string' ? JSON.parse(b) : b));
on('perm', () => {
  look.apply();
});
window.addEventListener('resize', () => setP(p));
// a computer's keyboard (the preview, a tablet with keys): Esc is Back
window.addEventListener('keydown', (e) => e.key === 'Escape' && window.__rezEmit('key', 'back'));

// ---------- start ----------

const info = rez.info();
insets(info.insets);
look.setYou(info.you);
look.apply();
apps.onApps(() => {
  renderHome(false);
  renderDrawer();
});
apps.reload();
setP(0);
clock();
setMedia(rez.mediaState());
setBadges(rez.badges());
if (!native) body.classList.add('preview');
// shown once the fonts are in (a moment at most), so nothing appears in a stand-in font
const show = () => body.classList.add('ready');
Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 900))]).then(show);
