// The words of the playing song in the full player, Apple Music style: big
// lines, the current one lit, the list gliding so it stays in view. Tap a line to
// jump there. Scroll by hand and it lets you read; a few seconds later it follows
// the song again. Lyrics without timings are simply shown as text.

import { h, clear } from './util.js';
import { lyricsFor } from './lyrics.js';
import { load, save } from './settings.js';

// A per-song correction for words that run ahead or behind (another recording's
// timings, a slow service): "Отстаёт" shows them earlier, "Спешит" later.
const SHIFT_KEY = 'lyricsShift';
const SHIFT_STEP = 0.5;
function shiftOf(key) {
  return (load(SHIFT_KEY, {})[key] || {}).s || 0;
}
function saveShift(key, s) {
  const all = load(SHIFT_KEY, {});
  if (s) all[key] = { s, at: Date.now() };
  else delete all[key];
  const keys = Object.keys(all);
  if (keys.length > 300) {
    keys.sort((a, b) => all[a].at - all[b].at);
    for (const k of keys.slice(0, keys.length - 300)) delete all[k];
  }
  save(SHIFT_KEY, all);
}

const LEAD = 0.25; // light a line a moment early, like the original players
const HAND_PAUSE = 3500; // ms of following-off after the user scrolls

// Index of the last line that has started at time `t` (-1 before the first).
export function activeIndex(lines, t) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// Adds "• • •" rows for a long intro and for long instrumental gaps.
export function withPauses(lines, duration = 0) {
  const out = [];
  if (lines.length && lines[0].t > 4) out.push({ t: 0, text: '', pause: true });
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    const end = next ? next.t : duration || l.t + 5;
    if (!l.text.trim()) {
      if (end - l.t > 6) out.push({ t: l.t, text: '', pause: true });
      else if (out.length) out.push({ t: l.t, text: '', blank: true });
      continue;
    }
    out.push(l);
  }
  return out;
}

export function createLyricsView({ onSeek, getDuration }) {
  const scroller = h('div', { class: 'ly-scroll' });
  const state = h('div', { class: 'ly-state', hidden: true });
  const shiftVal = h('span', { class: 'ly-shift-val' });
  const shiftBtn = (label, aria, d) => {
    const b = h('button', { class: 'ly-shift-btn', 'aria-label': aria }, label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setShift(Math.round((shift + d) * 10) / 10);
    });
    return b;
  };
  const shiftBar = h(
    'div',
    { class: 'ly-shift', hidden: true },
    shiftBtn('Спешит', 'Текст спешит: показывать позже', -SHIFT_STEP),
    shiftVal,
    shiftBtn('Отстаёт', 'Текст отстаёт: показывать раньше', SHIFT_STEP)
  );
  const el = h('div', { class: 'lyrics', 'aria-live': 'off' }, scroller, state, shiftBar);
  let shift = 0;
  let lastPos = 0;
  function paintShift() {
    shiftVal.textContent = shift ? `${shift > 0 ? 'раньше на' : 'позже на'} ${String(Math.abs(shift)).replace('.', ',')} с` : 'Синхронизация';
    shiftBar.classList.toggle('changed', !!shift);
  }
  function setShift(v) {
    shift = Math.max(-10, Math.min(10, v));
    if (key) saveShift(key, shift);
    paintShift();
    tick(lastPos);
  }

  let key = '';
  let data = null; // { synced, lines, source }
  let rows = [];
  let cur = -2;
  let handUntil = 0;
  let wanted = false;

  const setState = (text, loading = false) => {
    state.hidden = !text;
    state.textContent = text || '';
    state.classList.toggle('loading', loading);
  };

  const scrollToActive = (smooth = true) => {
    const row = rows[cur];
    if (!row || Date.now() < handUntil) return;
    const top = row.offsetTop - scroller.clientHeight * (el.clientWidth > 560 ? 0.38 : 0.3);
    scroller.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  };

  // a hand on the list: stop following for a moment
  const hand = () => {
    handUntil = Date.now() + HAND_PAUSE;
    el.classList.add('by-hand');
    clearTimeout(hand.t);
    hand.t = setTimeout(() => {
      el.classList.remove('by-hand');
      scrollToActive();
    }, HAND_PAUSE + 50);
  };
  scroller.addEventListener('touchstart', hand, { passive: true });
  scroller.addEventListener('wheel', hand, { passive: true });

  function render() {
    clear(scroller);
    rows = [];
    cur = -2;
    el.classList.toggle('plain', !!data && !data.synced);
    if (!data) return;
    const lines = data.synced ? withPauses(data.lines, getDuration ? getDuration() : 0) : data.lines;
    scroller.appendChild(h('div', { class: 'ly-pad top' }));
    if (!data.synced) scroller.appendChild(h('div', { class: 'ly-note' }, 'Текст без синхронизации'));
    for (const l of lines) {
      const row = l.pause
        ? h('div', { class: 'ly-line ly-pause', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))
        : l.blank
        ? h('div', { class: 'ly-line ly-blank', 'aria-hidden': 'true' })
        : h('div', { class: 'ly-line' }, l.text || ' ');
      row._t = l.t;
      if (data.synced && l.t != null) {
        row.addEventListener('click', () => {
          handUntil = 0;
          el.classList.remove('by-hand');
          onSeek(Math.max(0, l.t - 0.05));
        });
      }
      rows.push(row);
      scroller.appendChild(row);
    }
    scroller.appendChild(h('div', { class: 'ly-source' }, 'Текст: ' + data.source));
    scroller.appendChild(h('div', { class: 'ly-pad bottom' }));
    scroller.scrollTop = 0;
  }

  // Load the words for this track (once per track while the view is wanted).
  function show(track) {
    wanted = true;
    if (!track) return;
    const k = track.key;
    if (k === key) return;
    key = k;
    data = null;
    shift = shiftOf(k);
    paintShift();
    shiftBar.hidden = true;
    render();
    setState('Ищу текст…', true);
    el.classList.add('is-loading');
    lyricsFor(track)
      .then((d) => {
        if (key !== k) return;
        data = d;
        el.classList.remove('is-loading');
        if (!d) {
          setState('Текста для этой песни не нашлось');
          return;
        }
        setState('');
        render();
        shiftBar.hidden = !d.synced;
        tick.last = -1;
      })
      .catch(() => {
        if (key !== k) return;
        el.classList.remove('is-loading');
        setState('Не получилось загрузить текст. Проверь интернет.');
        key = ''; // try again next time
      });
  }

  // Called every frame with the playback position.
  function tick(pos) {
    lastPos = pos;
    if (!wanted || !data || !data.synced || !rows.length) return;
    pos += shift;
    let i = -1;
    for (let k = rows.length - 1; k >= 0; k--) {
      if (rows[k]._t != null && rows[k]._t <= pos + LEAD) {
        i = k;
        break;
      }
    }
    // a pause row ends shortly before the next line
    if (i === cur) return;
    const prev = rows[cur];
    if (prev) prev.classList.remove('active');
    for (let k = Math.max(0, Math.min(cur, i) - 1); k <= Math.max(cur, i) + 1 && k < rows.length; k++) {
      if (k < 0) continue;
      rows[k].classList.toggle('past', k < i);
    }
    if (cur === -2) rows.forEach((r, k) => r.classList.toggle('past', k < i));
    cur = i;
    if (rows[i]) rows[i].classList.add('active');
    scrollToActive(true);
  }

  function hide() {
    wanted = false;
  }

  // after a layout change (rotation, opening) put the current line back in view
  function relayout() {
    if (rows[cur]) scrollToActive(false);
  }

  return { el, show, tick, hide, relayout, hasSynced: () => !!(data && data.synced) };
}
