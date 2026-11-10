// Резонанс Лаунчер: the phone behind the page. window.RezL is given by the
// Android side (Bridge.java); events come back through window.__rezEmit(name,
// data). In a plain browser (for checking the design) every call is harmless,
// and a test can give window.RezL a stand-in before the page loads.

const N = typeof window.RezL !== 'undefined' ? window.RezL : null;
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
const has = (m) => N && typeof N[m] === 'function';
const BASE = location.protocol === 'https:' ? location.origin + '/' : '/';

export const rez = {
  apps: () => (has('apps') ? json(N.apps(), []) : []),
  meta: () => (has('meta') ? json(N.meta(), {}) : {}),
  // the window grows out of the icon: rect is its place on the screen
  launch: (pkg, r) => (has('launch') ? N.launch(pkg, r ? r.x : 0, r ? r.y : 0, r ? r.w : 0, r ? r.h : 0) : (console.log('launch', pkg), true)),
  shortcuts: (pkg) => (has('shortcuts') ? json(N.shortcuts(pkg), []) : []),
  startShortcut: (pkg, id) => has('startShortcut') && N.startShortcut(pkg, id),
  appInfo: (pkg) => has('appInfo') && N.appInfo(pkg),
  uninstall: (pkg) => has('uninstall') && N.uninstall(pkg),
  openSettings: () => has('openSettings') && N.openSettings(),
  openUrl: (u) => (has('openUrl') ? N.openUrl(u) : (window.open && console.log('open', u), false)),
  requestMic: () => has('requestMic') && N.requestMic(),
  openNotificationAccess: () => has('openNotificationAccess') && N.openNotificationAccess(),
  openHomeSettings: () => has('openHomeSettings') && N.openHomeSettings(),
  info: () => (has('info') ? json(N.info(), {}) : {}),
  network: () => (has('network') ? N.network() : navigator.onLine ? 'wifi' : 'none'),
  battery: () => (has('battery') ? json(N.battery(), {}) : {}),
  badges: () => (has('badges') ? json(N.badges(), {}) : {}),
  media: (a) => has('media') && N.media(a),
  mediaState: () => (has('mediaState') ? json(N.mediaState(), { active: false }) : { active: false }),
  visualizer: (on) => has('visualizer') && N.visualizer(!!on),
  wallpaper: (o) => has('wallpaper') && N.wallpaper(JSON.stringify(o)),
  setLiveWallpaper: () => has('setLiveWallpaper') && N.setLiveWallpaper(),
  pickWallpaper: () => has('pickWallpaper') && N.pickWallpaper(),
  seeThrough: (on) => has('seeThrough') && N.seeThrough(!!on),
  scroll: (x, pages) => has('scroll') && N.scroll(x, pages),
  widgets: () => (has('widgets') ? json(N.widgets(), []) : []),
  widgetAdd: (k) => has('widgetAdd') && N.widgetAdd(k),
  widgetFrames: (j) => has('widgetFrames') && N.widgetFrames(j),
  widgetRemove: (id) => has('widgetRemove') && N.widgetRemove(id),
  haptic: (k) => has('haptic') && N.haptic(k || 'tick'),
  notifications: () => has('notifications') && N.notifications(),
  orientation: (m) => has('orientation') && N.orientation(m),
  storeGet: () => (has('storeGet') ? N.storeGet() : ''),
  storeSet: (s) => has('storeSet') && N.storeSet(s),
  log: (m) => (has('log') ? N.log(String(m)) : console.log(String(m))),
  reload: () => has('reload') && N.reload(),
  iconUrl: (pkg, mono) => `${BASE}icon/${encodeURIComponent(pkg)}${mono ? '?k=mono' : ''}`,
  artUrl: (v) => `${BASE}art?v=${v}`,
};

// weather.js and the like speak to "tv": the outside services go through the Android side
export const tv = {
  log: rez.log,
  net: (url) => (N ? `${BASE}net?u=${encodeURIComponent(url)}` : url),
};
