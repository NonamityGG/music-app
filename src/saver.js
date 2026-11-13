// The screensaver: the waves over the whole screen, listening to the music, a big
// clock with the date above them and the song below. The screen stays on while
// it is up. A tap or the Back button closes it. The clock drifts a little every
// minute so nothing stands still in one place on an OLED screen.

import { h } from './util.js';
import * as waves from './waves.js';
import * as player from './player.js';
import { keepAwake } from './screen.js';

const canvas = h('canvas', { class: 'saver-waves', 'aria-hidden': 'true' });
const time = h('div', { class: 'saver-time' });
const date = h('div', { class: 'saver-date' });
const clock = h('div', { class: 'saver-clock' }, time, date);
const song = h('div', { class: 'saver-song' });
const el = h('div', { class: 'saver', hidden: true, role: 'dialog', 'aria-label': 'Заставка' }, canvas, clock, song);

let added = false;
let before = 'bg';
let tick = 0;

function paintClock() {
  const d = new Date();
  time.textContent = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  date.textContent = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  // drift within a small box, a new place every minute
  const m = d.getHours() * 60 + d.getMinutes();
  clock.style.transform = `translate(${Math.round(Math.sin(m * 1.7) * 18)}px, ${Math.round(Math.cos(m * 1.3) * 14)}px)`;
  clearTimeout(tick);
  tick = setTimeout(paintClock, 60500 - d.getSeconds() * 1000 - d.getMilliseconds());
}

function paintSong() {
  const t = player.current();
  song.textContent = t ? [t.title, t.artist].filter(Boolean).join(' — ') : '';
}

player.onPlayer((type) => {
  if (el.hidden) return;
  if (type === 'track' || type === 'state') paintSong();
});

export const saverOpen = () => !el.hidden;

export function openSaver(activeSurface = 'bg') {
  if (!added) {
    document.body.appendChild(el);
    waves.addSurface('saver', canvas, {
      dpr: 1,
      center: () => {
        const w = window.innerWidth;
        const hgt = window.innerHeight;
        return { x: w / 2, y: hgt * 0.62, r: 0, amp: Math.min(w, hgt) * 0.4 };
      },
    });
    el.addEventListener('click', () => closeSaver());
    added = true;
  }
  before = activeSurface;
  el.hidden = false;
  paintClock();
  paintSong();
  keepAwake(true);
  requestAnimationFrame(() => {
    el.classList.add('open');
    waves.setActive('saver');
    waves.resize('saver');
    waves.kick();
  });
}

export function closeSaver() {
  if (el.hidden) return false;
  el.classList.remove('open');
  clearTimeout(tick);
  keepAwake(false);
  waves.setActive(before);
  setTimeout(() => (el.hidden = true), 320);
  return true;
}
