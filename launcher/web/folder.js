// Резонанс Лаунчер: an open folder — a card over the desktop with its apps and
// a name that can be changed.

import { rez } from './bridge.js';
import { L, saveLayout } from './store.js';
import * as home from './home.js';
import * as apps from './apps.js';

const $ = (id) => document.getElementById(id);
const el = home.el;
const box = $('folder');
const card = $('fcard');
let openId = null;

export const isOpen = () => !!openId;

export function openFolder(id, rect) {
  const f = L.folders[id];
  if (!f) return;
  openId = id;
  box.dataset.id = id;
  paint();
  box.classList.add('on');
  // it grows out of the folder's icon
  if (rect && card.animate) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r = card.getBoundingClientRect();
    card.animate(
      [
        { transform: `translate(${cx - (r.left + r.width / 2)}px,${cy - (r.top + r.height / 2)}px) scale(0.2)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 280, easing: 'cubic-bezier(0.22,0.9,0.26,1)' }
    );
  }
}

export function closeFolder(instant) {
  if (!openId) return;
  const id = openId;
  openId = null;
  box.classList.remove('on');
  // a folder with one app becomes that app
  const f = L.folders[id];
  if (f && f.apps.length < 2) home.render();
  else if (!instant) home.render();
  saveLayout();
}

function paint() {
  const f = L.folders[openId];
  card.textContent = '';
  const title = el('input', 'f-title');
  title.value = f.name || 'Папка';
  title.maxLength = 24;
  title.setAttribute('aria-label', 'Название папки');
  title.addEventListener('change', () => {
    f.name = title.value.trim() || 'Папка';
    saveLayout();
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.blur();
  });
  card.appendChild(title);
  const grid = el('div', 'f-grid');
  grid.dataset.where = 'folder';
  for (const pkg of f.apps) {
    const n = home.buildItem({ k: 'a', p: pkg }, 'folder');
    if (n) grid.appendChild(n);
  }
  card.appendChild(grid);
}

export function rename(id) {
  if (openId !== id) openFolder(id);
  const t = card.querySelector('.f-title');
  if (t) {
    t.focus();
    t.select();
  }
}

box.addEventListener('pointerdown', (e) => {
  if (e.target === box) closeFolder();
});

void rez;
void apps;
