// Резонанс Лаунчер: the settings — wallpaper, colours, icons, the desktop, the
// page on the left, the drawer, gestures, the system. Everything changes the
// desktop behind at once, so it can be seen while choosing.

import * as waves from '../../src/waves.js';
import { rez } from './bridge.js';
import { S, L, save, saveLayout } from './store.js';
import * as look from './look.js';
import * as home from './home.js';
import * as apps from './apps.js';
import * as weather from './weather.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = home.el;
const root = $('settings');
const body = $('stbody');
const title = $('sttitle');
const backBtn = $('stback');

let info = {};
export const setInfo = (i) => (info = i || {});
let stack = [];
let isOpen = false;
export const opened = () => isOpen;

// ---------- small pieces ----------

function group(...children) {
  const g = el('div', 'st-group');
  for (const c of children) if (c) g.appendChild(c);
  return g;
}

function label(text) {
  return el('div', 'st-label', text);
}

function note(text) {
  return el('div', 'st-note', text);
}

function toggle(text, key, sub, onChange) {
  const r = el('label', 'st-row');
  const t = el('div', 'st-t');
  t.append(el('b', '', text));
  if (sub) t.append(el('span', '', sub));
  const sw = el('input');
  sw.type = 'checkbox';
  sw.className = 'sw';
  sw.checked = !!S[key];
  sw.addEventListener('change', () => {
    save({ [key]: sw.checked });
    if (onChange) onChange(sw.checked);
  });
  r.append(t, sw);
  return r;
}

// a row of choices: [[value, text]…]
function seg(text, key, opts, sub, onChange) {
  const r = el('div', 'st-seg');
  r.append(el('b', '', text));
  if (sub) r.append(el('span', '', sub));
  const row = el('div', 'seg');
  for (const [v, t] of opts) {
    const b = el('button', 'seg-b' + (S[key] === v ? ' on' : ''), t);
    b.addEventListener('click', () => {
      save({ [key]: v });
      for (const x of row.children) x.classList.toggle('on', x === b);
      if (onChange) onChange(v);
    });
    row.append(b);
  }
  r.append(row);
  return r;
}

function slider(text, key, min, max, step, fmt) {
  const r = el('div', 'st-seg');
  const head = el('div', 'st-sl');
  const val = el('em', '', fmt(S[key]));
  head.append(el('b', '', text), val);
  const rng = el('input');
  rng.type = 'range';
  rng.min = min;
  rng.max = max;
  rng.step = step;
  rng.value = S[key];
  rng.className = 'rng';
  const fill = () => rng.style.setProperty('--f', ((rng.value - min) / (max - min)) * 100 + '%');
  fill();
  rng.addEventListener('input', () => {
    val.textContent = fmt(+rng.value);
    fill();
  });
  rng.addEventListener('change', () => save({ [key]: +rng.value }));
  r.append(head, rng);
  return r;
}

function action(text, sub, fn, cls) {
  const r = el('button', 'st-row act' + (cls ? ' ' + cls : ''));
  const t = el('div', 'st-t');
  t.append(el('b', '', text));
  if (sub) t.append(el('span', '', sub));
  r.append(t, icon('chevron', 'chev'));
  r.addEventListener('click', fn);
  return r;
}

function status(text, ok, sub, btn, fn) {
  const r = el('div', 'st-row');
  const t = el('div', 'st-t');
  t.append(el('b', '', text));
  if (sub) t.append(el('span', '', sub));
  const right = el('div', 'st-r');
  const dot = el('i', 'dot-s ' + (ok ? 'ok' : 'no'));
  right.append(dot);
  if (!ok && btn) {
    const b = el('button', 'btn', btn);
    b.addEventListener('click', fn);
    right.append(b);
  }
  r.append(t, right);
  return r;
}

// ---------- pages ----------

const PAGES = {};

PAGES.root = {
  title: 'Резонанс',
  build(b) {
    const hero = el('div', 'st-hero');
    const mark = el('span', 'mark');
    for (let i = 0; i < 4; i++) mark.append(el('i'));
    hero.append(mark, el('b', '', 'Резонанс Лаунчер'), el('span', '', 'версия ' + (info.app || '1.0')));
    b.append(hero);
    const entries = [
      ['image', 'Обои и фон', 'волны, стиль, движение', 'wall'],
      ['palette', 'Цвета', 'палитра всего экрана', 'colors'],
      ['shapes', 'Значки', 'форма, размер, подписи', 'icons'],
      ['grid', 'Рабочий стол', 'сетка, док, страницы', 'desk'],
      ['sun', 'Страница «Сегодня»', 'часы, погода, плеер', 'feed'],
      ['search', 'Ящик приложений', 'вид, поиск, скрытые', 'drawer'],
      ['hand', 'Жесты и отклик', 'свайпы, вибрация, поворот', 'gest'],
      ['gear', 'Система', 'главный экран, доступы, копия', 'sys'],
    ];
    const g = el('div', 'st-group');
    for (const [glyph, t, sub, id] of entries) {
      const r = el('button', 'st-row nav');
      const ic = el('i', 'st-ic');
      ic.append(icon(glyph));
      const tt = el('div', 'st-t');
      tt.append(el('b', '', t), el('span', '', sub));
      r.append(ic, tt, icon('chevron', 'chev'));
      r.addEventListener('click', () => go(id));
      g.append(r);
    }
    b.append(g);
  },
};

PAGES.wall = {
  title: 'Обои и фон',
  build(b) {
    const modeNote = el('div', 'st-note');
    const extra = el('div');
    const showMode = () => {
      modeNote.textContent =
        S.wall === 'waves'
          ? 'Волны рисует сам лаунчер за значками. Обои телефона за ним не видны.'
          : S.wall === 'live'
            ? 'Волны становятся обоями телефона: видны и за лаунчером, и на экране блокировки.'
            : 'За значками видны обои, которые стоят на телефоне. Волны не рисуются.';
      extra.textContent = '';
      if (S.wall === 'live') {
        extra.append(
          group(
            info.liveWall
              ? status('Живые обои Резонанса', true, 'установлены на телефон')
              : action('Установить живые обои', 'система попросит подтвердить', () => rez.setLiveWallpaper())
          )
        );
      } else if (S.wall === 'system') {
        extra.append(group(action('Выбрать картинку', 'откроется выбор обоев телефона', () => rez.pickWallpaper())));
      }
    };
    b.append(
      group(
        seg('Фон главного экрана', 'wall', [
          ['waves', 'Волны'],
          ['live', 'Живые обои'],
          ['system', 'Свои обои'],
        ], null, showMode)
      ),
      modeNote,
      extra
    );
    showMode();

    b.append(label('Стиль волн'));
    const grid = el('div', 'st-cards');
    const cards = [];
    for (const s of look.STYLES) {
      const c = el('button', 'card' + (S.style === s.id ? ' on' : ''));
      const cv = el('canvas');
      c.append(cv, el('span', '', s.name));
      c.addEventListener('click', () => {
        save({ style: s.id });
        for (const x of grid.children) x.classList.toggle('on', x === c);
      });
      grid.append(c);
      cards.push([cv, s.id]);
    }
    b.append(grid);
    requestAnimationFrame(() => cards.forEach(([cv, id]) => waves.renderPreview(cv, id, S.palette)));

    b.append(label('Фон'));
    const bg = el('div', 'st-cards bgs');
    for (const [id, name] of look.BACKGROUNDS) {
      const c = el('button', 'card bgc bg-' + id + (S.bg === id ? ' on' : ''));
      const sw = el('i', 'bgsw');
      c.append(sw, el('span', '', name));
      c.addEventListener('click', () => {
        save({ bg: id });
        for (const x of bg.children) x.classList.toggle('on', x === c);
      });
      bg.append(c);
    }
    b.append(bg);

    b.append(
      label('Движение'),
      group(
        seg('Волны', 'motion', [
          ['off', 'Стоят'],
          ['calm', 'Спокойные'],
          ['lively', 'Живые'],
        ]),
        seg('Плавность', 'fps', [
          [24, '24'],
          [30, '30'],
          [60, '60'],
        ], 'больше кадров — красивее, но быстрее садится батарея'),
        toggle('Волны едут за страницами', 'parallax'),
        toggle('Слышат музыку', 'hear', 'подстраиваются под то, что играет')
      )
    );
    if (!info.mic) {
      b.append(group(status('Доступ к звуку', false, 'без него волны двигаются сами по себе', 'Разрешить', () => rez.requestMic())));
    }
  },
};

PAGES.colors = {
  title: 'Цвета',
  build(b) {
    b.append(note('Палитра красит волны, отметки страниц, подсветку, значки в одном цвете и всё остальное.'));
    const grid = el('div', 'st-pal');
    for (const p of look.PALETTES) {
      const c = el('button', 'pal' + (S.palette === p.id ? ' on' : ''));
      c.style.setProperty('--g', `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]} 55%, ${p.colors[2]})`);
      c.append(el('i'), el('span', '', p.name));
      c.addEventListener('click', () => {
        save({ palette: p.id });
        for (const x of grid.children) x.classList.toggle('on', x === c);
      });
      grid.append(c);
    }
    b.append(grid);
    b.append(note('«Из обложки» подбирает цвета из обложки играющей песни. «Material You» берёт цвета Android 12 и выше.'));
  },
};

// a sample icon for the shapes
function sample(shape) {
  const ic = el('div', 'ic sample shape-' + shape);
  const m = el('span', 'mark');
  for (let i = 0; i < 4; i++) m.append(el('i'));
  ic.append(m);
  return ic;
}

PAGES.icons = {
  title: 'Значки',
  build(b) {
    b.append(label('Форма'));
    const g = el('div', 'st-shapes');
    const shapes = [
      ['squircle', 'Плавный'],
      ['circle', 'Круг'],
      ['round', 'Скруглённый'],
      ['drop', 'Капля'],
      ['original', 'Как есть'],
    ];
    for (const [id, name] of shapes) {
      const c = el('button', 'shp' + (S.shape === id ? ' on' : ''));
      c.append(sample(id === 'original' ? 'squircle' : id), el('span', '', name));
      c.addEventListener('click', () => {
        save({ shape: id });
        for (const x of g.children) x.classList.toggle('on', x === c);
      });
      g.append(c);
    }
    b.append(g);
    b.append(
      group(
        slider('Размер', 'iconSize', 0.8, 1.3, 0.05, (v) => Math.round(v * 100) + '%'),
        toggle('Подписи под значками', 'labels'),
        seg('Подложка', 'plate', [
          ['auto', 'По цвету'],
          ['tint', 'Палитра'],
          ['glass', 'Стекло'],
        ], 'под значками старого вида, у которых нет своей формы'),
        toggle('Значки в цвет палитры', 'themed', 'у приложений с одноцветным значком (Android 13+)')
      ),
      group(toggle('Точки уведомлений', 'badges', 'число непрочитанного на значке')),
      info.notif ? null : group(status('Доступ к уведомлениям', false, 'нужен для точек и для «Сейчас играет»', 'Открыть', () => rez.openNotificationAccess()))
    );
  },
};

PAGES.desk = {
  title: 'Рабочий стол',
  build(b) {
    b.append(
      group(
        seg('Сетка', 'grid', [
          ['auto', 'Авто'],
          ['4x5', '4×5'],
          ['5x5', '5×5'],
          ['5x6', '5×6'],
          ['6x6', '6×6'],
        ], 'Авто подбирает число значков под экран телефона или планшета'),
        toggle('Подписи в доке', 'dockLabels'),
        toggle('Ручка ящика внизу', 'drawerButton', 'нажмите, чтобы открыть все приложения'),
        toggle('Новые приложения на экран', 'addNew', 'только что установленные появляются сами')
      ),
      label('Страницы'),
      group(
        action('Виджеты', 'часы, погода, плеер, поиск и виджеты других приложений', () => document.dispatchEvent(new CustomEvent('rez-open-widgets'))),
        action('Сбросить раскладку', 'значки вернутся на места по умолчанию', (e) => {
          // two taps instead of a dialog (the system's dialog does not open in the page)
          const row = e.currentTarget;
          const b = row.querySelector('b');
          if (!row.dataset.armed) {
            row.dataset.armed = '1';
            b.textContent = 'Нажмите ещё раз — папки и порядок пропадут';
            setTimeout(() => {
              delete row.dataset.armed;
              b.textContent = 'Сбросить раскладку';
            }, 3500);
            return;
          }
          L.seeded = false;
          L.pages = [[]];
          L.dock = [];
          L.folders = {};
          saveLayout();
          home.render();
          close();
        }, 'danger')
      )
    );
  },
};

PAGES.feed = {
  title: 'Страница «Сегодня»',
  build(b) {
    b.append(
      group(
        toggle('Страница слева от рабочего стола', 'feed', 'на планшете в горизонтали — отдельная колонка'),
        seg('Часы', 'clockStyle', [
          ['big', 'Крупные'],
          ['slim', 'Компактные'],
        ]),
        toggle('Погода', 'weather', 'место определяется по интернету или выбирается вручную')
      ),
      label('Город для погоды')
    );
    const cur = el('div', 'st-note', S.city ? 'Выбран: ' + S.city.name : 'Определяется автоматически');
    const input = el('input', 'st-input');
    input.placeholder = 'Название города';
    const res = el('div', 'st-group');
    let timer = 0;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        res.textContent = '';
        if (input.value.trim().length < 2) return;
        try {
          for (const c of await weather.search(input.value.trim())) {
            res.append(
              action(c.name, c.where, () => {
                save({ city: { name: c.name, lat: c.lat, lon: c.lon } });
                weather.refresh();
                cur.textContent = 'Выбран: ' + c.name;
                res.textContent = '';
                input.value = '';
              })
            );
          }
        } catch {
          res.append(note('Не удалось найти: нет сети?'));
        }
      }, 400);
    });
    b.append(cur, input, res);
    if (S.city) {
      b.append(
        group(
          action('Определять автоматически', '', () => {
            save({ city: null });
            weather.refresh();
            cur.textContent = 'Определяется автоматически';
          })
        )
      );
    }
  },
};

PAGES.drawer = {
  title: 'Ящик приложений',
  build(b) {
    b.append(
      group(
        seg('Вид', 'drawerStyle', [
          ['grid', 'Сетка'],
          ['list', 'Список'],
        ]),
        toggle('Виды приложений', 'drawerCats', 'игры, музыка, общение и другие — полоской сверху'),
        toggle('Клавиатура сразу', 'drawerKeyboard', 'при открытии ящика можно сразу печатать')
      ),
      label('Поиск в интернете'),
      group(
        seg('Искать в', 'engine', [
          ['yandex', 'Яндекс'],
          ['google', 'Google'],
          ['ddg', 'DuckDuckGo'],
        ])
      ),
      label('Скрытые приложения')
    );
    const hid = apps.all().filter((a) => apps.hidden(a));
    if (!hid.length) {
      b.append(note('Скрытых нет. Скрыть приложение можно долгим нажатием на значок в ящике.'));
    } else {
      const g = el('div', 'st-group');
      for (const a of hid) {
        const r = el('label', 'st-row');
        const ic = el('img', 'st-app');
        ic.src = rez.iconUrl(a.pkg);
        const t = el('div', 'st-t');
        t.append(el('b', '', a.label));
        const sw = el('input');
        sw.type = 'checkbox';
        sw.className = 'sw';
        sw.checked = true;
        sw.addEventListener('change', () => {
          if (!sw.checked) L.hidden = (L.hidden || []).filter((p) => p !== a.pkg);
          else if (L.hidden.indexOf(a.pkg) < 0) L.hidden.push(a.pkg);
          saveLayout();
        });
        r.append(ic, t, sw);
        g.append(r);
      }
      b.append(g, note('Переключатель включён — приложение скрыто.'));
    }
  },
};

PAGES.gest = {
  title: 'Жесты и отклик',
  build(b) {
    b.append(
      note('Свайп вверх по рабочему столу открывает ящик приложений.'),
      group(
        seg('Свайп вниз', 'swipeDown', [
          ['shade', 'Шторка'],
          ['search', 'Поиск'],
          ['none', 'Ничего'],
        ]),
        seg('Поворот экрана', 'orient', [
          ['auto', 'Как в системе'],
          ['portrait', 'Только вертикально'],
        ]),
        toggle('Вибрация', 'sounds', 'при долгом нажатии, переносе и открытии папки')
      )
    );
  },
};

PAGES.sys = {
  title: 'Система',
  build(b) {
    b.append(
      group(
        status('Главный экран', !!info.home, info.home ? 'Резонанс открывается кнопкой «Домой»' : 'сейчас «Домой» открывает другой лаунчер', 'Выбрать', () => rez.openHomeSettings()),
        status('Доступ к уведомлениям', !!info.notif, 'точки на значках и «Сейчас играет»', 'Открыть', () => rez.openNotificationAccess()),
        status('Звук для волн', !!info.mic, 'чтобы волны слышали музыку', 'Разрешить', () => rez.requestMic())
      ),
      label('Копия настроек'),
      group(
        action('Скопировать копию', 'раскладка и настройки одним текстом', async () => {
          try {
            await navigator.clipboard.writeText(JSON.stringify({ s: S, l: L }));
            toast('Скопировано');
          } catch {
            toast('Не вышло скопировать');
          }
        }),
        action('Вставить копию', 'восстановить из скопированного текста', async () => {
          try {
            const t = await navigator.clipboard.readText();
            const o = JSON.parse(t);
            if (!o || !o.s || !o.l) throw new Error('not ours');
            localStorage.setItem('rez.l.state', JSON.stringify(o));
            rez.storeSet(JSON.stringify(o));
            location.reload();
          } catch {
            toast('В буфере нет копии Резонанса');
          }
        })
      ),
      group(
        action('Показать заставку', 'вступление с волнами, как при первом запуске', () => {
          close();
          setTimeout(() => document.dispatchEvent(new CustomEvent('rez-play-intro')), 350);
        })
      ),
      label('О телефоне'),
      note([info.maker, info.model].filter(Boolean).join(' ') + (info.android ? ' · Android ' + info.android : '') + (info.tablet ? ' · планшет' : '') + ' · ' + home.geo.cols + '×' + home.geo.rows)
    );
  },
};

// ---------- the sheet ----------

function toast(text) {
  document.dispatchEvent(new CustomEvent('rez-toast', { detail: text }));
}

function render() {
  const page = PAGES[stack[stack.length - 1]];
  body.textContent = '';
  title.textContent = page.title;
  backBtn.classList.toggle('hidden', false);
  page.build(body);
  body.scrollTop = 0;
}

export function open(id) {
  info = Object.assign(info, rez.info());
  stack = ['root'];
  if (id && PAGES[id]) stack.push(id);
  isOpen = true;
  root.classList.add('on');
  render();
}

export function close() {
  if (!isOpen) return;
  isOpen = false;
  root.classList.remove('on');
}

export function go(id) {
  stack.push(id);
  render();
}

// Back: one page up, or the sheet closes
export function back() {
  if (!isOpen) return false;
  if (stack.length > 1) {
    stack.pop();
    render();
  } else close();
  return true;
}

backBtn.addEventListener('click', back);
$('stclose').addEventListener('click', close);
$('stscrim').addEventListener('click', close);

// the current page is built again when something it shows changed
export function refresh() {
  if (isOpen) {
    const top = body.scrollTop;
    const page = PAGES[stack[stack.length - 1]];
    body.textContent = '';
    page.build(body);
    body.scrollTop = top;
  }
}
