// Резонанс OS: the weather where the TV is. The place is the town chosen in the
// settings, or found from the internet address (no GPS on a TV): several
// services are asked in turn, since some are unreachable from some networks.
// The forecast is Open-Meteo's, or yr.no's where Open-Meteo is cut off (some
// providers block its hosting); neither needs a key. Everything goes through
// the Android side (tv.net), so the box's browser engine can't get in the way.

import { tv } from './tv.js';
import { S, cacheGet, cacheSet } from './store.js';
import { weatherLook } from './icons.js';

let timer = 0;
let listener = () => {};
let state = { status: 'loading', why: '' };

async function getJson(url, ms = 12000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(tv.net(url), ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const cyr = (s) => /[а-яё]/i.test(s || '');

// each one: url and how to read it
const FINDERS = [
  ['ipinfo.io', 'https://ipinfo.io/json', (g) => g && g.loc && { lat: num(g.loc.split(',')[0]), lon: num(g.loc.split(',')[1]), city: g.city || '' }],
  ['api.sypexgeo.net', 'https://api.sypexgeo.net/json/', (g) => g && g.city && { lat: num(g.city.lat), lon: num(g.city.lon), city: g.city.name_ru || g.city.name_en || '' }],
  ['get.geojs.io', 'https://get.geojs.io/v1/ip/geo.json', (g) => g && { lat: num(g.latitude), lon: num(g.longitude), city: g.city || '' }],
  ['ipwho.is', 'https://ipwho.is/?lang=ru', (g) => g && g.success !== false && { lat: num(g.latitude), lon: num(g.longitude), city: g.city || '' }],
  ['freeipapi.com', 'https://freeipapi.com/api/json', (g) => g && { lat: num(g.latitude), lon: num(g.longitude), city: g.cityName || '' }],
  ['ipapi.co', 'https://ipapi.co/json/', (g) => g && { lat: num(g.latitude), lon: num(g.longitude), city: g.city || '' }],
];

async function findPlace() {
  const fails = [];
  for (const [name, url, read] of FINDERS) {
    try {
      const p = read(await getJson(url, 8000));
      if (p && p.lat != null && p.lon != null && (p.lat !== 0 || p.lon !== 0)) {
        tv.log(`погода: место по ${name}: ${p.city} (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)})`);
        return p;
      }
      fails.push(name + ': нет координат');
    } catch (e) {
      fails.push(name + ': ' + (e && e.message ? e.message : e));
    }
  }
  tv.log('погода: место не найдено — ' + fails.join('; '));
  return null;
}

async function place() {
  // chosen in the settings
  if (S.city && S.city.lat != null) return { lat: S.city.lat, lon: S.city.lon, city: S.city.name, chosen: true };
  const hit = cacheGet('place2', 12 * 3600e3);
  if (hit) return hit;
  const p = await findPlace();
  if (!p) return cacheGet('place2', 0);
  // the town's name in Russian
  if (!cyr(p.city)) {
    try {
      const r = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lon}&zoom=10&accept-language=ru`, 8000);
      const a = (r && r.address) || {};
      p.city = a.city || a.town || a.village || a.municipality || a.county || p.city;
    } catch {}
  }
  cacheSet('place2', p);
  return p;
}

const KEY = () => 'wx4|' + (S.city ? S.city.name : 'auto');
// an old forecast is not today's weather: not shown after this long
const TOO_OLD = 12 * 3600e3;

async function forecast(force) {
  const key = KEY();
  const hit = !force && cacheGet(key, 20 * 60e3);
  if (hit) return hit;
  const p = await place();
  if (!p) throw new Error('не удалось определить, где телевизор');
  const order = cacheGet('wxsrc', 6 * 3600e3) === 'yr' ? [fromYr, fromOpenMeteo] : [fromOpenMeteo, fromYr];
  const fails = [];
  for (const get of order) {
    try {
      const w = await get(p);
      w.city = p.city;
      w.at = Date.now();
      cacheSet('wxsrc', get === fromYr ? 'yr' : 'om');
      cacheSet(key, w);
      return w;
    } catch (e) {
      fails.push((get === fromYr ? 'yr.no' : 'open-meteo') + ': ' + (e && e.message ? e.message : e));
    }
  }
  throw new Error(fails.join('; '));
}

async function fromOpenMeteo(p) {
  const q =
    `latitude=${p.lat}&longitude=${p.lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m' +
    '&hourly=temperature_2m,weather_code,is_day&forecast_hours=26' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=5&timezone=auto&wind_speed_unit=ms';
  const r = await getJson('https://api.open-meteo.com/v1/forecast?' + q, 9000);
  const c = r && r.current;
  if (!c) throw new Error('пустой прогноз');
  const hours = [];
  if (r.hourly && r.hourly.time) {
    const now = c.time || '';
    let first = -1;
    for (let i = 0; i < r.hourly.time.length; i++) {
      if (r.hourly.time[i] > now) {
        first = i;
        break;
      }
    }
    // every second hour from the next one: a longer look ahead in the same space
    for (let i = first; first >= 0 && i < r.hourly.time.length && hours.length < 6; i += 2) {
      const t = r.hourly.time[i];
      hours.push({ h: t.slice(11, 13), t: Math.round(r.hourly.temperature_2m[i]), code: r.hourly.weather_code[i], day: r.hourly.is_day[i] === 1 });
    }
  }
  const days = [];
  if (r.daily && r.daily.time) {
    for (let i = 1; i < r.daily.time.length && days.length < 4; i++) {
      days.push({ date: r.daily.time[i], max: Math.round(r.daily.temperature_2m_max[i]), min: Math.round(r.daily.temperature_2m_min[i]), code: r.daily.weather_code[i] });
    }
  }
  const w = {
    temp: Math.round(c.temperature_2m),
    feels: c.apparent_temperature != null ? Math.round(c.apparent_temperature) : null,
    code: c.weather_code,
    day: c.is_day === 1,
    wind: c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) : null,
    hum: c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : null,
    max: r.daily ? Math.round(r.daily.temperature_2m_max[0]) : null,
    min: r.daily ? Math.round(r.daily.temperature_2m_min[0]) : null,
    hours,
    days,
  };
  return w;
}

// yr.no's symbols in the weather codes the icons know (WMO)
function wmo(sym) {
  const s = String(sym || '').replace(/_(day|night|polartwilight)$/, '');
  if (s === 'clearsky') return 0;
  if (s === 'fair') return 1;
  if (s === 'partlycloudy') return 2;
  if (s === 'cloudy') return 3;
  if (s === 'fog') return 45;
  if (/thunder/.test(s)) return 95;
  if (/snowshowers/.test(s)) return 85;
  if (/snow/.test(s)) return /heavy/.test(s) ? 75 : /light/.test(s) ? 71 : 73;
  if (/sleet/.test(s)) return 67;
  if (/rainshowers/.test(s)) return 80;
  if (/rain/.test(s)) return /heavy/.test(s) ? 65 : /light/.test(s) ? 61 : 63;
  return 3;
}
const isDay = (sym) => !/_night$/.test(String(sym || ''));
const round = (v) => (v == null || isNaN(v) ? null : Math.round(v));

async function fromYr(p) {
  const r = await getJson(`https://www.yr.no/api/v0/locations/${p.lat.toFixed(3)},${p.lon.toFixed(3)}/forecast`, 12000);
  const sh = (r && r.shortIntervals) || [];
  const c = sh[0];
  if (!c) throw new Error('пустой прогноз');
  const sym = (x) => x && x.symbolCode && (x.symbolCode.next1Hour || x.symbolCode.next6Hours);
  const hours = [];
  for (let i = 2; i < sh.length && hours.length < 6; i += 2) {
    const t = sh[i];
    hours.push({ h: String(t.start || '').slice(11, 13), t: round(t.temperature && t.temperature.value), code: wmo(sym(t)), day: isDay(sym(t)) });
  }
  const di = (r && r.dayIntervals) || [];
  const days = [];
  for (let i = 1; i < di.length && days.length < 4; i++) {
    const d = di[i];
    days.push({ date: String(d.start || '').slice(0, 10), max: round(d.temperature && d.temperature.max), min: round(d.temperature && d.temperature.min), code: wmo(d.twentyFourHourSymbol) });
  }
  const today = di[0] && di[0].temperature;
  return {
    temp: round(c.temperature && c.temperature.value),
    feels: round(c.feelsLike && c.feelsLike.value),
    code: wmo(sym(c)),
    day: c.symbol && c.symbol.sunup != null ? !!c.symbol.sunup : isDay(sym(c)),
    wind: round(c.wind && c.wind.speed),
    hum: round(c.humidity && c.humidity.value),
    max: today ? round(today.max) : null,
    min: today ? round(today.min) : null,
    hours,
    days,
  };
}

const DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const deg = (v) => (v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°');

export function describe(w) {
  if (!w || !w.at || Date.now() - w.at > TOO_OLD) return null;
  const look = weatherLook(w.code, w.day);
  return {
    ...w,
    svg: look.svg,
    words: look.words,
    tempText: deg(w.temp),
    range: w.max != null ? `${deg(w.max)} / ${deg(w.min)}` : '',
    hours: (w.hours || []).map((x) => ({ ...x, svg: weatherLook(x.code, x.day).svg, text: deg(x.t) })),
    days: (w.days || []).map((x) => {
      const d = new Date(x.date + 'T12:00:00');
      return { ...x, name: isNaN(d) ? '' : DAY[d.getDay()], svg: weatherLook(x.code, true).svg, text: `${deg(x.max)} ${deg(x.min)}` };
    }),
  };
}

let current = null;
export const now = () => current;
export const status = () => state;

async function tick(force) {
  clearTimeout(timer);
  let w = null;
  try {
    w = await forecast(force);
    state = { status: 'ok', why: '' };
  } catch (e) {
    state = { status: 'fail', why: e && e.message ? e.message : String(e) };
    tv.log('погода: ' + state.why);
  }
  current = describe(w || cacheGet(KEY(), 0));
  listener(current);
  timer = setTimeout(tick, w ? 20 * 60e3 : 5 * 60e3);
}

export function start(fn) {
  if (fn) listener = fn;
  const old = cacheGet(KEY(), 0);
  current = describe(old);
  if (current) listener(current);
  tick();
}

// the place again (a town chosen or cleared in the settings)
export function refresh() {
  tick(true);
}

// towns by name, for the settings
export async function search(name) {
  const r = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=ru&format=json`);
  return ((r && r.results) || []).map((x) => ({
    name: x.name,
    where: [x.admin1, x.country].filter(Boolean).join(', '),
    lat: x.latitude,
    lon: x.longitude,
  }));
}

export function stop() {
  clearTimeout(timer);
}
