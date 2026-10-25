// The PC's sound for a page (wallpaper, bar, island): listens through the system
// loopback and starts listening again when it goes deaf. Windows' loopback
// follows the output device chosen when it started, so after switching to
// headphones (or another output in the volume flyout) the old stream only hears
// silence. Three signals bring it back:
//   * the helper says the output changed (main process -> 'audio' message);
//   * the browser sees devices come and go ('devicechange');
//   * a watchdog: music is playing (Windows' media controls say so), but the
//     stream has been completely silent for a while.

import * as graph from './graph.js';
import { loopback } from './loopback.js';

let stream = null;
let busy = false;
let again = false;
let hearing = false;
let lastTry = 0;
let backoff = 8000;
let name = 'окно';
let onChange = () => {};
let isPlaying = () => false;
let isResting = () => false;

export const heard = () => hearing;

export function start(opts) {
  name = opts.name || name;
  onChange = opts.onChange || onChange;
  isPlaying = opts.playing || isPlaying;
  isResting = opts.resting || isResting;
  listen('');
  window.rez.onAudio && window.rez.onAudio((e) => relisten('сменилось устройство вывода (' + (e && e.event) + ')', 700));
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => relisten('устройства изменились', 900));
  setInterval(watchdog, 2000);
}

let timer = 0;
export function relisten(why, delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => listen(why), delay);
}

async function listen(why) {
  if (busy) {
    again = why || 'повтор';
    return;
  }
  busy = true;
  lastTry = performance.now();
  try {
    const s = await loopback();
    const old = stream;
    graph.detachAll();
    hearing = graph.attachStream(s);
    stream = s;
    if (old) for (const t of old.getTracks()) t.stop();
    for (const t of s.getAudioTracks()) t.addEventListener('ended', () => relisten('дорожка закончилась', 500));
    window.rez.log(`${name}: ${hearing ? (why ? 'заново слышу звук' : 'слышу звук компьютера') : 'не подключилось к звуку'}${why ? ' — ' + why : ''}`);
    onChange(hearing);
  } catch (e) {
    window.rez.log(`${name}: звук недоступен: ${e && e.message}`);
  }
  busy = false;
  if (again) {
    const w = again;
    again = false;
    relisten(w, 300);
  }
}

function watchdog() {
  if (!hearing || busy || isResting() || !isPlaying()) {
    if (!isPlaying()) backoff = 8000;
    return;
  }
  const silent = graph.silentMs();
  if (silent > 4500 && performance.now() - lastTry > backoff) {
    backoff = Math.min(60000, backoff * 1.6);
    listen('музыка играет, а звука не слышно');
  } else if (silent === 0) backoff = 8000;
}
