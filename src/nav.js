// Tab + page-stack navigation. Each tab keeps its own stack of pages, so going
// back returns to the exact scroll position you left.

import { h, icon } from './util.js';

const stacks = {};
const containers = {};
let active = '';
let rootFactories = {};
const tabListeners = new Set();

export function initNav(host, factories, first) {
  rootFactories = factories;
  for (const name of Object.keys(factories)) {
    containers[name] = h('div', { class: 'tab-pane', 'data-tab': name, hidden: true });
    host.appendChild(containers[name]);
    stacks[name] = [];
  }
  switchTab(first);
}

export function onTab(fn) {
  tabListeners.add(fn);
}

export function activeTab() {
  return active;
}

function mount(tab, page) {
  page.classList.add('page');
  const st = stacks[tab];
  const prev = st[st.length - 1];
  if (prev) prev.classList.add('covered');
  st.push(page);
  containers[tab].appendChild(page);
}

export function switchTab(name, { reset = false } = {}) {
  if (!containers[name]) return;
  if (active === name && reset) {
    // tapping the active tab again returns to its first page
    while (stacks[name].length > 1) popPage(name);
    const root = stacks[name][0];
    if (root) root.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (active && containers[active]) containers[active].hidden = true;
  active = name;
  containers[name].hidden = false;
  if (!stacks[name].length) mount(name, rootFactories[name]());
  const top = stacks[name][stacks[name].length - 1];
  if (top && top._onShow) top._onShow();
  for (const fn of tabListeners) fn(name);
}

export function push(page) {
  mount(active, page);
  if (page._onShow) page._onShow();
}

function popPage(tab) {
  const st = stacks[tab];
  if (st.length <= 1) return false;
  const page = st.pop();
  if (page._cleanup) page._cleanup.forEach((fn) => fn());
  page.remove();
  const top = st[st.length - 1];
  top.classList.remove('covered');
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
