// Резонанс OS: the weather where the TV is. The place comes from the internet
// address (no GPS on a TV), the forecast from Open-Meteo (no key needed).

import { cacheGet, cacheSet } from './store.js';
import { weatherLook } from './icons.js';

let timer = 0;
let listener = () => {};

async function getJson(url, ms = 8000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function place() {
  const hit = cacheGet('place', 24 * 3600e3);
  if (hit) return hit;
  let p = null;
  try {
    const g = await getJson('https://get.geojs.io/v1/ip/geo.json');
    if (g && g.latitude) p = { lat: Number(g.latitude), lon: Number(g.longitude), city: g.city || '' };
  } catch {}
  if (!p) {
    try {
      const g = await getJson('https://ipwho.is/?lang=ru');
      if (g && g.success !== false && g.latitude) p = { lat: g.latitude, lon: g.longitude, city: g.city || '' };
    } catch {}
  }
  if (!p) return null;
  // the town's name in Russian
  try {
    const r = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lon}&zoom=10&accept-language=ru`);
    const a = (r && r.address) || {};
    p.city = a.city || a.town || a.village || a.municipality || a.county || p.city;
  } catch {}
  cacheSet('place', p);
  return p;
}

async function forecast() {
  const hit = cacheGet('weather', 20 * 60e3);
  if (hit) return hit;
  const p = await place();
  if (!p) return null;
  const r = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`);
  const c = r && r.current;
  if (!c) return null;
  const w = {
    temp: Math.round(c.temperature_2m),
    code: c.weather_code,
    day: c.is_day === 1,
    max: r.daily ? Math.round(r.daily.temperature_2m_max[0]) : null,
    min: r.daily ? Math.round(r.daily.temperature_2m_min[0]) : null,
    city: p.city,
  };
  cacheSet('weather', w);
  return w;
}

export function describe(w) {
  if (!w) return null;
  const look = weatherLook(w.code, w.day);
  const t = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°';
  return { ...w, svg: look.svg, words: look.words, tempText: t(w.temp), range: w.max != null ? `${t(w.max)} / ${t(w.min)}` : '' };
}

async function tick() {
  clearTimeout(timer);
  let w = null;
  try {
    w = await forecast();
  } catch {}
  listener(describe(w || cacheGet('weather', 0)));
  timer = setTimeout(tick, w ? 20 * 60e3 : 3 * 60e3);
}

export function start(fn) {
  listener = fn;
  const old = cacheGet('weather', 0);
  if (old) fn(describe(old));
  tick();
}

export function stop() {
  clearTimeout(timer);
}
