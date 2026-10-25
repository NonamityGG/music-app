// Themes. Colours live in style.css as tokens under [data-theme=…]; this module
// switches the attribute (with a soft cross-fade), keeps the status bar icons
// readable and tells the waves whether they are drawn on a light background.

import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { settings, saveSettings } from './settings.js';
import { configure as configureWaves, resize as resizeWaves } from './waves.js';

export const THEMES = [
  { id: 'dark', name: 'Тёмная', sub: 'фирменная', bg: '#140f1f' },
  { id: 'amoled', name: 'Чёрная', sub: 'для AMOLED', bg: '#000000' },
  { id: 'light', name: 'Светлая', sub: 'дневная', bg: '#f5f3fa', light: true },
  { id: 'glass-violet', name: 'Liquid Glass', sub: 'фиолетовая', bg: '#120a24', glass: true },
  { id: 'glass-black', name: 'Liquid Glass', sub: 'чёрная', bg: '#000000', glass: true },
  { id: 'glass-light', name: 'Liquid Glass', sub: 'светлая', bg: '#eef0fb', glass: true, light: true },
];

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
export const currentTheme = () => themeById(settings.theme);

function setAttrs(t) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t.id);
  root.toggleAttribute('data-glass', !!t.glass);
  root.toggleAttribute('data-light', !!t.light);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t.bg);
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', t.light ? 'light' : 'dark');
  bars(t);
  configureWaves({ light: !!t.light });
  // glass themes give the background waves a different area
  requestAnimationFrame(() => resizeWaves('bg'));
  window.dispatchEvent(new Event('rez-theme'));
}

// Status bar icons: dark on light themes — except while the (always dark)
// launch intro is on screen.
function bars(t, introGone = false) {
  if (!Capacitor.isNativePlatform()) return;
  const intro = !introGone && window.rezIntro && window.rezIntro.active;
  SystemBars.setStyle({ style: t.light && !intro ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
}
export const syncBars = (introGone) => bars(currentTheme(), introGone);

export function applyTheme() {
  setAttrs(currentTheme());
}

// Switches with a circle of the new theme spreading from where you tapped. The
// browser snapshots the screen as it is, the colours change underneath while
// that picture stays put (the heavy repaint happens out of sight), then the new
// look is revealed through a growing circle — no flash, no veil.
// Without view transitions (old WebView) it simply switches.
let switching = false;
export function setTheme(id, from, after) {
  const t = themeById(id);
  saveSettings({ theme: t.id });
  const apply = () => {
    setAttrs(t);
    if (after) after();
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || switching || !document.startViewTransition) return apply();
  switching = true;
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  const x = from && from.x != null ? from.x : w / 2;
  const y = from && from.y != null ? from.y : hgt / 2;
  const r = Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, hgt - y)));
  const root = document.documentElement;
  root.classList.add('vt-theme');
  let vt;
  try {
    vt = document.startViewTransition(apply);
  } catch {
    root.classList.remove('vt-theme');
    switching = false;
    return apply();
  }
  vt.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 560, easing: 'cubic-bezier(.45,0,.2,1)', pseudoElement: '::view-transition-new(root)' }
      );
    })
    .catch(() => {});
  vt.finished
    .catch(() => {})
    .then(() => {
      root.classList.remove('vt-theme');
      switching = false;
    });
}
