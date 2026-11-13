// Резонанс OS: «Приём экрана» (Резонанс Connect). A computer on the same Wi-Fi
// shows its screen here: the Android side (Connect.java) finds it, checks the
// code and hands over its WebRTC offer; this page answers it and shows the
// picture with its sound full screen. Back on the remote stops it.
//
// Events from Connect.java come as on('connect', {t, …}):
//   {t:'code', code, name}       a new computer: show the code to type there
//   {t:'nocode'}                 too many wrong tries: the code is gone
//   {t:'offer', sid, sdp, ip, name}  the picture is coming: answer it
//   {t:'bye'}                    the computer stopped

import { tv, on } from './tv.js';
import * as layers from './layers.js';
import * as look from './look.js';
import { unhideCandidates, countCandidates } from '../../src/connect.js';

const $ = (id) => document.getElementById(id);
const root = $('cast');
const video = $('castVideo');
const card = $('castCard');
const note = $('castNote');

let pc = null;
let ctl = null;
let sid = 0;
let who = '';
let mode = 'off'; // off | code | wait | live
let lostTimer = 0;
let noteTimer = 0;
let hooks = { before() {}, after() {} };

export const active = () => mode !== 'off';
export const live = () => mode === 'live' || mode === 'wait';

const layer = {
  el: root,
  dim: false,
  key: () => true, // the arrows do nothing here
  ok() {
    if (mode === 'live') hint(`Экран «${who}» · Назад — остановить`, 3000);
  },
  back() {
    end('back');
  },
  onClose() {
    // closed from outside (the Home button): stop as if Back was pressed
    if (mode !== 'off') end('back', true);
  },
};

export function init(h) {
  hooks = { ...hooks, ...h };
  on('connect', handle);
  // events that came while an app was in front
  pending();
  on('visible', (v) => v && pending());
}

function pending() {
  const list = tv.connectPending();
  for (const e of list) handle(e);
}

function handle(e) {
  if (!e || !e.t) return;
  if (e.t === 'code') showCode(e);
  else if (e.t === 'nocode') {
    if (mode === 'code') {
      setCard('Код больше не действует', 'Слишком много неверных попыток. Начни заново на компьютере', '');
      setTimeout(() => mode === 'code' && end('quiet'), 4000);
    }
  } else if (e.t === 'offer') answer(e);
  else if (e.t === 'bye') {
    if (mode !== 'off') end('remote');
  }
}

// ---------- the screen ----------

function open() {
  if (!layers.isOpen(layer)) {
    hooks.before();
    layers.push(layer);
  }
  root.classList.remove('hidden');
}

function setCard(title, text, code) {
  card.textContent = '';
  const mark = document.createElement('span');
  mark.className = 'cast-ic';
  mark.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 3H3a2 2 0 0 0-2 2v3h2V5h18v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM1 18v3h3a3 3 0 0 0-3-3zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7zm0-4v2a9 9 0 0 1 9 9h2A11 11 0 0 0 1 10z"/></svg>';
  const h = document.createElement('h1');
  h.textContent = title;
  card.append(mark, h);
  if (text) {
    const p = document.createElement('p');
    p.textContent = text;
    card.appendChild(p);
  }
  if (code) {
    const c = document.createElement('div');
    c.className = 'cast-code';
    for (const d of String(code)) {
      const b = document.createElement('b');
      b.textContent = d;
      c.appendChild(b);
    }
    card.appendChild(c);
    const p = document.createElement('p');
    p.className = 'cast-hint';
    p.textContent = 'Введи этот код на компьютере';
    card.appendChild(p);
  }
  const back = document.createElement('p');
  back.className = 'cast-back';
  back.textContent = 'Назад — отменить';
  card.appendChild(back);
  card.classList.remove('hidden');
}

function hint(text, ms) {
  note.textContent = text;
  note.classList.add('on');
  clearTimeout(noteTimer);
  if (ms) noteTimer = setTimeout(() => note.classList.remove('on'), ms);
}

function showCode(e) {
  // a picture already on the screen stays; the code waits in the corner
  if (mode === 'live') {
    hint(`«${e.name}» хочет показать экран. Код: ${e.code}`, 15000);
    return;
  }
  who = e.name || 'Компьютер';
  mode = 'code';
  open();
  document.body.classList.remove('casting');
  setCard('Приём экрана', `«${who}» хочет показать свой экран на телевизоре`, e.code);
  tv.log('connect: показан код для «' + who + '»');
}

// ---------- the picture ----------

function stopPc() {
  clearTimeout(lostTimer);
  if (ctl) {
    try {
      ctl.close();
    } catch (er) {}
    ctl = null;
  }
  if (pc) {
    try {
      pc.close();
    } catch (er) {}
    pc = null;
  }
  try {
    video.pause();
  } catch (er) {}
  video.srcObject = null;
}

async function answer(e) {
  stopPc();
  sid = e.sid;
  who = e.name || 'Компьютер';
  mode = 'wait';
  open();
  setCard('Подключаюсь…', `Экран «${who}»`, '');
  const my = sid;
  try {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('nowebrtc');
    // the home network only: no outside servers to learn addresses from
    const p = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    pc = p;
    p.ontrack = (ev) => {
      // as little waiting as the network allows: the picture, not smoothness
      try {
        ev.receiver.playoutDelayHint = 0;
      } catch (er) {}
      try {
        ev.receiver.jitterBufferTarget = 0;
      } catch (er) {}
      const s = (ev.streams && ev.streams[0]) || null;
      if (s) {
        if (video.srcObject !== s) video.srcObject = s;
      } else {
        const ms = video.srcObject || new MediaStream();
        ms.addTrack(ev.track);
        video.srcObject = ms;
      }
      const pl = video.play();
      // (both tracks call play(); a stop in between interrupts it — not a problem)
      if (pl && pl.catch) pl.catch((er) => er && er.name !== 'AbortError' && tv.log('connect: видео не играет: ' + er.message));
    };
    p.ondatachannel = (ev) => {
      ctl = ev.channel;
      ctl.onmessage = (m) => {
        let msg = null;
        try {
          msg = JSON.parse(m.data);
        } catch (er) {}
        if (msg && msg.t === 'bye' && pc === p) end('remote');
      };
    };
    const watch = () => {
      if (pc !== p) return;
      const st = p.connectionState || p.iceConnectionState;
      if (st === 'connected' || st === 'completed') {
        clearTimeout(lostTimer);
        if (mode !== 'live') goLive(p);
      } else if (st === 'failed' || st === 'closed') end('lost');
      else if (st === 'disconnected') {
        // Wi-Fi hiccups: give it a few seconds
        clearTimeout(lostTimer);
        lostTimer = setTimeout(() => pc === p && end('lost'), 6000);
      }
    };
    p.oniceconnectionstatechange = watch;
    p.onconnectionstatechange = watch;

    await p.setRemoteDescription({ type: 'offer', sdp: unhideCandidates(e.sdp, e.ip) });
    const a = await p.createAnswer();
    await p.setLocalDescription(a);
    await gathered(p, 2000);
    if (pc !== p || sid !== my) return;
    const sdp = p.localDescription.sdp;
    tv.log(`connect: ответ «${who}», адресов: ${countCandidates(sdp)}`);
    tv.connectAnswer(my, sdp);
    // nothing came: the computer couldn't reach us
    lostTimer = setTimeout(() => pc === p && mode === 'wait' && end('lost'), 15000);
  } catch (er) {
    tv.log('connect: не принял картинку: ' + (er && er.message));
    tv.connectFail(my, 'webrtc');
    if (sid === my) end('fail');
  }
}

// the answer goes with every address in it (no trickle: one request, one reply)
function gathered(p, ms) {
  return new Promise((res) => {
    if (p.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, ms);
    p.addEventListener('icegatheringstatechange', () => {
      if (p.iceGatheringState === 'complete') {
        clearTimeout(t);
        res();
      }
    });
  });
}

function goLive(p) {
  mode = 'live';
  card.classList.add('hidden');
  document.body.classList.add('casting');
  look.setWaveState({ cast: true });
  tv.keepAwake(true);
  hint(`Экран «${who}» · Назад — остановить`, 3500);
  tv.log('connect: картинка идёт');
  hooks.after(true);
  // what the box decodes with, for the log (hardware or not, delay)
  setTimeout(() => report(p), 6000);
}

function report(p) {
  if (pc !== p || !p.getStats) return;
  p.getStats()
    .then((stats) => {
      const out = [];
      const codecs = {};
      stats.forEach((s) => {
        if (s.type === 'codec') codecs[s.id] = s.mimeType;
      });
      stats.forEach((s) => {
        if (s.type !== 'inbound-rtp' || (s.kind || s.mediaType) !== 'video') return;
        out.push(`${codecs[s.codecId] || '?'} ${s.frameWidth || '?'}×${s.frameHeight || '?'} ${Math.round(s.framesPerSecond || 0)} к/с`);
        if (s.decoderImplementation) out.push('декодер ' + s.decoderImplementation);
        if (s.jitterBufferDelay && s.jitterBufferEmittedCount) out.push(`буфер ${Math.round((s.jitterBufferDelay / s.jitterBufferEmittedCount) * 1000)} мс`);
        if (s.framesDropped) out.push(`пропущено кадров ${s.framesDropped}`);
      });
      stats.forEach((s) => {
        if (s.type === 'inbound-rtp' && (s.kind || s.mediaType) === 'audio') out.push(`звук ${codecs[s.codecId] || '?'}, пакетов ${s.packetsReceived || 0}`);
        if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime != null) out.push(`сеть ${Math.round(s.currentRoundTripTime * 1000)} мс`);
      });
      tv.log('connect: ' + out.join(', '));
    })
    .catch(() => {});
}

// why: back (Back on the remote) | remote (the computer stopped) | lost | fail | quiet
function end(why, closing) {
  const was = mode;
  if (why === 'back' && ctl && ctl.readyState === 'open') {
    try {
      ctl.send(JSON.stringify({ t: 'bye' }));
    } catch (er) {}
  }
  if (was === 'code' && why === 'back') tv.connectCancel();
  stopPc();
  mode = 'off';
  document.body.classList.remove('casting');
  look.setWaveState({ cast: false });
  tv.log('connect: конец (' + why + ')');
  const msg = why === 'lost' ? 'Связь с компьютером пропала' : why === 'fail' ? 'Не получилось принять экран' : why === 'remote' && was === 'live' ? `«${who}» закончил показ` : '';
  if (!closing && layers.isOpen(layer)) layers.pop(layer);
  root.classList.add('hidden');
  hooks.after(false, msg);
}
