// Резонанс для ПК — the window switcher's page (Win+Tab, Alt+Tab): every open window
// as a card with its live picture when there is one, its app icon and title. The
// main process sends the list and which card is chosen; the pointer over a card
// chooses it, a click picks it, a click on the empty screen closes the switcher.

import * as shellwaves from './shellwaves.js';

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const body = document.body;

shellwaves.init($('waves'), { y: 1.0, amp: 0.2 });

let shownKeys = '';
const cards = new Map(); // window handle -> its card

function iconEl(icon) {
  if (icon) {
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    img.draggable = false;
    return img;
  }
  return Object.assign(document.createElement('i'), { className: 'ph' });
}

function makeCard(w, j) {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.animationDelay = `${j * 26}ms`;
  c.addEventListener('mouseenter', () => window.rez.shell('switchHover', c.dataset.hwnd));
  c.addEventListener('click', (e) => {
    e.stopPropagation();
    window.rez.shell('switchPick', c.dataset.hwnd);
  });
  const shot = document.createElement('div');
  shot.className = 'shot';
  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.alt = '';
  thumb.draggable = false;
  const noshot = document.createElement('div');
  noshot.className = 'noshot';
  noshot.appendChild(iconEl(w.icon));
  shot.append(thumb, noshot);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.appendChild(iconEl(w.icon));
  const t = document.createElement('span');
  t.className = 't';
  meta.append(ico, t);
  c.append(shot, meta);
  c._thumb = thumb;
  c._noshot = noshot;
  c._ico = ico;
  c._t = t;
  return c;
}

function update(c, w) {
  c.dataset.hwnd = w.hwnd;
  c._t.textContent = w.title || '';
  c.title = w.title || '';
  c.classList.toggle('min', !!w.min);
  if (w.thumb && c._thumb.getAttribute('src') !== w.thumb) {
    c._thumb.src = w.thumb;
    c.classList.add('has');
  }
}

function render(list, i, cols) {
  body.style.setProperty('--cols', String(Math.max(1, cols || list.length || 1)));
  const keys = list.map((w) => w.hwnd).join(',');
  if (keys !== shownKeys) {
    shownKeys = keys;
    grid.replaceChildren();
    cards.clear();
    list.forEach((w, j) => {
      const c = makeCard(w, j);
      cards.set(w.hwnd, c);
      grid.appendChild(c);
    });
  }
  list.forEach((w, j) => {
    const c = cards.get(w.hwnd);
    update(c, w);
    c.classList.toggle('on', j === i);
  });
  // the chosen card stays in view when there are more rows than fit
  const on = grid.querySelector('.card.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
}

// a click on the empty screen (not on a card) closes the switcher
grid.addEventListener('click', (e) => {
  if (e.target === grid) window.rez.shell('switchCancel');
});

function colors(s) {
  const c = (s && s.paletteColors) || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  body.style.setProperty('--acc', c[0]);
  body.style.setProperty('--acc3', c[1]);
  body.style.setProperty('--acc2', c[2]);
}
window.rez.settings().then(colors);
window.rez.onSettings(colors);

window.rez.onShell((m) => {
  if (!m || typeof m !== 'object' || !('open' in m)) return;
  if (m.open && Array.isArray(m.list)) render(m.list, m.i, m.cols);
  body.classList.toggle('open', !!m.open);
  shellwaves.show(!!m.open);
});
