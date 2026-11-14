// Резонанс Connect from the phone: the phone's screen and sound on a TV running
// Резонанс OS. The same steps as Резонанс для ПК's cast window (desktop/web/cast.js):
// the TV comes to us (the native side announces the phone on the network),
// a 4-digit code the first time, then the whole SDP each way. Native work —
// being seen, the screen capture, WebRTC — is in CastPlugin.java.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { h, icon, clear, toast, add } from './util.js';
import { sheet, closeSheet, spinner } from './components.js';
import { cleanCode, unhideCandidates, opusStereo, startBitrate, countCandidates, errorText, QUALITY, quality } from './connect.js';

// the picture: smooth by default on a phone (videos), up to 4K
const QKEY = 'rez.castQuality';
function qualityNow() {
  let id = '';
  try {
    id = localStorage.getItem(QKEY) || '';
  } catch {}
  return quality(id, 'smooth');
}
function setQuality(id) {
  try {
    localStorage.setItem(QKEY, id);
  } catch {}
}

const Cast = registerPlugin('Cast');
export const castAvailable = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const KEY = 'rez.cast';
const tvsById = new Map();
let me = null; // {id, name}
let live = null; // the TV we show on
let busy = false;
let listening = false;
let box = null; // the sheet's body
let view = 'list';
let codeFor = null;
let note = '';
const watchers = new Set();

/** Calls fn(liveTv|null) when a showing starts or ends. */
export function onCastChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
export const castLive = () => live;
const changed = () => watchers.forEach((f) => f(live));

function db() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { tvs: {} };
  } catch {
    return { tvs: {} };
  }
}
function remember(id, data) {
  const d = db();
  d.tvs[id] = { ...(d.tvs[id] || {}), ...data };
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
}
function forget(id) {
  const d = db();
  delete d.tvs[id];
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
}
const known = (id) => db().tvs[id] || null;

function listen() {
  if (listening) return;
  listening = true;
  Cast.addListener('tv', (e) => {
    if (!e || !e.tv) return;
    tvsById.set(e.tv.id, e.tv);
    paint();
  });
  Cast.addListener('gone', (e) => {
    if (e && tvsById.delete(e.id)) paint();
  });
  Cast.addListener('state', (e) => {
    if (e && e.live) {
      paint();
      return;
    }
    const was = live;
    live = null;
    changed();
    if (was && e && e.why === 'remote') toast(`«${was.name}» закончил показ`);
    else if (was && e && e.why === 'lost') toast('Связь с телевизором пропала');
    if (box) {
      view = 'list';
      paint();
    }
    if (!box) Cast.close().catch(() => {});
  });
}

/** The «На телевизор» sheet. */
export async function openCast() {
  if (!castAvailable()) return toast('Показ на телевизоре есть в приложении для Android');
  listen();
  view = live ? 'live' : 'list';
  note = '';
  box = h('div', { class: 'cast-box' });
  const el = sheet('На телевизор', box);
  // the sheet closes: stop being seen unless something is shown
  const gone = new MutationObserver(() => {
    if (!document.body.contains(el)) {
      gone.disconnect();
      box = null;
      if (!live && !busy) Cast.close().catch(() => {});
    }
  });
  gone.observe(document.body, { childList: true });
  paint();
  try {
    const r = await Cast.open();
    me = { id: r.id, name: r.name };
    for (const t of r.tvs || []) tvsById.set(t.id, t);
  } catch {
    note = 'Не получилось выйти в домашнюю сеть — телефон подключён к Wi-Fi?';
  }
  paint();
}

function paint() {
  if (!box) return;
  clear(box);
  if (view === 'live' && live) {
    add(box, 
      h('div', { class: 'cast-live' }, icon('tv', 40), h('div', { class: 'cast-live-t' }, `Экран телефона на «${live.name}»`), h('div', { class: 'muted small' }, 'Можно открыть любое приложение — картинка и звук идут на телевизор. Остановить можно и в шторке уведомлений, и кнопкой «Назад» на пульте.')),
      h('button', { class: 'btn btn-primary cast-btn', onclick: () => stop() }, 'Остановить показ')
    );
    return;
  }
  if (view === 'code' && codeFor) {
    const input = h('input', { class: 'cast-code', type: 'tel', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'one-time-code', placeholder: '····' });
    input.addEventListener('input', () => {
      const c = cleanCode(input.value);
      if (c !== input.value) input.value = c;
      if (c.length === 4) {
        input.blur();
        start(codeFor, c);
      }
    });
    add(box, 
      h('div', { class: 'cast-ask' }, `Введи код с экрана «${codeFor.name}»`),
      input,
      note ? h('div', { class: 'cast-note' }, note) : null,
      h('button', { class: 'btn btn-ghost cast-btn', onclick: () => ((view = 'list'), (note = ''), paint()) }, 'Назад')
    );
    setTimeout(() => input.focus(), 50);
    return;
  }
  if (view === 'wait') {
    add(box, spinner(note || 'Подключаюсь…'));
    return;
  }
  const list = [...tvsById.values()];
  if (note) add(box, h('div', { class: 'cast-note' }, note));
  if (!list.length) {
    add(box, 
      spinner('Ищу телевизоры с Резонанс OS…'),
      h('div', { class: 'muted small cast-hint' }, 'Телевизор должен быть включён и в той же сети Wi-Fi, что и телефон. Обычно он находится за пару секунд.')
    );
    return;
  }
  add(box, 
    h(
      'div',
      { class: 'sheet-items' },
      list.map((t) =>
        h(
          'button',
          { class: 'sheet-item', onclick: () => pick(t) },
          icon('tv', 22),
          h('span', null, t.name, known(t.id) && known(t.id).token ? h('span', { class: 'muted small' }, ' · подключался') : null)
        )
      )
    ),
    qualityRow(),
    h('div', { class: 'muted small cast-hint' }, 'Покажет экран телефона со звуком. Звук телефона идёт на телевизор на Android 10 и новее.')
  );
}

function qualityRow() {
  const q = qualityNow();
  return h(
    'div',
    { class: 'cast-q' },
    h('div', { class: 'cast-q-t' }, 'Качество', h('span', { class: 'muted small' }, ' · ' + q.sub)),
    h(
      'div',
      { class: 'chips' },
      QUALITY.map((p) =>
        h(
          'button',
          {
            class: 'chip' + (p.id === q.id ? ' active' : ''),
            onclick: () => {
              setQuality(p.id);
              paint();
            },
          },
          p.name
        )
      )
    )
  );
}

async function pick(t) {
  if (busy) return;
  busy = true;
  view = 'wait';
  note = `Подключаюсь к «${t.name}»…`;
  paint();
  try {
    const k = known(t.id);
    let r = await Cast.request({ tv: t.id, path: '/connect/hello', body: { from: me.id, name: me.name } });
    if (r.status !== 200 || !r.body.ok) return fail(r.body && r.body.error);
    // the TV remembers us but we lost the token: a code again
    if (r.body.paired && !(k && k.token)) {
      r = await Cast.request({ tv: t.id, path: '/connect/hello', body: { from: me.id, name: me.name, again: true } });
      if (r.status !== 200 || !r.body.ok) return fail(r.body && r.body.error);
    }
    if (!r.body.paired && k && k.token) forget(t.id);
    busy = false;
    if (r.body.paired) return start(t, null);
    codeFor = t;
    view = 'code';
    note = '';
    paint();
  } finally {
    busy = false;
  }
}

function fail(code) {
  busy = false;
  view = 'list';
  note = errorText(code || 'net');
  paint();
  Cast.stop({ why: 'failed' }).catch(() => {});
}

async function start(t, code) {
  if (busy) return;
  busy = true;
  view = 'wait';
  note = `Подключаюсь к «${t.name}»…`;
  paint();
  try {
    // the system asks for the screen (and the microphone permission, for the sound)
    try {
      const q = qualityNow();
      await Cast.capture({ w: q.w, h: q.h });
    } catch (e) {
      busy = false;
      view = code ? 'code' : 'list';
      note = /denied/.test(String(e && e.message)) ? 'Без разрешения на запись экрана показать не получится' : 'Не получилось начать запись экрана';
      return paint();
    }
    const { sdp } = await Cast.offer();
    const body = { from: me.id, name: me.name, sdp };
    const k = known(t.id);
    if (code) body.code = code;
    else if (k && k.token) body.token = k.token;
    const r = await Cast.request({ tv: t.id, path: '/connect/offer', body, timeout: 25000 });
    if (r.status !== 200 || !r.body.ok || !r.body.sdp) {
      const e = (r.body && r.body.error) || 'net';
      await Cast.stop({ why: 'failed' }).catch(() => {});
      busy = false;
      if (e === 'pair') forget(t.id);
      if (e === 'code' || e === 'expired' || e === 'pair') {
        if (e !== 'code') {
          // a new code on the TV
          const again = await Cast.request({ tv: t.id, path: '/connect/hello', body: { from: me.id, name: me.name, again: true } });
          if (again.status !== 200 || !again.body.ok) return fail(again.body && again.body.error);
        }
        codeFor = t;
        view = 'code';
        note = errorText(e);
        return paint();
      }
      return fail(e);
    }
    remember(t.id, { name: t.name, ...(r.body.token ? { token: r.body.token } : {}) });
    const q = qualityNow();
    // a phone's hardware encoder makes mush below 2.5 Mbit/s
    const min = Math.max(q.min, 2500);
    const start = Math.max(q.start, min);
    await Cast.answer({ sdp: startBitrate(opusStereo(unhideCandidates(r.body.sdp, t.ip)), start, min, q.max), min, start, max: q.max, keep: q.keep });
    if (!countCandidates(r.body.sdp)) console.warn('cast: в ответе телевизора нет адресов');
    live = { id: t.id, name: t.name };
    view = 'live';
    changed();
    paint();
  } catch (e) {
    busy = false;
    fail('webrtc');
  } finally {
    busy = false;
  }
}

export async function stop() {
  await Cast.stop({ why: 'phone' }).catch(() => {});
  live = null;
  changed();
  closeSheet();
}
