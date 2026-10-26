// Резонанс для ПК — the card of tray icons above the arrow on the taskbar. A click
// goes to the program as from Windows' own tray: left opens it, right opens its
// menu (with "Exit" and the rest), a double click does what it does there.

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const empty = $('empty');
const body = document.body;
const els = new Map();

const COLS = 5;

function render(list) {
  const items = Array.isArray(list) ? list : [];
  body.style.setProperty('--cols', String(Math.max(1, Math.min(COLS, items.length))));
  empty.classList.toggle('hidden', items.length > 0);
  const seen = new Set();
  items.forEach((t, i) => {
    seen.add(t.id);
    let b = els.get(t.id);
    if (!b) {
      b = document.createElement('button');
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      b.appendChild(img);
      const click = (button) => window.rez.shell('trayClick', { id: b._id, button });
      b.addEventListener('click', () => click('left'));
      b.addEventListener('dblclick', () => click('double'));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        click('right');
      });
      els.set(t.id, b);
    }
    b._id = t.id;
    const img = b.firstChild;
    if (img.getAttribute('src') !== t.icon) img.src = t.icon;
    b.title = t.tip || t.exe || '';
    if (grid.children[i] !== b) grid.insertBefore(b, grid.children[i] || null);
  });
  for (const [id, b] of els) {
    if (seen.has(id)) continue;
    els.delete(id);
    b.remove();
  }
}

window.rez.onTray(render);
window.rez.onShell((m) => {
  if (!m || typeof m !== 'object' || !('open' in m)) return;
  if (m.list) render(m.list);
  body.classList.toggle('open', !!m.open);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.rez.shell('trayClose');
});
