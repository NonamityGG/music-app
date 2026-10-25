// Full screen and the app's own status line. In full screen Android hides its
// bars (they come back for a moment with a swipe from the edge), so the time,
// the network and the battery are drawn by the app at the top instead.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { settings, saveSettings } from './settings.js';

const Screen = registerPlugin('Screen');
const native = Capacitor.isNativePlatform();
const SVG = 'http://www.w3.org/2000/svg';

let line = null;
let clockTimer = 0;
const status = { battery: -1, charging: false, net: 'none', level: -1 };

// for checking the layout in a browser: localStorage['rez.forceFullscreen'] = '1'
const forced = () => {
  try {
    return localStorage.getItem('rez.forceFullscreen') === '1';
  } catch {
    return false;
  }
};

export const fullscreenOn = () => settings.fullscreen !== false && (native || forced());

export function initScreen() {
  document.documentElement.toggleAttribute('data-fullscreen', fullscreenOn());
  build();
  if (native) {
    // Android remembers the choice itself (so it applies from the first frame);
    // only correct it when the two disagree
    Screen.getFullscreen()
      .then((r) => {
        if (!!r.enabled !== (settings.fullscreen !== false)) Screen.setFullscreen({ enabled: settings.fullscreen !== false });
      })
      .catch(() => {});
    Screen.addListener('status', (s) => paint(s)).catch(() => {});
    Screen.watchStatus().then(paint).catch(() => {});
  } else {
    browserStatus();
  }
}

export function setFullscreen(on) {
  saveSettings({ fullscreen: on });
  document.documentElement.toggleAttribute('data-fullscreen', fullscreenOn());
  if (native) Screen.setFullscreen({ enabled: on }).catch(() => {});
  tickClock();
}

// ---------- the line ----------

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function build() {
  if (line) return;
  const time = document.createElement('span');
  time.className = 'sl-time';
  const right = document.createElement('span');
  right.className = 'sl-right';
  const netSvg = el('svg', { class: 'sl-net', viewBox: '0 0 18 14', width: 18, height: 14, 'aria-hidden': 'true' });
  const pct = document.createElement('span');
  pct.className = 'sl-pct';
  const bat = el('svg', { class: 'sl-bat', viewBox: '0 0 26 13', width: 26, height: 13, 'aria-hidden': 'true' });
  el('rect', { x: 0.75, y: 0.75, width: 21.5, height: 11.5, rx: 3.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, opacity: 0.55 }, bat);
  el('rect', { x: 23.2, y: 4, width: 2, height: 5, rx: 1, fill: 'currentColor', opacity: 0.55 }, bat);
  const fill = el('rect', { class: 'sl-fill', x: 2.5, y: 2.5, width: 18, height: 8, rx: 1.8, fill: 'currentColor' }, bat);
  const bolt = el('path', { class: 'sl-bolt', d: 'M12.6 1.6 7.4 7.1h3.4l-1.4 4.3 5.2-5.5h-3.4z' }, bat);
  right.append(netSvg, pct, bat);
  line = document.createElement('div');
  line.className = 'statusline';
  line.setAttribute('aria-hidden', 'true');
  line.append(time, right);
  line._time = time;
  line._net = netSvg;
  line._pct = pct;
  line._fill = fill;
  line._bolt = bolt;
  document.body.appendChild(line);
  tickClock();
  paint({});
}

function tickClock() {
  clearTimeout(clockTimer);
  if (!line) return;
  const d = new Date();
  line._time.textContent = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  // next update right when the minute changes
  clockTimer = setTimeout(tickClock, 60500 - d.getSeconds() * 1000 - d.getMilliseconds());
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tickClock();
});

function paint(s) {
  Object.assign(status, s || {});
  if (!line) return;
  // battery
  const b = status.battery;
  line._pct.textContent = b >= 0 ? `${b}%` : '';
  line._fill.setAttribute('width', String(b >= 0 ? Math.max(1.5, (18 * b) / 100) : 18));
  line.classList.toggle('sl-low', b >= 0 && b <= 15 && !status.charging);
  line.classList.toggle('sl-charging', !!status.charging);
  line.querySelector('.sl-bat').style.visibility = b >= 0 || !native ? '' : 'hidden';
  // network
  const svg = line._net;
  while (svg.firstChild) svg.firstChild.remove();
  if (status.net === 'wifi') {
    const lv = status.level < 0 ? 3 : status.level;
    // three arcs and a dot, the ones above the level dimmed
    const arcs = ['M1.2 5.2a11.2 11.2 0 0 1 15.6 0', 'M3.9 7.9a7.4 7.4 0 0 1 10.2 0', 'M6.6 10.6a3.6 3.6 0 0 1 4.8 0'];
    arcs.forEach((d, i) => el('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', opacity: 3 - i <= lv ? 1 : 0.3 }, svg));
    el('circle', { cx: 9, cy: 12.6, r: 1.25, fill: 'currentColor' }, svg);
  } else if (status.net === 'cell' || status.net === 'eth' || status.net === 'other') {
    const lv = status.level < 0 ? 4 : status.level;
    for (let i = 0; i < 4; i++) {
      const hgt = 4 + i * 3;
      el('rect', { x: 1 + i * 4.3, y: 13 - hgt, width: 3, height: hgt, rx: 0.9, fill: 'currentColor', opacity: i < lv ? 1 : 0.3 }, svg);
    }
  } else {
    // no network: dimmed bars with a cross
    for (let i = 0; i < 4; i++) {
      const hgt = 4 + i * 3;
      el('rect', { x: 1 + i * 4.3, y: 13 - hgt, width: 3, height: hgt, rx: 0.9, fill: 'currentColor', opacity: 0.25 }, svg);
    }
    el('path', { d: 'M2 2l6 6M8 2l-6 6', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }, svg);
  }
}

// In a browser (only for checking the layout): what the web platform can tell.
function browserStatus() {
  const net = () => paint({ net: navigator.onLine ? 'wifi' : 'none', level: 3 });
  net();
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  if (navigator.getBattery) {
    navigator
      .getBattery()
      .then((bt) => {
        const upd = () => paint({ battery: Math.round(bt.level * 100), charging: bt.charging });
        upd();
        bt.addEventListener('levelchange', upd);
        bt.addEventListener('chargingchange', upd);
      })
      .catch(() => {});
  }
}
