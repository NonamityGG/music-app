// Резонанс для ПК — a gentle live wave along the bottom of the Start menu and
// the Quick settings, in the palette's colours. It needs no audio: waves.js
// drifts on its own (simulate) while a menu is open, so the menus open at once
// and still feel like Резонанс. The same waves the island and the wallpaper use.

import * as waves from '../../src/waves.js';

let on = false;
let place = { y: 0.985, amp: 0.26 };
let cv = null;
let keep = 0;

export function init(canvas, opts = {}) {
  cv = canvas;
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
  clearInterval(keep);
  if (!on) return;
  // The window was hidden when the page loaded, and an on-screen but just-shown
  // window can briefly still report itself hidden — then waves.js won't start its
  // loop. Keep nudging it (re-measure the canvas, start the loop) for as long as
  // the menu is open: the moment the page is really visible, the wave runs.
  const pump = () => {
    if (!on) return;
    waves.resize('shell');
    waves.burst(1600);
    waves.kick();
  };
  pump();
  requestAnimationFrame(pump);
  setTimeout(pump, 80);
  keep = setInterval(pump, 500);
  diag();
}

function diag() {
  try {
    const r = cv.getBoundingClientRect();
    window.rez.log(`волна: open=${on} hidden=${document.hidden} vis=${document.visibilityState} canvas=${Math.round(r.width)}x${Math.round(r.height)} buf=${cv.width}x${cv.height}`);
    setTimeout(() => {
      const b = cv.getBoundingClientRect();
      window.rez.log(`волна (через 0.6с): hidden=${document.hidden} canvas=${Math.round(b.width)}x${Math.round(b.height)} buf=${cv.width}x${cv.height}`);
    }, 600);
  } catch {}
}
