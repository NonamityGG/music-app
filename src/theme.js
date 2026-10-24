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
}

export function applyTheme() {
  setAttrs(currentTheme());
}

// Switches with a cross-fade of the whole screen where the WebView can do it.
export function setTheme(id) {
  const t = themeById(id);
  saveSettings({ theme: t.id });
  const go = () => setAttrs(t);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduced) {
    document.startViewTransition(go);
  } else {
    document.documentElement.classList.add('theme-fade');
    go();
    setTimeout(() => document.documentElement.classList.remove('theme-fade'), 450);
  }
}
