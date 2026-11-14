// Small pieces shared by the home screen and the drawer: an icon, a toast,
// the menu of a long press with its lifted icon, and the settings sheet.

import { rez, on } from './bridge.js';
import { S, save, used } from './store.js';
import * as apps from './apps.js';
import * as look from './look.js';
import { KINDS } from './widgets.js';
import * as weather from './weather.js';

export const $ = (s) => document.querySelector(s);
const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
export const ICONS = {
  pin: svg('<path d="M12 4v10M7 9l5-5 5 5M5 20h14"/>'),
  unpin: svg('<path d="M5 12h14"/><circle cx="12" cy="12" r="8.5"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
  del: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
  sc: svg('<path d="M13 4l-7 9h6l-1 7 7-9h-6l1-7z"/>'),
  web: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>'),
  store: svg('<path d="M5 8h14l-1 11H6L5 8zM9 8V6a3 3 0 0 1 6 0v2"/>'),
  home: svg('<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
  wall: svg('<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M4 15c3-3 5-3 8 0s5 3 8 0"/>'),
  page: svg('<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M12 9v6M9 12h6"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0"/>'),
};

// ---------- an icon ----------

export function icon(app, where) {
  const el = document.createElement('div');
  el.className = 'app';
  el.dataset.pkg = app.pkg;
  el.dataset.where = where;
  el.innerHTML = `<span class="ic"><img alt="" decoding="async"${where === 'drawer' ? ' loading="lazy"' : ''}><i class="dot"></i></span><span class="lb"></span>`;
  el.querySelector('img').src = rez.iconUrl(app.pkg);
  el.querySelector('.lb').textContent = app.label;
  if (badges[app.pkg]) el.classList.add('badge');
  return el;
}

let badges = {};
export function setBadges(b) {
  badges = b || {};
  for (const el of document.querySelectorAll('.app')) el.classList.toggle('badge', !!badges[el.dataset.pkg]);
}

export function launch(el) {
  const pkg = el.dataset.pkg;
  const r = el.querySelector('.ic').getBoundingClientRect();
  rez.haptic('tick');
  if (rez.launch(pkg, r)) used(pkg);
}

// ---------- a toast ----------

let toastT = 0;
export function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2200);
}

// ---------- the lifted icon or widget (a long press, and what is dragged) ----------

// the part that is lifted: an icon's picture, a widget's card
export const liftBox = (el) => el.querySelector('.ic') || el.querySelector('.wcard') || el;

export let ghost = null;
export function lift(el) {
  drop(true);
  const box = liftBox(el);
  const r = box.getBoundingClientRect();
  const g = document.createElement('div');
  g.className = 'ghost';
  g.style.width = r.width + 'px';
  g.style.height = r.height + 'px';
  const img = el.querySelector('.ic img');
  if (img) {
    g.innerHTML = '<img alt="">';
    g.querySelector('img').src = img.src;
  } else {
    // a widget: a copy of its card (it shows the same), in the same palette
    g.classList.add('wghost', ...[...el.classList].filter((c) => /^(wd-|s-)/.test(c)));
    g.appendChild(box.cloneNode(true));
  }
  g.style.transform = `translate3d(${r.left}px,${r.top}px,0)`;
  document.body.appendChild(g);
  ghost = { g, el, r, x: r.left, y: r.top };
  el.classList.add('lift');
  void g.offsetWidth; // the start is laid out, so the lift is animated
  g.style.transform = `translate3d(${r.left}px,${r.top}px,0) scale(${img ? 1.1 : 1.03})`;
  return ghost;
}

// the lifted one goes back to where it is now (or simply fades)
export function drop(now) {
  if (!ghost) return;
  const { g, el } = ghost;
  ghost = null;
  const target = el.isConnected ? el : null;
  if (now || !target) {
    g.remove();
    if (target) el.classList.remove('lift', 'hole');
    return;
  }
  const r = liftBox(el).getBoundingClientRect();
  g.classList.remove('drag');
  g.style.width = r.width + 'px';
  g.style.height = r.height + 'px';
  g.style.transform = `translate3d(${r.left}px,${r.top}px,0)`;
  setTimeout(() => {
    el.classList.remove('lift', 'hole');
    g.remove();
  }, 260);
}

// ---------- the menu of a long press ----------

export const menu = { open: false, key: null };
const pop = $('#menu');
const scrim = $('#scrim');

const SIZE_NAMES = { '1x1': 'Мини', '2x1': 'Полоска', '2x2': 'Квадрат', '4x1': 'Широкий', '4x2': 'Большой' };

// opts: { onHome, remove(), pin() } for an app; { widget: true, sizes, size, resize(s), remove() } for a widget
export function openMenu(el, opts) {
  const key = el.dataset.pkg || el.dataset.key;
  const app = el.dataset.pkg ? apps.get(el.dataset.pkg) : null;
  if (!app && !opts.widget) return;
  rez.haptic('press');
  lift(el);
  menu.open = true;
  menu.key = key;
  pop.innerHTML = '';
  const acts = document.createElement('div');
  acts.className = 'acts';
  const act = (cls, ic, label, fn) => {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = ic + `<span>${label}</span>`;
    b.onclick = () => {
      closeMenu();
      fn();
    };
    acts.appendChild(b);
  };
  let rows = 0;
  if (app) {
    const pkg = app.pkg;
    for (const s of rez.shortcuts(pkg).slice(0, 4)) {
      const b = document.createElement('button');
      b.className = 'row';
      b.innerHTML = ICONS.sc + '<span></span>';
      b.querySelector('span').textContent = s.label;
      b.onclick = () => {
        closeMenu();
        rez.startShortcut(pkg, s.id);
      };
      pop.appendChild(b);
      rows++;
    }
    if (opts.onHome) act('', ICONS.unpin, 'Убрать', opts.remove);
    else act('', ICONS.pin, 'На экран', opts.pin);
    act('', ICONS.info, 'О приложении', () => rez.appInfo(pkg));
    if (!app.sys) act('del', ICONS.del, 'Удалить', () => rez.uninstall(pkg));
  } else {
    // a widget: its sizes, as little pictures of the cells it would take
    const sz = document.createElement('div');
    sz.className = 'sizes';
    for (const s of opts.sizes) {
      const [w, h] = s.split('x').map(Number);
      const b = document.createElement('button');
      b.className = 'size' + (s === opts.size ? ' on' : '');
      b.innerHTML = `<i style="--w:${w};--h:${h}"></i><span>${SIZE_NAMES[s] || s}</span>`;
      b.onclick = () => {
        rez.haptic('tick');
        opts.resize(s);
        closeMenu();
      };
      sz.appendChild(b);
    }
    if (opts.sizes.length > 1) {
      pop.appendChild(sz);
      rows++;
    }
    act('', ICONS.unpin, 'Убрать виджет', opts.remove);
  }
  if (!rows) acts.style.cssText = 'margin-top:0;padding-top:0;border-top:0';
  pop.appendChild(acts);

  // above the icon when there is room, otherwise below it
  const r = liftBox(el).getBoundingClientRect();
  const W = window.innerWidth;
  const top0 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t')) || 24;
  const pw = Math.min(W - 32, Math.max(280, pop.offsetWidth));
  const ph = pop.offsetHeight;
  let y = r.top - ph - 16;
  let below = false;
  if (y < top0 + 8) {
    y = Math.min(r.bottom + (app ? 30 : 14), window.innerHeight - ph - 16);
    below = true;
  }
  const x = Math.max(16, Math.min(W - pw - 16, r.left + r.width / 2 - pw / 2));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  pop.style.transformOrigin = `${r.left + r.width / 2 - x}px ${below ? -20 : ph + 20}px`;
  scrim.classList.add('on');
  void pop.offsetWidth;
  pop.classList.add('on');
}

export function closeMenu(keepGhost) {
  if (!menu.open) return;
  menu.open = false;
  pop.classList.remove('on');
  if (!sheetOpen) scrim.classList.remove('on');
  if (!keepGhost) drop();
}

// ---------- the settings sheet ----------

let sheetOpen = false;
const sheet = $('#sheet');
export const isSheet = () => sheetOpen;
// what the home screen does for the sheet (main.js fills these in)
export const homeHooks = { addWidget: () => {}, newPage: () => {} };

export function openSheet() {
  rez.haptic('press');
  sheetOpen = true;
  renderSheet();
  sheet.scrollTop = 0;
  scrim.classList.add('on');
  sheet.classList.add('on');
}
export function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  sheet.classList.remove('on');
  sheet.style.transform = '';
  if (!menu.open) scrim.classList.remove('on');
}

function renderSheet() {
  const info = rez.info();
  const body = $('#sheet-body');
  body.innerHTML = '';
  const sec = (title) => {
    const s = document.createElement('div');
    s.className = 'sec';
    s.innerHTML = `<h4>${title}</h4>`;
    body.appendChild(s);
    return s;
  };

  if (info.home === false) {
    const b = link(ICONS.home, 'Сделать главным экраном', () => rez.openHomeSettings(), true);
    body.appendChild(b);
    b.style.marginBottom = '22px';
  }

  const ws = sec('Виджеты');
  const wl = document.createElement('div');
  wl.className = 'wpick';
  for (const [kind, k] of Object.entries(KINDS)) {
    const [w, h] = k.sizes[0].split('x').map(Number);
    const b = document.createElement('button');
    b.className = 'wp glass';
    b.innerHTML = `<i class="wp-ic wp-${kind}" style="--w:${w};--h:${h}"></i><b></b><span></span>`;
    b.querySelector('b').textContent = k.name;
    b.querySelector('span').textContent = k.sub;
    b.onclick = () => {
      rez.haptic('tick');
      closeSheet();
      homeHooks.addWidget(kind);
    };
    wl.appendChild(b);
  }
  ws.appendChild(wl);
  const np = link(ICONS.page, 'Новая страница', () => homeHooks.newPage());
  ws.appendChild(np);

  // the weather's town, when a weather widget is on the screen: found by name
  // (the internet address may be a VPN's, in another country)
  if ((S.pages || []).flat().some((k) => k.startsWith('#weather'))) {
    const wx = sec('Погода');
    const now = weather.now();
    const line = document.createElement('p');
    line.className = 'hint';
    line.textContent = S.city ? `Город: ${S.city.name}` : `Город по сети: ${(now && now.city) || 'ещё не известен'}. Если не тот — найди свой.`;
    wx.appendChild(line);
    const box = document.createElement('label');
    box.className = 'town glass';
    box.innerHTML = '<input type="search" placeholder="Город" autocomplete="off" enterkeyhint="search">';
    const list = document.createElement('div');
    list.className = 'towns';
    const input = box.querySelector('input');
    let t = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 2) return (list.innerHTML = '');
      t = setTimeout(async () => {
        let found = [];
        try {
          found = await weather.towns(q);
        } catch {}
        if (input.value.trim() !== q) return;
        list.innerHTML = '';
        if (!found.length) list.innerHTML = '<p class="hint">Не нашлось</p>';
        for (const c of found) {
          const b = document.createElement('button');
          b.className = 'tw';
          b.innerHTML = '<b></b><span></span>';
          b.querySelector('b').textContent = c.name;
          b.querySelector('span').textContent = c.where;
          b.onclick = () => {
            rez.haptic('tick');
            save({ city: c });
            weather.refresh();
            toast(`Погода — для города ${c.name}`);
            renderSheet();
          };
          list.appendChild(b);
        }
      }, 350);
    });
    wx.appendChild(box);
    wx.appendChild(list);
    if (S.city) {
      const back = document.createElement('button');
      back.className = 'btn-text';
      back.textContent = 'Определять по сети';
      back.onclick = () => {
        save({ city: null });
        weather.refresh();
        renderSheet();
      };
      wx.appendChild(back);
    }
  }

  const pal = sec('Палитра');
  const sw = document.createElement('div');
  sw.className = 'swatches';
  for (const p of look.PALETTES) {
    const b = document.createElement('button');
    b.className = 'sw' + (S.palette === p.id ? ' on' : '');
    b.title = p.name;
    b.style.background = `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]} 55%, ${p.colors[2]})`;
    b.onclick = () => {
      save({ palette: p.id });
      look.apply();
      look.preview();
      wallSoon();
      rez.haptic('tick');
      renderSheet();
    };
    sw.appendChild(b);
  }
  pal.appendChild(sw);

  const st = sec('Волны');
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const s of look.STYLES) {
    const b = document.createElement('button');
    b.className = 'chip' + (S.style === s.id ? ' on' : '');
    b.textContent = s.name;
    b.onclick = () => {
      save({ style: s.id });
      look.apply();
      look.preview();
      wallSoon();
      rez.haptic('tick');
      renderSheet();
    };
    chips.appendChild(b);
  }
  st.appendChild(chips);

  const opt = sec('Экран');
  opt.appendChild(
    toggle('Волны слышат музыку', 'Двигаются в такт тому, что играет', S.hear && info.mic !== false, () => {
      if (!S.hear && info.mic === false) rez.requestMic();
      save({ hear: !S.hear });
      look.apply();
      renderSheet();
    }),
  );
  opt.appendChild(
    toggle('Подписи под значками', '', S.labels, () => {
      save({ labels: !S.labels });
      look.apply();
      renderSheet();
    }),
  );

  const wp = sec('Обои телефона');
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Их видно, когда листаешь между приложениями. Картинка — как этот экран: палитра и волны.';
  wp.appendChild(hint);
  const set = link(ICONS.wall, 'Поставить обои Резонанса', () => setWall(), true);
  wp.appendChild(set);
  wp.appendChild(
    toggle('Менять вместе с палитрой', 'Новая палитра или волны — новые обои', !!S.syncWall, () => {
      save({ syncWall: !S.syncWall });
      if (S.syncWall) setWall();
      renderSheet();
    }),
  );

  if (info.notif === false) body.appendChild(link(ICONS.bell, 'Сейчас играет и точки уведомлений', () => rez.openNotificationAccess()));
  body.appendChild(link(ICONS.gear, 'Настройки телефона', () => rez.openSettings()));
  const v = document.createElement('div');
  v.className = 'ver';
  v.textContent = 'Резонанс Лаунчер' + (info.app ? ' ' + info.app : '');
  body.appendChild(v);
}

// ---------- the phone's wallpaper ----------

let wallBusy = false;
export function setWall() {
  if (wallBusy) return;
  wallBusy = true;
  toast('Рисую обои…');
  // a frame for the toast to show before the picture is drawn
  setTimeout(() => {
    try {
      if (!rez.setWallpaper(look.wallpaperImage())) {
        wallBusy = false;
        toast('Обои ставятся только на телефоне');
      }
    } catch (e) {
      wallBusy = false;
      toast('Не получилось нарисовать обои');
    }
  }, 60);
}
on('wall', (ok) => {
  wallBusy = false;
  toast(ok ? 'Обои телефона — в стиле Резонанса' : 'Не получилось поставить обои');
});
let wallT = 0;
function wallSoon() {
  if (!S.syncWall) return;
  clearTimeout(wallT);
  wallT = setTimeout(setWall, 1500);
}

function toggle(title, sub, on, fn) {
  const b = document.createElement('button');
  b.className = 'tgl' + (on ? ' on' : '');
  b.innerHTML = `<span></span><i></i>`;
  b.querySelector('span').textContent = title;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    b.querySelector('span').appendChild(s);
  }
  b.onclick = () => {
    rez.haptic('tick');
    fn();
  };
  return b;
}

function link(ic, text, fn, hi) {
  const b = document.createElement('button');
  b.className = 'link glass' + (hi ? ' hi' : '');
  b.innerHTML = ic + '<span></span>';
  b.querySelector('span').textContent = text;
  b.onclick = () => {
    closeSheet();
    fn();
  };
  return b;
}

// the sheet follows a finger pulling it down
{
  let y0 = 0;
  let dy = 0;
  let pulling = false;
  sheet.addEventListener('touchstart', (e) => {
    y0 = e.touches[0].clientY;
    dy = 0;
    pulling = false;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    dy = e.touches[0].clientY - y0;
    if (!pulling && sheet.scrollTop <= 0 && dy > 8) pulling = true;
    if (pulling) {
      e.preventDefault();
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }
  }, { passive: false });
  sheet.addEventListener('touchend', () => {
    if (!pulling) return;
    sheet.style.transition = '';
    if (dy > 90) closeSheet();
    else sheet.style.transform = '';
  });
}
