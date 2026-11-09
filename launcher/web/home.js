// Резонанс Лаунчер: the desktop — pages of icons, folders and widgets in a
// grid that fits the screen (phone or tablet, upright or on its side), the dock,
// the page marks, the page on the left with the clock and the weather.
//
// The layout is kept as lists: every page is an ordered list of items, laid out
// from the top left. When the screen holds fewer cells than a page has (turned
// on its side), the extra items flow on to the next page, as on iOS.

import { rez } from './bridge.js';
import { S, L, saveLayout, newId } from './store.js';
import * as apps from './apps.js';
import * as widgets from './widgets.js';
import * as look from './look.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const homeEl = $('home');
const pager = $('pager');
const dockEl = $('dock');
const dotsEl = $('dots');

// ---------- the screen ----------

export const geo = { W: 360, H: 760, cols: 4, rows: 5, is: 54, ch: 92, tablet: false, landscape: false, split: false, dockMax: 4, feedOn: false };
let ins = { t: 24, b: 0, l: 0, r: 0, ime: 0 };

export function setInsets(i) {
  ins = { ...ins, ...i };
  const st = document.documentElement.style;
  st.setProperty('--st', ins.t + 'px');
  st.setProperty('--sb', ins.b + 'px');
  st.setProperty('--sl', ins.l + 'px');
  st.setProperty('--sr', ins.r + 'px');
  st.setProperty('--ime', ins.ime + 'px');
}
export const insets = () => ins;

export function measure() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const tablet = Math.min(W, H) >= 600;
  const landscape = W > H;
  const split = !!S.feed && tablet && landscape && W >= 900;
  const is = Math.round((tablet ? 62 : 54) * (S.iconSize || 1));
  const padX = tablet ? 28 : 10;
  const feedW = split ? Math.round(Math.min(400, W * 0.31)) : 0;
  const areaW = W - ins.l - ins.r - padX * 2 - feedW;
  const labelH = S.labels ? 30 : 8;
  const ch = Math.round(is + labelH + (tablet ? 26 : 20));
  const dockH = is + 30;
  const bottom = Math.max(ins.b, 10) + 8;
  const availH = H - ins.t - 14 - dockH - bottom - 34;
  let cols = Math.max(4, Math.min(9, Math.floor(areaW / (is * 1.45))));
  let rows = Math.max(3, Math.min(8, Math.floor(availH / ch)));
  const m = /^(\d)x(\d)$/.exec(S.grid || '');
  if (m) {
    cols = Math.max(3, Math.min(9, +m[1]));
    rows = Math.max(3, Math.min(9, +m[2]));
  }
  widgets.dims.cols = cols;
  Object.assign(geo, { W, H, cols, rows, is, ch, tablet, landscape, split, feedW, dockMax: Math.max(4, Math.min(cols, tablet ? 7 : 5)), feedOn: !!S.feed });
  const st = homeEl.style;
  st.setProperty('--is', is + 'px');
  st.setProperty('--cols', cols);
  st.setProperty('--rows', rows);
  st.setProperty('--ch', ch + 'px');
  st.setProperty('--padx', padX + 'px');
  st.setProperty('--dockh', dockH + 'px');
  st.setProperty('--dockb', bottom + 'px');
  st.setProperty('--feedw', feedW + 'px');
  homeEl.classList.toggle('split', split);
  homeEl.classList.toggle('tablet', tablet);
  homeEl.classList.toggle('no-labels', !S.labels);
}

// ---------- packing: what fits on a page ----------

const spanOf = (it) => (it.k === 'w' ? widgets.sizeOf(it) : [1, 1]);

// the cells an item takes, first fit from the top left (the same as CSS grid with "dense")
export function pack(items, cols, rows) {
  const occ = new Array(cols * rows).fill(false);
  const placed = [];
  const over = [];
  for (const it of items) {
    let [c, r] = spanOf(it);
    c = Math.min(c, cols);
    r = Math.min(r, rows);
    let at = -1;
    for (let y = 0; y + r <= rows && at < 0; y++) {
      for (let x = 0; x + c <= cols && at < 0; x++) {
        let free = true;
        for (let j = 0; j < r && free; j++) for (let i = 0; i < c; i++) if (occ[(y + j) * cols + x + i]) free = false;
        if (free) at = y * cols + x;
      }
    }
    if (at < 0) {
      over.push(it);
      continue;
    }
    const y0 = Math.floor(at / cols);
    const x0 = at % cols;
    for (let j = 0; j < r; j++) for (let i = 0; i < c; i++) occ[(y0 + j) * cols + x0 + i] = true;
    placed.push(it);
  }
  return { placed, over };
}

export const keyOf = (it) => (it.k === 'a' ? 'a:' + it.p : it.k === 'f' ? 'f:' + it.id : 'w:' + (it.id || it.t));

// the pages as they are shown now: extras flow on to the next page
function effective() {
  const out = [];
  let carry = [];
  for (const page of L.pages) {
    const { placed, over } = pack(carry.concat(page), geo.cols, geo.rows);
    out.push(placed);
    carry = over;
  }
  let guard = 0;
  while (carry.length && guard++ < 40) {
    const { placed, over } = pack(carry, geo.cols, geo.rows);
    if (!placed.length) break;
    out.push(placed);
    carry = over;
  }
  return out;
}

// apps that are gone are taken off; folders with one app become that app
function prune() {
  if (!apps.all().length) return false;
  let changed = false;
  const has = (pkg) => !!apps.byPkg(pkg);
  const keep = (it) => {
    if (it.k === 'a') return has(it.p);
    if (it.k === 'f') {
      const f = L.folders[it.id];
      if (!f) return false;
      f.apps = f.apps.filter(has);
      return f.apps.length > 0;
    }
    return true;
  };
  const fix = (list) =>
    list.filter(keep).map((it) => {
      if (it.k === 'f' && L.folders[it.id] && L.folders[it.id].apps.length === 1) {
        const p = L.folders[it.id].apps[0];
        delete L.folders[it.id];
        return { k: 'a', p };
      }
      return it;
    });
  for (let i = 0; i < L.pages.length; i++) {
    const n = fix(L.pages[i]);
    if (n.length !== L.pages[i].length || n.some((x, j) => x !== L.pages[i][j])) changed = true;
    L.pages[i] = n;
  }
  const d = fix(L.dock);
  if (d.length !== L.dock.length || d.some((x, j) => x !== L.dock[j])) changed = true;
  L.dock = d;
  // folders nobody holds
  const used = new Set();
  for (const it of [].concat(L.dock, ...L.pages)) if (it.k === 'f') used.add(it.id);
  for (const id of Object.keys(L.folders)) if (!used.has(id)) delete L.folders[id];
  return changed;
}

// the effective pages become the stored ones; empty pages at the end go
export function commit(pages) {
  const p = (pages || L.pages).map((x) => x.slice());
  while (p.length > 1 && !p[p.length - 1].length) p.pop();
  L.pages = p.length ? p : [[]];
  saveLayout();
}

export function placed(pkg) {
  for (const it of L.dock) if (it.k === 'a' && it.p === pkg) return { where: 'dock' };
  for (let i = 0; i < L.pages.length; i++) {
    for (const it of L.pages[i]) if (it.k === 'a' && it.p === pkg) return { where: 'page', page: i };
    for (const it of L.pages[i]) if (it.k === 'f' && L.folders[it.id] && L.folders[it.id].apps.indexOf(pkg) >= 0) return { where: 'folder', page: i, id: it.id };
  }
  return null;
}

// ---------- the first layout and new apps ----------

const BROWSER = /^(chrome|firefox|opera|brave|via|samsung internet|яндекс\s*браузер|yandex\s*browser|браузер|browser)/i;
const FAVOURITES = [
  BROWSER,
  /(телеграм|telegram)/i,
  /^(whatsapp|ватсап|вацап)/i,
  /^(vk|вк)\b|вконтакте/i,
  /youtube|ютуб/i,
  /(карты|maps|2gis|2гис)/i,
  /(gmail|почта|mail)/i,
  /(галерея|gallery|фото|photos)/i,
  /(play маркет|play store|google play|rustore|магазин)/i,
  /(звук|zvuk|музык|music|spotify)/i,
  /(калькулятор|calculator)/i,
  /(часы|clock|будильник)/i,
  /(календарь|calendar)/i,
  /(файлы|files|проводник)/i,
  /(настройки|settings)/i,
];
const DOCK = [/(телефон|phone|dialer|звонки)/i, /(сообщения|messages|смс|sms)/i, BROWSER, /(камера|camera)/i];

function seed() {
  const list = apps.visible();
  if (!list.length) return;
  const used = new Set();
  const take = (re) => {
    const a = list.find((x) => re.test(x.label) && !used.has(x.pkg));
    if (a) used.add(a.pkg);
    return a;
  };
  const dock = [];
  for (const re of DOCK) {
    const a = take(re);
    if (a) dock.push({ k: 'a', p: a.pkg });
  }
  const favs = [];
  for (const re of FAVOURITES) {
    const a = take(re);
    if (a) favs.push({ k: 'a', p: a.pkg });
  }
  const first = (geo.split ? [] : [{ k: 'w', t: 'clock', id: newId('w'), c: 4, r: 2 }]).concat([{ k: 'w', t: 'search', id: newId('w'), c: 4, r: 1 }], favs);
  L.dock = dock.slice(0, geo.dockMax);
  L.pages = [first];
  L.seeded = true;
  L.seen = list.map((a) => a.pkg);
  saveLayout();
}

function newApps() {
  if (!L.seeded) return;
  const fresh = apps.all().filter((a) => (L.seen || []).indexOf(a.pkg) < 0);
  if (!fresh.length) return;
  for (const a of fresh) {
    L.seen.push(a.pkg);
    if (!S.addNew || apps.hidden(a) || placed(a.pkg)) continue;
    // only apps installed recently (the first run lists them all as seen)
    if (Date.now() - (a.installed || 0) > 3 * 24 * 3600e3) continue;
    const last = L.pages[L.pages.length - 1];
    const test = pack(last.concat({ k: 'a', p: a.pkg }), geo.cols, geo.rows);
    if (test.over.length) L.pages.push([{ k: 'a', p: a.pkg }]);
    else last.push({ k: 'a', p: a.pkg });
  }
  saveLayout();
}

// ---------- icons ----------

let badges = {};
export function setBadges(b) {
  badges = b || {};
  for (const n of document.querySelectorAll('.item[data-k="a"], .item[data-k="f"]')) paintBadge(n);
}

function badgeOf(node) {
  if (!S.badges) return 0;
  if (node.dataset.k === 'a') return badges[node.dataset.p] || 0;
  const f = L.folders[node.dataset.id];
  return f ? f.apps.reduce((s, p) => s + (badges[p] || 0), 0) : 0;
}

function paintBadge(node) {
  let b = node.querySelector('.bd');
  const n = badgeOf(node);
  if (!n) {
    if (b) b.remove();
    return;
  }
  if (!b) {
    b = el('b', 'bd');
    node.appendChild(b);
  }
  b.textContent = n > 9 ? '9+' : String(n);
}

// the picture of an app inside its shape (the system's own shapes are not used)
export function paintIcon(ic, app) {
  const m = app.m;
  const adaptive = !m || m.a;
  const themed = S.themed && m && m.m;
  ic.className = 'ic shape-' + (S.shape || 'squircle') + (m && !m.a ? ' lg' : ' ad') + ' plate-' + (S.plate || 'auto') + (themed ? ' themed' : '');
  ic.textContent = '';
  if (themed) {
    const mono = el('i', 'mono');
    mono.style.webkitMaskImage = `url("${rez.iconUrl(app.pkg, true)}")`;
    mono.style.maskImage = `url("${rez.iconUrl(app.pkg, true)}")`;
    ic.appendChild(mono);
    return;
  }
  if (!adaptive && m && m.c) ic.style.setProperty('--pc', m.c);
  const img = el('img');
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.src = rez.iconUrl(app.pkg);
  ic.appendChild(img);
}

function buildApp(app, where) {
  const root = el('div', 'item app');
  root.dataset.k = 'a';
  root.dataset.p = app.pkg;
  const ic = el('div', 'ic');
  paintIcon(ic, app);
  root.appendChild(ic);
  if (where === 'dock' ? S.dockLabels : S.labels || where === 'drawer' || where === 'folder') root.appendChild(el('div', 'lb', app.label));
  paintBadge(root);
  return root;
}

function buildFolder(it, where) {
  const f = L.folders[it.id] || { name: 'Папка', apps: [] };
  const root = el('div', 'item folder');
  root.dataset.k = 'f';
  root.dataset.id = it.id;
  const ic = el('div', 'ic fold shape-' + (S.shape === 'original' ? 'squircle' : S.shape));
  const grid = el('div', 'fg');
  for (const pkg of f.apps.slice(0, 9)) {
    const app = apps.byPkg(pkg);
    if (!app) continue;
    const mi = el('i', 'mi');
    const img = el('img');
    img.alt = '';
    img.draggable = false;
    img.src = rez.iconUrl(pkg);
    mi.appendChild(img);
    grid.appendChild(mi);
  }
  ic.appendChild(grid);
  root.appendChild(ic);
  if (where === 'dock' ? S.dockLabels : S.labels || where === 'drawer') root.appendChild(el('div', 'lb', f.name || 'Папка'));
  paintBadge(root);
  return root;
}

export function buildItem(it, where) {
  if (it.k === 'a') {
    const app = apps.byPkg(it.p);
    return app ? buildApp(app, where) : null;
  }
  if (it.k === 'f') return buildFolder(it, where);
  if (it.k === 'w') {
    const n = widgets.build(it);
    n.dataset.key = keyOf(it);
    return n;
  }
  return null;
}

// ---------- laying out a container (a page or the dock), with sliding ----------

export function layout(cont, items, hole, animate) {
  const nodes = cont._nodes || (cont._nodes = new Map());
  const before = new Map();
  if (animate !== false) for (const [k, n] of nodes) if (n.isConnected) before.set(k, n.getBoundingClientRect());
  const keep = new Set();
  const list = [];
  const where = cont.dataset.where;
  for (const it of items) {
    const key = keyOf(it);
    keep.add(key);
    let n = nodes.get(key);
    if (!n) {
      n = buildItem(it, where);
      if (!n) continue;
      n.dataset.key = key;
      nodes.set(key, n);
    }
    list.push(n);
  }
  if (hole >= 0) {
    const ph = cont._hole || (cont._hole = el('div', 'item hole'));
    ph.classList.toggle('big', !!cont._holeSize && cont._holeSize[0] * cont._holeSize[1] > 1);
    if (cont._holeSize) {
      ph.style.gridColumn = 'span ' + cont._holeSize[0];
      ph.style.gridRow = 'span ' + cont._holeSize[1];
    } else {
      ph.style.gridColumn = '';
      ph.style.gridRow = '';
    }
    list.splice(Math.max(0, Math.min(hole, list.length)), 0, ph);
  } else if (cont._hole) cont._hole.remove();
  for (const [k, n] of nodes) {
    if (!keep.has(k)) {
      widgets.forget(n);
      n.remove();
      nodes.delete(k);
    }
  }
  list.forEach((n, i) => {
    if (cont.children[i] !== n) cont.insertBefore(n, cont.children[i] || null);
  });
  if (animate === false) return;
  // sliding: from where each one was to where it is now
  for (const n of list) {
    const old = before.get(n.dataset.key);
    if (!old || !n.animate) continue;
    const now = n.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) + Math.abs(dy) < 2) continue;
    n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.22,0.9,0.26,1)' });
  }
}

// ---------- the pager ----------

let gridPages = []; // the elements of the pages with icons
let feedPage = null;
let feedSig = '';

const feedOffset = () => (geo.feedOn && !geo.split ? 1 : 0);

export function pageEls() {
  return gridPages;
}

function buildFeed(host) {
  host.textContent = '';
  const sec = el('div', 'feed-in');
  sec.appendChild(widgets.build({ k: 'w', t: 'clock', id: 'feed-clock', c: 4, r: 2 }));
  sec.appendChild(widgets.build({ k: 'w', t: 'weather', id: 'feed-wx', c: 4, r: 2 }));
  sec.appendChild(widgets.build({ k: 'w', t: 'np', id: 'feed-np', c: 4, r: 2 }));
  const freq = apps.frequent(geo.split ? 4 : Math.min(geo.cols, 5), L.dock.filter((x) => x.k === 'a').map((x) => x.p));
  if (freq.length) {
    const box = el('div', 'feed-freq');
    box.appendChild(el('div', 'feed-h', 'Часто открываете'));
    const row = el('div', 'feed-row');
    for (const a of freq) row.appendChild(buildApp(a, 'feed'));
    box.appendChild(row);
    sec.appendChild(box);
  }
  host.appendChild(sec);
}

export function refreshFeed() {
  const host = geo.split ? $('feedcol') : feedPage;
  if (host) buildFeed(host);
}

export function render() {
  measure();
  if (!L.seeded) seed();
  else {
    prune();
    newApps();
  }
  // the pages as shown (extras flowed on); they become the stored ones
  const eff = effective();
  L.pages = eff.length ? eff : [[]];
  const keepIdx = Math.max(0, pageIndex());
  const ww = Math.max(1, pager.clientWidth || geo.W);

  pager.textContent = '';
  gridPages = [];
  feedPage = null;
  const feedCol = $('feedcol');
  feedCol.classList.toggle('hidden', !geo.split);
  if (geo.split) buildFeed(feedCol);
  else feedCol.textContent = '';
  if (geo.feedOn && !geo.split) {
    feedPage = el('section', 'page feed');
    buildFeed(feedPage);
    pager.appendChild(feedPage);
  }
  L.pages.forEach((items, i) => {
    const page = el('section', 'page');
    const grid = el('div', 'grid');
    grid.dataset.where = 'page';
    grid.dataset.i = String(i);
    page.appendChild(grid);
    pager.appendChild(page);
    gridPages.push(grid);
    layout(grid, items, -1, false);
  });
  buildDock();
  buildDots();
  pager.scrollLeft = (keepIdx + feedOffset()) * ww;
  onScroll();
  rez.scroll(frac(), pager.children.length);
  saveLayout();
}

// the pages are rebuilt while an icon is being dragged: the clone floats above, nothing else changes
export function renderKeep() {
  const keep = pager.scrollLeft;
  render();
  pager.scrollLeft = keep;
}

export function buildDock() {
  dockEl.dataset.where = 'dock';
  dockEl._nodes = null;
  dockEl.textContent = '';
  dockEl.classList.toggle('empty', !L.dock.length);
  layout(dockEl, L.dock, -1, false);
}

// ---------- the marks under the pages ----------

function buildDots() {
  dotsEl.textContent = '';
  const n = pager.children.length;
  dotsEl.classList.toggle('hidden', n < 2);
  for (let i = 0; i < n; i++) {
    const d = el('button', 'dot' + (i === 0 && feedOffset() ? ' feed' : ''));
    d.dataset.i = String(i);
    d.setAttribute('aria-label', 'Страница ' + (i + 1));
    d.appendChild(el('i'));
    dotsEl.appendChild(d);
  }
  markDots();
}

function markDots() {
  const f = pager.scrollLeft / Math.max(1, pager.clientWidth);
  const cur = Math.round(f);
  Array.prototype.forEach.call(dotsEl.children, (d, i) => {
    d.classList.toggle('on', i === cur);
    // the mark stretches while the page is passing
    const near = Math.max(0, 1 - Math.abs(f - i));
    d.style.setProperty('--n', near.toFixed(2));
  });
}

function frac() {
  const max = pager.scrollWidth - pager.clientWidth;
  return max > 0 ? pager.scrollLeft / max : 0;
}

export function pageIndex() {
  const i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth)) - feedOffset();
  return i;
}

export function goto(i, smooth) {
  const left = Math.max(0, Math.min(pager.children.length - 1, i)) * pager.clientWidth;
  pager.scrollTo({ left, behavior: smooth === false ? 'auto' : 'smooth' });
}

export const gotoGrid = (i, smooth) => goto(i + feedOffset(), smooth);
export const onFeed = () => feedOffset() && pageIndex() < 0;

let rafScroll = 0;
let lastSent = -1;
function onScroll() {
  if (rafScroll) return;
  rafScroll = requestAnimationFrame(() => {
    rafScroll = 0;
    markDots();
    const f = frac();
    look.parallax(f, pager.children.length);
    if (Math.abs(f - lastSent) > 0.004) {
      lastSent = f;
      rez.scroll(f, pager.children.length);
    }
  });
}
pager.addEventListener('scroll', onScroll, { passive: true });

dotsEl.addEventListener('click', (e) => {
  const d = e.target.closest('.dot');
  if (d) goto(+d.dataset.i, true);
});

// ---------- the dock and pages as drop targets (used by the dragging) ----------

export const containerAt = (x, y) => {
  const dr = dockEl.getBoundingClientRect();
  if (y >= dr.top - 12) return dockEl;
  const i = pageIndex();
  return gridPages[i] || null;
};

export const dockEl_ = dockEl;
export { dockEl, pager, homeEl, icon };
