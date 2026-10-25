// Резонанс OS: moving around with the remote's arrows. Focusable things have the
// class "f". Things in a horizontal row ([data-row]) go left/right along the row
// and up/down to the row above/below (back to the card that was focused there
// last time). Grids ([data-nav="geo"]) and everything else move to the nearest
// thing in that direction.

let scope = document.body;
let cur = null;
const hooks = [];

export const current = () => cur;
export const onFocus = (fn) => hooks.push(fn);

const shown = (el) => el && el.getClientRects().length > 0;
const all = () => Array.prototype.filter.call(scope.querySelectorAll('.f'), (el) => shown(el) && !el.classList.contains('nofocus'));

export function setScope(root, el) {
  if (scope && cur && scope.contains(cur)) scope._last = cur;
  scope = root;
  const target = el || (root._last && root.contains(root._last) && shown(root._last) ? root._last : all()[0]);
  if (target) focus(target, { silent: false });
}

export function getScope() {
  return scope;
}

export function focus(el, opts = {}) {
  if (!el) return;
  if (cur && cur !== el) cur.classList.remove('focus');
  const prev = cur;
  cur = el;
  el.classList.add('focus');
  const row = rowOf(el);
  if (row) row._last = el;
  for (const fn of hooks) fn(el, prev, opts);
}

// the focusable things of a row (a row can be one focusable thing itself)
function itemsOf(r) {
  if (r.classList.contains('f')) return shown(r) ? [r] : [];
  return Array.prototype.filter.call(r.querySelectorAll('.f'), shown);
}

function rowOf(el) {
  const r = el.closest('[data-row]');
  return r && scope.contains(r) ? r : null;
}

function rect(el) {
  return el.getBoundingClientRect();
}

function center(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function geo(dir, list, from) {
  const a = center(rect(from));
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === from) continue;
    const c = center(rect(el));
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const primary = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    if (primary <= 4) continue;
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.4;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function bump(dir) {
  if (!cur) return;
  const cls = 'bump-' + dir;
  cur.classList.remove(cls);
  void cur.offsetWidth;
  cur.classList.add(cls);
  setTimeout(() => cur && cur.classList.remove(cls), 320);
}

// returns true when the focus moved
export function move(dir) {
  const list = all();
  if (!cur || !scope.contains(cur) || !shown(cur)) {
    if (list[0]) focus(list[0]);
    return !!list[0];
  }
  const row = rowOf(cur);
  const geoRow = row && row.getAttribute('data-nav') === 'geo';
  if (row && !geoRow && (dir === 'left' || dir === 'right')) {
    const items = itemsOf(row);
    const i = items.indexOf(cur);
    const next = items[i + (dir === 'right' ? 1 : -1)];
    if (next) {
      focus(next, { dir });
      return true;
    }
    bump(dir);
    return false;
  }
  if (row && !geoRow && (dir === 'up' || dir === 'down')) {
    const rows = Array.prototype.filter
      .call(scope.querySelectorAll('[data-row]'), (r) => shown(r) && itemsOf(r).length && !r.classList.contains('nofocus'))
      .sort((p, q) => rect(p).top - rect(q).top);
    const idx = rows.indexOf(row);
    const target = rows[idx + (dir === 'down' ? 1 : -1)];
    if (target) {
      const mem = target._last && target.contains(target._last) && shown(target._last) ? target._last : null;
      const items = itemsOf(target);
      const from = center(rect(cur));
      const near = items.reduce((b, el) => (Math.abs(center(rect(el)).x - from.x) < Math.abs(center(rect(b)).x - from.x) ? el : b), items[0]);
      focus(mem || near, { dir });
      return true;
    }
    bump(dir);
    return false;
  }
  const pool = geoRow ? itemsOf(row) : list;
  const next = geo(dir, pool, cur) || (geoRow ? geo(dir, list, cur) : null);
  if (next) {
    focus(next, { dir });
    return true;
  }
  bump(dir);
  return false;
}

// keep a card of a horizontal row on screen (the row slides, not the page)
export function intoView(el) {
  const track = el.closest('.track');
  if (!track) return;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const viewW = window.innerWidth;
  const pad = 8 * rem;
  const peek = 6 * rem;
  const left = el.offsetLeft;
  const w = el.offsetWidth;
  let x = track._x || 0;
  if (left + w - x > viewW - pad - peek) x = left + w - (viewW - pad - peek);
  if (left - x < pad) x = Math.max(0, left - pad);
  if (x !== track._x) {
    track._x = x;
    track.style.transform = `translate3d(${-x}px,0,0)`;
  }
}
