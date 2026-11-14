// The weather for the weather widget: the place from the internet address (the
// launcher asks for no location permission; several services are tried, since
// some are unreachable from some networks), the forecast from Open-Meteo (no
// key). Everything goes through the Android side's /net (a short list of hosts).

import { rez, native } from './bridge.js';

const BASE = location.protocol === 'https:' ? location.origin + '/' : '/';
const net = (url) => (native ? `${BASE}net?u=${encodeURIComponent(url)}` : url);

async function getJson(url, ms = 12000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(net(url), ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const cacheGet = (k, maxAge) => {
  try {
    const v = JSON.parse(localStorage.getItem('rezw-' + k) || 'null');
    return v && (!maxAge || Date.now() - v.at < maxAge) ? v.data : null;
  } catch {
    return null;
  }
};
const cacheSet = (k, data) => {
  try {
    localStorage.setItem('rezw-' + k, JSON.stringify({ at: Date.now(), data }));
  } catch {}
};

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const FINDERS = [
  ['https://api.sypexgeo.net/json/', (g) => g && g.city && { lat: num(g.city.lat), lon: num(g.city.lon), city: g.city.name_ru || g.city.name_en || '' }],
  ['https://get.geojs.io/v1/ip/geo.json', (g) => g && { lat: num(g.latitude), lon: num(g.longitude), city: g.city || '' }],
  ['https://ipwho.is/?lang=ru', (g) => g && g.success !== false && { lat: num(g.latitude), lon: num(g.longitude), city: g.city || '' }],
  ['https://freeipapi.com/api/json', (g) => g && { lat: num(g.latitude), lon: num(g.longitude), city: g.cityName || '' }],
];

async function place() {
  const hit = cacheGet('place', 12 * 3600e3);
  if (hit) return hit;
  for (const [url, read] of FINDERS) {
    try {
      const p = read(await getJson(url, 8000));
      if (p && p.lat != null && p.lon != null && (p.lat || p.lon)) {
        if (!/[а-яё]/i.test(p.city)) {
          try {
            const r = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lon}&zoom=10&accept-language=ru`, 8000);
            const a = (r && r.address) || {};
            p.city = a.city || a.town || a.village || p.city;
          } catch {}
        }
        cacheSet('place', p);
        return p;
      }
    } catch {}
  }
  return cacheGet('place', 0);
}

async function forecast() {
  const p = await place();
  if (!p) throw new Error('не нашлось место');
  const q = `latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`;
  const r = await getJson('https://api.open-meteo.com/v1/forecast?' + q);
  const c = r && r.current;
  if (!c) throw new Error('пустой прогноз');
  const w = {
    temp: Math.round(c.temperature_2m),
    code: c.weather_code,
    day: c.is_day === 1,
    max: r.daily ? Math.round(r.daily.temperature_2m_max[0]) : null,
    min: r.daily ? Math.round(r.daily.temperature_2m_min[0]) : null,
    city: p.city,
  };
  cacheSet('wx', w);
  return w;
}

export const deg = (v) => (v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°');

// the sky in the palette's colours: a few simple shapes
const SUN = '<circle cx="12" cy="12" r="4.2" class="sun"/><path class="ray" d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>';
const MOON = '<path class="sun" d="M15.5 4.5a7.5 7.5 0 1 0 4 12.5 6 6 0 0 1-4-12.5z"/>';
const CLOUD = '<path class="cloud" d="M7 18h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 7 18z"/>';
const look = (code, day) => {
  const sky = day ? SUN : MOON;
  const s = (inner) => `<svg viewBox="0 0 24 24">${inner}</svg>`;
  if (code === 0) return [s(sky), day ? 'ясно' : 'ясная ночь'];
  if (code <= 2) return [s(`<g transform="translate(-3 -3) scale(.8)">${sky}</g>` + CLOUD), 'переменная облачность'];
  if (code === 3) return [s(CLOUD), 'пасмурно'];
  if (code === 45 || code === 48) return [s('<path class="cloud" d="M4 9h16M3 13h18M5 17h14"/>'), 'туман'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return [s(CLOUD + '<path class="drop" d="M8 21h.01M12 22h.01M16 21h.01"/>'), 'снег'];
  if (code >= 95) return [s(CLOUD + '<path class="drop" d="M12 17l-2 4h3l-2 3"/>'), 'гроза'];
  if (code >= 51) return [s(CLOUD + '<path class="drop" d="M8 20l-1 2M12 20l-1 2M16 20l-1 2"/>'), code <= 57 ? 'морось' : 'дождь'];
  return [s(CLOUD), 'облачно'];
};

function describe(w) {
  if (!w) return null;
  const [svg, words] = look(w.code, w.day);
  return { ...w, svg, words, tempText: deg(w.temp), range: w.max != null ? `${deg(w.max)} / ${deg(w.min)}` : '' };
}

let timer = 0;
let current = describe(cacheGet('wx', 0));
let state = { status: 'loading' };
let listener = () => {};
export const now = () => current;
export const status = () => state;

async function tick() {
  clearTimeout(timer);
  let w = null;
  try {
    w = await forecast();
    state = { status: 'ok' };
  } catch (e) {
    state = { status: 'fail' };
    rez.log('погода: ' + (e && e.message ? e.message : e));
  }
  if (w) current = describe(w);
  listener(current);
  timer = setTimeout(tick, w ? 30 * 60e3 : 3 * 60e3);
}

export function start(fn) {
  listener = fn || listener;
  if (current) listener(current);
  const fresh = cacheGet('wx', 25 * 60e3);
  if (fresh) {
    timer = setTimeout(tick, 25 * 60e3);
    return;
  }
  tick();
}
export const stop = () => clearTimeout(timer);
