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
  if (Capacitor.isNativePlatform()) {
    SystemBars.setStyle({ style: t.light ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
  }
  configureWaves({ light: !!t.light });
  // glass themes give the background waves a different area
  requestAnimationFrame(() => resizeWaves('bg'));
  window.dispatchEvent(new Event('rez-theme'));
}

export function applyTheme() {
  setAttrs(currentTheme());
}

// Switches behind a quick veil in the new background colour: the veil fades in,
// the colours change while the screen is covered (that repaint is the heavy
// part), and the veil fades out. Only opacity animates, so it stays smooth.
let switching = false;
export function setTheme(id) {
  const t = themeById(id);
  saveSettings({ theme: t.id });
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || switching) {
    setAttrs(t);
    return;
  }
  switching = true;
  const veil = document.createElement('div');
  veil.className = 'theme-veil';
  veil.style.background = t.bg; // the screen washes into the new theme's colour
  document.body.appendChild(veil);
  requestAnimationFrame(() => {
    veil.classList.add('in');
    setTimeout(() => {
      setAttrs(t);
      // give the new colours two frames to paint under the veil
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          veil.classList.remove('in');
          setTimeout(() => {
            veil.remove();
            switching = false;
          }, 320);
        })
      );
    }, 170);
  });
}
