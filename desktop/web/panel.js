// Резонанс для ПК — the panel: every setting, in the app's own look, instead of
// a plain Windows menu. Opened from the logo on the bar or from the tray icon;
// closes when it loses focus or with Esc. Every change goes to the main process
// at once (sliders while they are dragged), so the wallpaper follows live.

import * as waves from '../../src/waves.js';
import { icon } from '../../src/util.js';
import * as looks from './looks.js';
import { $, appName, mediaState } from './common.js';

looks.install();

// ---------- icons ----------

const P = {
  home: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  waves: 'M3 10h2v4H3zM7 7h2v10H7zM11 4h2v16h-2zM15 8h2v8h-2zM19 11h2v2h-2z',
  image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v10.6l4.2-4.9 3.3 3.8 2.3-2.7L19 17V6zm10.5 4a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z',
  text: 'M4 5h16v3.2h-2.2V7.2h-4.7v9.6h2.1V19H8.8v-2.2h2.1V7.2H6.2v1H4z',
  bar: 'M4 4h16a1 1 0 0 1 1 1v3H3V5a1 1 0 0 1 1-1zm-1 6h18v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm2 2v6h14v-6z',
  sys: 'M4 7h9v2H4zM17 7h3v2h-3zM13 5h4v6h-4zM4 15h3v2H4zM11 15h9v2h-9zM7 13h4v6H7z',
  monitor: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6zM8 19h8v2H8z',
  island: 'M8 8.5h8a3.5 3.5 0 0 1 0 7H8a3.5 3.5 0 0 1 0-7zm.2 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  quote: 'M6 7h5v5c0 3-2 5-5 5v-2c1.7 0 3-1.3 3-3H6zm8 0h5v5c0 3-2 5-5 5v-2c1.7 0 3-1.3 3-3h-3z',
  palette:
    'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 22 9.9C22 6 17.5 3 12 3zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  power: 'M11 3h2v9h-2zM7.05 5.64l1.41 1.41A6 6 0 1 0 15.54 7l1.41-1.41A8 8 0 1 1 7.05 5.64z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z',
};

function ic(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', P[name] || '');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(p);
  return svg;
}

// ---------- state ----------

let S = {};
let info = {};
let tab = 'home';
let binds = [];
const TABS = [
  ['home', 'Главное'],
  ['waves', 'Волны'],
  ['bg', 'Фон'],
  ['text', 'Текст'],
  ['bar', 'Строка'],
  ['sys', 'Система'],
];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function bind(fn) {
  binds.push(fn);
  fn(S);
}

function update() {
  for (const fn of binds) fn(S);
  paintAccent();
}

function set(patch) {
  S = { ...S, ...patch };
  update();
  window.rez.set(patch);
}

// ---------- accents in the palette's colours ----------

let coverCols = null;

function paintAccent() {
  const c = S.palette === 'cover' && coverCols ? coverCols : S.paletteColors || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  document.body.style.setProperty('--acc', c[0]);
  document.body.style.setProperty('--acc3', c[1]);
  document.body.style.setProperty('--acc2', c[2]);
}

// ---------- controls ----------

function sec(title, ...kids) {
  const s = el('section', 'sec');
  if (title) s.appendChild(el('div', 'sec-title', title));
  for (const k of kids) if (k) s.appendChild(k);
  return s;
}

function card(...kids) {
  const c = el('div', 'card');
  for (const k of kids) if (k) c.appendChild(k);
  return c;
}

function hint(text) {
  return el('div', 'hint', text);
}

// a big control-centre toggle; opts: { isOn(s), state(s), click() } for the
// ones that are more than on/off
function tile(key, name, iconName, opts = {}) {
  const b = el('button', 'tg');
  const i = el('span', 'tg-ic');
  i.appendChild(ic(iconName, 18));
  const t = el('span', 'tg-t');
  const n = el('span', 'tg-name', name);
  const st = el('span', 'tg-state');
  t.append(n, st);
  b.append(i, t);
  const isOn = opts.isOn || ((s) => !!s[key]);
  b.addEventListener('click', () => (opts.click ? opts.click() : set({ [key]: !S[key] })));
  bind((s) => {
    const on = isOn(s);
    b.classList.toggle('on', on);
    st.textContent = opts.state ? opts.state(s) : on ? 'Включено' : 'Выключено';
  });
  return b;
}

function sw(key, onChange) {
  const i = el('input', 'sw');
  i.type = 'checkbox';
  i.addEventListener('change', () => (onChange ? onChange(i.checked) : set({ [key]: i.checked })));
  bind((s) => {
    i.checked = !!s[key];
  });
  return i;
}

function row(name, sub, control) {
  const r = el('label', 'row');
  const t = el('span', 'row-t');
  t.appendChild(el('span', 'row-name', name));
  if (sub) t.appendChild(el('span', 'row-sub', sub));
  r.append(t, control);
  return r;
}

function slider(key, name, min, max, step, show) {
  const w = el('div', 'sl');
  const top = el('div', 'sl-top');
  const val = el('span', 'sl-val');
  top.append(el('span', 'row-name', name), val);
  const r = el('input');
  r.type = 'range';
  r.min = min;
  r.max = max;
  r.step = step;
  let last = 0;
  let pending = null;
  const paint = (v) => {
    r.style.setProperty('--v', `${((v - min) / (max - min)) * 100}%`);
    val.textContent = show(v);
  };
  r.addEventListener('input', () => {
    const v = Number(r.value);
    paint(v);
    S[key] = v;
    // live while dragging, but not on every pixel
    const now = performance.now();
    if (now - last > 70) {
      last = now;
      window.rez.set({ [key]: v });
    } else {
      clearTimeout(pending);
      pending = setTimeout(() => window.rez.set({ [key]: Number(r.value) }), 80);
    }
  });
  r.addEventListener('change', () => set({ [key]: Number(r.value) }));
  w.append(top, r);
  bind((s) => {
    if (document.activeElement === r) return;
    const v = s[key] ?? min;
    r.value = v;
    paint(v);
  });
  return w;
}

const pct = (v) => `${Math.round(v * 100)}%`;

function seg(key, options, onPick) {
  const w = el('div', 'seg');
  const th = el('i', 'seg-th');
  w.appendChild(th);
  const btns = options.map(([value, label]) => {
    const b = el('button', '', label);
    b.addEventListener('click', () => (onPick ? onPick(value) : set({ [key]: value })));
    w.appendChild(b);
    return [value, b];
  });
  const place = () => {
    const on = btns.find(([v]) => v === S[key]);
    th.style.opacity = on ? '1' : '0';
    if (!on) return;
    th.style.width = `${on[1].offsetWidth}px`;
    th.style.transform = `translateX(${on[1].offsetLeft}px)`;
  };
  bind((s) => {
    for (const [v, b] of btns) b.classList.toggle('on', v === s[key]);
    requestAnimationFrame(place);
  });
  w._place = place;
  return w;
}

function button(label, iconName, cls, onClick) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  if (iconName) b.appendChild(ic(iconName, 16));
  b.appendChild(el('span', '', label));
  b.addEventListener('click', onClick);
  return b;
}

// ---------- wave styles with live-looking previews ----------

function styleTiles(wide) {
  const g = el('div', 'styles' + (wide ? ' wide' : ''));
  const canvases = [];
  for (const st of waves.STYLES) {
    const b = el('button', 'st');
    const c = el('canvas');
    b.append(c, el('span', '', st.name));
    b.addEventListener('click', () => set({ style: st.id }));
    g.appendChild(b);
    canvases.push([st.id, c, b]);
  }
  let shownPal = '';
  bind((s) => {
    for (const [id, , b] of canvases) b.classList.toggle('on', id === s.style);
    const pal = s.palette + (s.palette === 'cover' && coverCols ? coverCols.join() : '');
    if (pal !== shownPal) {
      shownPal = pal;
      requestAnimationFrame(() => {
        for (const [id, c] of canvases) if (c.isConnected) waves.renderPreview(c, id, s.palette);
      });
    }
  });
  return g;
}

function swatch(p, small) {
  const b = el('button', 'sw-c' + (p.id === 'cover' ? ' cover' : ''));
  const cols = p.id === 'cover' && coverCols ? coverCols : p.colors;
  b.style.setProperty('--a', cols[0]);
  b.style.setProperty('--b', cols[1]);
  b.style.setProperty('--c', cols[2]);
  b.title = p.name;
  if (small) b.addEventListener('click', () => set({ palette: p.id }));
  return b;
}

function swatches() {
  const w = el('div', 'swatches');
  const list = waves.PALETTES.map((p) => [p.id, swatch(p, true)]);
  for (const [, b] of list) w.appendChild(b);
  bind((s) => {
    for (const [id, b] of list) b.classList.toggle('on', id === s.palette);
  });
  return w;
}

function paletteGrid() {
  const g = el('div', 'palettes');
  const list = waves.PALETTES.map((p) => {
    const b = el('button', 'pal');
    b.append(swatch(p, false), el('span', '', p.name));
    b.addEventListener('click', () => set({ palette: p.id }));
    g.appendChild(b);
    return [p.id, b];
  });
  bind((s) => {
    for (const [id, b] of list) {
      b.classList.toggle('on', id === s.palette);
      b.firstChild.classList.toggle('on', id === s.palette);
    }
  });
  return g;
}

// ---------- backgrounds ----------

const BGS = [
  ['glass-violet', 'Liquid Glass фиолетовый', 'radial-gradient(60% 80% at 20% 10%, #7a3cffcc, transparent), radial-gradient(60% 80% at 90% 40%, #ff4fb499, transparent), radial-gradient(70% 70% at 40% 110%, #2f6bffaa, transparent), #120a24'],
  ['glass-black', 'Liquid Glass чёрный', 'radial-gradient(60% 80% at 20% 10%, #7a3cff55, transparent), radial-gradient(60% 80% at 90% 40%, #ff4fb440, transparent), radial-gradient(70% 70% at 40% 110%, #2f6bff50, transparent), #000'],
  ['glass-palette', 'Liquid Glass в цвет волн', ''],
  ['aurora', 'Северное сияние', 'radial-gradient(60% 80% at 20% 10%, #00e5a0aa, transparent), radial-gradient(60% 80% at 90% 40%, #0096ff88, transparent), radial-gradient(70% 70% at 40% 110%, #8a5cff88, transparent), #031820'],
  ['ember', 'Угли', 'radial-gradient(60% 80% at 20% 10%, #ff2e4d88, transparent), radial-gradient(60% 80% at 90% 40%, #ff7a1a77, transparent), radial-gradient(70% 70% at 40% 110%, #ff502888, transparent), #12050a'],
  ['dark', 'Тёмный', 'radial-gradient(120% 90% at 50% 45%, #1d1530, #140f1f 55%, #0c0913)'],
  ['amoled', 'Чёрный AMOLED', '#000'],
  ['windows', 'Мои обои Windows', ''],
  ['image', 'Свой рисунок', ''],
];

function bgTiles() {
  const g = el('div', 'bgs');
  const list = BGS.map(([id, name, css]) => {
    const b = el('button', 'bg');
    const pic = el('span', 'bg-pic');
    if (css) pic.style.background = css;
    b.append(pic, el('span', '', name));
    b.addEventListener('click', () => {
      if (id === 'image' && !S.bgImage) return window.rez.pickImage();
      set({ bg: id });
    });
    g.appendChild(b);
    return [id, b, pic];
  });
  bind((s) => {
    const c = s.paletteColors || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
    for (const [id, b, pic] of list) {
      b.classList.toggle('on', id === s.bg);
      if (id === 'glass-palette') pic.style.background = `radial-gradient(60% 80% at 20% 10%, ${c[0]}cc, transparent), radial-gradient(60% 80% at 90% 40%, ${c[2]}99, transparent), radial-gradient(70% 70% at 40% 110%, ${c[1]}99, transparent), #0b0714`;
      if (id === 'windows' || id === 'image') {
        const url = id === 'windows' ? s.windowsUrl : s.imageUrl;
        pic.replaceChildren();
        if (url) pic.style.backgroundImage = `url("${url}")`;
        else {
          pic.style.background = 'rgba(255,255,255,0.06)';
          const ph = el('span', 'ph');
          ph.appendChild(ic(id === 'windows' ? 'monitor' : 'plus', 22));
          pic.appendChild(ph);
        }
      }
    }
  });
  return g;
}

// ---------- now playing (the same player as the island) ----------

let nowParts = null;
const media = mediaState((st) => {
  if (st._thumbChanged || coverCols === null) {
    looks.coverColors(st.thumb).then((c) => {
      coverCols = c || false;
      if (c) looks.setCoverColors(c);
      update();
    });
  }
  paintNow();
});

function nowCard() {
  const w = el('div', 'now');
  const cov = el('span', 'now-cover');
  const meta = el('div', 'now-meta');
  const title = el('div', 'now-title');
  const artist = el('div', 'now-artist');
  meta.append(title, artist);
  const ctl = el('div', 'now-ctl');
  const prev = el('button');
  prev.appendChild(icon('prev', 18));
  const play = el('button', 'big');
  const next = el('button');
  next.appendChild(icon('next', 18));
  ctl.append(prev, play, next);
  prev.addEventListener('click', () => window.rez.media('prev'));
  next.addEventListener('click', () => window.rez.media('next'));
  play.addEventListener('click', () => {
    window.rez.media('toggle');
    media.setLocal({ status: media.playing() ? 'paused' : 'playing' });
  });
  w.append(cov, meta, ctl);
  nowParts = { w, cov, title, artist, prev, play, next };
  paintNow();
  return w;
}

function paintNow() {
  if (!nowParts) return;
  const st = media.st;
  const n = nowParts;
  const active = media.active();
  n.w.classList.toggle('idle', !active);
  n.title.textContent = active ? st.title || 'Без названия' : 'Ничего не играет';
  n.artist.textContent = active ? [st.artist, appName(st.app)].filter(Boolean).join(' · ') : 'Включи музыку в любом плеере — Резонанс её услышит';
  n.cov.style.backgroundImage = active && st.thumb ? `url("${st.thumb}")` : '';
  if (coverCols) n.w.style.setProperty('--cov', coverCols[0]);
  const name = media.playing() ? 'pause' : 'play';
  if (n.play._icon !== name) {
    n.play._icon = name;
    n.play.replaceChildren(icon(name, 20));
  }
  n.prev.disabled = !st.canPrev;
  n.next.disabled = !st.canNext;
}

// ---------- what's new ----------

function newsCard() {
  let dismissed = '';
  try {
    dismissed = localStorage.getItem('rez.news') || '';
  } catch {}
  if (!S.version || dismissed === S.version) return null;
  const w = el('div', 'news');
  w.appendChild(el('h3', '', `Новое в ${S.version}`));
  const ul = el('ul');
  for (const t of [
    'Своя панель задач снизу: «Пуск» Резонанса, закреплённые и открытые приложения, быстрые настройки и часы',
    'Панель Windows с треем выезжает при наведении на нижний край экрана',
    'Колесо мыши над значками у часов меняет громкость, средняя кнопка открывает новое окно приложения',
    'Резонанс засыпает только когда запущена CS2 — FACEIT в трее больше не мешает',
    'Логотип на строке снова нажимается после скриншота, перезагрузки и игры',
    'Если окно или графика падают, Резонанс сам их поднимает — без пустых рамок',
  ])
    ul.appendChild(el('li', '', t));
  w.appendChild(ul);
  const x = el('button', 'x');
  x.appendChild(ic('close', 14));
  x.addEventListener('click', () => {
    try {
      localStorage.setItem('rez.news', S.version);
    } catch {}
    w.remove();
  });
  w.appendChild(x);
  return w;
}

// ---------- pages ----------

const PAGES = {
  home() {
    return [
      newsCard(),
      nowCard(),
      (() => {
        const t = el('div', 'toggles');
        t.append(tile('wallpaper', 'Живые обои', 'monitor'), tile('island', 'Остров', 'island'), tile('bar', 'Строка сверху', 'bar'), textTile());
        return t;
      })(),
      sec('Стиль волн', styleTiles(false)),
      sec('Цвета', card(swatches(), slider('waveSize', 'Размер волн', 0.4, 1.8, 0.05, pct), slider('waveBright', 'Яркость волн', 0.2, 1, 0.02, pct))),
    ];
  },

  waves() {
    return [
      sec('Стиль', styleTiles(true)),
      sec('Палитра', card(paletteGrid(), S.palette === 'cover' ? hint('Цвета берутся из обложки песни, которая сейчас играет.') : null)),
      sec(
        'Как выглядят',
        card(
          slider('waveSize', 'Размер', 0.4, 1.8, 0.05, pct),
          slider('waveBright', 'Яркость', 0.2, 1, 0.02, pct),
          slider('wavePos', 'Высота на экране', 0.2, 0.8, 0.01, (v) => (v < 0.45 ? 'выше' : v > 0.55 ? 'ниже' : 'по центру')),
          row(
            'Плавность',
            'Больше кадров — плавнее, меньше — тише видеокарта',
            seg('fps', [
              [30, '30'],
              [60, '60'],
              [144, '144'],
            ])
          )
        )
      ),
    ];
  },

  bg() {
    const isPhoto = S.bg === 'windows' || S.bg === 'image';
    return [
      sec('Фон', bgTiles()),
      isPhoto
        ? sec(
            'Картинка',
            card(
              slider('bgDim', 'Затемнение', 0, 0.85, 0.01, pct),
              slider('bgBlur', 'Размытие', 0, 40, 1, (v) => (v ? `${Math.round(v)} px` : 'нет')),
              S.bg === 'image' ? btnRow(button('Выбрать другой рисунок', 'image', '', () => window.rez.pickImage())) : null
            )
          )
        : null,
      sec('Движение', card(row('Облака света плывут', 'Медленно, почти незаметно', sw('clouds')), row('Тень по краям экрана', 'Значки на рабочем столе читаются лучше', sw('vignette')))),
    ];
  },

  text() {
    const m = S.text || 'off';
    const sample = el('div', 'sample');
    sample.appendChild(el('b', '', 'Резонанс'));
    bind((s) => {
      sample.className = `sample ts-${s.textStyle || 'soft'} font-${s.textFont || 'display'}`;
    });
    const custom = el('textarea', 'input');
    custom.rows = 2;
    custom.maxLength = 200;
    custom.placeholder = 'Любые слова — например, «Не сдавайся»';
    custom.value = S.textCustom || '';
    let tmr = 0;
    custom.addEventListener('input', () => {
      S.textCustom = custom.value;
      clearTimeout(tmr);
      tmr = setTimeout(() => window.rez.set({ textCustom: custom.value }), 250);
    });
    return [
      sec(
        'Что за волнами',
        card(
          seg(
            'text',
            [
              ['off', 'Ничего'],
              ['lyrics', 'Слова'],
              ['track', 'Название'],
              ['clock', 'Часы'],
              ['custom', 'Своё'],
            ],
            (v) => {
              set({ text: v });
              render(true);
            }
          ),
          m === 'lyrics' ? hint('Слова песни появляются строчка за строчкой, в такт. Если слов не нашлось, за волнами будет название песни.') : null,
          m === 'custom' ? custom : null
        )
      ),
      m === 'off'
        ? null
        : sec(
            'Как выглядит',
            card(
              sample,
              row('Стиль', null, seg('textStyle', [
                ['soft', 'Мягкий'],
                ['outline', 'Контур'],
                ['glass', 'Стекло'],
              ])),
              row('Шрифт', null, seg('textFont', [
                ['display', 'Unbounded'],
                ['body', 'Onest'],
                ['thin', 'Тонкий'],
              ])),
              row('Место', null, seg('textPos', [
                ['center', 'За волнами'],
                ['top', 'Выше'],
              ])),
              slider('textSize', 'Размер', 0.5, 1.8, 0.05, pct),
              slider('textOpacity', 'Яркость', 0.1, 1, 0.02, pct)
            )
          ),
      m === 'lyrics'
        ? sec(
            'Слова песни',
            card(
              slider('textShift', 'Сдвиг слов', -5, 5, 0.25, (v) => (Math.abs(v) < 0.01 ? 'точно' : v > 0 ? `раньше на ${v} с` : `позже на ${-v} с`)),
              hint('Если строчки спешат или отстают от песни — подвинь их.'),
              btnRow(button('Поискать слова ещё раз', 'quote', '', () => window.rez.action('lyricsAgain')))
            )
          )
        : null,
    ];
  },

  bar() {
    return [
      sec(
        'Строка сверху',
        card(
          row('Показывать строку', 'Часы, дата и логотип; окна не заходят под неё', sw('bar')),
          slider('barTint', 'Плотность фона', 0, 0.95, 0.01, (v) => (v < 0.15 ? 'почти прозрачная' : v > 0.75 ? 'плотная' : pct(v))),
          row('Секунды в часах', null, sw('barSeconds')),
          row('Дата', null, sw('barDate')),
          row('Логотип танцует под музыку', null, sw('barMark'))
        )
      ),
      sec(
        'Плеер',
        card(
          seg('island', [
            [true, 'Остров'],
            [false, 'Капсула в строке'],
          ]),
          row('Показывать новую песню', 'Остров раскрывается на пару секунд, когда песня сменилась', sw('islandPeek')),
          row('Свечение в цвет обложки', null, sw('islandGlow')),
          hint('Остров работает и без строки — тогда он висит у верхнего края экрана.')
        )
      ),
    ];
  },

  sys() {
    const status = el('div', 'hint');
    const restore = button('Вернуть цвета Windows как было', 'palette', '', () => window.rez.action('restoreColors'));
    const again = button('Применить ещё раз', 'waves', '', () => window.rez.action('applyColors'));
    const btns = el('div', 'btns');
    btns.append(again, restore);
    bind((s) => {
      restore.style.display = s.colorsSaved ? '' : 'none';
      again.style.display = s.winAccent || s.winDark || s.winPrevalence ? '' : 'none';
      const c = info.colors;
      status.textContent = c && c.ok ? (c.restored ? 'Цвета Windows возвращены.' : `Windows сейчас в цветах палитры «${paletteName(s)}».`) : 'Резонанс запоминает прежние цвета Windows и может вернуть их в любой момент.';
    });
    const diag = el('div', 'diag');
    const paintDiag = () => {
      const w = (info.walls || []).map((x) => (x.attached ? 'на месте' : 'не встали')).join(', ');
      diag.textContent = `Резонанс для ПК ${info.version || S.version || ''} · ${info.os || 'Windows'} · рабочий стол ${info.raised === true ? 'нового типа' : info.raised === false ? 'классический' : '—'} · обои: ${w || '—'}`;
    };
    paintDiag();
    infoHooks.push(paintDiag, () => update());
    return [
      sec(
        'Windows в цветах Резонанса',
        card(
          row('Акцент и цвет выделения', 'Пуск, параметры, выделение на рабочем столе и в окнах', sw('winAccent')),
          row('Тёмная тема Windows', 'Окна, проводник и меню — в тёмном', sw('winDark')),
          row('Акцент на панели задач и заголовках', null, sw('winPrevalence')),
          status,
          btns
        )
      ),
      sec(
        'Резонанс вместо Windows',
        card(
          row('Системный шрифт Onest', 'Меню, подсказки, заголовки окон и подписи под значками — одним аккуратным шрифтом', sw('winFont')),
          row('Панель задач Резонанса', 'Снизу вместо панели Windows: «Пуск», закреплённые и открытые приложения, часы. Панель Windows с треем выезжает при наведении на самый нижний край', sw('taskbar')),
          row('Пуск и быстрые настройки по клавишам', 'Win открывает «Пуск» Резонанса, Win+A — быстрые настройки', sw('shellKeys')),
          row('Засыпать в CS2', 'Пока запущена игра, перехват Win выключается, а строка и панели уходят назад — чтобы не трогать анти-чит. FACEIT в трее не мешает', sw('guardGames')),
          row('Недавние файлы в «Пуске»', null, sw('startRecent')),
          btnRow(button('Показать «Пуск»', 'grid', '', () => window.rez.shell('openStart')), button('Быстрые настройки', 'sliders', '', () => window.rez.shell('openQuick')))
        )
      ),
      sec(
        'Запуск',
        card(
          row('Запускать вместе с Windows', null, sw('autostart')),
          row(
            'Способ встраивания обоев',
            'Если обои не встали под значки — попробуй другой',
            seg('attachMode', [
              ['auto', 'Авто'],
              ['child', '1'],
              ['layered', '2'],
              ['worker', '3'],
            ])
          ),
          btnRow(button('Встроить заново', 'monitor', '', () => window.rez.action('reattach')), button('Журнал', 'text', '', () => window.rez.action('log')))
        )
      ),
      (() => {
        const b = el('div', 'btns');
        b.style.padding = '0 2px';
        b.append(button('Выйти из Резонанса', 'power', 'danger', () => window.rez.action('quit')));
        return b;
      })(),
      diag,
    ];
  },
};

// not a plain on/off: "off" or the last chosen kind of text
const TEXT_NAMES = { lyrics: 'Слова песни', track: 'Название песни', clock: 'Часы', custom: 'Свой текст' };
let lastText = '';
function textTile() {
  return tile('text', 'Слова за волнами', 'quote', {
    isOn: (s) => !!s.text && s.text !== 'off',
    state: (s) => TEXT_NAMES[s.text] || 'Выключено',
    click: () => {
      if (S.text && S.text !== 'off') {
        lastText = S.text;
        set({ text: 'off' });
      } else set({ text: lastText || 'lyrics' });
    },
  });
}

function btnRow(...buttons) {
  const b = el('div', 'btns');
  b.append(...buttons);
  return b;
}

function paletteName(s) {
  const p = waves.PALETTES.find((x) => x.id === (s.palette === 'cover' ? s.lastPalette : s.palette));
  return p ? p.name : 'Фиолет';
}

// ---------- tabs ----------

const tabsEl = $('tabs');
const ind = $('tabInd');
const bodyEl = $('body');
const tabBtns = TABS.map(([id, name]) => {
  const b = el('button', 'tab');
  b.setAttribute('role', 'tab');
  b.appendChild(ic(id, 18));
  b.appendChild(el('span', '', name));
  b.addEventListener('click', () => switchTab(id));
  tabsEl.appendChild(b);
  return [id, b];
});

function placeInd() {
  const on = tabBtns.find(([id]) => id === tab);
  if (!on) return;
  ind.style.width = `${on[1].offsetWidth}px`;
  ind.style.transform = `translateX(${on[1].offsetLeft}px)`;
}

let infoHooks = [];

function render(keepScroll) {
  binds = [];
  infoHooks = [];
  nowParts = null;
  const page = el('div', 'page');
  for (const part of PAGES[tab]()) if (part) page.appendChild(part);
  const top = bodyEl.scrollTop;
  bodyEl.replaceChildren(page);
  if (keepScroll) bodyEl.scrollTop = top;
  update();
  return page;
}

function switchTab(id, animate = true) {
  if (!PAGES[id]) return;
  const from = TABS.findIndex(([t]) => t === tab);
  const to = TABS.findIndex(([t]) => t === id);
  tab = id;
  for (const [t, b] of tabBtns) b.classList.toggle('on', t === id);
  placeInd();
  const page = render(false);
  bodyEl.scrollTop = 0;
  if (animate && from !== to) page.classList.add('in', ...(to < from ? ['back'] : []));
}

// ---------- open / close ----------

$('close').appendChild(ic('close', 16));
$('close').addEventListener('click', () => window.rez.panel('close'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.rez.panel('close');
});

let openTimer = 0;
window.rez.onPanel((m) => {
  if (!m) return;
  if (m.open) {
    document.body.classList.toggle('from-bottom', m.from === 'bottom');
    document.body.classList.remove('opening');
    void document.body.offsetWidth;
    if (m.tab && m.tab !== tab) switchTab(m.tab, false);
    else render(false);
    document.body.classList.add('opening');
    clearTimeout(openTimer);
    openTimer = setTimeout(() => document.body.classList.remove('opening'), 900);
    window.rez.info().then(setInfo);
  } else if (m.tab) switchTab(m.tab);
});

function setInfo(i) {
  info = i || {};
  for (const fn of infoHooks) fn();
}
window.rez.onInfo(setInfo);

// ---------- start ----------

function applySettings(s) {
  if (!s) return;
  const prevPalette = S.palette;
  const prevBg = S.bg;
  S = s;
  $('ver').textContent = s.version || '';
  // a page that shows different things for different choices is built again
  if ((tab === 'bg' && prevBg !== s.bg) || (tab === 'waves' && prevPalette !== s.palette && (prevPalette === 'cover' || s.palette === 'cover'))) render(true);
  else update();
}

window.rez.settings().then((s) => {
  applySettings(s);
  for (const [t, b] of tabBtns) b.classList.toggle('on', t === tab);
  render(false);
  requestAnimationFrame(placeInd);
});
window.rez.onSettings(applySettings);
window.addEventListener('resize', () => {
  placeInd();
  for (const s of document.querySelectorAll('.seg')) s._place && s._place();
});
document.fonts && document.fonts.ready.then(placeInd);
