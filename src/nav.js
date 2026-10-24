// Tab + page-stack navigation. Each tab keeps its own stack of pages, so going
// back returns to the exact scroll position you left. Pages slide in and out;
// tabs fade in.

import { h, icon } from './util.js';

const stacks = {};
const containers = {};
let active = '';
let rootFactories = {};
const tabListeners = new Set();

const PAGE_MS = 280;
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Plays a CSS animation class once and cleans it up (with a timeout fallback,
// since animationend doesn't fire when animations are disabled).
function animate(el, cls, ms, done) {
  if (reduced()) {
    done && done();
    return;
  }
  el.classList.add(cls);
  let finished = false;
  const end = () => {
    if (finished) return;
    finished = true;
    el.classList.remove(cls);
    el.removeEventListener('animationend', onEnd);
    done && done();
  };
  const onEnd = (e) => {
    if (e.target === el) end();
  };
  el.addEventListener('animationend', onEnd);
  setTimeout(end, ms + 80);
}

export function initNav(host, factories, first) {
  rootFactories = factories;
  for (const name of Object.keys(factories)) {
    containers[name] = h('div', { class: 'tab-pane', 'data-tab': name, hidden: true });
    host.appendChild(containers[name]);
    stacks[name] = [];
  }
  switchTab(first, { instant: true });
}

export function onTab(fn) {
  tabListeners.add(fn);
}

export function activeTab() {
  return active;
}

// Items of a page rise in one after another, but only right after the page
// appears: later re-renders (progress, likes) must not replay it.
export function freshen(page) {
  if (!page || reduced()) return;
  page.classList.add('fresh');
  clearTimeout(page._freshTimer);
  page._freshTimer = setTimeout(() => page.classList.remove('fresh'), 620);
}

function mount(tab, page, withAnimation) {
  page.classList.add('page');
  freshen(page);
  // the header gets its background once the content scrolls under it
  const head = page.querySelector('.page-head');
  if (head && !page._scrollWatch) {
    page._scrollWatch = true;
    let on = false;
    page.addEventListener(
      'scroll',
      () => {
        const now = page.scrollTop > 6;
        if (now !== on) head.classList.toggle('scrolled', (on = now));
      },
      { passive: true }
    );
  }
  const st = stacks[tab];
  const prev = st[st.length - 1];
  st.push(page);
  containers[tab].appendChild(page);
  if (!prev) return;
  if (!withAnimation) {
    prev.classList.add('covered');
    return;
  }
  animate(page, 'page-enter', PAGE_MS);
  animate(prev, 'page-under', PAGE_MS, () => {
    // only hide it if it is still under the top page
    if (st[st.length - 1] !== prev) prev.classList.add('covered');
  });
}

export function switchTab(name, { reset = false, instant = false } = {}) {
  if (!containers[name]) return;
  const changed = active !== name;
  if (active === name && reset) {
    // tapping the active tab again returns to its first page
    while (stacks[name].length > 1) popPage(name, false);
    const root = stacks[name][0];
    if (root) root.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (active && containers[active]) containers[active].hidden = true;
  active = name;
  containers[name].hidden = false;
  if (!stacks[name].length) mount(name, rootFactories[name](), false);
  if (changed && !instant) animate(containers[name], 'pane-enter', 220);
  const top = stacks[name][stacks[name].length - 1];
  if (top && top._onShow) top._onShow();
  for (const fn of tabListeners) fn(name);
}

export function push(page) {
  mount(active, page, true);
  if (page._onShow) page._onShow();
}

function popPage(tab, withAnimation = true) {
  const st = stacks[tab];
  if (st.length <= 1) return false;
  const page = st.pop();
  if (page._cleanup) page._cleanup.forEach((fn) => fn());
  const top = st[st.length - 1];
  top.classList.remove('covered');
  if (withAnimation) {
    page.style.pointerEvents = 'none';
    animate(page, 'page-leave', PAGE_MS, () => page.remove());
    animate(top, 'page-reveal', PAGE_MS);
  } else {
    page.remove();
  }
  if (top._onShow) top._onShow();
  return true;
}

export function back() {
  if (popPage(active)) return true;
  if (active !== 'feed') {
    switchTab('feed');
    return true;
  }
  return false;
}

// Page with a header. opts: { title, back: bool, actions: [elements] }
export function page(opts, ...body) {
  const head = h(
    'header',
    { class: 'page-head' + (opts.back ? ' with-back' : '') },
    opts.back ? h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => back() }, icon('back', 24)) : null,
    h('h1', { class: opts.back ? 'page-title small' : 'page-title' }, opts.title || ''),
    h('div', { class: 'page-actions' }, opts.actions || [])
  );
  const el = h('div', null, head, h('div', { class: 'page-body' }, ...body));
  el._cleanup = [];
  return el;
}

export function pageBody(el) {
  return el.querySelector('.page-body');
}
