// Резонанс Лаунчер: the drawer with every app — a search that also finds in the
// internet and counts, kinds of apps as chips, the apps you open most, the
// letters on the right for a quick jump. It slides up with the finger.

import { rez } from './bridge.js';
import { S, L } from './store.js';
import * as apps from './apps.js';
import * as home from './home.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = home.el;
const drawer = $('drawer');
const input = $('q');
const scroller = $('drscroll');
const list = $('drlist');
const cats = $('cats');
const rail = $('rail');
const clear = $('qclear');

let open = false;
let cat = 'all';
let query = '';

export const isOpen = () => open;

// ---------- opening and closing ----------

function under(on) {
  home.homeEl.classList.toggle('under', on);
}

export function openDrawer(opts) {
  if (open) return;
  open = true;
  drawer.style.transition = '';
  drawer.style.transform = '';
  drawer.classList.add('on');
  under(true);
  render();
  scroller.scrollTop = 0;
  if (opts && opts.focus) setTimeout(() => input.focus(), 280);
  else if (S.drawerKeyboard) setTimeout(() => input.focus(), 280);
}

export function closeDrawer(instant) {
  if (!open) return;
  open = false;
  input.blur();
  drawer.style.transition = '';
  drawer.style.transform = '';
  if (instant) drawer.style.transition = 'none';
  drawer.classList.remove('on');
  under(false);
  if (instant) {
    void drawer.offsetWidth;
    drawer.style.transition = '';
  }
  setTimeout(() => {
    if (!open) {
      query = '';
      input.value = '';
      cat = 'all';
    }
  }, 320);
}

// following the finger while swiping up (p: 0..1) and settling after
export function follow(p) {
  if (!drawer.classList.contains('following')) {
    drawer.classList.add('following');
    render();
    scroller.scrollTop = 0;
  }
  drawer.style.transition = 'none';
  home.homeEl.style.transition = 'none';
  drawer.style.transform = `translateY(${((1 - Math.max(0, Math.min(1, p))) * 100).toFixed(2)}%)`;
  home.homeEl.style.setProperty('--under', Math.max(0, Math.min(1, p)).toFixed(3));
}

export function settle(wantOpen) {
  drawer.classList.remove('following');
  home.homeEl.style.removeProperty('--under');
  home.homeEl.style.transition = '';
  drawer.style.transition = '';
  drawer.style.transform = '';
  if (wantOpen) {
    open = false;
    openDrawer();
  } else {
    open = true;
    closeDrawer();
  }
}

// ---------- the content ----------

function grid(items, cls, letters) {
  const g = el('div', 'dr-grid' + (cls ? ' ' + cls : ''));
  g.dataset.where = 'drawer';
  const rows = S.drawerStyle === 'list';
  g.classList.toggle('as-list', rows);
  for (const a of items) {
    const n = home.buildItem({ k: 'a', p: a.pkg }, 'drawer');
    if (!n) continue;
    n.dataset.key = 'a:' + a.pkg;
    if (letters) n.dataset.letter = apps.letterOf(a);
    if (apps.isNew(a)) n.classList.add('fresh');
    if (apps.hidden(a)) n.classList.add('is-hidden');
    g.appendChild(n);
  }
  return g;
}

function heading(text) {
  return el('div', 'dr-h', text);
}

function row(glyph, title, sub, fn) {
  const r = el('button', 'dr-row');
  const ic = el('i');
  ic.appendChild(icon(glyph));
  const t = el('div');
  t.append(el('b', '', title), el('span', '', sub || ''));
  r.append(ic, t);
  r.addEventListener('click', fn);
  return r;
}

function renderCats() {
  cats.textContent = '';
  cats.classList.toggle('hidden', !S.drawerCats || !!query);
  for (const c of apps.CATS) {
    if (c.id !== 'all' && !apps.visible().some((a) => apps.inCat(a, c.id))) continue;
    const b = el('button', 'chip' + (c.id === cat ? ' on' : ''), c.name);
    b.addEventListener('click', () => {
      cat = c.id;
      render();
      scroller.scrollTop = 0;
    });
    cats.appendChild(b);
  }
}

export function render() {
  list.textContent = '';
  rail.textContent = '';
  rail.classList.add('hidden');
  clear.classList.toggle('hidden', !query);
  renderCats();
  list.style.setProperty('--dcols', home.geo.tablet ? Math.min(8, home.geo.cols + 1) : home.geo.cols);

  if (query) {
    const sum = apps.calc(query);
    if (sum) list.appendChild(row('plus', sum, query + ' =', () => rez.openUrl(apps.webUrl(query))));
    const found = apps.search(query);
    if (found.length) {
      list.appendChild(heading('Приложения'));
      list.appendChild(grid(found));
    }
    list.appendChild(row('search', `Найти «${query}»`, 'в ' + apps.engineName(), () => rez.openUrl(apps.webUrl(query))));
    if (!found.length && !sum) list.appendChild(el('div', 'dr-empty', 'Приложений с таким названием нет'));
    return;
  }

  const all = apps.visible().filter((a) => apps.inCat(a, cat));
  if (cat === 'all' && !S.drawerStyleHideFreq) {
    const freq = apps.frequent(home.geo.tablet ? 7 : Math.min(5, home.geo.cols));
    if (freq.length >= 3) {
      list.appendChild(heading('Часто открываете'));
      list.appendChild(grid(freq, 'freq'));
    }
  }
  if (!all.length) {
    list.appendChild(el('div', 'dr-empty', 'Здесь пока пусто'));
    return;
  }
  // by letters: a list has the letters as headings, a grid is one field (the letters only jump to the first one)
  const letters = [];
  for (const a of all) {
    const ch = apps.letterOf(a);
    if (letters[letters.length - 1] !== ch) letters.push(ch);
  }
  if (S.drawerStyle === 'list') {
    let cur = null;
    let box = [];
    const flush = () => {
      if (!cur) return;
      const h = heading(cur);
      h.dataset.letter = cur;
      list.appendChild(h);
      list.appendChild(grid(box));
    };
    for (const a of all) {
      const ch = apps.letterOf(a);
      if (ch !== cur) {
        flush();
        cur = ch;
        box = [];
      }
      box.push(a);
    }
    flush();
  } else {
    list.appendChild(grid(all, 'all', true));
  }
  if (letters.length > 4 && cat === 'all') {
    rail.classList.remove('hidden');
    for (const ch of letters) {
      const b = el('i', '', ch);
      b.dataset.letter = ch;
      rail.appendChild(b);
    }
  }
}

// ---------- search ----------

input.addEventListener('input', () => {
  query = input.value.trim();
  render();
  scroller.scrollTop = 0;
});

input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const sum = apps.calc(query);
  const found = apps.search(query);
  if (found.length && !sum) {
    rez.launch(found[0].pkg);
    apps.used(found[0].pkg);
  } else if (query) rez.openUrl(apps.webUrl(query));
  input.blur();
});

clear.addEventListener('click', () => {
  input.value = '';
  query = '';
  render();
  input.focus();
});

$('drgear').addEventListener('click', () => document.dispatchEvent(new CustomEvent('rez-open-settings')));

// ---------- the letters ----------

function jump(y) {
  const items = Array.prototype.slice.call(rail.children);
  if (!items.length) return;
  const r = rail.getBoundingClientRect();
  const i = Math.max(0, Math.min(items.length - 1, Math.floor(((y - r.top) / r.height) * items.length)));
  const ch = items[i].dataset.letter;
  const h = list.querySelector(`[data-letter="${ch}"]`);
  if (h) scroller.scrollTop = Math.max(0, h.offsetTop - (h.classList.contains('dr-h') ? 4 : 10));
  const bub = $('bubble');
  bub.textContent = ch;
  bub.classList.add('on');
  items.forEach((n, k) => n.classList.toggle('on', k === i));
}
rail.addEventListener('pointerdown', (e) => {
  rail.setPointerCapture(e.pointerId);
  jump(e.clientY);
});
rail.addEventListener('pointermove', (e) => {
  if (rail.hasPointerCapture(e.pointerId)) jump(e.clientY);
});
const endRail = () => {
  $('bubble').classList.remove('on');
  for (const n of rail.children) n.classList.remove('on');
};
rail.addEventListener('pointerup', endRail);
rail.addEventListener('pointercancel', endRail);

// a downward swipe from the top of the list closes the drawer, following the finger
let sw = null;
drawer.addEventListener('pointerdown', (e) => {
  if (e.target.closest('input, .dr-rail, button')) return;
  sw = { id: e.pointerId, y: e.clientY, x: e.clientX, on: false, top: scroller.scrollTop <= 0 };
});
window.addEventListener('pointermove', (e) => {
  if (!sw || e.pointerId !== sw.id || !open) return;
  const dy = e.clientY - sw.y;
  const dx = e.clientX - sw.x;
  if (!sw.on) {
    if (!sw.top && scroller.scrollTop > 0) {
      sw = null;
      return;
    }
    if (dy > 14 && dy > Math.abs(dx) * 1.5 && scroller.scrollTop <= 0) {
      sw.on = true;
      input.blur();
    } else return;
  }
  drawer.style.transition = 'none';
  drawer.style.transform = `translateY(${Math.max(0, dy) * 0.9}px)`;
  sw.dy = dy;
});
window.addEventListener('pointerup', (e) => {
  if (!sw || e.pointerId !== sw.id) return;
  const s = sw;
  sw = null;
  if (!s.on) return;
  drawer.style.transition = '';
  drawer.style.transform = '';
  if ((s.dy || 0) > 140) closeDrawer();
});

document.addEventListener('rez-drawer-refresh', () => {
  if (open) render();
});
apps.onApps(() => {
  if (open) render();
});
