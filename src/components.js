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
    const img = h('img', { src, loading: 'lazy', alt: '', referrerpolicy: 'no-referrer' });
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

// Highlight the playing track everywhere on screen.
export function markPlaying() {
  const cur = player.current();
  for (const el of document.querySelectorAll('.track[data-key]')) {
    el.classList.toggle('playing', !!cur && el.getAttribute('data-key') === cur.key);
  }
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
  setTimeout(() => el.remove(), 220);
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
  const panel = h('div', { class: 'sheet-panel' }, h('div', { class: 'sheet-grip' }), title ? h('div', { class: 'sheet-title' }, title) : null, body);
  const el = h('div', { class: 'sheet' }, h('div', { class: 'sheet-backdrop', onclick: closeSheet }), panel);
  document.body.appendChild(el);
  openSheetEl = el;
  requestAnimationFrame(() => el.classList.add('open'));
  return el;
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

export function confirmSheet(title, text, okLabel = 'Удалить') {
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
          h('button', { class: 'btn btn-danger', onclick: () => done(true) }, okLabel)
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
