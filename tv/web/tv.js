// Резонанс OS: the TV behind the page. window.RezTV is given by the Android
// side (Bridge.java); events come back through window.__rezEmit(name, data).
// In a plain browser (for checking the design) window.__mock stands in for it.

const N = typeof window.RezTV !== 'undefined' ? window.RezTV : null;
const M = () => window.__mock || null;
export const native = !!N;

const handlers = {};
window.__rezEmit = (name, data) => {
  for (const fn of handlers[name] || []) {
    try {
      fn(data);
    } catch (e) {
      console.error(e);
    }
  }
};
export const on = (name, fn) => (handlers[name] = handlers[name] || []).push(fn);
export const emit = (name, data) => window.__rezEmit(name, data);

const json = (s, def) => {
  try {
    return JSON.parse(s);
  } catch {
    return def;
  }
};
const BASE = location.protocol === 'https:' ? location.origin + '/' : '';

export const tv = {
  apps: () => (N ? json(N.apps(), []) : M() ? M().apps() : []),
  launch: (pkg) => (N ? N.launch(pkg) : (console.log('launch', pkg), true)),
  openSettings: () => (N ? N.openSettings() : false),
  appInfo: (pkg) => (N ? N.appInfo(pkg) : false),
  uninstall: (pkg) => (N ? N.uninstall(pkg) : false),
  openAccessibility: () => (N ? N.openAccessibility() : false),
  info: () => (N ? json(N.info(), {}) : M() ? M().info() : {}),
  network: () => (N ? N.network() : navigator.onLine ? 'wifi' : 'none'),
  media: (a) => (N ? N.media(a) : M() && M().media && M().media(a)),
  mediaState: () => (N ? json(N.mediaState(), { active: false }) : M() && M().np ? M().np : { active: false }),
  visualizer: (on) => N && N.visualizer(!!on),
  setGuard: (on) => N && N.setGuard(!!on),
  openStockHome: (min) => (N ? N.openStockHome(min) : false),
  log: (m) => (N ? N.log(String(m)) : console.log(String(m))),
  iconUrl: (pkg, banner) => (M() ? M().icon(pkg, banner) : `${BASE}icon/${encodeURIComponent(pkg)}${banner ? '?k=banner' : ''}`),
  artUrl: (v) => (M() ? M().art(v) : `${BASE}art?v=${v}`),
};

// keys from the Android side: back, menu, home
document.addEventListener('keydown', (e) => {
  // in a browser: Esc = Back, M = Menu, H = Home
  if (N) return;
  if (e.key === 'Escape' || e.key === 'Backspace') emit('key', 'back');
  else if (e.key === 'm' || e.key === 'ContextMenu') emit('key', 'menu');
  else if (e.key === 'h') emit('key', 'home');
});
