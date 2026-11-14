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
  // the keyboard: the Android side ends the page at its top, and the bar under it is hidden
  root.style.setProperty('--b', (i.ime > 0 ? 0 : i.b || 0) + 'px');
  root.style.setProperty('--l', (i.l || 0) + 'px');
  root.style.setProperty('--r', (i.r || 0) + 'px');
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
        pages.scrollLeft = 0;
        markDot();
      }
    },
    animate ? 440 : 0,
  );
  if (!open) q.blur();
}
function openDrawer(withKeyboard) {
  settle(true);
  if (withKeyboard) q.focus();
}
const closeDrawer = (animate = true) => drawerOpen && settle(false, animate);

// pages of 4 × N in А…Я, A…Z order, turned sideways — the phone's own "А–Я" layout
const pages = $('#pages');
const dots = $('#dots');
let grid0 = '';
function layout() {
  const cols = window.innerWidth >= 600 ? 6 : 4;
  const h = pages.clientHeight || H() * 0.72;
  const rows = clamp(Math.floor(h / 118), 3, 6);
  return { cols, rows };
}
function renderDrawer() {
  const { cols, rows } = layout();
  grid0 = cols + 'x' + rows;
  const per = cols * rows;
  const list = apps.all();
  const w = Math.max(1, pages.clientWidth);
  const was = Math.round(pages.scrollLeft / w);
  const n = Math.max(1, Math.ceil(list.length / per));
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const pg = document.createElement('div');
    pg.className = 'page apps';
    pg.style.setProperty('--cols', cols);
    pg.style.setProperty('--rows', rows);
    for (const a of list.slice(i * per, (i + 1) * per)) pg.appendChild(icon(a, 'drawer'));
    frag.appendChild(pg);
  }
  pages.innerHTML = '';
  pages.appendChild(frag);
  dots.innerHTML = n > 1 ? '<i></i>'.repeat(n) : '';
  pages.scrollLeft = Math.min(was, n - 1) * w;
  markDot();
}
function markDot() {
  const i = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
  [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
}
let dotT = 0;
pages.addEventListener(
  'scroll',
  () => {
    if (!dotT) dotT = setTimeout(() => ((dotT = 0), markDot()), 50);
  },
  { passive: true },
);
// a turn of the phone changes the pages; the keyboard (the page shrinks while
// typing) does not — the pages are hidden then anyway
const relayout = () => {
  if (document.activeElement === q) return;
  const { cols, rows } = layout();
  if (cols + 'x' + rows !== grid0) renderDrawer();
};
window.addEventListener('resize', relayout);

// typing: the pages give way to the results, the field sits on the keyboard
q.addEventListener('focus', () => drawer.classList.add('typing'));
q.addEventListener('blur', () => {
  drawer.classList.remove('typing');
  setTimeout(relayout, 350);
});

// the part of a name that matched, in bold (as the phone's own search does)
function mark(el, a, text) {
  const qn = apps.norm(text);
  const label = a.label.trim();
  const i = a.key.indexOf(qn);
  if (i < 0 || !qn) return;
  const lb = el.querySelector('.lb');
  lb.textContent = '';
  const b = document.createElement('b');
  b.textContent = label.slice(i, i + qn.length);
  lb.append(label.slice(0, i), b, label.slice(i + qn.length));
}

function renderSearch() {
  const text = q.value.trim();
  $('#q-x').hidden = !q.value;
  drawer.classList.toggle('searching', !!text);
  const found = $('#d-found');
  const web = $('#d-web');
  found.innerHTML = '';
  web.innerHTML = '';
  if (!text) return;
  for (const a of apps.search(text).slice(0, 24)) {
    const el = icon(a, 'drawer');
    mark(el, a, text);
    found.appendChild(el);
  }
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
  $('#d-results').scrollTop = 0;
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
$('#d-more').addEventListener('click', (e) => {
  e.preventDefault();
  q.blur();
  openSheet();
});

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
    if (g.mode === 'drawer') drawer.classList.add('open');
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

// the drawer under the finger: pulled down, it goes; sideways, the pages turn
// (the browser does that); a tap opens an app; a long press opens its menu,
// and moved, takes the icon to the home screen
{
  let d = null;
  const area = $('#d-body');
  area.addEventListener('pointerdown', (e) => {
    if (d || e.button > 0) return;
    const item = e.target.closest('.app');
    d = { ...track(e), id: e.pointerId, item, mode: null };
    if (item) item.classList.add('down');
    d.timer = setTimeout(() => {
      if (!d || d.mode || !item) return;
      d.mode = 'long';
      item.classList.remove('down');
      cap(area, d.id);
      q.blur();
      openMenu(item, 'drawer', () => renderHome(false));
    }, LONG);
  });
  area.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    step(d, e.clientX, e.clientY);
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const far = Math.hypot(dx, dy) > SLOP;
    if (d.mode === 'drag') return dragMove(e.clientX, e.clientY);
    if (d.mode === 'long') {
      if (far && d.item && menu.open) {
        d.mode = 'drag';
        settle(false);
        dragStart(d.item.dataset.pkg, e.clientX, e.clientY, true);
      }
      return;
    }
    if (d.mode === 'pull') return setP(clamp(1 - (dy - SLOP) / span(), 0, 1));
    if (d.mode || !far) return;
    clearTimeout(d.timer);
    if (d.item) d.item.classList.remove('down');
    const searching = drawer.classList.contains('searching');
    if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && (!searching || $('#d-results').scrollTop <= 0)) {
      d.mode = 'pull';
      cap(area, d.id);
      q.blur();
    } else d.mode = 'scroll';
  });
  // a held icon keeps the pages still, and so does pulling the drawer down
  area.addEventListener(
    'touchmove',
    (e) => {
      if (d && (d.mode === 'long' || d.mode === 'drag' || d.mode === 'pull')) e.preventDefault();
    },
    { passive: false },
  );
  const up = (e, cancelled) => {
    if (!d || e.pointerId !== d.id) return;
    const x = d;
    d = null;
    clearTimeout(x.timer);
    if (x.item) x.item.classList.remove('down');
    if (x.mode === 'pull') return release(speedY(x));
    if (x.mode === 'drag') return dragEnd(cancelled);
    if (x.mode || cancelled) return;
    if (x.item) launch(x.item);
    else q.blur();
  };
  area.addEventListener('pointerup', (e) => up(e, false));
  area.addEventListener('pointercancel', (e) => up(e, true));
  $('#d-results').addEventListener('scroll', () => q.blur(), { passive: true });
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
