// Резонанс OS: what is on top of the home screen (all apps, the menu of an app,
// settings, the screen saver). The arrows and OK go to the top one.

import * as nav from './nav.js';

const home = document.getElementById('home');
const stack = [];

export const top = () => stack[stack.length - 1] || null;
export const isOpen = (layer) => stack.indexOf(layer) >= 0;

function dim() {
  document.body.classList.toggle('dim', stack.some((l) => l.dim));
}

export function push(layer, focusEl) {
  if (isOpen(layer)) return;
  stack.push(layer);
  layer.el.classList.remove('hidden');
  dim();
  nav.setScope(layer.el, focusEl);
}

export function pop(layer) {
  const i = stack.indexOf(layer || top());
  if (i < 0) return;
  const [l] = stack.splice(i, 1);
  l.el.classList.add('hidden');
  if (l.onClose) l.onClose();
  dim();
  const t = top();
  nav.setScope(t ? t.el : home);
}

export function closeAll() {
  while (stack.length) pop(top());
}
