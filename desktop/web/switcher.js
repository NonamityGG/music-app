// Резонанс для ПК — the window switcher's page. The main process sends the open
// windows and which one is chosen; a click on a tile picks that window.

const grid = document.getElementById('grid');
const body = document.body;
let shown = '';

function render(list, i) {
  const sig = list.map((w) => w.hwnd + w.title).join('|');
  if (sig !== shown) {
    shown = sig;
    grid.replaceChildren();
    body.style.setProperty('--cols', String(Math.max(1, Math.min(6, list.length))));
    for (const w of list) {
      const c = document.createElement('div');
      c.className = 'card' + (w.min ? ' min' : '');
      if (w.icon) {
        const img = document.createElement('img');
        img.src = w.icon;
        img.alt = '';
        img.draggable = false;
        c.appendChild(img);
      } else c.appendChild(Object.assign(document.createElement('i'), { className: 'ph' }));
      c.appendChild(Object.assign(document.createElement('span'), { className: 't', textContent: w.title || '' }));
      c.title = w.title || '';
      c.addEventListener('click', () => window.rez.shell('switchPick', w.hwnd));
      grid.appendChild(c);
    }
  }
  [...grid.children].forEach((c, j) => c.classList.toggle('on', j === i));
}

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
  if (m.open && Array.isArray(m.list)) render(m.list, m.i);
  body.classList.toggle('open', !!m.open);
});
