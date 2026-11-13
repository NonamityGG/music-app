// Резонанс для ПК — «На телевизор» (Резонанс Connect): the screen and the sound
// of this PC on a TV with Резонанс OS, over the home Wi-Fi.
//
// 1. the main process looks for TVs (mDNS + a broadcast question) — the list;
// 2. a TV this PC doesn't know shows a 4-digit code; it is typed here;
// 3. the screen (and the sound the PC plays, by loopback) is captured, a WebRTC
//    offer with every address in it goes to the TV over HTTP, the TV's answer
//    comes back in the same request — then the picture goes straight to the
//    TV, nothing in between and nothing outside the home network;
// 4. while it goes, this window is a pill in the corner with «Остановить».

import { h, clear } from '../../src/util.js';
import { preferCodecs, unhideCandidates, fitSize, errorText, cleanCode, opusStereo, startBitrate, countCandidates } from '../../src/connect.js';

const $ = (id) => document.getElementById(id);
const body = document.body;

const ICON = {
  cast: 'M21 3H3a2 2 0 0 0-2 2v3h2V5h18v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM1 18v3h3a3 3 0 0 0-3-3zm0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7zm0-4v2a9 9 0 0 1 9 9h2A11 11 0 0 0 1 10z',
  tv: 'M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z',
};

function svg(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICON[name] || '');
  p.setAttribute('fill', 'currentColor');
  s.appendChild(p);
  return s;
}

$('hIc').appendChild(svg('cast'));
$('close').appendChild(svg('close'));

const cast = (cmd, arg) => window.rez.cast(cmd, arg);

let tvs = [];
let displays = [];
let displayId = null;
let mute = true;
let chosen = null; // the TV
let pc = null;
let ctl = null;
let stream = null;
let live = false;
let attempt = 0;
let finding = false;

// ---------- views ----------

function view(name) {
  for (const v of ['vList', 'vCode', 'vWait']) $(v).classList.toggle('hidden', v !== name);
  if (name === 'vCode') setTimeout(() => $('code').focus(), 30);
}

function status(text, spinning) {
  const s = clear($('status'));
  if (spinning) s.appendChild(h('span', { class: 'mini' }));
  s.appendChild(h('span', null, text));
}

function renderTvs() {
  const box = clear($('tvs'));
  for (const t of tvs) {
    box.appendChild(
      h(
        'button',
        { class: 'tv', onclick: () => choose(t), title: t.ip },
        h('span', { class: 'tv-ic' }, svg('tv')),
        h('div', { class: 'tv-t' }, h('div', { class: 'tv-n' }, t.name || 'Резонанс OS'), h('div', { class: 'tv-s' }, t.ip)),
        t.known ? h('span', { class: 'tag' }, 'без кода') : null
      )
    );
  }
}

function renderOpts() {
  const box = clear($('opts'));
  if (displays.length > 1) {
    const seg = h('div', { class: 'seg' });
    displays.forEach((d, i) => {
      seg.appendChild(
        h(
          'button',
          {
            class: d.id === displayId ? 'on' : '',
            title: `${d.w}×${d.h}`,
            onclick: () => {
              displayId = d.id;
              renderOpts();
            },
          },
          d.primary ? 'Основной' : `Экран ${i + 1}`
        )
      );
    });
    box.appendChild(h('div', { class: 'opt' }, h('div', { class: 'opt-t' }, 'Какой экран'), seg));
  }
  box.appendChild(
    h(
      'button',
      {
        class: 'opt',
        onclick: () => {
          mute = !mute;
          renderOpts();
        },
      },
      h('div', { class: 'opt-t' }, 'Звук только на телевизоре', h('small', null, mute ? 'Компьютер молчит, пока идёт показ' : 'Звук и здесь, и на телевизоре')),
      h('span', { class: 'sw' + (mute ? ' on' : '') })
    )
  );
}

function addTv(t) {
  if (!t || !t.ip) return;
  const i = tvs.findIndex((x) => (t.id && x.id === t.id) || x.ip === t.ip);
  if (i >= 0) tvs[i] = { ...tvs[i], ...t };
  else tvs.push(t);
  renderTvs();
}

async function find() {
  if (finding) return;
  finding = true;
  view('vList');
  status('Ищу телевизоры с Резонанс OS…', true);
  try {
    const r = await cast('find', { ms: 2500 });
    for (const t of r.tvs || []) addTv(t);
    displays = r.displays || [];
    if (displayId == null || !displays.some((d) => d.id === displayId)) displayId = (displays.find((d) => d.primary) || displays[0] || {}).id;
    if (typeof r.mute === 'boolean') mute = r.mute;
    renderOpts();
    if (tvs.length) status(tvs.length === 1 ? 'Нашёл телевизор — нажми на него' : `Нашёл телевизоров: ${tvs.length}`);
    else {
      status('Не нашёл. Резонанс OS включён и в той же сети? Можно ввести адрес — он в настройках Резонанс OS, «Приём экрана»');
      $('manual').classList.remove('hidden');
    }
  } catch (e) {
    status('Не получилось поискать: ' + e.message);
  } finally {
    finding = false;
  }
}

$('again').addEventListener('click', find);
$('byIp').addEventListener('click', () => {
  $('manual').classList.toggle('hidden');
  if (!$('manual').classList.contains('hidden')) $('ip').focus();
});
async function byIp() {
  const ip = $('ip').value.trim();
  if (!ip) return;
  status('Спрашиваю ' + ip + '…', true);
  const r = await cast('byIp', { ip });
  if (r.error) return status(r.error === 'lan' ? 'Это не адрес домашней сети' : errorText(r.error));
  addTv(r.tv);
  status('Есть — нажми на телевизор');
}
$('ipGo').addEventListener('click', byIp);
$('ip').addEventListener('keydown', (e) => e.key === 'Enter' && byIp());
$('close').addEventListener('click', () => cast('close'));

// ---------- the code ----------

const codeIn = $('code');
const cells = Array.from($('codeBox').querySelectorAll('span'));
function paintCode() {
  const v = cleanCode(codeIn.value);
  if (v !== codeIn.value) codeIn.value = v;
  cells.forEach((c, i) => {
    c.textContent = v[i] || '';
    c.classList.toggle('full', !!v[i]);
    c.classList.toggle('cur', i === v.length && document.activeElement === codeIn);
  });
}
codeIn.addEventListener('input', () => {
  $('codeBox').classList.remove('bad');
  $('codeErr').textContent = '';
  paintCode();
  if (codeIn.value.length === 4) start(chosen, codeIn.value);
});
codeIn.addEventListener('focus', paintCode);
codeIn.addEventListener('blur', paintCode);
$('codeBack').addEventListener('click', () => {
  view('vList');
  renderTvs();
});

function askCode(t, err) {
  view('vCode');
  $('codeFor').textContent = `Его показывает «${t.name}»`;
  codeIn.value = '';
  paintCode();
  if (err) {
    $('codeErr').textContent = err;
    $('codeBox').classList.add('bad');
  }
}

async function choose(t) {
  chosen = t;
  view('vWait');
  $('waitText').textContent = `Спрашиваю «${t.name}»…`;
  const r = await cast('hello', { tv: t });
  if (chosen !== t) return;
  if (r.error) {
    view('vList');
    return status(errorText(r.error));
  }
  if (r.paired) start(t, null);
  else askCode(t);
}

// ---------- the picture ----------

function cleanup() {
  live = false;
  if (ctl) {
    try {
      ctl.close();
    } catch {}
    ctl = null;
  }
  if (pc) {
    try {
      pc.close();
    } catch {}
    pc = null;
  }
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
}

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

async function capture(size) {
  const video = { width: { max: size.w }, height: { max: size.h }, frameRate: { ideal: 30, max: 30 } };
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
  } catch (e) {
    // no sound to capture (no output device): the picture alone
    window.rez.log('трансляция: без звука: ' + e.message);
    return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  }
}

async function start(t, code) {
  const my = ++attempt;
  cleanup();
  view('vWait');
  $('waitText').textContent = `Подключаюсь к «${t.name}»…`;
  try {
    const prep = await cast('prepare', { displayId, mute });
    const d = prep.display || { w: 1920, h: 1080 };
    const size = fitSize(d.w, d.h, t.w, t.h);
    stream = await capture(size);
    if (my !== attempt) return cleanup();
    const vt = stream.getVideoTracks()[0];
    if (vt) {
      // films and games: smooth motion matters more than sharp still text
      vt.contentHint = 'motion';
      vt.addEventListener('ended', () => stop('ended'));
    }

    const p = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    pc = p;
    ctl = p.createDataChannel('ctl', { ordered: true });
    ctl.onmessage = (m) => {
      let msg = null;
      try {
        msg = JSON.parse(m.data);
      } catch {}
      if (msg && msg.t === 'bye' && pc === p) stop('remote');
    };
    for (const tr of stream.getTracks()) p.addTrack(tr, stream);
    // H.264 first: TV boxes decode it in hardware
    for (const tc of p.getTransceivers()) {
      if (!tc.sender.track || tc.sender.track.kind !== 'video' || !tc.setCodecPreferences) continue;
      try {
        const caps = RTCRtpReceiver.getCapabilities('video');
        if (caps) tc.setCodecPreferences(preferCodecs(caps.codecs));
      } catch (e) {
        window.rez.log('трансляция: порядок кодеков: ' + e.message);
      }
    }

    await p.setLocalDescription(await p.createOffer());
    await gathered(p, 2000);
    if (my !== attempt) return cleanup();
    const offer = p.localDescription.sdp;
    const r = await cast('offer', { tv: t, sdp: offer, code });
    if (my !== attempt) return cleanup();
    if (r.error) {
      cleanup();
      if (r.error === 'code' || r.error === 'expired' || r.error === 'pair') {
        if (r.error === 'expired' || r.error === 'pair') {
          // a new code on the TV
          const again = await cast('hello', { tv: t });
          if (again.error) return failed(errorText(again.error));
        }
        return askCode(t, errorText(r.error));
      }
      return failed(errorText(r.error));
    }
    await p.setRemoteDescription({ type: 'answer', sdp: startBitrate(opusStereo(unhideCandidates(r.sdp, t.ip))) });
    if (!countCandidates(r.sdp)) window.rez.log('трансляция: в ответе телевизора нет адресов — жду его сам');

    // a clear picture on the home network; under load keep the motion smooth
    for (const s of p.getSenders()) {
      if (!s.track) continue;
      try {
        const prm = s.getParameters();
        if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
        if (s.track.kind === 'video') {
          prm.encodings[0].maxBitrate = 12000000;
          prm.encodings[0].maxFramerate = 30;
          prm.degradationPreference = 'maintain-framerate';
        } else {
          prm.encodings[0].maxBitrate = 192000;
        }
        await s.setParameters(prm);
      } catch (e) {
        window.rez.log('трансляция: параметры: ' + e.message);
      }
    }

    const until = setTimeout(() => pc === p && !live && (cleanup(), failed('Телевизор не принял картинку — проверь, что оба в одной сети')), 15000);
    const watch = () => {
      if (pc !== p) return;
      const st = p.connectionState;
      if (st === 'connected' && !live) {
        clearTimeout(until);
        goLive(t, p);
      } else if (st === 'failed') {
        clearTimeout(until);
        if (live) stop('lost');
        else {
          cleanup();
          failed('Не получилось связаться с телевизором напрямую');
        }
      } else if (st === 'disconnected' && live) {
        setTimeout(() => pc === p && p.connectionState === 'disconnected' && stop('lost'), 6000);
      }
    };
    p.addEventListener('connectionstatechange', watch);
    // on a fast home network it may be connected already
    watch();
  } catch (e) {
    window.rez.log('трансляция: ' + (e && e.message));
    cleanup();
    if (my === attempt) failed('Не получилось снять экран: ' + (e && e.message));
  }
}

function failed(text) {
  view('vList');
  renderTvs();
  status(text);
}

function goLive(t, p) {
  live = true;
  body.classList.add('live');
  $('pick').classList.add('hidden');
  $('pill').classList.remove('hidden');
  $('pillTv').textContent = t.name;
  cast('live', { tv: t });
  setTimeout(() => report(p), 5000);
}

// what goes out, for the log: codec, encoder, size, frames, network
function report(p) {
  if (pc !== p) return;
  p.getStats()
    .then((stats) => {
      const codecs = {};
      const out = [];
      stats.forEach((s) => s.type === 'codec' && (codecs[s.id] = s.mimeType));
      stats.forEach((s) => {
        if (s.type === 'outbound-rtp' && s.kind === 'video') {
          out.push(`${codecs[s.codecId] || '?'} ${s.frameWidth}×${s.frameHeight} ${Math.round(s.framesPerSecond || 0)} к/с`);
          if (s.encoderImplementation) out.push('кодер ' + s.encoderImplementation);
          if (s.qualityLimitationReason && s.qualityLimitationReason !== 'none') out.push('упирается в ' + s.qualityLimitationReason);
        }
        if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime != null) out.push(`сеть ${Math.round(s.currentRoundTripTime * 1000)} мс`);
        if (s.type === 'candidate-pair' && s.nominated && s.availableOutgoingBitrate) out.push(`канал ${(s.availableOutgoingBitrate / 1e6).toFixed(1)} Мбит/с`);
      });
      cast('stats', { text: out.join(', ') });
    })
    .catch(() => {});
}

// why: button | remote (the TV said bye) | lost | ended (the screen went away) | main
function stop(why) {
  attempt++;
  if (ctl && ctl.readyState === 'open' && why !== 'remote') {
    try {
      ctl.send(JSON.stringify({ t: 'bye' }));
    } catch {}
  }
  const wasLive = live;
  cleanup();
  body.classList.remove('live');
  $('pill').classList.add('hidden');
  $('pick').classList.remove('hidden');
  if (wasLive || why === 'main' || why === 'button') cast('stopped', { why });
}

$('stop').addEventListener('click', () => stop('button'));

// ---------- from the main process ----------

function colors(s) {
  const c = (s && s.paletteColors) || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  body.style.setProperty('--acc', c[0]);
  body.style.setProperty('--acc3', c[1]);
  body.style.setProperty('--acc2', c[2]);
}

window.rez.onCast((m) => {
  if (!m) return;
  if (m.cmd === 'pick') {
    window.rez.settings().then(colors);
    if (live) return;
    $('manual').classList.add('hidden');
    tvs = tvs.filter((t) => t.known);
    renderTvs();
    find();
  } else if (m.cmd === 'stop') stop('main');
  else if (m.cmd === 'hidden') {
    // the list closed while asking: forget that attempt (unless the picture goes)
    if (!live) {
      attempt++;
      chosen = null;
      cleanup();
    }
  }
});
window.rez.onSettings(colors);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !live) cast('close');
});
