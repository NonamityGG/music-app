// Резонанс для ПК — a live wave along the bottom of the Start menu and the Quick
// settings, in the palette's colours. The same waves the island and the
// wallpaper use. Two modes (settings.shellWaves):
//   * music: the wave hears the PC's sound, like the wallpaper; while nothing
//     is heard it drifts on its own, so the menu never looks dead;
//   * simple: no audio at all, waves.js drifts on its own (simulate).
// The PC's sound is listened to only from the first time a menu opens in the
// music mode, so a menu that is never opened costs nothing.

import * as waves from '../../src/waves.js';
import * as graph from './graph.js';
import * as listen from './listen.js';

let on = false;
let mode = 'music';
let listening = false;
let place = { y: 0.985, amp: 0.26 };
let cv = null;
let keep = 0;

// the sound is used only while it is really there; silence falls back to the drift
const hearing = () => mode === 'music' && listen.heard() && graph.silentMs() < 1500;
const probeBands = new Float32Array(graph.BANDS);
const probeWave = new Float32Array(graph.WAVE);

export function init(canvas, opts = {}) {
  cv = canvas;
  if (opts.y != null) place.y = opts.y;
  if (opts.amp != null) place.amp = opts.amp;
  if (opts.name) place.name = opts.name;
  waves.addSurface('shell', canvas, {
    dpr: Math.min(2, window.devicePixelRatio || 1),
    center: () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      return { x: w / 2, y: h * place.y, amp: Math.min(w, h) * place.amp, r: 0 };
    },
  });
  waves.setSource({ playing: () => on, analysing: hearing, onSilence: () => {} });
  waves.setActive('shell');
}

export function look(palette, style = 'neon') {
  waves.configure({ style: style || 'neon', palette: palette || 'violet', light: false, maxFps: 60 });
  waves.kick();
}

// 'music' | 'simple'
export function setMode(m) {
  mode = m === 'simple' ? 'simple' : 'music';
  if (on) startListening();
  waves.kick();
}

function startListening() {
  if (listening || mode !== 'music') return;
  listening = true;
  // no "music plays but nothing is heard" watchdog here: the menus don't know
  // what's playing; the wallpaper and the bar already keep an eye on that
  listen.start({ name: place.name || 'меню', playing: () => false });
}

export function show(v) {
  on = !!v;
  clearInterval(keep);
  if (!on) return;
  startListening();
  // The window was hidden when the page loaded, and an on-screen but just-shown
  // window can briefly still report itself hidden — then waves.js won't start its
  // loop. Keep nudging it (re-measure the canvas, start the loop) for as long as
  // the menu is open: the moment the page is really visible, the wave runs.
  const pump = () => {
    if (!on) return;
    // drifting in a silence: peek at the sound now and then, so the wave
    // switches back to the music the moment it plays again
    if (mode === 'music' && listen.heard() && !hearing()) graph.read(probeBands, probeWave);
    waves.resize('shell');
    waves.kick();
  };
  pump();
  requestAnimationFrame(pump);
  setTimeout(pump, 80);
  keep = setInterval(pump, 500);
}
