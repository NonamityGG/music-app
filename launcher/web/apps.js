// The installed apps: the list, the order, the search (Russian and Latin,
// a word typed in the wrong keyboard layout, transliteration), and the first
// home screen for someone who has not arranged anything yet.

import { rez, on } from './bridge.js';
import { S, save } from './store.js';

let list = [];
let byPkg = new Map();
const subs = [];
export const onApps = (fn) => subs.push(fn);
export const all = () => list;
export const get = (pkg) => byPkg.get(pkg);

const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
export const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

export function reload() {
  const raw = rez.apps();
  list = raw
    .filter((a) => a && a.pkg && a.label)
    .map((a) => ({ ...a, key: norm(a.label) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  byPkg = new Map(list.map((a) => [a.pkg, a]));
  firstHome();
  // apps that are gone leave the home screen and the dock
  const keep = (arr) => (arr || []).filter((p) => byPkg.has(p));
  const home = keep(S.home);
  const dock = keep(S.dock);
  if (home.length !== (S.home || []).length || dock.length !== (S.dock || []).length) save({ home, dock });
  for (const fn of subs) fn(list);
}
on('apps', () => setTimeout(reload, 120));

// the first letter for the drawer's index: А…Я, A…Z, digits as #
export function letter(a) {
  const c = a.label.trim().charAt(0).toUpperCase().replace('Ё', 'Е');
  if (/[А-Я]/.test(c) || /[A-Z]/.test(c)) return c;
  return '#';
}

// ---------- the first home screen ----------

const DOCK_GUESS = [
  [/dialer|\.phone$|contacts.*call|incallui/, /^(телефон|phone|звонки)$/],
  [/messaging|\.mms|\.sms|messages/, /^(сообщения|messages|sms)$/],
  [/chrome|browser|yandex\.browser|firefox|opera|\.webview/, /(chrome|браузер|browser|яндекс браузер)/],
  [/camera/, /^(камера|camera)$/],
];
const HOME_GUESS = [/rezonans|music|spotify|yandex\.music|zvuk/, /telegram|whatsapp|vk|viber/, /maps|navigator|2gis/, /gallery|photos/, /settings$/, /youtube/, /gmail|mail/, /calendar/, /clock|deskclock/, /calculator/, /files|filemanager/, /market|vending|appgallery|rustore/];

function firstHome() {
  if (S.home && S.dock) return;
  const taken = new Set();
  const pick = (pkgRe, labelRe) => {
    const a = list.find((x) => !taken.has(x.pkg) && (pkgRe.test(x.pkg) || (labelRe && labelRe.test(x.key))));
    if (a) taken.add(a.pkg);
    return a && a.pkg;
  };
  const dock = DOCK_GUESS.map(([p, l]) => pick(p, l)).filter(Boolean);
  const home = HOME_GUESS.map((p) => pick(p)).filter(Boolean);
  for (const a of list) {
    if (home.length >= 8) break;
    if (!taken.has(a.pkg) && !a.sys) {
      taken.add(a.pkg);
      home.push(a.pkg);
    }
  }
  save({ home: S.home || home.slice(0, 12), dock: S.dock || dock.slice(0, 4) });
}

// ---------- search ----------

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const swapLayout = (s) =>
  s.replace(/./g, (c) => {
    const i = EN.indexOf(c);
    if (i >= 0) return RU[i];
    const j = RU.indexOf(c);
    return j >= 0 ? EN[j] : c;
  });
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const translit = (s) => s.replace(/[а-я]/g, (c) => TR[c] ?? c);

function score(a, q) {
  const k = a.key;
  if (k === q) return 100;
  if (k.startsWith(q)) return 90;
  if (k.split(/[\s\-_.:]+/).some((w) => w.startsWith(q))) return 80;
  if (k.includes(q)) return 60;
  const t = translit(k);
  if (t.startsWith(q)) return 55;
  if (t.includes(q)) return 40;
  if (a.pkg.toLowerCase().includes(q) && q.length > 2) return 20;
  // the letters in order ("тлг" → Телеграм)
  let i = 0;
  for (const c of k) if (c === q[i]) i++;
  return i === q.length && q.length > 1 ? 10 : 0;
}

export function search(text) {
  const q = norm(text);
  if (!q) return [];
  const sw = swapLayout(q);
  const qs = [q, sw, translit(q), translit(sw)];
  const out = [];
  for (const a of list) {
    let best = 0;
    for (let i = 0; i < qs.length; i++) best = Math.max(best, score(a, qs[i]) - i * 5);
    if (best > 0) out.push([best + Math.min(9, (S.uses[a.pkg]?.n || 0) / 3), a]);
  }
  return out.sort((x, y) => y[0] - x[0]).map((x) => x[1]);
}

// the ones opened most and lately: the row above the drawer's list
export function frequent(n = 4) {
  const now = Date.now();
  return list
    .map((a) => {
      const u = S.uses[a.pkg];
      return [u ? u.n / (1 + (now - u.at) / 864e5 / 7) : 0, a];
    })
    .filter((x) => x[0] > 0)
    .sort((x, y) => y[0] - x[0])
    .slice(0, n)
    .map((x) => x[1]);
}
