// Reusable UI pieces: track rows, cards, bottom sheets, dialogs.

import { h, icon, fmtTime, clear, toast } from './util.js';
import * as player from './player.js';
import { localTracks } from './local.js';

// ---------- covers ----------

const localCovers = new Map();
export async function refreshLocalCovers() {
  localCovers.clear();
  for (const t of await localTracks()) if (t.cover) localCovers.set(t.lid, t.cover);
}

export function coverOf(t) {
  if (!t) return '';
  if (t.cover) return t.cover;
  if ((t.src === 'local' || t.match === 'local') && t.lid) return localCovers.get(t.lid) || '';
  return '';
}

export function cover(src, cls = 'cover', fallbackIcon = 'note') {
  const box = h('div', { class: cls + ' cover-box' });
  if (src) {
    const img = h('img', { src, loading: 'lazy', alt: '', referrerpolicy: 'no-referrer', draggable: 'false', decoding: 'async' });
    img.onerror = () => {
      img.remove();
      box.appendChild(icon(fallbackIcon, 22, 'cover-icon'));
    };
    box.appendChild(img);
  } else {
    box.appendChild(icon(fallbackIcon, 22, 'cover-icon'));
  }
  return box;
}

// ---------- track rows ----------

export function sourceBadge(t) {
  if (t.src === 'local' || t.match === 'local') return h('span', { class: 'badge' }, 'MP3');
  if (t.src === 'ext' && t.match === 'none') return h('span', { class: 'badge badge-missing' }, 'нет');
  return null;
}

// options: { onPlay(index), menu(track, index), numbered }
export function trackRow(t, i, opts = {}) {
  const cur = player.current();
  const row = h(
    'div',
    {
      class: 'track' + (cur && cur.key === t.key ? ' playing' : '') + (t.unavailable || (t.src === 'ext' && t.match === 'none') ? ' unavailable' : ''),
      'data-key': t.key,
      role: 'button',
    },
    opts.numbered ? h('div', { class: 'track-num' }, String(i + 1)) : cover(coverOf(t), 'cover cover-sm'),
    h(
      'div',
      { class: 'track-text' },
      h('div', { class: 'track-title' }, t.title, t.explicit ? h('span', { class: 'badge badge-e' }, 'E') : null),
      h('div', { class: 'track-sub' }, sourceBadge(t), t.artist || '')
    ),
    h('div', { class: 'track-dur' }, t.duration ? fmtTime(t.duration) : ''),
    opts.menu
      ? h(
          'button',
          {
            class: 'icon-btn track-more',
            'aria-label': 'Ещё',
            onclick: (e) => {
              e.stopPropagation();
              opts.menu(t, i);
            },
          },
          icon('more', 22)
        )
      : null
  );
  row.addEventListener('click', () => opts.onPlay && opts.onPlay(i));
  return row;
}

export function trackList(tracks, opts = {}) {
  const box = h('div', { class: 'track-list' });
  tracks.forEach((t, i) => box.appendChild(trackRow(t, i, opts)));
  return box;
}

// Highlight the playing track everywhere on screen. Only rows of the old and the
// new track are touched (lists can have thousands of rows); new rows get the
// mark when they are created (trackRow).
let markedKey = '';
export function markPlaying() {
  const cur = player.current();
  const key = cur ? cur.key : '';
  if (key === markedKey) return;
  const sel = (k) => `.track[data-key="${CSS.escape(k)}"]`;
  if (markedKey) for (const el of document.querySelectorAll(sel(markedKey))) el.classList.remove('playing');
  if (key) for (const el of document.querySelectorAll(sel(key))) el.classList.add('playing');
  markedKey = key;
}

// ---------- cards ----------

export function releaseCard(r, onClick) {
  const year = r.date ? String(r.date).slice(0, 4) : '';
  return h(
    'div',
    { class: 'card', role: 'button', onclick: onClick },
    cover(r.cover, 'cover cover-card'),
    h('div', { class: 'card-title' }, r.title),
    h('div', { class: 'card-sub' }, [r.artist, year].filter(Boolean).join(', '))
  );
}

export function artistCard(a, onClick) {
  return h(
    'div',
    { class: 'card card-artist', role: 'button', onclick: onClick },
    cover(a.image, 'cover cover-card round', 'user'),
    h('div', { class: 'card-title center' }, a.name)
  );
}

export function hscroll(children) {
  return h('div', { class: 'hscroll' }, children);
}

export function section(title, action, ...body) {
  return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, title), action || null), ...body);
}

// Placeholder shapes that shimmer while a page loads, so the layout doesn't jump.
export function skeleton(kind = 'list') {
  const rows = [];
  for (let i = 0; i < 7; i++) {
    rows.push(
      h(
        'div',
        { class: 'sk-row', style: { '--i': i } },
        h('div', { class: 'sk sk-cover' }),
        h('div', { class: 'sk-lines' }, h('div', { class: 'sk sk-line', style: { width: 55 + ((i * 17) % 35) + '%' } }), h('div', { class: 'sk sk-line short', style: { width: 30 + ((i * 23) % 25) + '%' } }))
      )
    );
  }
  return h(
    'div',
    { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Загрузка' },
    kind === 'hero' ? h('div', { class: 'sk-hero' }, h('div', { class: 'sk sk-hero-cover' }), h('div', { class: 'sk sk-line wide' }), h('div', { class: 'sk sk-line mid' })) : null,
    rows
  );
}

export function spinner(text) {
  return h('div', { class: 'loading' }, h('div', { class: 'spin' }), text ? h('div', { class: 'loading-text' }, text) : null);
}

export function emptyState(iconName, title, text, ...actions) {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName, 34)),
    h('div', { class: 'empty-title' }, title),
    text ? h('div', { class: 'empty-text' }, text) : null,
    actions.length ? h('div', { class: 'empty-actions' }, actions) : null
  );
}

export function errorBox(err, retry) {
  return h(
    'div',
    { class: 'error-box' },
    h('div', null, err && err.message ? err.message : String(err)),
    retry ? h('button', { class: 'btn btn-ghost', onclick: retry }, 'Повторить') : null
  );
}

export function playButtons(getTracks) {
  return h(
    'div',
    { class: 'play-buttons' },
    h(
      'button',
      {
        class: 'btn btn-primary',
        onclick: async () => {
          const t = await getTracks();
          if (t.length) player.playQueue(t, 0);
        },
      },
      icon('play', 20),
      'Слушать'
    ),
    h(
      'button',
      {
        class: 'btn btn-ghost',
        onclick: async () => {
          const t = await getTracks();
          if (t.length) player.playQueue(t, 0, { shuffle: true, randomStart: true });
        },
      },
      icon('shuffle', 20),
      'Вперемешку'
    )
  );
}

// ---------- bottom sheet ----------

let openSheetEl = null;

export function closeSheet() {
  if (!openSheetEl) return false;
  const el = openSheetEl;
  openSheetEl = null;
  el.classList.remove('open');
  setTimeout(() => el.remove(), 380);
  return true;
}

export function isSheetOpen() {
  return !!openSheetEl;
}

// items: [{ icon, label, onClick, danger }] or a ready element
export function sheet(title, content) {
  closeSheet();
  const body = Array.isArray(content)
    ? h(
        'div',
        { class: 'sheet-items' },
        content.filter(Boolean).map((it) =>
          h(
            'button',
            {
              class: 'sheet-item' + (it.danger ? ' danger' : ''),
              onclick: () => {
                if (!it.keepOpen) closeSheet();
                it.onClick && it.onClick();
              },
            },
            it.icon ? icon(it.icon, 22) : null,
            h('span', null, it.label)
          )
        )
      )
    : content;
  const grip = h('div', { class: 'sheet-handle' }, h('div', { class: 'sheet-grip' }), title ? h('div', { class: 'sheet-title' }, title) : null);
  const panel = h('div', { class: 'sheet-panel' }, grip, body);
  const el = h('div', { class: 'sheet' }, h('div', { class: 'sheet-backdrop', onclick: closeSheet }), panel);
  document.body.appendChild(el);
  openSheetEl = el;
  // on a wide screen dialogs float in the middle and close with a tap outside
  dragToClose(grip, panel, () => closeSheet(), el, { enabled: () => !window.matchMedia('(min-width: 700px)').matches });
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  return el;
}

// Pull a panel down to close it (sheets, the full player). `handle` is where the
// pull may start; small moves stay taps.
export function dragToClose(handle, panel, onClose, host = panel, { threshold = 110, ignore = '', enabled = () => true } = {}) {
  let d = null;
  handle.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || !enabled()) return;
    if (ignore && e.target.closest && e.target.closest(ignore)) return;
    d = { y0: e.clientY, t0: performance.now(), dy: 0, moved: false, id: e.pointerId };
  });
  handle.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    // a sideways swipe (hSwipe) took this touch
    if (handle._hSwipe || (e.target && e.target.closest && e.target.closest('[data-hswipe]'))) return (d = null);
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (dy < 8) return;
      d.moved = true;
      try {
        handle.setPointerCapture(d.id);
      } catch {}
      host.classList.add('dragging');
    }
    d.dy = Math.max(0, dy);
    panel.style.transform = `translateY(${d.dy}px)`;
  });
  const end = (e) => {
    if (!d || (e && e.pointerId !== d.id)) return;
    const { moved, dy, t0 } = d;
    d = null;
    if (!moved) return;
    host.classList.remove('dragging');
    const v = dy / Math.max(1, performance.now() - t0);
    panel.style.transform = '';
    if (dy > threshold || v > 0.7) onClose();
    // a pull is not a tap
    const swallow = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    handle.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => handle.removeEventListener('click', swallow, { capture: true }), 350);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// Sideways swipe: the targets follow the finger; far or fast enough and they fly
// off to that side and onSwipe('next' | 'prev') is called (left = next, right =
// previous), otherwise they spring back. Gives way to a vertical pull.
export function hSwipe(area, { targets, onSwipe, ignore = '', enabled = () => true, threshold = 72 }) {
  let d = null;
  const reset = (els) =>
    els.forEach((el) => {
      el.style.transform = '';
      el.style.opacity = '';
    });
  area.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || !enabled()) return;
    if (ignore && e.target.closest && e.target.closest(ignore)) return;
    d = { x0: e.clientX, y0: e.clientY, t0: performance.now(), dx: 0, on: false, id: e.pointerId, els: [] };
  });
  // dragging text or a picture natively would cancel the swipe
  area.addEventListener('dragstart', (e) => e.preventDefault());
  area.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.on) {
      if (area.closest('.dragging') || area.classList.contains('dragging')) return (d = null);
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) {
        if (Math.abs(dy) > 12) d = null; // it's a vertical move
        return;
      }
      d.on = true;
      area._hSwipe = true;
      area.setAttribute('data-hswipe', '');
      try {
        area.setPointerCapture(d.id);
      } catch {}
      d.els = targets().filter(Boolean);
      d.els.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    }
    d.dx = dx;
    const w = area.clientWidth || 320;
    // a little resistance, a little tilt
    const x = dx * 0.92;
    d.els.forEach((el) => {
      el.style.transform = `translateX(${x}px) rotate(${(x / w) * 5}deg)`;
      el.style.opacity = String(1 - Math.min(0.55, (Math.abs(x) / w) * 0.9));
    });
  });
  const end = (e) => {
    if (!d || (e && e.pointerId !== d.id)) return;
    const { on, dx, t0, els } = d;
    d = null;
    area._hSwipe = false;
    area.removeAttribute('data-hswipe');
    if (!on) return;
    // a swipe is not a tap
    const swallow = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    area.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => area.removeEventListener('click', swallow, { capture: true }), 350);
    const w = area.clientWidth || 320;
    const v = dx / Math.max(1, performance.now() - t0);
    // a cancelled touch (the system took it over) still counts if it went far enough
    const far = Math.abs(dx) > threshold;
    const go = e && e.type === 'pointercancel' ? Math.abs(dx) > threshold * 1.2 : far || (Math.abs(v) > 0.45 && Math.abs(dx) > 24);
    const from = els.map((el) => ({ transform: el.style.transform || 'none', opacity: el.style.opacity || '1' }));
    if (go) {
      const sign = dx < 0 ? -1 : 1;
      els.forEach((el, i) => {
        el.animate([from[i], { transform: `translateX(${sign * w * 0.9}px) rotate(${sign * 6}deg)`, opacity: 0 }], {
          duration: 200,
          easing: 'cubic-bezier(.4,0,1,1)',
          fill: 'forwards',
        });
      });
      reset(els);
      onSwipe(dx < 0 ? 'next' : 'prev');
    } else {
      els.forEach((el, i) => el.animate([from[i], { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.9,.25,1.15)' }));
      reset(els);
    }
  };
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
  area.addEventListener('lostpointercapture', (e) => d && d.on && end(e));
}

// Brings in new content from the side a swipe went to (or back, if the track
// didn't change after all).
export function slideIn(el, dir, dist = 60) {
  if (!el) return;
  const sign = dir === 'next' ? 1 : -1;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ transform: `translateX(${sign * dist}px) scale(0.96)`, opacity: 0 }, { transform: 'none', opacity: 1 }], {
    duration: 380,
    easing: 'cubic-bezier(.2,.8,.2,1)',
  });
}

// Text input dialog built on the sheet.
export function askText(title, initial = '', okLabel = 'Готово') {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value: initial, placeholder: 'Название', maxlength: '80' });
    const done = (v) => {
      closeSheet();
      resolve(v);
    };
    const content = h(
      'div',
      { class: 'sheet-form' },
      input,
      h(
        'div',
        { class: 'row-end' },
        h('button', { class: 'btn btn-ghost', onclick: () => done(null) }, 'Отмена'),
        h('button', { class: 'btn btn-primary', onclick: () => done(input.value.trim() || null) }, okLabel)
      )
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
    });
    sheet(title, content);
    setTimeout(() => input.focus(), 250);
  });
}

export function confirmSheet(title, text, okLabel = 'Удалить', kind = 'danger') {
  return new Promise((resolve) => {
    const done = (v) => {
      closeSheet();
      resolve(v);
    };
    sheet(
      title,
      h(
        'div',
        { class: 'sheet-form' },
        text ? h('div', { class: 'muted' }, text) : null,
        h(
          'div',
          { class: 'row-end' },
          h('button', { class: 'btn btn-ghost', onclick: () => done(false) }, 'Отмена'),
          h('button', { class: 'btn btn-' + kind, onclick: () => done(true) }, okLabel)
        )
      )
    );
  });
}

// ---------- snackbar with an action ----------

let snackTimer;
export function snack(text, actionLabel, onAction, ms = 6000) {
  let el = document.getElementById('snack');
  if (!el) {
    el = h('div', { id: 'snack', class: 'snack' });
    document.body.appendChild(el);
  }
  clear(el);
  el.appendChild(h('div', { class: 'snack-text' }, text));
  if (actionLabel) {
    el.appendChild(
      h(
        'button',
        {
          class: 'snack-btn',
          onclick: () => {
            el.classList.remove('show');
            onAction && onAction();
          },
        },
        actionLabel
      )
    );
  }
  el.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export { toast };
