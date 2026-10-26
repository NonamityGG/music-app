// Резонанс для ПК — the menu of an app on the taskbar. The main process sends the
// items ({ head } | { sep } | { id, label, icon, kind, on, danger }); a pick goes
// back by its id. Arrows and Enter work too; Esc or a click elsewhere closes it.

const menu = document.getElementById('menu');
const body = document.body;

const ICON = {
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  pin: 'M16 3l5 5-2.1.9-3.3 3.3.7 4.3-1.4 1.4-3.6-3.6L6 19.6 4.4 18l5.3-5.3L6.1 9.1l1.4-1.4 4.3.7 3.3-3.3z',
  unpin: 'M3.3 2 22 20.7 20.7 22l-6.3-6.3.2 1.1-1.4 1.4-3.6-3.6L5 19.6 4.4 18l5.3-5.3L6.1 9.1l1.4-1.4.6.1L2 3.3zM16 3l5 5-2.1.9-2.4 2.4-4.9-4.9L14 4.1z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z',
  kill: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 0 1 6.3 12.9L7.1 5.7A8 8 0 0 1 12 4zM5.7 7.1l11.2 11.2A8 8 0 0 1 5.7 7.1z',
};

function svg(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICON[name] || '');
  s.appendChild(p);
  return s;
}

let buttons = [];
let kb = -1;

function render(items) {
  menu.replaceChildren();
  buttons = [];
  kb = -1;
  for (const it of items || []) {
    if (it.sep) {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
      continue;
    }
    if (it.head) {
      const h = document.createElement('div');
      h.className = 'head';
      if (it.icon) {
        const img = document.createElement('img');
        img.src = it.icon;
        img.alt = '';
        h.appendChild(img);
      } else h.appendChild(Object.assign(document.createElement('i'), { className: 'ph' }));
      h.appendChild(Object.assign(document.createElement('span'), { textContent: it.label }));
      menu.appendChild(h);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'item' + (it.kind ? ' ' + it.kind : '') + (it.on ? ' on' : '') + (it.danger ? ' danger' : '');
    b.setAttribute('role', 'menuitem');
    if (it.icon && ICON[it.icon]) b.appendChild(svg(it.icon));
    b.appendChild(Object.assign(document.createElement('span'), { textContent: it.label }));
    b.title = it.label;
    b.addEventListener('click', () => window.rez.shell('menuPick', it.id));
    menu.appendChild(b);
    buttons.push(b);
  }
}

function mark(i) {
  buttons.forEach((b, j) => b.classList.toggle('kb', j === i));
  kb = i;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return window.rez.shell('menuClose');
  if (!buttons.length) return;
  if (e.key === 'ArrowDown') mark((kb + 1) % buttons.length);
  else if (e.key === 'ArrowUp') mark((kb - 1 + buttons.length) % buttons.length);
  else if (e.key === 'Enter' && kb >= 0) buttons[kb].click();
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
  if (m.items) render(m.items);
  body.classList.toggle('open', !!m.open);
});
