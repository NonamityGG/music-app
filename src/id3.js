// Reads title, artist, album and cover from MP3 tags (ID3v2.2/2.3/2.4 and ID3v1).
// Russian MP3s often store Cyrillic as Windows-1251 while claiming Latin-1,
// so single-byte text with high bytes is decoded as Windows-1251.

function decoder(label) {
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('utf-8');
  }
}
const DEC = {
  cp1251: decoder('windows-1251'),
  latin1: decoder('iso-8859-1'),
  utf8: decoder('utf-8'),
  utf16le: decoder('utf-16le'),
  utf16be: decoder('utf-16be'),
};

function decodeSingleByte(bytes) {
  let high = false;
  for (const b of bytes) if (b >= 0x80) { high = true; break; }
  return (high ? DEC.cp1251 : DEC.latin1).decode(bytes);
}

function decodeText(enc, bytes) {
  let s;
  if (enc === 0) s = decodeSingleByte(bytes);
  else if (enc === 1) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) s = DEC.utf16le.decode(bytes.subarray(2));
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) s = DEC.utf16be.decode(bytes.subarray(2));
    else s = DEC.utf16le.decode(bytes);
  } else if (enc === 2) s = DEC.utf16be.decode(bytes);
  else s = DEC.utf8.decode(bytes);
  // v2.4 allows several values separated by NUL
  return s
    .split('\u0000')
    .map((x) => x.replace(/﻿/g, '').trim())
    .filter(Boolean)
    .join(', ');
}

function synchsafe(b, i) {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}

function u32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function deUnsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[j++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

// Size of the whole ID3v2 tag (header included) from its first 10 bytes, or 0.
export function id3v2Size(head) {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  const footer = head[5] & 0x10 ? 10 : 0;
  return 10 + synchsafe(head, 6) + footer;
}

function findTerminator(bytes, start, wide) {
  if (wide) {
    for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  } else {
    for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i;
  }
  return bytes.length;
}

function parsePicture(body, v22) {
  const enc = body[0];
  let i = 1;
  let mime;
  if (v22) {
    const fmt = String.fromCharCode(body[1], body[2], body[3]).toUpperCase();
    mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
    i = 4;
  } else {
    const end = findTerminator(body, 1, false);
    mime = DEC.latin1.decode(body.subarray(1, end)).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = 'image/' + (mime === 'png' ? 'png' : 'jpeg');
    i = end + 1;
  }
  const picType = body[i];
  i += 1;
  const wide = enc === 1 || enc === 2;
  const descEnd = findTerminator(body, i, wide);
  i = descEnd + (wide ? 2 : 1);
  if (i >= body.length) return null;
  return { mime, type: picType, data: body.slice(i) };
}

export function parseId3v2(bytes) {
  const tags = {};
  if (!id3v2Size(bytes)) return tags;
  const ver = bytes[3];
  const flags = bytes[5];
  const size = synchsafe(bytes, 6);
  let tag = bytes.subarray(10, Math.min(bytes.length, 10 + size));
  if (flags & 0x80 && ver < 4) tag = deUnsync(tag);
  let pos = 0;
  if (flags & 0x40) {
    // extended header
    const ext = ver === 4 ? synchsafe(tag, 0) : u32(tag, 0) + 4;
    pos = ext;
  }
  const v22 = ver === 2;
  const headLen = v22 ? 6 : 10;
  const ids = v22
    ? { TT2: 'title', TP1: 'artist', TP2: 'albumArtist', TAL: 'album', PIC: 'picture' }
    : { TIT2: 'title', TPE1: 'artist', TPE2: 'albumArtist', TALB: 'album', APIC: 'picture' };

  while (pos + headLen <= tag.length) {
    const idLen = v22 ? 3 : 4;
    const id = String.fromCharCode(...tag.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    let fsize;
    if (v22) fsize = (tag[pos + 3] << 16) | (tag[pos + 4] << 8) | tag[pos + 5];
    else if (ver === 4) fsize = synchsafe(tag, pos + 4);
    else fsize = u32(tag, pos + 4);
    const fflags = v22 ? 0 : tag[pos + 9];
    const start = pos + headLen;
    const end = start + fsize;
    if (fsize <= 0 || end > tag.length) break;
    const field = ids[id];
    // skip compressed or encrypted frames
    const skip = ver === 4 ? fflags & 0x0c : ver === 3 ? fflags & 0xc0 : 0;
    if (field && !skip) {
      let body = tag.subarray(start, end);
      if (ver === 4 && fflags & 0x02) body = deUnsync(body);
      if (ver === 4 && fflags & 0x01) body = body.subarray(4); // data length indicator
      try {
        if (field === 'picture') {
          const pic = parsePicture(body, v22);
          // prefer the front cover (type 3), else the first picture
          if (pic && (!tags.picture || (pic.type === 3 && tags.picture.type !== 3))) tags.picture = pic;
        } else if (!tags[field]) {
          const text = decodeText(body[0], body.subarray(1));
          if (text) tags[field] = text;
        }
      } catch {}
    }
    pos = end;
  }
  if (!tags.artist && tags.albumArtist) tags.artist = tags.albumArtist;
  return tags;
}

export function parseId3v1(bytes) {
  if (bytes.length < 128 || bytes[0] !== 0x54 || bytes[1] !== 0x41 || bytes[2] !== 0x47) return {};
  const field = (a, b) => {
    let sub = bytes.subarray(a, b);
    const z = sub.indexOf(0);
    if (z >= 0) sub = sub.subarray(0, z);
    return decodeSingleByte(sub).trim();
  };
  const out = {};
  const title = field(3, 33);
  const artist = field(33, 63);
  const album = field(63, 93);
  if (title) out.title = title;
  if (artist) out.artist = artist;
  if (album) out.album = album;
  return out;
}

// "Artist - Title.mp3" → { artist, title }
export function tagsFromFileName(name) {
  let base = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' ').trim();
  base = base.replace(/^\d{1,3}[\s.\-–]+/, ''); // leading track number
  const m = base.split(/\s+[-–—]\s+/);
  if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
  return { title: base };
}

// Reads tags straight from a File/Blob.
export async function readTags(file) {
  let tags = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    const size = id3v2Size(head);
    if (size) {
      const bytes = new Uint8Array(await file.slice(0, Math.min(size, 20 * 1024 * 1024)).arrayBuffer());
      tags = parseId3v2(bytes);
    }
    if (!tags.title || !tags.artist) {
      const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 128)).arrayBuffer());
      const v1 = parseId3v1(tail);
      tags = { ...v1, ...tags };
    }
  } catch (e) {
    console.warn('tag read failed', e);
  }
  const fromName = tagsFromFileName(file.name || '');
  return {
    title: tags.title || fromName.title || 'Без названия',
    artist: tags.artist || fromName.artist || 'Неизвестный артист',
    album: tags.album || '',
    picture: tags.picture || null,
  };
}
