// Резонанс Connect: the small pure pieces both ends share — the PC that shows
// its screen (desktop/web/cast.js) and the TV that receives it
// (tv/web/connect.js). No DOM, no WebRTC objects: easy to test.

export const PORT = 48230; // the TV's HTTP server
export const FIND_PORT = 48231; // the TV answers "REZCONNECT?" here
export const SERVICE = '_rezonans-connect._tcp.local';

/** Is this IPv4 address on a home network (private / link-local / this machine)? */
export function isLanIp(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((x) => x > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127;
}

/** A 4-digit code as typed by a person: digits only, at most 4. */
export function cleanCode(s) {
  return String(s || '')
    .replace(/\D+/g, '')
    .slice(0, 4);
}

/**
 * Browsers hide their own address in WebRTC behind a random "….local" name.
 * On the home network we know the other side's real address (we just talked
 * to it over HTTP), so such candidates get that address instead — no mDNS
 * lookups needed on an old TV box.
 */
export function unhideCandidates(sdp, ip) {
  if (!sdp || !isLanIp(ip)) return sdp;
  return String(sdp).replace(/^(a=candidate:\S+ \d+ \S+ \d+ )([0-9a-f-]+\.local)( )/gim, (all, a, host, b) => a + ip + b);
}

/**
 * Stereo music, not a phone call: the receiver's answer asks for stereo Opus
 * at a good bitrate (a browser answers mono unless told). Applied to the TV's
 * answer before the PC takes it.
 */
export function opusStereo(sdp, kbps = 192) {
  const s = String(sdp || '');
  const m = /^a=rtpmap:(\d+) opus\/48000\/2\r?$/im.exec(s);
  if (!m) return s;
  const pt = m[1];
  const want = { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: String(kbps * 1000) };
  const re = new RegExp(`^a=fmtp:${pt} (.*?)(\\r?)$`, 'm');
  if (re.test(s)) {
    return s.replace(re, (all, params, cr) => {
      const kept = params.split(';').filter((p) => p && !(p.split('=')[0].trim() in want));
      return `a=fmtp:${pt} ${kept.concat(Object.entries(want).map(([k, v]) => `${k}=${v}`)).join(';')}${cr}`;
    });
  }
  const line = new RegExp(`^(a=rtpmap:${pt} opus/48000/2)(\\r?)$`, 'im');
  return s.replace(line, (all, a, cr) => `${a}${cr}\na=fmtp:${pt} ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';')}${cr}`);
}

/**
 * A browser starts a video call at a few hundred kbit/s and climbs for many
 * seconds (a blurry, small picture at first). On the home network the picture
 * can start sharp: the answer tells the sending browser where to start
 * (Chromium's x-google-*-bitrate, in kbit/s) for every video codec.
 */
export function startBitrate(sdp, start = 6000, min = 1500, max = 12000) {
  const s = String(sdp || '');
  const video = new Set();
  let inVideo = false;
  for (const line of s.split(/\r?\n/)) {
    if (line.startsWith('m=')) inVideo = line.startsWith('m=video');
    const m = inVideo && /^a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\//i.exec(line);
    if (m) video.add(m[1]);
  }
  if (!video.size) return s;
  const want = { 'x-google-start-bitrate': start, 'x-google-min-bitrate': min, 'x-google-max-bitrate': max };
  return s.replace(/^a=fmtp:(\d+) (.*?)(\r?)$/gm, (all, pt, params, cr) => {
    if (!video.has(pt)) return all;
    const kept = params.split(';').filter((p) => p && !(p.split('=')[0].trim() in want));
    return `a=fmtp:${pt} ${kept.concat(Object.entries(want).map(([k, v]) => `${k}=${v}`)).join(';')}${cr}`;
  });
}

/** How many usable ICE candidates an SDP carries (0: the other side can't reach us). */
export function countCandidates(sdp) {
  return (String(sdp || '').match(/^a=candidate:/gm) || []).length;
}

/**
 * Codecs in the order we want them: H.264 first (TV boxes decode it in
 * hardware), the constrained baseline profile with packetization-mode=1 before
 * others (every hardware decoder takes it), then VP8, then the rest as they
 * were. `codecs` are RTCRtpCodecCapability-like objects {mimeType, sdpFmtpLine}.
 */
export function preferCodecs(codecs, order = ['video/H264', 'video/VP8']) {
  const list = Array.isArray(codecs) ? codecs.slice() : [];
  const rank = (c) => {
    const mime = String(c.mimeType || '').toLowerCase();
    const i = order.findIndex((o) => o.toLowerCase() === mime);
    if (i < 0) return 1000;
    let r = i * 10;
    if (mime === 'video/h264') {
      const f = String(c.sdpFmtpLine || '');
      if (!/packetization-mode=1/.test(f)) r += 4;
      if (!/profile-level-id=42e0/i.test(f)) r += 2;
    }
    return r;
  };
  return list.map((c, i) => ({ c, i, r: rank(c) })).sort((x, y) => x.r - y.r || x.i - y.i).map((x) => x.c);
}

/**
 * How the picture goes, chosen on the PC and the phone. A TV box's Wi-Fi takes
 * a few Mbit/s without queueing, so the choice is what gives way when that is
 * not enough: "smooth" keeps the frames (a smaller picture), the "sharp" ones
 * keep the picture (fewer frames — for text and windows). Bitrates in kbit/s.
 */
export const QUALITY = [
  { id: 'smooth', name: 'Плавно', sub: '720p — видео и игры, меньше задержка', w: 1280, h: 720, hint: 'motion', keep: 'maintain-framerate', start: 3000, min: 1500, max: 4500 },
  { id: 'balanced', name: 'Баланс', sub: '1080p — уступают и кадры, и чёткость', w: 1920, h: 1080, hint: '', keep: 'balanced', start: 3000, min: 1500, max: 6000 },
  { id: 'sharp', name: 'Чётко', sub: '1080p — текст читается, кадров меньше под нагрузкой', w: 1920, h: 1080, hint: 'detail', keep: 'maintain-resolution', start: 3000, min: 1500, max: 6000 },
  { id: 'sharp1440', name: '1440p', sub: 'Чётко, 2560×1440 — экраны 2K', w: 2560, h: 1440, hint: 'detail', keep: 'maintain-resolution', start: 4000, min: 2000, max: 10000 },
  { id: 'sharp4k', name: '4K', sub: 'Чётко, до 3840×2160 — если приставка тянет 4K', w: 3840, h: 2160, hint: 'detail', keep: 'maintain-resolution', start: 5000, min: 2500, max: 16000 },
];

/** A preset by id (or the fallback's, or "smooth"). */
export function quality(id, fallback = 'smooth') {
  return QUALITY.find((q) => q.id === id) || QUALITY.find((q) => q.id === fallback) || QUALITY[0];
}

/**
 * The size to capture: the screen's, no bigger than the preset (capW×capH,
 * 1080p by default) — and up to 1080p no bigger than the TV says it shows
 * (above that the TV's own report is a 1080p output mode, not its panel).
 */
export function fitSize(screenW, screenH, tvW, tvH, capW = 1920, capH = 1080) {
  const maxW = capW > 1920 ? capW : Math.min(capW, tvW > 0 ? tvW : capW);
  const maxH = capH > 1080 ? capH : Math.min(capH, tvH > 0 ? tvH : capH);
  const k = Math.min(1, maxW / screenW, maxH / screenH);
  // even numbers: encoders want them
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  return { w: even(screenW * k), h: even(screenH * k) };
}

/** What the TV said, in words for the person at the PC. */
export function errorText(code) {
  switch (code) {
    case 'code':
      return 'Неверный код — посмотри на экран телевизора';
    case 'expired':
      return 'Код устарел — попробуй ещё раз, телевизор покажет новый';
    case 'pair':
      return 'Телевизор не узнал этот компьютер — нужен код';
    case 'timeout':
      return 'Телевизор не ответил — он включён?';
    case 'replaced':
      return 'Телевизор принял другой экран';
    case 'busy':
      return 'Телевизор сейчас занят';
    case 'net':
      return 'Нет связи с телевизором — он в той же сети?';
    case 'webrtc':
      return 'Телевизор не смог принять картинку';
    default:
      return 'Не получилось: ' + (code || 'неизвестная ошибка');
  }
}
