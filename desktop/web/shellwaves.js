// Резонанс для ПК — a gentle live wave along the bottom of the Start menu and
// the Quick settings, in the palette's colours. It needs no audio: waves.js
// drifts on its own (simulate) while a menu is open, so the menus open at once
// and still feel like Резонанс. The same waves the island and the wallpaper use.

import * as waves from '../../src/waves.js';

let on = false;
let place = { y: 0.985, amp: 0.26 };

export function init(canvas, opts = {}) {
  if (opts.y != null) place.y = opts.y;
  if (opts.amp != null) place.amp = opts.amp;
  waves.addSurface('shell', canvas, {
    dpr: Math.min(2, window.devicePixelRatio || 1),
    center: () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      return { x: w / 2, y: h * place.y, amp: Math.min(w, h) * place.amp, r: 0 };
    },
  });
  waves.setSource({ playing: () => on, analysing: () => false, onSilence: () => {} });
  waves.setActive('shell');
}

export function look(palette, style = 'neon') {
  waves.configure({ style: style || 'neon', palette: palette || 'violet', light: false, maxFps: 60 });
  waves.kick();
}

export function show(v) {
  on = !!v;
  if (on) {
    waves.burst(2000);
    waves.kick();
  }
}
