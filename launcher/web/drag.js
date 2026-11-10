// Резонанс Лаунчер: touch on icons — a tap opens, a long press lifts the icon
// and shows its menu, moving after a long press drags it to another place,
// another page, the dock, a folder, or the strip at the top (remove, info,
// uninstall). Icons of the drawer and of an open folder can be dragged out onto
// the desktop the same way.

import { rez } from './bridge.js';
import { S, L, saveLayout, newId } from './store.js';
import * as apps from './apps.js';
import * as home from './home.js';
import * as widgets from './widgets.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = home.el;

// what the other parts give: opening the drawer, a folder, the settings…
export const hooks = {
  closeDrawer: () => {},
  closeFolder: () => {},
  openFolder: () => {},
  openSettings: () => {},
  openWidgets: () => {},
  toast: () => {},
  rename: () => {},
  dragging: () => {},
};

const menuEl = $('menu');
const zonesEl = $('zones');
const ghost = $('ghost');

// ---------- the menu ----------

let menuFor = null;

export function hideMenu() {
  if (!menuEl.classList.contains('on')) return;
  menuEl.classList.remove('on');
  if (menuFor) menuFor.classList.remove('lift');
  menuFor = null;
}

function entry(label, glyph, fn, cls) {
  const b = el('button', 'mi-row' + (cls ? ' ' + cls : ''));
  if (glyph) b.appendChild(icon(glyph));
  b.appendChild(el('span', '', label));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    hideMenu();
    fn();
  });
  return b;
}

function showMenu(rows, rect, node) {
  menuEl.textContent = '';
  for (const r of rows) menuEl.appendChild(r);
  menuEl.classList.add('on');
  menuEl.style.visibility = 'hidden';
  const mw = menuEl.offsetWidth;
  const mh = menuEl.offsetHeight;
  const W = window.innerWidth;
  const H = window.innerHeight;
  let x = rect.left + rect.width / 2 - mw / 2;
  x = Math.max(10, Math.min(W - mw - 10, x));
  let below = rect.bottom + 10;
  let y = below;
  if (below + mh > H - 24) y = Math.max(home.insets().t + 8, rect.top - mh - 10);
  menuEl.style.left = x + 'px';
  menuEl.style.top = y + 'px';
  menuEl.style.transformOrigin = `${rect.left + rect.width / 2 - x}px ${y < rect.top ? '100%' : '0%'}`;
  menuEl.style.visibility = '';
  menuFor = node || null;
  if (node) node.classList.add('lift');
}

function rectOf(node) {
  const ic = node.querySelector('.ic') || node;
  return ic.getBoundingClientRect();
}

export const launchRect = (node) => {
  const r = rectOf(node);
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

function appRows(d, app) {
  const rows = [];
  const sc = rez.shortcuts(app.pkg) || [];
  for (const s of sc.slice(0, 4)) rows.push(entry(s.label, 'chevron', () => rez.startShortcut(app.pkg, s.id)));
  if (sc.length) rows.push(el('div', 'mi-sep'));
  if (d.where === 'drawer') {
    rows.push(entry('На рабочий стол', 'plus', () => addToHome(app.pkg, 'page')));
    rows.push(entry('В док', 'home', () => addToHome(app.pkg, 'dock')));
  } else if (d.where === 'folder') {
    rows.push(entry('Вынести на рабочий стол', 'move', () => moveOutOfFolder(d)));
  } else {
    rows.push(entry('Убрать с экрана', 'close', () => removeFromHome(d)));
  }
  rows.push(entry('О приложении', 'info', () => rez.appInfo(app.pkg)));
  if (d.where === 'drawer') {
    const hid = apps.hidden(app);
    rows.push(entry(hid ? 'Показывать в ящике' : 'Скрыть из ящика', 'hide', () => toggleHidden(app.pkg)));
  }
  if (!app.sys) rows.push(entry('Удалить', 'trash', () => rez.uninstall(app.pkg), 'danger'));
  return rows;
}

function folderRows(d) {
  return [
    entry('Переименовать', 'edit', () => hooks.rename(d.id)),
    entry('Разгруппировать', 'move', () => dissolveFolder(d.id)),
  ];
}

function widgetRows(d, item) {
  const rows = [];
  const kind = widgets.KINDS[item.t];
  if (kind && kind.sizes.length > 1) {
    const row = el('div', 'mi-sizes');
    row.appendChild(el('span', '', 'Размер'));
    const [c, r] = widgets.sizeOf(item);
    for (const [sc, sr] of kind.sizes) {
      const b = el('button', 'sz' + (sc === c && sr === r ? ' on' : ''), `${sc}×${sr}`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        hideMenu();
        item.c = sc;
        item.r = sr;
        home.render();
      });
      row.appendChild(b);
    }
    rows.push(row);
  }
  rows.push(entry('Убрать с экрана', 'close', () => removeFromHome(d), 'danger'));
  return rows;
}

function emptyRows(point) {
  return [
    entry('Обои и стиль', 'palette', () => hooks.openSettings('wall')),
    entry('Виджеты', 'grid', () => hooks.openWidgets()),
    entry('Настройки Резонанса', 'gear', () => hooks.openSettings()),
  ];
}

// ---------- what the menu does to the layout ----------

function itemAt(d) {
  const list = d.where === 'dock' ? L.dock : L.pages[d.page];
  return list ? list.find((it) => home.keyOf(it) === d.key) : null;
}

function removeFromHome(d) {
  if (d.where === 'dock') L.dock = L.dock.filter((it) => home.keyOf(it) !== d.key);
  else if (L.pages[d.page]) L.pages[d.page] = L.pages[d.page].filter((it) => home.keyOf(it) !== d.key);
  if (d.k === 'f') delete L.folders[d.id];
  home.render();
  hooks.toast(d.k === 'w' ? 'Виджет убран' : 'Убрано с экрана (осталось в ящике)');
}

export function addToHome(pkg, where) {
  const at = home.placed(pkg);
  if (at) {
    hooks.closeDrawer();
    if (at.where === 'page' || at.where === 'folder') home.gotoGrid(at.page, true);
    hooks.toast('Уже на экране');
    return;
  }
  const it = { k: 'a', p: pkg };
  if (where === 'dock') {
    if (L.dock.length >= home.geo.dockMax) return hooks.toast('Док заполнен');
    L.dock.push(it);
  } else {
    let i = Math.max(0, home.pageIndex());
    let list = L.pages[i];
    if (home.pack(list.concat(it), home.geo.cols, home.geo.rows).over.length) {
      i = L.pages.length;
      L.pages.push([]);
      list = L.pages[i];
    }
    list.push(it);
    hooks.closeDrawer();
    home.render();
    home.gotoGrid(i, false);
    hooks.toast('Добавлено на рабочий стол');
    return;
  }
  hooks.closeDrawer();
  home.render();
  hooks.toast('Добавлено в док');
}

export function addWidget(kind) {
  const k = widgets.KINDS[kind];
  if (!k) return;
  const [c, r] = k.sizes[0];
  const it = { k: 'w', t: kind, id: newId('w'), c: Math.min(c, home.geo.cols), r };
  let i = Math.max(0, home.pageIndex());
  if (home.pack(L.pages[i].concat(it), home.geo.cols, home.geo.rows).over.length) {
    i = L.pages.length;
    L.pages.push([]);
  }
  L.pages[i].push(it);
  home.render();
  home.gotoGrid(i, false);
}

function toggleHidden(pkg) {
  const h = L.hidden || (L.hidden = []);
  const i = h.indexOf(pkg);
  if (i >= 0) h.splice(i, 1);
  else h.push(pkg);
  saveLayout();
  document.dispatchEvent(new CustomEvent('rez-drawer-refresh'));
}

function moveOutOfFolder(d) {
  const f = L.folders[d.folderId];
  if (!f) return;
  f.apps = f.apps.filter((p) => p !== d.pkg);
  hooks.closeFolder();
  const i = Math.max(0, home.pageIndex());
  L.pages[i].push({ k: 'a', p: d.pkg });
  home.render();
}

export function dissolveFolder(id) {
  const f = L.folders[id];
  if (!f) return;
  for (let i = 0; i < L.pages.length; i++) {
    const at = L.pages[i].findIndex((it) => it.k === 'f' && it.id === id);
    if (at >= 0) {
      L.pages[i].splice(at, 1, ...f.apps.map((p) => ({ k: 'a', p })));
      break;
    }
  }
  const dk = L.dock.findIndex((it) => it.k === 'f' && it.id === id);
  if (dk >= 0) L.dock.splice(dk, 1, ...f.apps.map((p) => ({ k: 'a', p })).slice(0, Math.max(0, home.geo.dockMax - L.dock.length + 1)));
  delete L.folders[id];
  hooks.closeFolder();
  home.render();
}

// ---------- reading what was touched ----------

// the place an icon is in: { where, node, k, key, pkg|id, page }
function describe(target) {
  const node = target.closest && target.closest('.item');
  if (!node || node.classList.contains('hole')) return null;
  const k = node.dataset.k;
  const cont = node.parentElement;
  const where = node.closest('#drawer') ? 'drawer' : node.closest('#folder') ? 'folder' : node.closest('#dock') ? 'dock' : node.closest('.feed, #feedcol') ? 'feed' : 'page';
  const d = { node, k, where, page: cont && cont.dataset.i != null ? +cont.dataset.i : -1 };
  if (k === 'a') {
    d.pkg = node.dataset.p;
    d.key = 'a:' + d.pkg;
  } else if (k === 'f') {
    d.id = node.dataset.id;
    d.key = 'f:' + d.id;
  } else if (k === 'w') {
    d.id = node.dataset.id;
    d.key = node.dataset.key;
  }
  if (where === 'folder') d.folderId = node.closest('#folder').dataset.id;
  return d;
}

// ---------- the press ----------

let press = null;
let drag = null;

function tap(d, e) {
  if (d.k === 'a') {
    const app = apps.byPkg(d.pkg);
    if (!app) return;
    rez.launch(d.pkg, launchRect(d.node));
    apps.used(d.pkg);
    if (S.sounds) rez.haptic('tick');
    d.node.classList.remove('pop');
    void d.node.offsetWidth;
    d.node.classList.add('pop');
  } else if (d.k === 'f') {
    hooks.openFolder(d.id, rectOf(d.node));
  } else if (d.k === 'w') {
    const item = itemAt(d) || { t: d.node.className.match(/w-(\w+)/)[1] };
    if (widgets.press(e.target)) return;
    widgets.tap(d.node, item, launchRect(d.node));
  }
}

function longPress() {
  if (!press) return;
  const d = press.desc;
  press.lifted = true;
  if (S.sounds) rez.haptic('long');
  if (!d) {
    showMenu(emptyRows(), new DOMRect(press.x0 - 1, press.y0 - 1, 2, 2), null);
    press.lifted = false;
    press.done = true;
    return;
  }
  const rect = rectOf(d.node);
  if (d.k === 'a') {
    const app = apps.byPkg(d.pkg);
    if (app) showMenu(appRows(d, app), rect, d.node);
  } else if (d.k === 'f') {
    showMenu(folderRows(d), rect, d.node);
  } else if (d.k === 'w') {
    if (d.where === 'feed') {
      press.lifted = false;
      press.done = true;
      return;
    }
    const item = itemAt(d);
    if (item) showMenu(widgetRows(d, item), d.node.getBoundingClientRect(), d.node);
  }
}

// a long press on a widget of another app: the Android side saw it, the menu is ours
export function widgetMenu(wid) {
  const node = document.querySelector(`#pager .item.w-sys[data-wid="${wid}"]`);
  if (!node) return;
  const cont = node.parentElement;
  const d = { node, k: 'w', where: 'page', page: cont && cont.dataset.i != null ? +cont.dataset.i : -1, id: node.dataset.id, key: node.dataset.key };
  const item = itemAt(d);
  if (!item) return;
  if (S.sounds) rez.haptic('long');
  showMenu(widgetRows(d, item), node.getBoundingClientRect(), node);
}

function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  if (press.desc && press.desc.node) press.desc.node.classList.remove('lift');
  press = null;
}

export function attach(root) {
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || drag) return;
    if (menuEl.classList.contains('on') && !menuEl.contains(e.target)) hideMenu();
    if (e.target.closest('.np-b, .sr-pill, .dot, .handle')) {
      press = null;
      return;
    }
    const d = describe(e.target);
    // the empty place of a home page: a long press gives the menu of the desktop
    const emptyOk = !d && e.target.closest('.grid, .page.feed') && root.id !== 'drawer';
    if (!d && !emptyOk) return;
    cancelPress();
    press = { pid: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), desc: d, lifted: false, moved: false, done: false, root };
    press.timer = setTimeout(longPress, 380);
  });
}

window.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.pid) return;
  const dx = e.clientX - press.x0;
  const dy = e.clientY - press.y0;
  const dist = Math.hypot(dx, dy);
  if (!press.lifted) {
    // moved before the long press: it is a swipe or a scroll, not a press
    if (dist > 12) cancelPress();
    return;
  }
  if (press.done) return;
  if (!drag && dist > 10 && press.desc && !(press.desc.k === 'w' && press.desc.where === 'feed')) startDrag(e);
  if (drag) moveDrag(e);
});

window.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.pid) return;
  const p = press;
  clearTimeout(p.timer);
  if (drag) {
    endDrag(e);
    press = null;
    return;
  }
  if (!p.lifted && p.desc && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 12 && performance.now() - p.t0 < 600) tap(p.desc, e);
  press = null; // a lifted icon keeps its menu until it is dismissed
});

window.addEventListener('pointercancel', (e) => {
  if (!press || e.pointerId !== press.pid) return;
  if (drag) endDrag(e, true);
  cancelPress();
});

// a lifted icon must not scroll the pages away under the finger
window.addEventListener(
  'touchmove',
  (e) => {
    if (press && press.lifted && e.cancelable) e.preventDefault();
  },
  { passive: false }
);
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- the drag ----------

const ZONES = [
  { id: 'remove', name: 'Убрать', glyph: 'close' },
  { id: 'info', name: 'О приложении', glyph: 'info' },
  { id: 'delete', name: 'Удалить', glyph: 'trash' },
];

function buildZones(d) {
  zonesEl.textContent = '';
  const app = d.k === 'a' ? apps.byPkg(d.pkg) : null;
  for (const z of ZONES) {
    if (z.id === 'info' && !app) continue;
    if (z.id === 'delete' && !(app && !app.sys)) continue;
    if (z.id === 'remove' && (d.where === 'drawer' || d.where === 'folder' || d.where === 'feed') && !(d.where === 'drawer' && home.placed(d.pkg))) {
      // from the drawer there is nothing to remove from the desktop
      continue;
    }
    const b = el('div', 'zone z-' + z.id);
    b.dataset.zone = z.id;
    b.appendChild(icon(z.glyph));
    b.appendChild(el('span', '', z.name));
    zonesEl.appendChild(b);
  }
  zonesEl.classList.add('on');
}

function startDrag(e) {
  const d = press.desc;
  hideMenu();
  hooks.dragging(true);
  const node = d.node;
  const r = node.getBoundingClientRect();
  let item = null;
  let origin = null;
  if (d.k === 'a') item = { k: 'a', p: d.pkg };
  else if (d.k === 'f') item = { k: 'f', id: d.id };
  else if (d.k === 'w') item = itemAt(d);
  if (!item) {
    cancelPress();
    return;
  }
  // where it comes from: it leaves there at once
  const at = d.where === 'drawer' && item.k === 'a' ? home.placed(d.pkg) : null;
  if (d.where === 'page' || d.where === 'dock' || (at && at.where !== 'folder')) {
    const where = d.where === 'drawer' ? at.where : d.where;
    const page = d.where === 'drawer' ? at.page : d.page;
    const list = where === 'dock' ? L.dock : L.pages[page];
    const index = list.findIndex((it) => home.keyOf(it) === home.keyOf(item));
    if (index >= 0) {
      origin = { where, page, index, item: list[index] };
      item = list[index];
      list.splice(index, 1);
    }
  } else if (d.where === 'folder') {
    const f = L.folders[d.folderId];
    if (f) {
      const index = f.apps.indexOf(d.pkg);
      origin = { where: 'folder', folderId: d.folderId, index, item };
      f.apps.splice(index, 1);
    }
  }
  const [wc, wr] = item.k === 'w' ? widgets.sizeOf(item) : [1, 1];
  ghost.textContent = '';
  const clone = node.cloneNode(true);
  clone.classList.remove('lift', 'pop');
  clone.style.cssText = '';
  ghost.appendChild(clone);
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  ghost.classList.add('on');
  drag = {
    d,
    item,
    origin,
    size: [wc, wr],
    isApp: item.k === 'a' || item.k === 'f',
    offx: press.x0 - r.left,
    offy: press.y0 - r.top,
    cont: null,
    hole: -1,
    zone: null,
    merge: null,
    mergeTimer: 0,
    edgeTimer: 0,
    last: { x: e.clientX, y: e.clientY },
  };
  node.classList.add('src');
  if (d.where === 'drawer') hooks.closeDrawer(true);
  if (d.where === 'folder') hooks.closeFolder(true);
  buildZones(d);
  // the place it left closes up
  if (origin && origin.where !== 'folder') {
    const cont = origin.where === 'dock' ? home.dockEl : home.pageEls()[origin.page];
    if (cont) home.layout(cont, origin.where === 'dock' ? L.dock : L.pages[origin.page], -1, true);
  }
  document.body.classList.add('dragging');
  moveDrag(e);
}

function modelOf(cont) {
  return cont.dataset.where === 'dock' ? L.dock : L.pages[+cont.dataset.i];
}

function moveDrag(e) {
  if (!drag) return;
  const x = e.clientX;
  const y = e.clientY;
  drag.last = { x, y };
  ghost.style.transform = `translate(${x - drag.offx}px,${y - drag.offy}px) scale(1.12)`;

  // the strip at the top
  let zone = null;
  const zr = zonesEl.getBoundingClientRect();
  if (y < zr.bottom + 6) {
    for (const z of zonesEl.children) {
      const r = z.getBoundingClientRect();
      if (x >= r.left && x <= r.right) zone = z.dataset.zone;
    }
  }
  if (zone !== drag.zone) {
    drag.zone = zone;
    for (const z of zonesEl.children) z.classList.toggle('over', z.dataset.zone === zone);
    if (zone && S.sounds) rez.haptic('tick');
  }
  if (zone) {
    setHole(null, -1);
    clearMerge();
    return;
  }

  // the edges: another page after a moment
  const W = window.innerWidth;
  const edge = x < 26 ? -1 : x > W - 26 ? 1 : 0;
  if (edge && !drag.edgeTimer && drag.cont && drag.cont.dataset.where === 'page') {
    drag.edgeTimer = setTimeout(() => {
      drag.edgeTimer = 0;
      flipPage(edge);
    }, 650);
  } else if (!edge && drag.edgeTimer) {
    clearTimeout(drag.edgeTimer);
    drag.edgeTimer = 0;
  }

  const cont = home.containerAt(x, y);
  if (!cont) return;
  if (cont !== drag.cont) {
    setHole(null, -1);
    clearMerge();
    drag.cont = cont;
    cont._holeSize = drag.size[0] > 1 || drag.size[1] > 1 ? drag.size : null;
  }
  const items = modelOf(cont);
  const nodes = Array.prototype.filter.call(cont.children, (n) => n.classList.contains('item') && !n.classList.contains('hole'));
  // the nearest one
  let best = -1;
  let bd = 1e9;
  const rects = nodes.map((n) => n.getBoundingClientRect());
  rects.forEach((r, i) => {
    const dd = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  });
  if (best < 0) {
    return place(cont, items.length);
  }
  const r = rects[best];
  const n = nodes[best];
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // over the middle of another icon: a folder
  const icR = (n.querySelector('.ic') || n).getBoundingClientRect();
  const inner = drag.isApp && cont.dataset.where === 'page' && (n.dataset.k === 'a' || n.dataset.k === 'f') && Math.abs(x - (icR.left + icR.width / 2)) < icR.width * 0.3 && Math.abs(y - (icR.top + icR.height / 2)) < icR.height * 0.3;
  if (inner) {
    if (!drag.merge || drag.merge.node !== n) {
      clearMerge();
      drag.merge = { node: n, ready: false };
      drag.mergeTimer = setTimeout(() => {
        if (drag && drag.merge && drag.merge.node === n) {
          drag.merge.ready = true;
          n.classList.add('merge');
          if (S.sounds) rez.haptic('tick');
        }
      }, 450);
    }
    return;
  }
  clearMerge();
  const idxInModel = items.findIndex((it) => home.keyOf(it) === n.dataset.key);
  let idx = idxInModel + (x > cx || (y > cy + r.height * 0.4 && Math.abs(x - cx) < r.width) ? 1 : 0);
  if (idxInModel < 0) idx = items.length;
  place(cont, idx);
}

function clearMerge() {
  if (!drag) return;
  clearTimeout(drag.mergeTimer);
  if (drag.merge) drag.merge.node.classList.remove('merge');
  drag.merge = null;
}

// the empty place moves to where the icon would land (if the page has room for it)
function place(cont, idx) {
  const items = modelOf(cont);
  const room = cont.dataset.where === 'dock' ? items.length < home.geo.dockMax : !home.pack(items.concat(drag.item), home.geo.cols, home.geo.rows).over.length;
  if (!room) return setHole(cont, -1);
  idx = Math.max(0, Math.min(items.length, idx));
  if (cont === drag.holeCont && idx === drag.hole) return;
  setHole(cont, idx);
}

function setHole(cont, idx) {
  if (!drag) return;
  const prev = drag.holeCont;
  if (prev && prev !== cont) home.layout(prev, modelOf(prev), -1, true);
  drag.holeCont = cont;
  drag.hole = idx;
  if (cont) home.layout(cont, modelOf(cont), idx, true);
  else if (prev) home.layout(prev, modelOf(prev), -1, true);
}

function flipPage(dir) {
  if (!drag) return;
  let i = home.pageIndex() + dir;
  if (i < 0) return;
  if (i >= L.pages.length) {
    // beyond the last page: a new empty one (only when the last has something)
    if (!L.pages[L.pages.length - 1].length) return;
    L.pages.push([]);
    drag.holeCont = null;
    drag.hole = -1;
    home.renderKeep();
  }
  home.gotoGrid(i, true);
  drag.cont = null; // measured again on the next move
}

function endDrag(e, cancelled) {
  const dr = drag;
  clearTimeout(dr.edgeTimer);
  clearTimeout(dr.mergeTimer);
  drag = null;
  zonesEl.classList.remove('on');
  document.body.classList.remove('dragging');
  hooks.dragging(false);
  const app = dr.d.k === 'a' ? apps.byPkg(dr.d.pkg) : null;
  let done = false;
  let flyTo = null;

  const back = () => {
    // to where it came from (or nowhere, if it came from the drawer)
    const o = dr.origin;
    if (o && o.where === 'folder') {
      const f = L.folders[o.folderId];
      if (f) f.apps.splice(Math.min(o.index, f.apps.length), 0, o.item.p);
    } else if (o) {
      const list = o.where === 'dock' ? L.dock : L.pages[o.page];
      if (list) list.splice(Math.min(o.index, list.length), 0, o.item);
    }
  };

  if (!cancelled && dr.zone) {
    if (dr.zone === 'remove') {
      if (dr.item.k === 'f') delete L.folders[dr.item.id];
      hooks.toast(dr.item.k === 'w' ? 'Виджет убран' : 'Убрано с экрана');
      done = true;
    } else if (dr.zone === 'info' && app) {
      rez.appInfo(app.pkg);
      back();
      done = true;
    } else if (dr.zone === 'delete' && app) {
      rez.uninstall(app.pkg);
      back();
      done = true;
    }
  } else if (!cancelled && dr.merge && dr.merge.ready && dr.cont) {
    const key = dr.merge.node.dataset.key;
    const items = modelOf(dr.cont);
    const at = items.findIndex((it) => home.keyOf(it) === key);
    if (at >= 0) {
      const target = items[at];
      if (target.k === 'f') {
        const f = L.folders[target.id];
        if (f && f.apps.indexOf(dr.item.p) < 0) f.apps.push(dr.item.p);
        if (dr.item.k === 'f') back();
      } else if (dr.item.k === 'a' && target.k === 'a') {
        const id = newId('f');
        L.folders[id] = { name: 'Папка', apps: [target.p, dr.item.p] };
        items.splice(at, 1, { k: 'f', id });
      } else back();
      done = true;
    }
  }
  if (!done && !cancelled && dr.holeCont && dr.hole >= 0) {
    const items = modelOf(dr.holeCont);
    items.splice(Math.min(dr.hole, items.length), 0, dr.item);
    flyTo = dr.item;
    done = true;
  }
  if (!done) back();
  if (S.sounds && done) rez.haptic('confirm');

  // the icon settles into its place, then the screen is put together again
  home.layout(dr.holeCont || home.dockEl, dr.holeCont ? modelOf(dr.holeCont) : L.dock, -1, true);
  const final = flyTo && dr.holeCont && dr.holeCont._nodes ? dr.holeCont._nodes.get(home.keyOf(flyTo)) : null;
  const finish = () => {
    ghost.classList.remove('on');
    ghost.textContent = '';
    ghost.style.transform = '';
    home.render();
  };
  if (final) {
    final.style.visibility = 'hidden';
    const r = final.getBoundingClientRect();
    ghost.style.transition = 'transform 0.18s cubic-bezier(0.22,0.9,0.26,1)';
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${r.left}px,${r.top}px) scale(1)`;
    });
    setTimeout(() => {
      ghost.style.transition = '';
      finish();
    }, 200);
  } else {
    ghost.style.transition = 'opacity 0.15s ease';
    ghost.style.opacity = '0';
    setTimeout(() => {
      ghost.style.transition = '';
      ghost.style.opacity = '';
      finish();
    }, 160);
  }
}

export const isDragging = () => !!drag;
