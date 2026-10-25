// Резонанс для ПК: the colours Windows gets from the chosen palette, and the
// palettes themselves (the same as the wallpaper's, for the main process).

'use strict';

const PALETTES = {
  violet: ['#7c4dff', '#c3a6ff', '#ff6fd8'],
  neon: ['#00d1ff', '#4d6bff', '#b44dff'],
  sunset: ['#ff3d7f', '#ff8a3d', '#ffd36b'],
  mint: ['#2ee6c1', '#3fa9ff', '#a8ff9e'],
  ice: ['#3d7bff', '#7fd3ff', '#e8f7ff'],
  aurora: ['#00e5a0', '#00b3ff', '#8a5cff'],
  fire: ['#ff2e4d', '#ff7a1a', '#ffd23f'],
  sakura: ['#ff6fa5', '#ffb8d0', '#c9a7ff'],
  gold: ['#b8742b', '#f5c96a', '#fff3cf'],
  mono: ['#7d8590', '#d4d9e0', '#ffffff'],
};

function rgb(hex) {
  const h = String(hex || '').replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
}

function hex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function mix(a, b, k) {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * k));
}

// the accent: the palette's main colour, kept vivid but not glaring
function accentOf(paletteId) {
  const p = PALETTES[paletteId] || PALETTES.violet;
  return p[0];
}

// Windows' eight accent shades, light to dark (index 3 is the accent)
function shades(accent) {
  return [
    mix(accent, '#ffffff', 0.6),
    mix(accent, '#ffffff', 0.4),
    mix(accent, '#ffffff', 0.2),
    accent,
    mix(accent, '#000000', 0.2),
    mix(accent, '#000000', 0.4),
    mix(accent, '#000000', 0.6),
    '#888888',
  ];
}

// what Windows is told for one palette
function forPalette(paletteId) {
  const accent = accentOf(paletteId);
  const s = shades(accent);
  return {
    accent,
    palette: s,
    // selected text in classic apps is white on this: a darker shade reads better
    highlight: s[4],
    hot: s[3],
  };
}

module.exports = { PALETTES, forPalette, mix };
