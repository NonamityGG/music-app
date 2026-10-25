// Резонанс OS: everything that opens over the home screen — all apps, the menu
// of an app, settings and the screen saver.

import { tv } from './tv.js';
import { S, save } from './store.js';
import * as apps from './apps.js';
import * as nav from './nav.js';
import * as layers from './layers.js';
import * as look from './look.js';
import { icon } from './icons.js';
import { saver } from './saver.js';
import * as weather from './weather.js';
import { appCard, dateText, media as npMedia, toTop } from './home.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let toastTimer = 0;
export function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

// opening an app: a short zoom of its card, then the app
export function launch(app, cardEl) {
  apps.markSeen(app.pkg);
  if (cardEl && cardEl.animate && !look.eco()) {
    cardEl.animate([{ transform: 'scale(1.1)' }, { transform: 'scale(1.18)', opacity: 0.6 }, { transform: 'scale(1.1)', opacity: 1 }], { duration: 420, easing: 'ease-out' });
  }
  setTimeout(() => {
    if (!tv.launch(app.pkg)) toast(`Не получилось открыть «${app.label}»`);
  }, 140);
  const badge = cardEl && cardEl.querySelector('.badge');
  if (badge) badge.remove();
}

// ---------- all apps ----------

const gridEl = $('grid');
export const grid = {
  el: gridEl,
  dim: true,
  open() {
    gridEl.textContent = '';
    const list = apps.everything();
    const head = el('div', 'grid-head');
    head.appendChild(el('h1', '', 'Все приложения'));
    head.appendChild(el('span', '', `${list.length}`));
    const view = el('div', 'grid-view');
    const g = el('div', 'grid');
    g.setAttribute('data-row', 'grid');
    g.setAttribute('data-nav', 'geo');
    for (const a of list) g.appendChild(appCard(a));
    view.appendChild(g);
    gridEl.append(head, view);
    grid._g = g;
    grid._view = view;
    g._y = 0;
    layers.push(grid, g.querySelector('.card'));
  },
  ok(c) {
    if (c && c._app) launch(c._app, c);
  },
  long(c) {
    if (c && c._app) menu.open(c._app, c);
  },
  back() {
    layers.pop(grid);
  },
};

nav.onFocus((c) => {
  if (!gridEl.contains(c) || !grid._g) return;
  const g = grid._g;
  const viewH = grid._view.clientHeight;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const top = c.offsetTop;
  const bottom = top + c.offsetHeight + 6 * rem;
  let y = g._y;
  if (bottom - y > viewH) y = bottom - viewH;
  if (top - y < 2 * rem) y = Math.max(0, top - 2 * rem);
  if (y !== g._y) {
    g._y = y;
    g.style.transform = `translate3d(0,${-y}px,0)`;
  }
  apps.colorOf(c._app).then((col) => {
    if (nav.current() === c) look.tint(col ? apps.rgba(col, 0.42) : null);
  });
});

// ---------- the menu of an app ----------

const menuEl = $('menu');
export const menu = {
  el: menuEl,
  dim: true,
  onMove: null,
  open(app, cardEl) {
    menuEl.textContent = '';
    const sheet = el('div', 'sheet');
    const head = el('div', 'sheet-head');
    const pic = el('div', 'sheet-pic');
    pic.appendChild(appCard(app).querySelector('.pic'));
    const t = el('div');
    t.appendChild(el('h3', '', app.label));
    t.appendChild(el('p', '', app.tv ? 'Приложение для телевизора' : 'Приложение'));
    head.append(pic, t);
    sheet.appendChild(head);
    const fav = apps.isFav(app.pkg);
    const acts = [
      ['open', 'Открыть', 'open'],
      [fav ? 'unfav' : 'fav', fav ? 'Убрать из избранного' : 'В избранное', 'star'],
    ];
    if (fav && apps.favourites().length > 1) acts.push(['move', 'Переставить', 'move']);
    acts.push(['info', 'О приложении', 'info'], ['hide', 'Скрыть с главного экрана', 'hide']);
    if (!app.sys) acts.push(['delete', 'Удалить', 'trash']);
    for (const [id, name, ic] of acts) {
      const a = el('div', 'act f' + (id === 'delete' ? ' danger' : ''));
      a.setAttribute('data-row', 'act-' + id);
      a.appendChild(icon(ic));
      a.appendChild(el('span', '', name));
      a._act = id;
      sheet.appendChild(a);
    }
    menuEl.appendChild(sheet);
    menu._app = app;
    menu._card = cardEl;
    layers.push(menu, sheet.querySelector('.act'));
  },
  ok(a) {
    const app = menu._app;
    const id = a && a._act;
    layers.pop(menu);
    if (!id || !app) return;
    if (id === 'open') launch(app, menu._card);
    else if (id === 'fav' || id === 'unfav') {
      const added = apps.toggleFav(app.pkg);
      toast(added ? `«${app.label}» в избранном` : `«${app.label}» убрано из избранного`);
    } else if (id === 'move') {
      if (menu.onMove) menu.onMove(app);
    } else if (id === 'info') {
      if (!tv.appInfo(app.pkg)) toast('Эта приставка не показывает сведения о приложениях');
    } else if (id === 'hide') {
      apps.hide(app.pkg);
      toast(`«${app.label}» скрыто. Вернуть — в настройках`);
    } else if (id === 'delete') {
      if (!tv.uninstall(app.pkg)) toast('Эта приставка не даёт удалять приложения отсюда');
    }
  },
  back() {
    layers.pop(menu);
  },
};

// ---------- settings ----------

const setEl = $('settings');
let info = {};
let weatherCity = '';

export function setInfo(i) {
  info = i || {};
}

export function setCity(c) {
  weatherCity = c || '';
}

function citySub() {
  if (S.city && S.city.name) return `${S.city.name} — выбран вручную`;
  const st = weather.status();
  if (st.status === 'fail' && !weatherCity) return `Не получилось определить: ${st.why}. Выбери город сам`;
  return weatherCity ? `${weatherCity} — определён по интернету` : 'Определяю по интернету…';
}

const SAVER = [
  [2, '2 минуты'],
  [5, '5 минут'],
  [10, '10 минут'],
  [15, '15 минут'],
  [30, '30 минут'],
  [0, 'Никогда'],
];

function items() {
  const guardSub = !info.guard
    ? 'Сначала включи службу в разделе «Подготовка» выше (или установщиком с компьютера)'
    : S.guard
      ? `«Домой» ведёт в Резонанс OS${info.stockLabel ? `, а не в «${info.stockLabel}»` : ''}`
      : 'Выключено: «Домой» ведёт на экран приставки';
  const list = [];
  // what the installer would give, asked for right here (when it's missing)
  const setup = [];
  if (info.mic === false) setup.push({ act: 'mic', name: 'Разрешить звук для волн', sub: 'Телевизор спросит — выбери «Разрешить»' });
  if (info.notif === false) setup.push({ act: 'notif', name: 'Доступ к «Сейчас играет»', sub: 'В списке включи «Резонанс OS — что сейчас играет»' });
  if (info.guard === false) setup.push({ act: 'guardOn', name: 'Кнопка «Домой» → Резонанс OS', sub: 'Специальные возможности → «Резонанс OS — кнопка «Домой»» → включить' });
  if (info.home === false) setup.push({ act: 'homeApp', name: 'Сделать главным экраном', sub: 'Если приставка даёт выбрать главный экран — выбери Резонанс OS' });
  if (setup.length && info.app) list.push({ sec: 'Подготовка' }, ...setup);
  list.push(
    { sec: 'Оформление' },
    { key: 'bg', name: 'Фон', choices: look.BACKGROUNDS },
    { key: 'palette', name: 'Цвета', choices: look.PALETTES.map((p) => [p.id, p.name, p.colors[0]]) },
    { key: 'style', name: 'Волны', choices: look.STYLES.map((s) => [s.id, s.name]) },
    { key: 'hear', name: 'Волны слышат звук', sub: info.mic === false ? 'Нет разрешения на звук — его выдаёт установщик' : 'Танцуют под то, что играет на телевизоре', bool: true },
    { key: 'tint', name: 'Подсветка от приложения', sub: 'Комната окрашивается в цвет выбранного приложения', bool: true },
    { sec: 'Главный экран' },
    { key: 'clockSec', name: 'Секунды в часах', bool: true },
    { key: 'weather', name: 'Погода', sub: 'На главном экране и на заставке', bool: true },
    { act: 'city', name: 'Город для погоды', sub: citySub() },
    { key: 'np', name: '«Сейчас играет»', sub: info.notif === false ? 'Нет доступа к плеерам — его выдаёт установщик' : 'Обложка и кнопки того, что играет', bool: true },
    { key: 'tools', name: 'Ряд «Резонанс OS»', bool: true },
    { act: 'hidden', name: 'Скрытые приложения', sub: `${apps.hiddenApps().length} шт.` },
    { sec: 'Заставка' },
    { key: 'saver', name: 'Включать через', choices: SAVER },
    {
      key: 'saverLook',
      name: 'Что за волнами',
      sub: 'Как обои на ПК: большие часы, а пока играет музыка — строчка песни (или её название)',
      choices: [
        ['auto', 'Песня и часы'],
        ['clock', 'Только часы'],
        ['orb', 'Сфера и часы'],
        ['waves', 'Только волны'],
      ],
    },
    {
      key: 'saverText',
      name: 'Надписи',
      choices: [
        ['soft', 'Мягкий свет'],
        ['outline', 'Контур'],
        ['glass', 'Стекло'],
      ],
    },
    { key: 'saverWx', name: 'Погода на заставке', sub: 'Сейчас и на ближайшие часы', bool: true },
    { key: 'saverCover', name: 'Цвета из обложки', sub: 'Волны и надписи в цветах того, что играет', bool: true },
    { act: 'saverNow', name: 'Показать заставку' },
    {
      key: 'sleep',
      name: 'Сон приставки',
      sub: 'Пока на экране Резонанс OS, заставка Сбера не включается. Без нажатий столько времени — приставка засыпает как обычно',
      choices: [
        [30, 'Через 30 минут'],
        [60, 'Через 1 час'],
        [120, 'Через 2 часа'],
        [240, 'Через 4 часа'],
        [0, 'Никогда'],
      ],
    },
    { sec: 'Экран' },
    {
      key: 'inset',
      name: 'Поля по краям',
      sub: 'Если телевизор обрезает края картинки (или включи на нём «По размеру экрана»)',
      choices: [
        [0, 'Нет'],
        [2, '2%'],
        [3.5, '3,5%'],
        [5, '5%'],
      ],
    },
    { sec: 'Плавность' },
    {
      key: 'fx',
      name: 'Эффекты',
      sub: look.weak() ? 'Сами — у этой приставки мало памяти, поэтому экономно: меньше кадров и движения' : 'Сами — по силам приставки. Экономно: меньше кадров и движения',
      choices: [
        ['auto', 'Сами'],
        ['max', 'Максимум'],
        ['eco', 'Экономно'],
      ],
    },
    { sec: 'Кнопка «Домой»' },
    { key: 'guard', name: 'Возвращать Резонанс OS', sub: guardSub, bool: true }
  );
  if (info.stock) list.push({ act: 'stock', name: `Открыть «${info.stockLabel || 'экран приставки'}»`, sub: 'На 5 минут, потом «Домой» снова ведёт сюда' });
  list.push({ act: 'tvSettings', name: 'Настройки телевизора' }, { act: 'reload', name: 'Перезапустить Резонанс OS' });
  list.push({ sec: 'О системе' });
  const rows = [
    ['Резонанс OS', info.app || '1.0'],
    ['Приставка', [info.maker, info.model].filter(Boolean).join(' ') || '—'],
    ['Android', info.android ? `${info.android} (API ${info.sdk})` : '—'],
    ['Память', info.ram ? `${(info.ram / 1024).toFixed(1)} ГБ, свободно ${(info.ramFree / 1024).toFixed(1)} ГБ` : '—'],
    ['Браузерный движок', info.webview || (navigator.userAgent.match(/Chrome\/[\d.]+/) || ['—'])[0]],
    ['Адрес в сети', info.ip || '—'],
  ];
  for (const [n, v] of rows) list.push({ info: true, name: n, value: v });
  return list;
}

function valueOf(it) {
  const v = S[it.key];
  const c = it.choices.find((x) => x[0] === v) || it.choices[0];
  return c;
}

function buildRow(it) {
  const o = el('div', 'opt f' + (it.info ? ' info' : ''));
  o.setAttribute('data-row', 'opt-' + (it.key || it.act || it.name));
  const t = el('div', 'opt-t');
  t.appendChild(el('div', 'opt-name', it.name));
  if (it.sub) t.appendChild(el('div', 'opt-sub', it.sub));
  o.appendChild(t);
  const v = el('div', 'opt-val');
  if (it.bool) {
    v.appendChild(el('span', 'sw' + (S[it.key] ? ' on' : '')));
  } else if (it.choices) {
    const c = valueOf(it);
    v.appendChild(icon('chevron', 'arr l'));
    if (c[2]) {
      const dot = el('span', 'sw-dot');
      dot.style.background = c[2];
      v.appendChild(dot);
    }
    v.appendChild(el('span', '', c[1]));
    v.appendChild(icon('chevron', 'arr r'));
  } else if (it.act) {
    v.appendChild(icon('chevron', 'arr r'));
  } else if (it.info) {
    v.appendChild(el('span', '', it.value));
  }
  o.appendChild(v);
  o._item = it;
  return o;
}

export const settings = {
  el: setEl,
  dim: false,
  page: 'main',
  onAct: null,
  open(page = 'main', focusKey) {
    settings.page = page;
    setEl.textContent = '';
    const panel = el('div', 'panel');
    const head = el('div', 'panel-head');
    const mark = el('span', 'mark');
    for (let i = 0; i < 4; i++) mark.appendChild(el('i'));
    head.append(mark, el('h1', '', page === 'hidden' ? 'Скрытые' : page === 'city' ? 'Город для погоды' : 'Настройки'));
    const view = el('div', 'panel-view');
    const inner = el('div', 'panel-in');
    if (page === 'city') {
      buildCity(inner);
    } else if (page === 'hidden') {
      const list = apps.hiddenApps();
      if (!list.length) inner.appendChild(el('div', 'sec-t', 'Скрытых приложений нет'));
      for (const a of list) inner.appendChild(buildRow({ act: 'unhide', name: a.label, sub: 'OK — вернуть на главный экран', pkg: a.pkg }));
    } else {
      for (const it of items()) {
        if (it.sec) inner.appendChild(el('div', 'sec-t', it.sec));
        else inner.appendChild(buildRow(it));
      }
    }
    view.appendChild(inner);
    panel.append(head, view);
    setEl.appendChild(panel);
    settings._in = inner;
    settings._view = view;
    inner._y = 0;
    const want = focusKey ? Array.prototype.find.call(inner.querySelectorAll('.opt'), (o) => o._item && (o._item.key === focusKey || o._item.act === focusKey)) : null;
    if (layers.isOpen(settings)) nav.setScope(setEl, want || inner.querySelector('.opt'));
    else layers.push(settings, want || inner.querySelector('.opt'));
  },
  refresh() {
    if (!layers.isOpen(settings)) return;
    const c = nav.current();
    const key = c && c._item ? c._item.key || c._item.act : null;
    const y = settings._in ? settings._in._y : 0;
    settings.open(settings.page, key);
    settings._in._y = y;
    settings._in.style.transform = `translate3d(0,${-y}px,0)`;
  },
  key(k) {
    const o = nav.current();
    const it = o && o._item;
    if (!it || !it.choices || (k !== 'left' && k !== 'right')) return false;
    step(it, k === 'right' ? 1 : -1);
    return true;
  },
  ok(o) {
    const it = o && o._item;
    if (!it || it.info) return;
    if (it.bool) {
      save({ [it.key]: !S[it.key] });
      settings.refresh();
    } else if (it.choices) step(it, 1);
    else if (it.act === 'hidden') settings.open('hidden');
    else if (it.act === 'city') settings.open('city');
    else if (it.act === 'cityType') typeCity(o);
    else if (it.act === 'cityPick' || it.act === 'cityAuto') pickCity(it.place || null);
    else if (it.act === 'unhide') {
      apps.unhide(it.pkg);
      toast(`«${it.name}» снова на главном экране`);
      settings.open('hidden');
    } else if (settings.onAct) settings.onAct(it.act);
  },
  back() {
    if (settings.page === 'hidden') settings.open('main', 'hidden');
    else if (settings.page === 'city') settings.open('main', 'city');
    else layers.pop(settings);
  },
};

// ---------- the town for the weather: typed with the TV's keyboard ----------

let found = []; // towns found for what was typed
let typed = '';
let searching = '';

function buildCity(inner) {
  const row = el('div', 'opt f opt-input');
  row.setAttribute('data-row', 'opt-cityType');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = typed;
  input.placeholder = 'Название города — OK, чтобы ввести';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('enterkeyhint', 'search');
  input.addEventListener('input', () => {
    typed = input.value;
    clearTimeout(input._t);
    input._t = setTimeout(() => findTowns(typed), 700);
  });
  input.addEventListener('blur', () => tv.typing(false));
  row.appendChild(input);
  row._item = { act: 'cityType' };
  row._input = input;
  inner.appendChild(row);
  if (searching) inner.appendChild(buildRow({ info: true, name: 'Ищу…', value: '' }));
  else if (typed.trim().length >= 2 && !found.length) inner.appendChild(buildRow({ info: true, name: 'Ничего не нашлось', value: '' }));
  for (const t of found) inner.appendChild(buildRow({ act: 'cityPick', name: t.name, sub: t.where, place: t }));
  inner.appendChild(el('div', 'sec-t', ''));
  inner.appendChild(buildRow({ act: 'cityAuto', name: 'Определять по интернету', sub: S.city ? 'Сейчас выбран вручную: ' + S.city.name : 'Так сейчас и есть' + (weatherCity ? ': ' + weatherCity : '') }));
}

// OK on the field: the keyboard comes up
function typeCity(row) {
  const input = row && row._input;
  if (!input) return;
  tv.typing(true);
  input.focus();
  tv.keyboard(true);
}

export function cityEnter() {
  findTowns(typed, true);
}

async function findTowns(q, now) {
  q = (q || '').trim();
  if (q.length < 2) {
    found = [];
    return;
  }
  searching = q;
  try {
    const list = await weather.search(q);
    if (searching !== q) return;
    found = list;
  } catch (e) {
    found = [];
    toast('Поиск не ответил: ' + (e && e.message ? e.message : e));
  }
  searching = '';
  if (settings.page !== 'city' || !layers.isOpen(settings)) return;
  // keep the keyboard while typing; after Enter go to what was found
  const active = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (active && !now) {
    redrawCityList();
  } else {
    tv.keyboard(false);
    settings.open('city', found.length ? 'cityPick' : 'cityType');
  }
}

// the list under the field, without touching the field (the keyboard stays up)
function redrawCityList() {
  const inner = settings._in;
  if (!inner) return;
  const field = inner.querySelector('.opt-input');
  while (field && field.nextSibling) inner.removeChild(field.nextSibling);
  const tmp = el('div');
  buildCity(tmp);
  tmp.removeChild(tmp.firstChild);
  while (tmp.firstChild) inner.appendChild(tmp.firstChild);
}

function pickCity(place) {
  tv.keyboard(false);
  if (place) save({ city: { name: place.name, lat: place.lat, lon: place.lon } });
  else save({ city: null });
  found = [];
  typed = '';
  toast(place ? `Погода для города ${place.name}` : 'Город определяется по интернету');
  settings.open('main', 'city');
}

function step(it, d) {
  const i = it.choices.findIndex((x) => x[0] === S[it.key]);
  const n = it.choices.length;
  const next = it.choices[(((i < 0 ? 0 : i) + d) % n + n) % n];
  save({ [it.key]: next[0] });
  settings.refresh();
}

nav.onFocus((o) => {
  if (!setEl.contains(o) || !settings._in) return;
  const inner = settings._in;
  const viewH = settings._view.clientHeight;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  let y = inner._y || 0;
  const top = o.offsetTop - 7 * rem;
  const bottom = o.offsetTop + o.offsetHeight + 4 * rem;
  if (bottom - y > viewH) y = bottom - viewH;
  if (top - y < 0) y = Math.max(0, top);
  if (y !== inner._y) {
    inner._y = y;
    inner.style.transform = `translate3d(0,${-y}px,0)`;
  }
});

// ---------- the screen saver (saver.js) ----------

export const ambient = saver;
saver.onClosed = () => homePlace();

// on the home screen the waves run along the bottom of the whole screen,
// behind the rows of apps (the orb floats on the right, by "now playing")
export function homePlace() {
  if (S.style === 'orb') look.setWavePlace({ y: 0.42, amp: 0.2, box: [0.5, 0.5] });
  else look.setWavePlace({ y: 0.87, amp: 0.15 });
}

export { toTop };
