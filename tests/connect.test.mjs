// Резонанс Connect: the parts that need no TV — addresses, codecs, SDP fixes,
// the mDNS answers and the broadcast replies the PC reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as shared from '../src/connect.js';

const require = createRequire(import.meta.url);
const net = require('../desktop/lib/connect.js');

test('only home-network addresses count', () => {
  for (const f of [shared.isLanIp, net.isLanIp]) {
    for (const ip of ['192.168.1.40', '10.0.0.7', '172.16.5.1', '172.31.255.254', '169.254.10.2', '127.0.0.1']) assert.equal(f(ip), true, ip);
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '256.1.1.1', '192.168.1', '', null, 'tv.local', '::1']) assert.equal(f(ip), false, String(ip));
  }
});

test('a typed code keeps 4 digits only', () => {
  assert.equal(shared.cleanCode(' 12-34 5'), '1234');
  assert.equal(shared.cleanCode('ab'), '');
  assert.equal(shared.cleanCode(null), '');
});

const SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=candidate:1 1 udp 2122260223 4b1e2a7c-1111-2222-3333-444455556666.local 54321 typ host generation 0',
  'a=candidate:2 1 udp 2122194687 192.168.1.20 54322 typ host generation 0',
  '',
].join('\r\n');

test('hidden .local addresses become the address we know', () => {
  const out = shared.unhideCandidates(SDP, '192.168.1.40');
  assert.match(out, /a=candidate:1 1 udp 2122260223 192\.168\.1\.40 54321 typ host/);
  assert.match(out, /a=candidate:2 1 udp 2122194687 192\.168\.1\.20 54322/);
  assert.equal(shared.unhideCandidates(SDP, '8.8.8.8'), SDP, 'never an outside address');
  assert.equal(shared.countCandidates(out), 2);
  assert.equal(shared.countCandidates('v=0\r\n'), 0);
});

test('opus is asked for in stereo', () => {
  const out = shared.opusStereo(SDP);
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=192000\r\n/);
  // twice is the same as once
  assert.equal(shared.opusStereo(out), out);
  // no fmtp line: one is added after the rtpmap
  const bare = SDP.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
  assert.match(shared.opusStereo(bare), /a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=192000\r\n/);
  assert.equal(shared.opusStereo('v=0\r\n'), 'v=0\r\n');
});

test('H.264 for the TV first, the baseline profile before others, then VP8', () => {
  const codecs = [
    { mimeType: 'video/VP8' },
    { mimeType: 'video/rtx', sdpFmtpLine: 'apt=96' },
    { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f' },
    { mimeType: 'video/VP9', sdpFmtpLine: 'profile-id=0' },
    { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f' },
    { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
    { mimeType: 'video/AV1' },
  ];
  const out = shared.preferCodecs(codecs).map((c) => c.mimeType + ' ' + (c.sdpFmtpLine || ''));
  assert.deepEqual(out.slice(0, 4), [
    'video/H264 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
    'video/H264 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f',
    'video/H264 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f',
    'video/VP8 ',
  ]);
  // nothing dropped, the rest keep their order
  assert.equal(out.length, codecs.length);
  assert.deepEqual(out.slice(4), ['video/rtx apt=96', 'video/VP9 profile-id=0', 'video/AV1 ']);
  assert.deepEqual(shared.preferCodecs(null), []);
});

test('the capture fits the TV, 1080p at most, even sizes', () => {
  assert.deepEqual(shared.fitSize(2560, 1440, 1920, 1080), { w: 1920, h: 1080 });
  assert.deepEqual(shared.fitSize(1920, 1080, 1280, 720), { w: 1280, h: 720 });
  assert.deepEqual(shared.fitSize(1366, 768, 3840, 2160), { w: 1366, h: 768 });
  assert.deepEqual(shared.fitSize(3440, 1440, 0, 0), { w: 1920, h: 804 });
  assert.deepEqual(shared.fitSize(1280, 1024, 1920, 1080), { w: 1280, h: 1024 });
});

test('every TV error has words for a person', () => {
  for (const c of ['code', 'expired', 'pair', 'timeout', 'replaced', 'busy', 'net', 'webrtc']) assert.doesNotMatch(shared.errorText(c), /^Не получилось: /);
  assert.match(shared.errorText('weird'), /weird/);
});

// ---------- mDNS ----------

// a DNS answer as Android's NSD would send it (with name compression)
function answer({ instance, ip, port, id }) {
  const parts = [];
  const names = new Map();
  let size = 12;
  const name = (n) => {
    const out = [];
    const labels = n.split('.');
    for (let i = 0; i < labels.length; i++) {
      const rest = labels.slice(i).join('.');
      if (names.has(rest)) {
        out.push(Buffer.from([0xc0 | (names.get(rest) >> 8), names.get(rest) & 0xff]));
        return Buffer.concat(out);
      }
      names.set(rest, size + Buffer.concat(out).length);
      const b = Buffer.from(labels[i]);
      out.push(Buffer.from([b.length]), b);
    }
    out.push(Buffer.from([0]));
    return Buffer.concat(out);
  };
  const rr = (n, type, data) => {
    const nb = name(n);
    size += nb.length + 10;
    const dataBuf = typeof data === 'function' ? data() : data;
    const h = Buffer.alloc(10);
    h.writeUInt16BE(type, 0);
    h.writeUInt16BE(0x8001, 2);
    h.writeUInt32BE(120, 4);
    h.writeUInt16BE(dataBuf.length, 8);
    size += dataBuf.length;
    parts.push(nb, h, dataBuf);
  };
  const svc = '_rezonans-connect._tcp.local';
  const full = `${instance}.${svc}`;
  rr(svc, 12, () => name(full));
  rr(full, 33, () => {
    const h = Buffer.alloc(6);
    h.writeUInt16BE(0, 0);
    h.writeUInt16BE(0, 2);
    h.writeUInt16BE(port, 4);
    // the target name starts after priority, weight and port
    size += 6;
    const target = name('Android-7.local');
    size -= 6;
    return Buffer.concat([h, target]);
  });
  rr(full, 16, () => {
    const out = [];
    for (const s of [`id=${id}`, 'proto=1']) out.push(Buffer.from([Buffer.byteLength(s)]), Buffer.from(s));
    return Buffer.concat(out);
  });
  rr('Android-7.local', 1, () => Buffer.from(ip.split('.').map(Number)));
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(1, 6);
  head.writeUInt16BE(3, 10);
  return Buffer.concat([head, ...parts]);
}

test('the mDNS question is a well-formed PTR query', () => {
  const q = net.encodeQuery(net.SERVICE);
  assert.equal(q.readUInt16BE(4), 1);
  assert.equal(q.readUInt16BE(q.length - 4), 12);
  assert.equal(q.readUInt16BE(q.length - 2), 0x8001);
  assert.ok(q.includes(Buffer.from('_rezonans-connect')));
  assert.throws(() => net.encodeName('x'.repeat(64) + '.local'));
});

test('a TV is read from an mDNS answer', () => {
  const msg = answer({ instance: 'Резонанс OS · SberBox', ip: '192.168.1.40', port: 48230, id: 'abc-123' });
  const recs = net.parseMessage(msg);
  assert.deepEqual(recs.map((r) => r.type), [12, 33, 16, 1]);
  const tvs = net.tvsFromMdns(recs, '192.168.1.99');
  assert.deepEqual(tvs, [{ name: 'Резонанс OS · SberBox', ip: '192.168.1.40', port: 48230, id: 'abc-123' }]);
});

test('without an A record the sender of the answer is the TV', () => {
  const msg = answer({ instance: 'TV', ip: '8.8.8.8', port: 48230, id: 'x' });
  const tvs = net.tvsFromMdns(net.parseMessage(msg), '192.168.1.41');
  assert.equal(tvs[0].ip, '192.168.1.41', 'an outside A record is ignored');
  assert.deepEqual(net.tvsFromMdns(net.parseMessage(msg), '8.8.4.4'), [], 'nothing from outside the home network');
});

test('broken mDNS messages throw instead of hanging', () => {
  assert.throws(() => net.parseMessage(Buffer.alloc(5)));
  const loop = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0, 12]);
  assert.throws(() => net.parseMessage(loop));
  const msg = answer({ instance: 'TV', ip: '192.168.1.40', port: 1, id: 'x' });
  assert.throws(() => net.parseMessage(msg.subarray(0, msg.length - 3)));
});

test('the broadcast reply is a TV card', () => {
  const r = net.tvFromFindReply(Buffer.from('REZCONNECT!' + JSON.stringify({ id: 'abc', name: 'Резонанс OS · Зал', port: 48230, w: 1920, h: 1080 })), '192.168.0.12');
  assert.deepEqual(r, { id: 'abc', name: 'Резонанс OS · Зал', ip: '192.168.0.12', port: 48230, w: 1920, h: 1080 });
  assert.equal(net.tvFromFindReply('REZCONNECT!{bad', '192.168.0.12'), null);
  assert.equal(net.tvFromFindReply('hello', '192.168.0.12'), null);
  assert.equal(net.tvFromFindReply('REZCONNECT!{"id":"a"}', '1.1.1.1'), null);
});

test('requests never go outside the home network', async () => {
  const r = await net.request('8.8.8.8', 'GET', '/connect/info');
  assert.deepEqual(r, { status: 0, body: { ok: false, error: 'lan' } });
});

test('the video starts sharp: start bitrate on every video fmtp line, audio left alone', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10',
    'm=video 9 UDP/TLS/RTP/SAVPF 102 103',
    'a=rtpmap:102 H264/90000',
    'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=300',
    'a=rtpmap:103 rtx/90000',
    'a=fmtp:103 apt=102',
    '',
  ].join('\r\n');
  const out = shared.startBitrate(sdp);
  assert.match(out, /a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=6000;x-google-min-bitrate=1500;x-google-max-bitrate=12000\r\n/);
  assert.match(out, /a=fmtp:111 minptime=10\r\n/);
  assert.match(out, /a=fmtp:103 apt=102\r\n/);
  assert.equal(shared.startBitrate(out), out);
  assert.equal(shared.startBitrate('v=0\r\n'), 'v=0\r\n');
});
