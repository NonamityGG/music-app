// Резонанс Лаунчер: widgets of other apps. They are real Android views that live
// above the page; here each one is an empty place in the desktop grid, and this
// file tells the Android side where that place is on the screen (every frame it
// moves: a swipe between pages, an animation). While something is above the
// desktop (the drawer, a menu, a drag) the widgets are hidden.

import { rez, on, native } from './bridge.js';
import { S, L, save, newId } from './store.js';
import * as home from './home.js';
import * as widgets from './widgets.js';

const hooks = { toast() {}, longMenu() {} };
export { hooks };

const COVER = '#drawer.on, #drawer.following, #folder.on, #settings.on, #widgets.on, #menu.on, #hello.on, body.intro-on, #home.dragging';

if (native) document.documentElement.classList.add('native-host');

let last = '';
let known = new Set();
let running = false;

function ids() {
  const out = new Set();
  for (const page of L.pages) for (const it of page) if (it.k === 'w' && it.t === 'sys' && it.wid != null) out.add(it.wid);
  return out;
}

function frame() {
  if (!native) return;
  // widgets taken off the desktop (by any road) are let go of
  const now = ids();
  for (const id of known) if (!now.has(id)) rez.widgetRemove(id);
  known = now;

  let list = [];
  if (!document.querySelector(COVER) && !document.hidden) {
    const W = window.innerWidth;
    for (const n of document.querySelectorAll('#pager .item.w-sys')) {
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.right <= 0 || r.left >= W || n.classList.contains('lift')) continue;
      list.push({ id: +n.dataset.wid, x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
    }
  }
  const j = JSON.stringify(list);
  if (j !== last) {
    last = j;
    rez.log('виджеты: рамки ' + j);
    rez.widgetFrames(j);
  }
}

function loop() {
  frame();
  requestAnimationFrame(loop);
}

export function start() {
  if (running || !native) return;
  running = true;
  known = ids();
  requestAnimationFrame(loop);
}

// ---------- adding ----------

export function sizeFor(w, h) {
  const pad = 16;
  const cw = (home.geo.W - pad * 2) / home.geo.cols;
  const c = Math.max(1, Math.min(home.geo.cols, Math.ceil((w - 8) / cw)));
  const r = Math.max(1, Math.min(4, Math.ceil((h - 8) / home.geo.ch)));
  return [c >= 3 ? 4 : c, r];
}

export function added(info) {
  rez.log('виджет добавлен: ' + JSON.stringify(info) + ', страниц ' + L.pages.length);
  const [c, r] = sizeFor(info.w || 250, info.h || 110);
  const it = { k: 'w', t: 'sys', id: newId('w'), wid: info.id, label: info.label || 'Виджет', c, r };
  let i = Math.max(0, home.pageIndex());
  if (home.pack(L.pages[i].concat(it), home.geo.cols, home.geo.rows).over.length) {
    i = L.pages.length;
    L.pages.push([]);
  }
  L.pages[i].push(it);
  home.render();
  home.gotoGrid(i, false);
  hooks.toast('Виджет добавлен');
}

on('widgetAdded', (info) => added(info));
on('widgetFail', (msg) => hooks.toast(String(msg)));
on('widgetGone', (id) => {
  for (let i = 0; i < L.pages.length; i++) L.pages[i] = L.pages[i].filter((it) => !(it.t === 'sys' && it.wid === id));
  known.delete(id);
  home.render();
});
on('widgetSwipe', (o) => {
  home.gotoGrid(home.pageIndex() + (o && o.dir > 0 ? 1 : -1), true);
});
on('widgetLong', (o) => hooks.longMenu(o.id));
on('visible', (v) => {
  if (v) last = ''; // the layer asks again when we are back
});
