// Резонанс Connect, the PC's network half (main process): finding Резонанс OS
// TVs on the home network and talking to them. Two ways to find a TV, both
// answered by the box itself (tv/…/Connect.java):
//   * mDNS / DNS-SD: a question for _rezonans-connect._tcp.local, sent from an
//     ordinary port so the TV answers us directly ("legacy unicast");
//   * a broadcast "REZCONNECT?" on UDP 48231 — for networks or boxes where
//     mDNS doesn't get through.
// Everything stays on the local network: addresses outside it are refused.

'use strict';

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const PORT = 48230;
const FIND_PORT = 48231;
const SERVICE = '_rezonans-connect._tcp.local';
const MDNS = { address: '224.0.0.251', port: 5353 };

/** Is this IPv4 address on a home network (private / link-local / this machine)? */
function isLanIp(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((x) => x > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127;
}

// ---------- DNS messages (just what mDNS discovery needs) ----------

const T = { A: 1, PTR: 12, TXT: 16, SRV: 33 };

function encodeName(name) {
  const parts = String(name).replace(/\.$/, '').split('.');
  const bufs = [];
  for (const p of parts) {
    const b = Buffer.from(p, 'utf8');
    if (b.length > 63) throw new Error('label too long');
    bufs.push(Buffer.from([b.length]), b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

/** A DNS question for PTR records of `name`, asking for a direct (unicast) answer. */
function encodeQuery(name, type = T.PTR) {
  const head = Buffer.alloc(12); // id 0, flags 0, one question
  head.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(0x8001, 2); // class IN, "QU": unicast response please
  return Buffer.concat([head, encodeName(name), tail]);
}

// a name at `off`, following compression pointers; returns [name, next offset]
function readName(buf, off) {
  const labels = [];
  let jumped = false;
  let next = off;
  for (let guard = 0; guard < 128; guard++) {
    if (off >= buf.length) throw new Error('name out of range');
    const len = buf[off];
    if (len === 0) {
      if (!jumped) next = off + 1;
      return [labels.join('.'), next];
    }
    if ((len & 0xc0) === 0xc0) {
      if (off + 1 >= buf.length) throw new Error('pointer out of range');
      if (!jumped) next = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      jumped = true;
      continue;
    }
    if (off + 1 + len > buf.length) throw new Error('label out of range');
    labels.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += 1 + len;
  }
  throw new Error('name loop');
}

/** Every record of a DNS message (answers, authority, additional), decoded where we care. */
function parseMessage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) throw new Error('short message');
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < qd; i++) {
    off = readName(buf, off)[1] + 4;
  }
  const records = [];
  for (let i = 0; i < total; i++) {
    const [name, o] = readName(buf, off);
    if (o + 10 > buf.length) throw new Error('record out of range');
    const type = buf.readUInt16BE(o);
    const len = buf.readUInt16BE(o + 8);
    const at = o + 10;
    if (at + len > buf.length) throw new Error('data out of range');
    const r = { name, type };
    if (type === T.A && len === 4) r.data = `${buf[at]}.${buf[at + 1]}.${buf[at + 2]}.${buf[at + 3]}`;
    else if (type === T.PTR) r.data = readName(buf, at)[0];
    else if (type === T.SRV && len >= 7) r.data = { priority: buf.readUInt16BE(at), weight: buf.readUInt16BE(at + 2), port: buf.readUInt16BE(at + 4), target: readName(buf, at + 6)[0] };
    else if (type === T.TXT) {
      const txt = {};
      let p = at;
      while (p < at + len) {
        const l = buf[p];
        const s = buf.toString('utf8', p + 1, Math.min(p + 1 + l, at + len));
        const eq = s.indexOf('=');
        if (s) txt[eq < 0 ? s : s.slice(0, eq)] = eq < 0 ? true : s.slice(eq + 1);
        p += 1 + l;
      }
      r.data = txt;
    }
    records.push(r);
    off = at + len;
  }
  return records;
}

/**
 * The TVs in one mDNS answer: [{name, ip, port, id}]. `from` is the address
 * the answer came from (the TV itself) — used when no A record is included.
 */
function tvsFromMdns(records, from) {
  const lc = (s) => String(s || '').toLowerCase();
  const out = [];
  for (const ptr of records.filter((r) => r.type === T.PTR && lc(r.name) === SERVICE)) {
    const inst = ptr.data;
    const srv = records.find((r) => r.type === T.SRV && lc(r.name) === lc(inst));
    const txt = records.find((r) => r.type === T.TXT && lc(r.name) === lc(inst));
    const a = srv && records.find((r) => r.type === T.A && lc(r.name) === lc(srv.data.target) && isLanIp(r.data));
    const ip = a ? a.data : from;
    if (!isLanIp(ip)) continue;
    const label = String(inst).slice(0, Math.max(0, String(inst).length - SERVICE.length - 1));
    out.push({ name: label.replace(/\\(\d{3})/g, (m, d) => String.fromCharCode(Number(d))).replace(/\\(.)/g, '$1'), ip, port: srv ? srv.data.port : PORT, id: txt && typeof txt.data.id === 'string' ? txt.data.id : '' });
  }
  return out;
}

/** The answer to a broadcast question: "REZCONNECT!{json}". */
function tvFromFindReply(msg, from) {
  const s = Buffer.isBuffer(msg) ? msg.toString('utf8') : String(msg || '');
  if (!s.startsWith('REZCONNECT!') || !isLanIp(from)) return null;
  try {
    const o = JSON.parse(s.slice(11));
    if (!o || typeof o !== 'object') return null;
    return { id: String(o.id || ''), name: String(o.name || 'Резонанс OS'), ip: from, port: Number(o.port) || PORT, w: Number(o.w) || 0, h: Number(o.h) || 0 };
  } catch {
    return null;
  }
}

// ---------- finding TVs ----------

// the PC's own IPv4 networks: [{address, broadcast}]
function lanInterfaces() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      if (i.internal || !isLanIp(i.address)) continue;
      const a = i.address.split('.').map(Number);
      const m = String(i.netmask || '255.255.255.0').split('.').map(Number);
      out.push({ address: i.address, broadcast: a.map((x, k) => (x & m[k]) | (~m[k] & 255)).join('.') });
    }
  }
  return out;
}

/** Looks for TVs for `ms` milliseconds. Calls onFound(tv) for each new one; resolves with all. */
function discover(ms = 2500, onFound = () => {}) {
  return new Promise((resolve) => {
    const found = new Map(); // key: id or ip
    const add = (tv) => {
      if (!tv || !isLanIp(tv.ip)) return;
      const key = tv.id || tv.ip;
      // the same TV seen both ways: keep one, with what each told
      for (const [k, v] of found) {
        if ((tv.id && v.id === tv.id) || v.ip === tv.ip) {
          const merged = { ...v, ...Object.fromEntries(Object.entries(tv).filter(([, x]) => x)) };
          found.delete(k);
          found.set(merged.id || merged.ip, merged);
          return;
        }
      }
      found.set(key, tv);
      onFound(tv);
    };
    const socks = [];
    const ifs = lanInterfaces();

    // mDNS, once per network the PC is on
    for (const i of ifs.length ? ifs : [{ address: '0.0.0.0' }]) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socks.push(s);
      s.on('error', () => {});
      s.on('message', (msg, r) => {
        try {
          for (const tv of tvsFromMdns(parseMessage(msg), r.address)) add(tv);
        } catch {}
      });
      s.bind(0, i.address === '0.0.0.0' ? undefined : i.address, () => {
        try {
          if (i.address !== '0.0.0.0') s.setMulticastInterface(i.address);
          const q = encodeQuery(SERVICE);
          s.send(q, MDNS.port, MDNS.address);
          setTimeout(() => s.send(q, MDNS.port, MDNS.address, () => {}), 700);
        } catch {}
      });
    }

    // the broadcast question
    const b = dgram.createSocket('udp4');
    socks.push(b);
    b.on('error', () => {});
    b.on('message', (msg, r) => add(tvFromFindReply(msg, r.address)));
    b.bind(0, () => {
      try {
        b.setBroadcast(true);
        const q = Buffer.from('REZCONNECT?1');
        const targets = new Set(['255.255.255.255', ...ifs.map((i) => i.broadcast)]);
        for (const t of targets) b.send(q, FIND_PORT, t, () => {});
        setTimeout(() => {
          for (const t of targets) b.send(q, FIND_PORT, t, () => {});
        }, 700);
      } catch {}
    });

    setTimeout(() => {
      for (const s of socks) {
        try {
          s.close();
        } catch {}
      }
      resolve([...found.values()]);
    }, ms);
  });
}

// ---------- talking to a TV ----------

/** One JSON request to a TV: {status, body}. Never leaves the local network. */
function request(ip, method, path, body, timeout = 8000) {
  return new Promise((resolve) => {
    if (!isLanIp(ip)) return resolve({ status: 0, body: { ok: false, error: 'lan' } });
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: ip,
        port: PORT,
        method,
        path,
        timeout,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size < 1024 * 1024) chunks.push(c);
        });
        res.on('end', () => {
          let o = {};
          try {
            o = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {}
          resolve({ status: res.statusCode, body: o });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, body: { ok: false, error: e.message === 'timeout' ? 'timeout' : 'net' } }));
    if (data) req.write(data);
    req.end();
  });
}

// ---------- what this PC remembers ----------

/** This PC's id and the tokens TVs gave it: {me: {id}, tvs: {tvId: {token, name, ip, at}}}. */
function store(file) {
  let s = { me: {}, tvs: {} };
  try {
    s = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (!s || typeof s !== 'object') s = {};
  if (!s.me || typeof s.me.id !== 'string') s.me = { id: crypto.randomUUID() };
  if (!s.tvs || typeof s.tvs !== 'object') s.tvs = {};
  const save = () => {
    try {
      fs.writeFileSync(file, JSON.stringify(s, null, 1));
    } catch {}
  };
  save();
  return {
    me: () => s.me.id,
    tv: (id) => (id && s.tvs[id]) || null,
    known: () => Object.entries(s.tvs).map(([id, v]) => ({ id, name: v.name, ip: v.ip, at: v.at || 0 })),
    remember(id, patch) {
      if (!id) return;
      s.tvs[id] = { ...(s.tvs[id] || {}), ...patch, at: Date.now() };
      save();
    },
    forget(id) {
      if (!s.tvs[id]) return;
      delete s.tvs[id].token;
      save();
    },
  };
}

module.exports = { PORT, FIND_PORT, SERVICE, T, isLanIp, encodeName, encodeQuery, parseMessage, tvsFromMdns, tvFromFindReply, lanInterfaces, discover, request, store };
