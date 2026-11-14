// Резонанс Лаунчер: the home screen (pages of apps and widgets, the dock), the
// drawer with every app and the search, and the touch: a swipe up opens the
// drawer under the finger, a swipe down pulls the notification shade, sideways
// turns the pages, a long press opens an icon's or a widget's menu (and, moved,
// drags it — to another page at the screen's side), a long press on an empty
// place opens the settings.

import { rez, on, native } from './bridge.js';
import { S, save } from './store.js';
import * as apps from './apps.js';
import * as look from './look.js';
import { $, icon, launch, toast, ghost, drop, menu, openMenu, closeMenu, openSheet, closeSheet, isSheet, setBadges, ICONS, homeHooks } from './ui.js';
import * as W from './widgets.js';
import './graph.js';

const body = document.body;
const root = document.documentElement;
const home = $('#home');
const drawer = $('#drawer');
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

// ---------- the home screen: pages of apps and widgets, and the dock ----------

const hpages = $('#hpages');
const hdots = $('#hdots');
const homeEls = new Map(); // key (a package, or "#kind:n" for a widget) -> its element

// the first time: what used to be the one home screen becomes the first page,
// with the clock and what's playing on top
function migrate() {
  if (Array.isArray(S.pages) && S.pages.length) return;
  S.pages = [['#clock:1', '#music:1', ...(S.home || [])]];
  save({ pages: S.pages });
}
const valid = (k) => (W.isWidget(k) ? !!W.KINDS[W.kindOf(k)] : !!apps.get(k));
const pageOf = (k) => S.pages.findIndex((pg) => pg.includes(k));
const onHome = (k) => pageOf(k) >= 0 || S.dock.includes(k);
const cur = () => clamp(Math.round(hpages.scrollLeft / Math.max(1, hpages.clientWidth)), 0, S.pages.length - 1);
function goPage(i, smooth) {
  const left = i * hpages.clientWidth;
  if (smooth) hpages.scrollTo({ left, behavior: 'smooth' });
  else hpages.scrollLeft = left;
}

function homeEl(key, where) {
  let el = homeEls.get(key);
  if (!el) {
    if (W.isWidget(key)) el = W.make(key);
    else {
      const a = apps.get(key);
      if (!a) return null;
      el = icon(a, where);
    }
    homeEls.set(key, el);
  }
  el.dataset.where = where;
  return el;
}

// rows of a page: as many as fit comfortably; the cells share the height evenly
let rows = 5;
function measure() {
  const h = hpages.clientHeight || H() * 0.6;
  rows = clamp(Math.round(h / 124), 3, 7);
  hpages.style.setProperty('--rows', rows);
}

function fill(box, list, where) {
  const els = list.map((k) => homeEl(k, where)).filter(Boolean);
  els.forEach((el, i) => {
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
  while (box.children.length > els.length) box.lastChild.remove();
}
function fillAll() {
  while (hpages.children.length < S.pages.length) {
    const pg = document.createElement('div');
    pg.className = 'hpage';
    hpages.appendChild(pg);
  }
  while (hpages.children.length > S.pages.length) hpages.lastChild.remove();
  S.pages.forEach((list, i) => fill(hpages.children[i], list, 'home'));
  fill(dock, S.dock, 'dock');
}

// a page that ran over (a bigger widget, one more icon) gives its last items to the next page
function overflow() {
  let moved = false;
  for (let i = 0; i < S.pages.length; i++) {
    const box = hpages.children[i];
    if (!box) break;
    const limit = box.clientHeight + 4;
    const last = box.lastElementChild;
    if (S.pages[i].length > 1 && last && last.offsetTop + last.offsetHeight > limit) {
      const k = S.pages[i].pop();
      if (!S.pages[i + 1]) S.pages.push([]);
      S.pages[i + 1].unshift(k);
      moved = true;
    }
  }
  return moved;
}

// draws the pages and the dock; what only moved glides to its new place
function renderHome(animate) {
  const before = new Map();
  if (animate) for (const [k, el] of homeEls) if (el.isConnected) before.set(k, el.getBoundingClientRect());
  fillAll();
  for (let n = 0; n < 30 && overflow(); n++) fillAll();
  dock.style.setProperty('--cols', Math.max(4, S.dock.length));
  const keep = new Set([...S.pages.flat(), ...S.dock]);
  for (const k of [...homeEls.keys()]) if (!keep.has(k)) homeEls.delete(k);
  hdots.innerHTML = S.pages.length > 1 ? '<i></i>'.repeat(S.pages.length) : '';
  markHomeDot();
  W.weatherWatch();
  if (!animate) return;
  for (const [k, el] of homeEls) {
    const a = before.get(k);
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
const saveHome = () => save({ pages: S.pages, dock: S.dock });

function markHomeDot() {
  const i = cur();
  [...hdots.children].forEach((d, k) => d.classList.toggle('on', k === i));
}
let hdotT = 0;
hpages.addEventListener(
  'scroll',
  () => {
    if (!hdotT) hdotT = setTimeout(() => ((hdotT = 0), markHomeDot()), 50);
  },
  { passive: true },
);

// empty pages go (the first one stays), except the one being looked at
function prune(keep) {
  const was = cur();
  let before = 0;
  for (let i = S.pages.length - 1; i > 0; i--) {
    if (!S.pages[i].length && i !== keep) {
      S.pages.splice(i, 1);
      if (i < was) before++;
    }
  }
  if (!before && hpages.children.length === S.pages.length) return;
  renderHome(false);
  goPage(Math.max(0, was - before), false);
  saveHome();
}

function removeKey(k) {
  S.pages = S.pages.map((pg) => pg.filter((x) => x !== k));
  S.dock = S.dock.filter((x) => x !== k);
  renderHome(true);
  saveHome();
}
function addKey(k, atStart) {
  const pg = S.pages[cur()] || S.pages[0];
  if (atStart) pg.unshift(k);
  else pg.push(k);
  renderHome(true);
  saveHome();
}

const appMenu = (pkg) => ({
  onHome: onHome(pkg),
  remove: () => removeKey(pkg),
  pin: () => {
    addKey(pkg);
    toast(`${apps.get(pkg)?.label || 'Значок'} — на главном экране`);
  },
});
const widgetMenu = (el) => {
  const key = el.dataset.key;
  return {
    widget: true,
    sizes: W.KINDS[W.kindOf(key)].sizes,
    size: W.sizeName(key),
    resize: (s) => {
      W.resize(el, s);
      renderHome(true);
      saveHome();
    },
    remove: () => removeKey(key),
  };
};
// a new widget goes after what is on the page being looked at; when it does not
// fit there, it gets a page of its own right after it (the icons stay where they are)
homeHooks.addWidget = (kind) => {
  const key = W.newKey(kind, S.pages);
  const c = cur();
  const before = S.pages.map((pg) => pg.slice());
  S.pages[c].push(key);
  renderHome(false);
  if (pageOf(key) !== c) {
    S.pages = before;
    S.pages.splice(c + 1, 0, [key]);
    renderHome(false);
    goPage(c + 1, true);
  }
  const el = homeEls.get(key);
  if (el) el.classList.add('new');
  saveHome();
  toast(`«${W.KINDS[kind].name}» — на экране. Подержи, чтобы сменить размер`);
};
homeHooks.newPage = () => {
  S.pages.push([]);
  renderHome(false);
  goPage(S.pages.length - 1, true);
  saveHome();
  toast('Новая страница: перетащи сюда значки или добавь виджет');
};

// a music widget's buttons
hpages.addEventListener('click', (e) => {
  const b = e.target.closest('.np-b');
  if (!b) return;
  e.stopPropagation();
  W.musicButton(b);
});
on('media', (m) => {
  W.setMedia(m);
  look.set({ music: W.playing() });
});

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
  const item = e.target.closest('.app, .wd');
  g = { ...track(e), id: e.pointerId, item, target: e.target, mode: null };
  if (item) item.classList.add('down');
  g.timer = setTimeout(() => {
    if (!g || g.mode) return;
    g.mode = 'long';
    if (item) {
      item.classList.remove('down');
      openMenu(item, item.dataset.key ? widgetMenu(item) : appMenu(item.dataset.pkg));
    } else if (!e.target.closest('#find')) openSheet();
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
      dragStart(g.item.dataset.pkg || g.item.dataset.key, e.clientX, e.clientY);
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
  } else g.mode = 'pages'; // sideways: the browser turns the pages
});
// a held icon keeps the pages still; so does the drawer coming up
home.addEventListener(
  'touchmove',
  (e) => {
    if (g && g.mode && g.mode !== 'pages') e.preventDefault();
  },
  { passive: false },
);
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
  if (t.item && t.item.dataset.key) return W.tap(t.item, t.target);
  if (t.item) return launch(t.item);
  if (t.target.closest('#find')) {
    rez.haptic('tick');
    openDrawer(true);
  }
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
      openMenu(item, appMenu(item.dataset.pkg));
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

// ---------- dragging an icon or a widget ----------

let dr = null;
const trash = $('#trash');
const where = (k) => (S.dock.includes(k) ? 'dock' : pageOf(k));
function holeOn() {
  const el = homeEls.get(dr.key);
  if (el) el.classList.add('hole', 'lift');
  if (el && ghost) ghost.el = el;
}
function dragStart(key, x, y, fromDrawer) {
  if (!ghost) return;
  closeMenu(true);
  rez.haptic('context');
  ghost.g.classList.add('drag');
  dr = { key, fromDrawer, wid: W.isWidget(key), w: ghost.r.width, h: ghost.r.height, gx: x - ghost.r.left, gy: y - ghost.r.top, hot: false, armed: false, last: 0, edgeAt: 0 };
  if (fromDrawer && !onHome(key)) {
    S.pages[cur()].push(key);
    renderHome(false);
  }
  holeOn();
  if (!fromDrawer) trash.classList.add('on');
  dragMove(x, y);
}

function moveTo(list, i) {
  S.pages = S.pages.map((pg) => pg.filter((x) => x !== dr.key));
  S.dock = S.dock.filter((x) => x !== dr.key);
  // the lists were rebuilt: find the target again
  const target = list === 'dock' ? S.dock : S.pages[list];
  target.splice(clamp(i, 0, target.length), 0, dr.key);
}

// held at a side of the screen: the next page (a new one after the last)
function turnPage(dir) {
  const i = cur() + dir;
  if (i < 0) return;
  if (i >= S.pages.length) {
    if (S.pages[S.pages.length - 1].length === 1 && S.pages[S.pages.length - 1][0] === dr.key) return;
    S.pages.push([]);
  }
  moveTo(i, S.pages[i].length);
  renderHome(false);
  goPage(i, true);
  holeOn();
  rez.haptic('context');
}

function dragMove(x, y) {
  if (!dr || !ghost) return;
  const s = dr.wid ? 1.03 : 1.12;
  const gx = dr.wid ? x - dr.gx : x - dr.w / 2;
  const gy = dr.wid ? y - dr.gy : y - dr.h * 0.75;
  ghost.g.style.transform = `translate3d(${gx}px,${gy}px,0) scale(${s})`;
  // over the "remove" pill
  // it counts only once the finger has been below it: an icon of the top row,
  // picked up right next to the pill, is not removed by just being let go
  // (where the pill ends once it has slid in: offsetTop ignores its sliding)
  const zone = trash.offsetTop + trash.offsetHeight + 8;
  if (y > zone + 16) dr.armed = true;
  const hot = trash.classList.contains('on') && !!dr.armed && y < zone;
  if (hot !== dr.hot) {
    dr.hot = hot;
    trash.classList.toggle('hot', hot);
    if (hot) rez.haptic('tick');
  }
  if (hot) return;
  const now = performance.now();
  // a side of the screen
  const edge = x < 24 ? -1 : x > window.innerWidth - 24 ? 1 : 0;
  if (edge) {
    if (!dr.edgeAt) dr.edgeAt = now;
    else if (now - dr.edgeAt > 480) {
      dr.edgeAt = now + 500; // one page at a time
      turnPage(edge);
    }
    return;
  }
  dr.edgeAt = 0;
  if (now - dr.last < 90) return;
  // the nearest place on the page or in the dock (widgets stay on pages)
  const dk = dock.getBoundingClientRect();
  const inDock = !dr.wid && y > dk.top - 12;
  const pi = cur();
  const box = inDock ? dock : hpages.children[pi];
  const to = inDock ? 'dock' : pi;
  if (!box) return;
  if (inDock && where(dr.key) !== 'dock' && S.dock.length >= 5) return;
  let best = 0;
  let bd = 1e9;
  const kids = [...box.children];
  kids.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const dd = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  });
  if (kids.length) {
    const r = kids[best].getBoundingClientRect();
    if (best === kids.length - 1 && (y > r.bottom || (x > r.right && y > r.top)) && kids[best] !== homeEls.get(dr.key)) best = kids.length;
  }
  const list = to === 'dock' ? S.dock : S.pages[to];
  if (where(dr.key) === to && list.indexOf(dr.key) === best) return;
  dr.last = now;
  moveTo(to, best);
  renderHome(true);
  holeOn();
  rez.haptic('tick');
}

function dragEnd() {
  if (!dr) return;
  const x = dr;
  dr = null;
  trash.classList.remove('on', 'hot');
  if (x.hot) {
    if (ghost) {
      const g0 = ghost.g;
      g0.style.transition = 'transform 0.25s, opacity 0.25s';
      g0.style.opacity = '0';
      setTimeout(() => g0.remove(), 260);
    }
    drop(true);
    removeKey(x.key);
    toast(W.isWidget(x.key) ? 'Виджет убран' : `${apps.get(x.key)?.label || 'Значок'} — убран с экрана`);
  } else drop();
  prune(cur());
  saveHome();
}

// ---------- the keys, the screen coming and going ----------

on('key', (k) => {
  if (dr) return;
  if (menu.open) return closeMenu();
  if (isSheet()) return closeSheet();
  if (drawerOpen) return closeDrawer();
  // Home on the home screen: back to the first page
  if (k === 'home' && cur() !== 0) goPage(0, true);
});

function setVisible(v) {
  look.set({ visible: v });
  if (v) {
    W.tick();
    W.setMedia(rez.mediaState());
    look.set({ music: W.playing() });
    setBadges(rez.badges());
  } else {
    // coming back, the person finds the home screen, not the drawer they left
    closeMenu();
    drop(true);
    closeSheet();
    closeDrawer(false);
    W.stop();
    prune(cur());
  }
}
on('visible', setVisible);
document.addEventListener('visibilitychange', () => setVisible(!document.hidden));
on('badges', (b) => setBadges(typeof b === 'string' ? JSON.parse(b) : b));
on('perm', () => {
  look.apply();
});
window.addEventListener('resize', () => {
  setP(p);
  // the keyboard (the drawer's search) makes the page shorter for a while: the pages stay as they are
  if (document.activeElement === q) return;
  const was = cur();
  measure();
  renderHome(false);
  goPage(was, false);
});
// a computer's keyboard (the preview, a tablet with keys): Esc is Back
window.addEventListener('keydown', (e) => e.key === 'Escape' && window.__rezEmit('key', 'back'));

// ---------- start ----------

const info = rez.info();
insets(info.insets);
look.setYou(info.you);
look.apply();
measure();
apps.onApps(() => {
  migrate();
  S.pages = S.pages.map((pg) => pg.filter(valid));
  if (!S.pages.length) S.pages = [[]];
  S.dock = (S.dock || []).filter(valid);
  renderHome(false);
  renderDrawer();
});
apps.reload();
setP(0);
W.tick();
W.setMedia(rez.mediaState());
look.set({ music: W.playing() });
setBadges(rez.badges());
if (!native) body.classList.add('preview');
// shown once the fonts are in (a moment at most), so nothing appears in a stand-in font
const show = () => body.classList.add('ready');
Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 900))]).then(show);
