// Резонанс для ПК — the live wallpaper. The phone app's waves (src/waves.js) fed
// with the sound of the whole PC; they rest while a window covers the screen.

import * as waves from '../../src/waves.js';
import * as graph from './graph.js';
import { loopback } from './loopback.js';

const canvas = document.getElementById('waves');
let resting = false;
let hearing = false;

waves.setSource({
  playing: () => !resting,
  analysing: () => hearing,
  onSilence: () => {},
});
waves.addSurface('bg', canvas, { dpr: 1, place: 'center', ampScale: 0.27 });

function apply(s) {
  if (!s) return;
  document.body.dataset.bg = s.bg || 'glass-violet';
  waves.configure({ style: s.style || 'neon', palette: s.palette || 'violet', light: false });
  waves.kick();
}

window.rez.settings().then(apply);
window.rez.onSettings(apply);
window.rez.onPause((p) => {
  resting = !!p;
  document.body.classList.toggle('resting', resting);
  waves.kick();
});

loopback()
  .then((stream) => {
    hearing = graph.attachStream(stream);
    window.rez.log(hearing ? 'обои слышат звук компьютера' : 'обои не подключились к звуку');
    waves.kick();
  })
  .catch((e) => window.rez.log('звук компьютера недоступен: ' + (e && e.message)));

waves.kick();
