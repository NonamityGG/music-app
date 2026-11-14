// The phone behind the page. window.RezL comes from the Android side
// (Bridge.java); events come back through window.__rezEmit(name, data). In a
// plain browser every call is harmless, and the preview can put a stand-in
// RezL in place before the page loads.

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

const json = (s, def) => {
  try {
    return JSON.parse(s) ?? def;
  } catch {
    return def;
  }
};
const has = (m) => N && typeof N[m] === 'function';
const BASE = location.protocol === 'https:' ? location.origin + '/' : '/';

export const rez = {
  apps: () => (has('apps') ? json(N.apps(), []) : []),
  meta: () => (has('meta') ? json(N.meta(), {}) : {}),
  // the app's window grows out of the icon: r is the icon's place on the screen
  launch: (pkg, r) => (has('launch') ? N.launch(pkg, r ? r.x : 0, r ? r.y : 0, r ? r.width : 0, r ? r.height : 0) : (console.log('launch', pkg), true)),
  shortcuts: (pkg) => (has('shortcuts') ? json(N.shortcuts(pkg), []) : []),
  startShortcut: (pkg, id) => has('startShortcut') && N.startShortcut(pkg, id),
  appInfo: (pkg) => has('appInfo') && N.appInfo(pkg),
  uninstall: (pkg) => has('uninstall') && N.uninstall(pkg),
  openSettings: () => has('openSettings') && N.openSettings(),
  openUrl: (u) => (has('openUrl') ? N.openUrl(u) : (console.log('open', u), false)),
  requestMic: () => has('requestMic') && N.requestMic(),
  openNotificationAccess: () => has('openNotificationAccess') && N.openNotificationAccess(),
  openHomeSettings: () => has('openHomeSettings') && N.openHomeSettings(),
  info: () => (has('info') ? json(N.info(), {}) : {}),
  battery: () => (has('battery') ? json(N.battery(), {}) : {}),
  badges: () => (has('badges') ? json(N.badges(), {}) : {}),
  media: (a) => has('media') && N.media(a),
  mediaState: () => (has('mediaState') ? json(N.mediaState(), { active: false }) : { active: false }),
  visualizer: (v) => has('visualizer') && N.visualizer(!!v),
  setWallpaper: (dataUrl) => has('setWallpaper') && (N.setWallpaper(dataUrl), true),
  haptic: (k) => has('haptic') && N.haptic(k || 'tick'),
  notifications: () => has('notifications') && N.notifications(),
  storeGet: () => (has('storeGet') ? N.storeGet() : ''),
  storeSet: (s) => has('storeSet') && N.storeSet(s),
  log: (m) => (has('log') ? N.log(String(m)) : console.log(String(m))),
  iconUrl: (pkg) => `${BASE}icon/${encodeURIComponent(pkg)}`,
  artUrl: (v) => `${BASE}art?v=${v}`,
};
