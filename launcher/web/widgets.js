// Резонанс Лаунчер: the widgets of its own — the clock, the weather, what is
// playing, search, the battery, the waves. Each one is a card that can sit on
// any page of the desktop (or the page on the left) and has a few sizes.

import { rez } from './bridge.js';
import { S } from './store.js';
import { icon } from './icons.js';
import * as apps from './apps.js';

export const KINDS = {
  clock: { name: 'Часы', hint: 'время, дата, погода', sizes: [[4, 2], [4, 1], [2, 2]], glyph: 'sun' },
  weather: { name: 'Погода', hint: 'сейчас и по часам', sizes: [[4, 2], [2, 2], [4, 1]], glyph: 'sun' },
  np: { name: 'Сейчас играет', hint: 'обложка и кнопки', sizes: [[4, 2], [4, 1], [2, 2]], glyph: 'play' },
  search: { name: 'Поиск', hint: 'приложения и интернет', sizes: [[4, 1], [2, 1]], glyph: 'search' },
  battery: { name: 'Батарея', hint: 'заряд телефона', sizes: [[2, 1], [2, 2]], glyph: 'battery' },
  sys: { name: 'Виджет приложения', hint: '', sizes: [[2, 1], [2, 2], [4, 1], [4, 2], [4, 3], [4, 4]], glyph: 'grid', hidden: true },
  waves: { name: 'Волны', hint: 'живая полоса', sizes: [[4, 1], [4, 2]], glyph: 'waves' },
};

// the grid the desktop has now: a wide widget on a phone takes the whole width
export const dims = { cols: 4 };
export const sizeOf = (item) => {
  const c = item.c || KINDS[item.t].sizes[0][0];
  return [c >= 4 && dims.cols <= 6 ? dims.cols : c, item.r || KINDS[item.t].sizes[0][1]];
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const two = (n) => String(n).padStart(2, '0');
export const timeText = (d = new Date()) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const dateText = (d = new Date()) => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export function greeting(d = new Date()) {
  const h = d.getHours();
  return h >= 5 && h < 12 ? 'Доброе утро' : h >= 12 && h < 17 ? 'Добрый день' : h >= 17 && h < 23 ? 'Добрый вечер' : 'Доброй ночи';
}

// ---------- what the widgets show ----------

let weather = null;
let media = { active: false };
let battery = {};
const mounted = new Set(); // { el, item }

export function setWeather(w) {
  weather = w;
  refresh('clock', 'weather');
}
export function setMedia(m) {
  media = m || { active: false };
  refresh('np');
}
export function setBattery(b) {
  battery = b || {};
  refresh('battery');
}
export const getMedia = () => media;
export const getWeather = () => weather;

function refresh(...kinds) {
  for (const m of mounted) {
    if (!m.el.isConnected) {
      mounted.delete(m);
      continue;
    }
    if (kinds.indexOf(m.item.t) >= 0) paint(m.el, m.item);
  }
}

export function tick() {
  refresh('clock');
}

// the dots of a widget being removed from the page
export function forget(elx) {
  for (const m of mounted) if (m.el === elx) mounted.delete(m);
}

// ---------- building ----------

export function build(item, extra) {
  const k = KINDS[item.t];
  const root = el('div', 'item w w-' + item.t);
  root.dataset.k = 'w';
  root.dataset.id = item.id || '';
  const [c, r] = sizeOf(item);
  root.style.setProperty('--wc', c);
  root.style.setProperty('--wr', r);
  root.classList.toggle('wide', c >= 4);
  root.classList.toggle('tall', r >= 2);
  if (!extra || !extra.static) mounted.add({ el: root, item });
  paint(root, item);
  void k;
  return root;
}

function paint(root, item) {
  const fn = PAINT[item.t];
  if (!fn) return;
  const [c, r] = sizeOf(item);
  root.classList.toggle('wide', c >= 4);
  root.classList.toggle('tall', r >= 2);
  root.textContent = '';
  fn(root, c, r, item);
}

function weatherChip(w) {
  const chip = el('span', 'wx-chip');
  const pic = el('i', 'wx-pic');
  pic.innerHTML = w.svg;
  chip.append(pic, el('b', '', w.tempText));
  return chip;
}

const PAINT = {
  clock(root, c, r) {
    const d = new Date();
    if (S.clockStyle === 'slim' || r < 2) {
      const row = el('div', 'wc-row');
      row.append(el('div', 'wc-time', timeText(d)));
      const side = el('div', 'wc-side');
      side.append(el('div', 'wc-date', dateText(d)));
      if (S.weather !== false && weather) side.append(weatherChip(weather));
      row.append(side);
      root.append(row);
      return;
    }
    root.append(el('div', 'wc-greet', greeting(d)), el('div', 'wc-time', timeText(d)));
    const line = el('div', 'wc-line');
    line.append(el('span', 'wc-date', dateText(d)));
    if (S.weather !== false && weather) line.append(weatherChip(weather));
    root.append(line);
  },

  weather(root, c, r) {
    const w = weather;
    if (!w || S.weather === false) {
      root.append(el('div', 'wx-none', S.weather === false ? 'Погода выключена' : 'Узнаю погоду…'));
      return;
    }
    const top = el('div', 'wx-top');
    const pic = el('div', 'wx-pic wx-anim');
    pic.innerHTML = w.svg;
    const now = el('div', 'wx-now');
    now.append(el('div', 'wx-t', w.tempText), el('div', 'wx-w', w.words));
    top.append(pic, now);
    if (c >= 4) {
      const side = el('div', 'wx-side');
      side.append(el('b', '', w.city || ''));
      if (w.range) side.append(el('div', '', 'днём ' + w.range));
      if (w.feels != null && w.feels !== w.temp) side.append(el('div', '', 'ощущается ' + w.feels + '°'));
      top.append(side);
    }
    root.append(top);
    if (r >= 2 && c >= 4 && w.hours && w.hours.length) {
      const strip = el('div', 'wx-hours');
      for (const h of w.hours.slice(0, 6)) {
        const it = el('div', 'wx-h');
        const ic = el('i');
        ic.innerHTML = h.svg;
        it.append(el('span', '', h.h + ':00'), ic, el('b', '', h.text));
        strip.append(it);
      }
      root.append(strip);
    }
  },

  np(root, c, r) {
    const m = media;
    const art = el('div', 'np-art');
    if (m.active && m.art) {
      art.style.backgroundImage = `url("${rez.artUrl(m.art)}")`;
      art.classList.add('has');
    } else {
      art.append(icon('waves'));
    }
    const text = el('div', 'np-text');
    if (m.active) {
      text.append(el('div', 'np-title', m.title || 'Без названия'), el('div', 'np-artist', m.artist || m.appLabel || ''));
    } else {
      text.append(el('div', 'np-title', 'Тишина'), el('div', 'np-artist', 'Включите музыку — она появится здесь'));
    }
    const btns = el('div', 'np-btns');
    const mk = (name, act, cls) => {
      const b = el('button', 'np-b ' + (cls || ''));
      b.dataset.act = act;
      b.setAttribute('aria-label', act);
      b.append(icon(name));
      return b;
    };
    if (m.active) {
      btns.append(mk('prev', 'prev'), mk(m.playing ? 'pause' : 'play', 'toggle', 'main'), mk('next', 'next'));
    }
    root.append(art, text, btns);
    root.classList.toggle('on', !!m.active);
  },

  search(root, c) {
    const b = el('div', 'sr-pill');
    b.dataset.act = 'search';
    b.append(icon('search'));
    if (c >= 3) b.append(el('span', '', 'Поиск приложений и в сети'));
    root.append(b);
  },

  battery(root, c, r) {
    const lv = battery.level;
    const box = el('div', 'bt');
    const ring = el('div', 'bt-ring');
    ring.style.setProperty('--p', lv >= 0 ? lv : 0);
    ring.append(el('b', '', lv >= 0 ? lv + '%' : '—'));
    const side = el('div', 'bt-side');
    side.append(el('div', 'bt-t', battery.charging ? 'Заряжается' : 'Батарея'));
    if (r >= 2) side.append(el('div', 'bt-s', battery.charging ? 'питание подключено' : lv >= 0 && lv <= 20 ? 'пора заряжать' : 'работает от аккумулятора'));
    box.append(ring, side);
    root.append(box);
  },

  // a widget of another app: the real one is drawn by Android above this place
  sys(root, c, r, item) {
    root.dataset.wid = item.wid;
    root.append(el('div', 'sys-name', item.label || 'Виджет'));
  },

  waves(root, c, r) {
    const box = el('div', 'wv');
    const n = c >= 4 ? 28 : 14;
    for (let i = 0; i < n; i++) {
      const b = el('i');
      b.style.setProperty('--i', i);
      b.style.setProperty('--d', (0.9 + ((i * 37) % 11) / 10).toFixed(2) + 's');
      b.style.setProperty('--o', (-((i * 53) % 17) / 10).toFixed(2) + 's');
      box.append(b);
    }
    root.append(box);
  },
};

// the buttons inside a widget (the card itself is for editing and moving)
export function press(target) {
  const b = target.closest && target.closest('[data-act]');
  if (!b) return false;
  const act = b.dataset.act;
  if (act === 'search') {
    document.dispatchEvent(new CustomEvent('rez-open-search'));
    return true;
  }
  if (act === 'toggle' || act === 'next' || act === 'prev') {
    rez.media(act);
    rez.haptic('tick');
    return true;
  }
  return false;
}

// a tap on the card itself
export function tap(root, item, rect) {
  if (item.t === 'np' && media.active && media.app) {
    rez.launch(media.app, rect);
    apps.used(media.app);
    return true;
  }
  if (item.t === 'weather' && weather) {
    rez.openUrl('https://yandex.ru/pogoda/');
    return true;
  }
  if (item.t === 'clock') {
    return false;
  }
  return false;
}
