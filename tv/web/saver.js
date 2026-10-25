// Резонанс OS: the screen saver, made like the PC's live wallpaper. Big soft
// words behind the waves — the clock, or the line of the song being sung (its
// title when the words aren't known) — and around them, quietly: the weather
// with what comes next, and what's playing with its cover. Everything stays in
// the middle; the whole picture moves by a few pixels a minute so nothing burns
// into the screen.

import { tv } from './tv.js';
import { S } from './store.js';
import * as layers from './layers.js';
import * as look from './look.js';
import * as lyrics from './lyrics.js';
import * as weather from './weather.js';
import { dateText, media as npMedia, position } from './home.js';

const $ = (id) => document.getElementById(id);
const ambEl = $('ambient');
const words = $('words');
const body = document.body;
const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
const two = (n) => String(n).padStart(2, '0');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let parts = null;
let lyr = null; // { key, synced, lines } for the song playing
let lyrKey = '';
let fast = 0;
let slow = 0;
let coverKey = -1;

const mode = () => S.saverLook || 'auto';

// ---------- the words behind the waves ----------

let curKey = '';
let cur = null;

function show(key, main, sub, cls) {
  if (key === curKey) return;
  curKey = key;
  const old = cur;
  cur = null;
  const soft = !look.eco();
  if (old) {
    if (old.animate) {
      const a = old.animate(
        [
          { opacity: 1, transform: 'none', filter: 'blur(0px)' },
          { opacity: 0, transform: 'translateY(-0.4em) scale(0.97)', filter: soft ? 'blur(14px)' : 'blur(0px)' },
        ],
        { duration: 600, easing: EASE, fill: 'forwards' }
      );
      a.onfinish = () => old.remove();
    } else old.remove();
  }
  if (!main) return;
  const wrap = el('div', 'wrap');
  const w = el('div', 'w ' + (cls || ''), main);
  if (sub) w.appendChild(el('small', '', sub));
  wrap.appendChild(w);
  words.appendChild(wrap);
  if (wrap.animate) {
    wrap.animate(
      [
        { opacity: 0, transform: 'translateY(0.5em) scale(1.03)', filter: soft ? 'blur(16px)' : 'blur(0px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0px)' },
      ],
      { duration: 850, delay: old ? 120 : 0, easing: EASE, fill: 'backwards' }
    );
  }
  cur = wrap;
  while (words.children.length > 3) words.firstElementChild.remove();
}

function clockWords() {
  const d = new Date();
  const t = `${two(d.getHours())}:${two(d.getMinutes())}`;
  show('k|' + t + d.getDate(), t, dateText(d), 'clock');
}

function trackWords(m) {
  show('t|' + m.title + '|' + m.artist, m.title || m.artist || '', m.title && m.artist ? m.artist : '', 'track');
}

const playing = (m) => m.active && m.playing;

// what the middle says right now
function centre() {
  const m = npMedia();
  const md = mode();
  const music = playing(m) && md === 'auto';
  body.classList.toggle('sv-music', music);
  if (md === 'waves') return show('', '');
  if (!music) return clockWords();
  const key = lyrics.keyOf(m);
  if (key !== lyrKey) {
    lyrKey = key;
    lyr = null;
    lyrics.find(m).then((r) => {
      if (lyrKey === key) {
        lyr = r;
        centre();
      }
    });
  }
  if (!lyr || !lyr.synced || !lyr.lines.length) return trackWords(m);
  // a quarter second early: the eye is slower than the ear
  const sec = (position() + 250) / 1000;
  const i = lyrics.lineAt(lyr.lines, sec);
  if (i < 0) return trackWords(m);
  const line = lyr.lines[i].text;
  if (!line) return show('g|' + key + '|' + i, ''); // an instrumental bit
  show('l|' + key + '|' + i, line, '', 'lyric');
}

// ---------- around the words ----------

function build() {
  ambEl.textContent = '';
  const sv = el('div', 'sv');
  const clock = el('div', 'sv-clock');
  const wx = el('div', 'sv-wx');
  const np = el('div', 'sv-np');
  sv.append(clock, wx, np);
  ambEl.appendChild(sv);
  // the only focusable thing: any key closes the saver anyway
  const f = el('i', 'f');
  f.style.position = 'absolute';
  ambEl.appendChild(f);
  parts = { sv, clock, wx, np, f };
}

function paintClock() {
  const d = new Date();
  const c = parts.clock;
  c.textContent = '';
  c.append(el('b', '', `${two(d.getHours())}:${two(d.getMinutes())}`), el('span', '', dateText(d)));
}

function paintWeather() {
  const w = weather.now();
  const box = parts.wx;
  box.textContent = '';
  box.classList.toggle('hidden', !w || S.saverWx === false || S.weather === false || mode() === 'waves');
  if (!w) return;
  const head = el('div', 'wx-head');
  const pic = el('div', 'wx-pic wx-anim');
  pic.innerHTML = w.svg;
  const tt = el('div', 'wx-t', w.tempText);
  head.append(pic, tt);
  const words1 = el('div', 'wx-words', w.words + (w.feels != null && w.feels !== w.temp ? ` · ощущается ${weather.deg(w.feels)}` : ''));
  const words2 = el('div', 'wx-city', [w.city, w.range ? 'днём ' + w.range : ''].filter(Boolean).join(' · '));
  box.append(head, words1, words2);
  if (w.hours && w.hours.length) {
    const strip = el('div', 'wx-hours');
    for (const h of w.hours.slice(0, 5)) {
      const it = el('div', 'wx-h');
      const ic = el('i');
      ic.innerHTML = h.svg;
      it.append(el('span', '', h.h), ic, el('b', '', h.text));
      strip.appendChild(it);
    }
    box.appendChild(strip);
  }
}

function paintNp() {
  const m = npMedia();
  const box = parts.np;
  const on = m.active && S.np !== false && mode() !== 'waves';
  box.classList.toggle('hidden', !on);
  if (!on) {
    box.textContent = '';
    box._key = '';
    coverColorsFor(null);
    return;
  }
  const key = [m.title, m.artist, m.art, m.appLabel].join('|');
  if (box._key !== key) {
    box._key = key;
    box.textContent = '';
    const cover = el('div', 'sv-cover');
    if (m.art) cover.style.backgroundImage = `url("${tv.artUrl(m.art)}")`;
    else cover.classList.add('empty');
    const meta = el('div', 'sv-meta');
    meta.append(el('div', 'sv-app', m.appLabel || 'Сейчас играет'), el('div', 'sv-title', m.title || 'Без названия'), el('div', 'sv-artist', m.artist || ''));
    const bar = el('div', 'sv-bar');
    const fill = el('i');
    bar.appendChild(fill);
    meta.appendChild(bar);
    box.append(cover, meta);
    box._fill = fill;
    coverColorsFor(m.art ? tv.artUrl(m.art) : null, m.art);
  }
  box.classList.toggle('paused', !m.playing);
  paintBar();
}

function paintBar() {
  const m = npMedia();
  const f = parts && parts.np._fill;
  if (!f || !m.active) return;
  f.style.transform = `scaleX(${m.dur > 0 ? Math.min(1, position() / m.dur).toFixed(4) : 0})`;
}

// the waves and the words take the colours of the cover
function coverColorsFor(url, key) {
  if (key === coverKey) return;
  coverKey = key == null ? -1 : key;
  if (!url || S.saverCover === false) {
    look.saverColors(null);
    body.style.removeProperty('--w1');
    body.style.removeProperty('--w2');
    body.style.removeProperty('--w3');
    return;
  }
  look.coverColors(url).then((c) => {
    if (!c || coverKey !== key || !layers.isOpen(saver)) return;
    look.saverColors(c);
    body.style.setProperty('--w1', c[0]);
    body.style.setProperty('--w2', c[1]);
    body.style.setProperty('--w3', c[2]);
  });
}

function place() {
  const md = mode();
  if (md === 'orb') look.setWavePlace({ y: 0.5, amp: 0.3 });
  else if (md === 'waves') look.setWavePlace({ y: 0.5, amp: 0.34 });
  else look.setWavePlace({ y: 0.5, amp: 0.27 });
}

// a few pixels each minute: nothing stays on the same spot for hours
function drift() {
  const dx = Math.round(Math.random() * 12 - 6);
  const dy = Math.round(Math.random() * 12 - 6);
  const t = `translate3d(${dx}px,${dy}px,0)`;
  parts.sv.style.transform = t;
  words.style.transform = t;
}

function paintAll() {
  if (!parts) return;
  paintClock();
  paintWeather();
  paintNp();
  centre();
}

// ---------- the layer ----------

let savedStyle = null;

export const saver = {
  el: ambEl,
  dim: false,
  open() {
    build();
    curKey = '';
    coverKey = -2;
    words.textContent = '';
    cur = null;
    body.classList.add('saver');
    body.classList.remove('ts-soft', 'ts-outline', 'ts-glass');
    body.classList.add('ts-' + (S.saverText || 'soft'));
    body.classList.toggle('sv-waves', mode() === 'waves');
    if (mode() === 'orb') {
      savedStyle = S.style;
      S.style = 'orb';
      look.apply();
    }
    place();
    look.setWaveState({ saver: true });
    layers.push(saver, parts.f);
    paintAll();
    drift();
    clearInterval(fast);
    clearInterval(slow);
    // the words follow the song closely; the rest once in a while
    fast = setInterval(() => {
      const m = npMedia();
      if (!playing(m)) return;
      paintBar();
      if (lyr && lyr.synced) centre();
    }, 150);
    slow = setInterval(() => {
      paintAll();
      if (new Date().getSeconds() < 5) drift();
    }, 5000);
  },
  // the TV said something changed (a track, play/pause)
  tick() {
    if (!layers.isOpen(saver)) return;
    paintNp();
    centre();
  },
  weather() {
    if (layers.isOpen(saver)) paintWeather();
  },
  onClose() {
    clearInterval(fast);
    clearInterval(slow);
    body.classList.remove('saver', 'sv-music', 'sv-waves');
    words.textContent = '';
    curKey = '';
    cur = null;
    coverKey = -1;
    look.saverColors(null);
    body.style.removeProperty('--w1');
    body.style.removeProperty('--w2');
    body.style.removeProperty('--w3');
    if (savedStyle) {
      S.style = savedStyle;
      savedStyle = null;
      look.apply();
    }
    look.setWaveState({ saver: false });
    if (saver.onClosed) saver.onClosed();
  },
  any() {
    layers.pop(saver);
  },
};
