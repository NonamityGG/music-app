// Резонанс для ПК — the taskbar along the bottom: Start, the apps pinned to the
// Windows taskbar and the open windows grouped by app (a click brings the app
// forward, minimises it if it's in front, or steps through its windows; a middle
// click opens a new one), the programs' tray icons, Quick settings with Wi-Fi,
// volume and battery (the wheel changes the volume), the clock and "show
// desktop". Windows' own taskbar is hidden altogether.

const $ = (id) => document.getElementById(id);
const body = document.body;
const appsBox = $('apps');

const ICON = {
  wifi: 'M12 21l3-3a4.2 4.2 0 0 0-6 0l3 3zm0-6a7.5 7.5 0 0 1 5.3 2.2l1.7-1.7a9.9 9.9 0 0 0-14 0l1.7 1.7A7.5 7.5 0 0 1 12 15zm0-5c2.9 0 5.6 1.1 7.6 3.1l1.7-1.7A13.4 13.4 0 0 0 12 5 13.4 13.4 0 0 0 2.7 11.4l1.7 1.7A10.6 10.6 0 0 1 12 10z',
  wifiOff: 'M2.3 3.7 3.7 2.3l18 18-1.4 1.4-5.5-5.5A4.2 4.2 0 0 0 12 15.5c-1 0-2 .4-2.8 1.1L12 21l-3-3a4.2 4.2 0 0 1 3.7-1.1L9.4 13.6a7.5 7.5 0 0 0-2.7 1.9L5 13.8a9.9 9.9 0 0 1 2.8-1.9L5.6 9.7a13 13 0 0 0-2.9 1.7L1 9.7a15 15 0 0 1 2.9-1.8zM12 5c3.6 0 6.9 1.4 9.3 3.7l-1.7 1.7A10.6 10.6 0 0 0 11 7.5L8.6 5.2C9.7 5.1 10.8 5 12 5z',
  vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  volLow: 'M5 9v6h4l5 5V4L9 9H5zm13.5 3A4.5 4.5 0 0 0 16 8v8a4.5 4.5 0 0 0 2.5-4z',
  mute: 'M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45a4.9 4.9 0 0 0 .05-.63zM19 12a7 7 0 0 1-.73 3.1l1.46 1.46A9 9 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25a7 7 0 0 1-2.25 1.21v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z',
  battery: 'M16 4h-2V2h-4v2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
  bolt: 'M7 2v11h3v9l7-12h-4l4-8z',
  chevron: 'M12 8.3 5.7 14.6l1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4z',
  // a cable connection: a screen on a stand with a plug-in line
  ethernet: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-8v2h3v2H8v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6zm3.5 2h9v2h-9zm0 3h6v2h-6z',
  netOff: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-8v2h3v2H8v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6zm5.2 1.8L12 10.6l2.8-2.8 1.4 1.4-2.8 2.8 2.8 2.8-1.4 1.4-2.8-2.8-2.8 2.8-1.4-1.4 2.8-2.8-2.8-2.8z',
  mobile: 'M4 20h3V14H4zm5 0h3V10H9zm5 0h3V6h-3zm5 0h2V2h-2z',
};

// what the network looks like: the icon and the words for the hover
function netIcon(s) {
  if (s.net === 'none' || s.netLevel === 'none') return s.net === 'wifi' ? 'wifiOff' : 'netOff';
  if (s.net === 'ethernet') return 'ethernet';
  if (s.net === 'mobile') return 'mobile';
  return s.wifi === false ? 'wifiOff' : 'wifi';
}
const NET_KIND = { ethernet: 'кабель', wifi: 'Wi-Fi', mobile: 'мобильная сеть' };
const NET_LEVEL = { internet: 'интернет есть', limited: 'интернет ограничен (нужен вход?)', local: 'только локальная сеть, интернета нет', none: 'нет подключения' };
function netText(s) {
  if (!s.net) return '';
  if (s.net === 'none') return 'Сеть: нет подключения';
  return `Сеть: ${s.netName || NET_KIND[s.net] || ''} (${NET_KIND[s.net] || s.net}) · ${NET_LEVEL[s.netLevel] || ''}`;
}

function svg(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICON[name] || '');
  p.setAttribute('fill', 'currentColor');
  s.appendChild(p);
  return s;
}
function put(el, ...kids) {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const k of kids) el.append(k);
}

// ---------- settings: the same look as the top bar ----------

let settings = {};
function apply(s) {
  if (!s) return;
  settings = s;
  body.dataset.bg = s.bg || 'glass-violet';
  // the see-through taskbar: no acrylic from Windows, the page's own frosted tint
  body.classList.toggle('clearable', !!s.taskbarClear);
  body.style.setProperty('--tint-a', String(s.barTint ?? 0.42));
  const c = s.paletteColors || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  c.forEach((v, i) => body.style.setProperty(`--c${i + 1}`, v));
}
window.rez.settings().then(apply);
window.rez.onSettings(apply);

// ---------- Start and Quick ----------

$('start').addEventListener('click', () => window.rez.shell('toggleStart'));
$('quick').addEventListener('click', () => window.rez.shell('toggleQuick'));
$('clock').addEventListener('click', () => window.rez.shell('toggleQuick'));
$('desk').addEventListener('click', () => window.rez.shell('showDesktop'));

// which menu is open (the buttons stay lit while it is)
window.rez.onShell((m) => {
  if (!m || typeof m !== 'object') return;
  if ('start' in m) $('start').classList.toggle('open', !!m.start);
  if ('quick' in m) $('quick').classList.toggle('open', !!m.quick);
});

// ---------- the apps: pinned + open windows, grouped by app ----------

let pins = [];
let wins = [];
const els = new Map();
const lower = (p) => String(p || '').toLowerCase();
const frameHost = (exe) => /applicationframehost\.exe$/i.test(exe || '');

function groups() {
  const byKey = new Map();
  const order = [];
  for (const p of pins) {
    const key = /\.exe$/i.test(p.target || '') ? 'exe:' + lower(p.target) : 'pin:' + lower(p.path);
    if (byKey.has(key)) continue;
    const g = { key, pin: p, wins: [] };
    byKey.set(key, g);
    order.push(g);
  }
  for (const w of wins) {
    // Store apps all live in one frame host: each of their windows on its own
    const key = w.exe && !frameHost(w.exe) ? 'exe:' + lower(w.exe) : 'win:' + w.hwnd;
    let g = byKey.get(key);
    if (!g) {
      g = { key, pin: null, wins: [] };
      byKey.set(key, g);
      order.push(g);
    }
    g.wins.push(w);
  }
  // the order the user dragged the buttons into; new ones keep their place after
  const pos = new Map((settings.taskOrder || []).map((k, i) => [k, i]));
  const natural = new Map(order.map((g, i) => [g.key, i]));
  return order.sort((a, b) => {
    const pa = pos.has(a.key) ? pos.get(a.key) : 1e6 + natural.get(a.key);
    const pb = pos.has(b.key) ? pos.get(b.key) : 1e6 + natural.get(b.key);
    return pa - pb;
  });
}

const baseName = (p) => String(p || '').split(/[\\/]/).pop().replace(/\.exe$/i, '');

// what the menu of an app needs to know about it
function describe(g) {
  const front = g.wins.find((w) => w.active) || g.wins[0];
  const exe = g.pin && /\.exe$/i.test(g.pin.target || '') ? g.pin.target : front && !frameHost(front.exe) ? front.exe : '';
  return {
    key: g.key,
    name: g.pin ? g.pin.name : exe ? baseName(exe) : (front && front.title) || '',
    icon: (g.pin && g.pin.icon) || (front && front.icon) || '',
    exe,
    launch: (g.pin && g.pin.path) || exe,
    pinPath: g.pin && !g.pin.own ? g.pin.path : '',
    pinOwn: !!(g.pin && g.pin.own),
    pinned: !!g.pin,
    wins: g.wins.map((w) => ({ hwnd: w.hwnd, title: w.title, active: !!w.active })),
  };
}

function makeItem(key) {
  const el = document.createElement('button');
  el.className = 'app enter';
  el.dataset.key = key;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  const ph = document.createElement('span');
  ph.className = 'ph';
  const dot = document.createElement('span');
  dot.className = 'dot';
  el.append(img, ph, dot);
  el.addEventListener('click', () => {
    if (el._dragged) return (el._dragged = false); // the end of a drag, not a click
    onItem(el);
  });
  // the right button: the app's menu (its windows, new window, pin, close)
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!el._g) return;
    const r = el.getBoundingClientRect();
    window.rez.shell('appMenu', { g: describe(el._g), x: Math.round(window.screenX + r.left + r.width / 2) });
  });
  el.addEventListener('pointerdown', (e) => startDrag(e, el));
  // the middle button: a new window of the app
  el.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const g = el._g;
    const path = (g.pin && g.pin.path) || (g.wins[0] && g.wins[0].exe);
    if (path) window.rez.shell('launch', { path });
  });
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter')));
  return el;
}

function update(el, g) {
  el._g = g;
  const front = g.wins.find((w) => w.active) || g.wins.find((w) => !w.min) || g.wins[0];
  const icon = (g.pin && g.pin.icon) || (front && front.icon) || '';
  if (el._icon !== icon) {
    el._icon = icon;
    const img = el.querySelector('img');
    if (icon) img.src = icon;
    img.classList.toggle('hidden', !icon);
    el.querySelector('.ph').classList.toggle('hidden', !!icon);
  }
  const name = front ? front.title : g.pin ? g.pin.name : '';
  el.title = g.wins.length > 1 ? `${name}  ·  окон: ${g.wins.length}` : name;
  el.classList.toggle('running', g.wins.length > 0);
  el.classList.toggle('active', g.wins.some((w) => w.active));
  el.classList.toggle('min', g.wins.length > 0 && g.wins.every((w) => w.min));
}

function onItem(el) {
  const g = el._g;
  if (!g) return;
  el.classList.add('press');
  setTimeout(() => el.classList.remove('press'), 160);
  if (!g.wins.length) {
    if (g.pin) window.rez.shell('launch', { path: g.pin.path });
    return;
  }
  const ai = g.wins.findIndex((w) => w.active);
  let target;
  if (ai === -1) target = g.wins.find((w) => !w.min) || g.wins[0]; // the app forward
  else if (g.wins.length === 1) target = g.wins[0]; // in front already: minimise
  else target = g.wins[(ai + 1) % g.wins.length]; // step through its windows
  window.rez.shell('activate', { hwnd: target.hwnd });
}

// ---------- dragging the buttons into another order ----------
// Past a few pixels the button follows the mouse; its neighbours slide out of
// the way. Let go: the new order is kept (in Резонанс's settings).

let drag = null;
let renderLater = false;

function startDrag(e, el) {
  if (e.button !== 0) return;
  drag = { el, x0: e.clientX, id: e.pointerId, on: false };
  el.addEventListener('pointermove', moveDrag);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
}

function moveDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const el = drag.el;
  const dx = e.clientX - drag.x0;
  if (!drag.on) {
    if (Math.abs(dx) < 6) return;
    drag.on = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
  }
  // the gap the mouse is over: put the button there
  const live = [...appsBox.children].filter((c) => !c.classList.contains('leaving'));
  const others = live.filter((c) => c !== el);
  let at = others.findIndex((c) => {
    const r = c.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2;
  });
  if (at === -1) at = others.length;
  const before = others[at] || null;
  if (el.nextSibling !== before && before !== el) slide(() => appsBox.insertBefore(el, before), el);
  // follow the mouse: the shift from where the button now sits in the row
  const r = el.getBoundingClientRect();
  const home = r.left - (parseFloat(el.dataset.tx) || 0);
  const tx = e.clientX - home - r.width / 2;
  el.dataset.tx = String(tx);
  el.style.transform = `translateX(${tx}px)`;
}

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { el, on } = drag;
  drag = null;
  el.removeEventListener('pointermove', moveDrag);
  el.removeEventListener('pointerup', endDrag);
  el.removeEventListener('pointercancel', endDrag);
  if (!on) return;
  el._dragged = true;
  setTimeout(() => (el._dragged = false), 0);
  el.classList.remove('drag');
  el.style.transform = '';
  delete el.dataset.tx;
  const keys = [...appsBox.children].filter((c) => !c.classList.contains('leaving')).map((c) => c.dataset.key);
  settings = { ...settings, taskOrder: keys };
  window.rez.shell('taskOrder', keys);
  if (renderLater) {
    renderLater = false;
    render();
  }
}

// neighbours glide to their new places instead of jumping (FLIP)
function slide(change, skip) {
  const kids = [...appsBox.children].filter((c) => c !== skip);
  const before = new Map(kids.map((c) => [c, c.getBoundingClientRect().left]));
  change();
  for (const c of kids) {
    const d = before.get(c) - c.getBoundingClientRect().left;
    if (!d) continue;
    c.style.transition = 'none';
    c.style.transform = `translateX(${d}px)`;
    requestAnimationFrame(() => {
      c.style.transition = '';
      c.style.transform = '';
    });
  }
}

function render() {
  if (drag && drag.on) return (renderLater = true);
  const list = groups();
  const seen = new Set();
  list.forEach((g, i) => {
    seen.add(g.key);
    let el = els.get(g.key);
    if (!el) {
      el = makeItem(g.key);
      els.set(g.key, el);
    }
    update(el, g);
    const live = [...appsBox.children].filter((c) => !c.classList.contains('leaving'));
    if (live[i] !== el) appsBox.insertBefore(el, live[i] || null);
  });
  for (const [k, el] of els) {
    if (seen.has(k)) continue;
    els.delete(k);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }
}

window.rez.onTaskpins((list) => {
  pins = Array.isArray(list) ? list : [];
  render();
});
window.rez.onWindows((list) => {
  wins = Array.isArray(list) ? list : [];
  render();
});

// ---------- the tray: the programs' icons (the helper keeps them now) ----------
// All of them sit under the arrow, as in Windows: a click on it opens a card
// with the icons above it (its own window — this strip is too low for it).

const trayBtn = $('tray');
put(trayBtn, svg('chevron'));
trayBtn.addEventListener('click', () => {
  const r = trayBtn.getBoundingClientRect();
  window.rez.shell('trayOpen', { x: Math.round(window.screenX + r.left + r.width / 2) });
});
window.rez.onTray((list) => {
  const n = Array.isArray(list) ? list.length : 0;
  trayBtn.title = n ? `Значки программ: ${n}` : 'Значков программ нет';
  trayBtn.classList.toggle('none', n === 0);
});
window.rez.onShell((m) => {
  if (m && typeof m === 'object' && 'tray' in m) trayBtn.classList.toggle('open', !!m.tray);
  // the see-through taskbar (frosted again under Start or a maximised window)
  if (m && typeof m === 'object' && 'clear' in m) body.classList.toggle('clear', !!m.clear);
});

// ---------- Wi-Fi, volume, battery ----------

let status = {};
function renderStatus() {
  put($('qWifi'), svg(netIcon(status)));
  const v = typeof status.vol === 'number' ? status.vol : 50;
  put($('qVol'), svg(status.muted || v === 0 ? 'mute' : v < 40 ? 'volLow' : 'vol'));
  const bat = $('qBat');
  if (typeof status.battery === 'number') {
    bat.classList.remove('hidden');
    const t = document.createElement('span');
    t.textContent = `${status.battery}%`;
    put(bat, svg(status.charging ? 'bolt' : 'battery'), t);
  } else bat.classList.add('hidden');
  const net = netText(status);
  $('quick').title = (net ? net + '\n' : '') + `Звук: ${status.muted ? 'выключен' : v + '%'}` + (typeof status.battery === 'number' ? `\nБатарея: ${status.battery}%${status.charging ? ', заряжается' : ''}` : '');
}
window.rez.onStatus((m) => {
  status = { ...status, ...(m || {}) };
  renderStatus();
});
renderStatus();

// the wheel over the icons: volume in steps of 2
let wheelAt = 0;
$('quick').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - wheelAt < 40) return;
    wheelAt = now;
    const v = typeof status.vol === 'number' ? status.vol : 50;
    const next = Math.max(0, Math.min(100, v + (e.deltaY < 0 ? 2 : -2)));
    if (next === v) return;
    status.vol = next;
    if (status.muted) {
      status.muted = false;
      window.rez.shell('mute', { on: false });
    }
    window.rez.shell('volume', { level: next });
    renderStatus();
  },
  { passive: false },
);

// ---------- clock ----------

const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
function tick() {
  const d = new Date();
  $('time').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('date').textContent = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
tick();
setInterval(tick, 1000);
