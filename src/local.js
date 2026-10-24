// Library of the user's own MP3 files. Files are copied into the app's storage
// (IndexedDB), so they keep working after the app is restarted.

import { db, requestPersistence } from './db.js';
import { readTags } from './id3.js';
import { uid } from './util.js';
import { norm } from './match.js';

let cache = null;
const listeners = new Set();

export function onLocalChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

export function localToTrack(m) {
  return {
    key: 'l:' + m.lid,
    src: 'local',
    lid: m.lid,
    title: m.title,
    artist: m.artist,
    artists: splitArtists(m.artist).map((name) => ({ id: '', name })),
    album: m.album || '',
    cover: m.cover || '',
    duration: m.duration || 0,
  };
}

function splitArtists(s) {
  return String(s || '')
    .split(/\s*(?:,|&|\sfeat\.?\s|\sft\.?\s)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

export async function localTracks() {
  if (!cache) {
    const rows = await db.all('tracks');
    rows.sort((a, b) => b.addedAt - a.addedAt);
    cache = rows.map(localToTrack);
  }
  return cache;
}

export async function localBlob(lid) {
  return db.get('files', lid);
}

export async function removeLocal(lid) {
  await db.del('files', lid);
  await db.del('tracks', lid);
  cache = null;
  emit();
}

async function coverDataUrl(picture) {
  if (!picture || !picture.data || !picture.data.length) return '';
  try {
    const blob = new Blob([picture.data], { type: picture.mime || 'image/jpeg' });
    const bmp = await createImageBitmap(blob);
    const size = 256;
    const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const hgt = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return '';
  }
}

function audioDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    let done = false;
    const finish = (d) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      a.src = '';
      resolve(isFinite(d) ? Math.round(d) : 0);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish(a.duration);
    a.onerror = () => finish(0);
    setTimeout(() => finish(0), 8000);
    a.src = url;
  });
}

// Imports a list of File objects. Skips files already in the library (same name and size).
export async function importFiles(files, onProgress) {
  await requestPersistence();
  const existing = await db.all('tracks');
  const seen = new Set(existing.map((m) => m.fileName + '|' + m.size));
  let added = 0;
  let skipped = 0;
  const list = Array.from(files);
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    onProgress && onProgress(i, list.length, f.name);
    const isAudio = (f.type && f.type.startsWith('audio/')) || /\.(mp3|m4a|aac|ogg|opus|flac|wav)$/i.test(f.name);
    if (!isAudio || seen.has(f.name + '|' + f.size)) {
      skipped++;
      continue;
    }
    const tags = await readTags(f);
    const lid = uid();
    const meta = {
      lid,
      title: tags.title,
      artist: tags.artist,
      album: tags.album,
      cover: await coverDataUrl(tags.picture),
      duration: await audioDuration(f),
      fileName: f.name,
      size: f.size,
      mime: f.type || 'audio/mpeg',
      addedAt: Date.now() + i,
    };
    // copy the bytes now: a File picked on Android may point at a content:// URI that
    // can't be read again later, so the stored Blob must own its data
    const data = new Blob([await f.arrayBuffer()], { type: meta.mime });
    await db.put('files', data, lid);
    await db.put('tracks', meta);
    seen.add(f.name + '|' + f.size);
    added++;
  }
  onProgress && onProgress(list.length, list.length, '');
  cache = null;
  emit();
  return { added, skipped };
}

export async function searchLocal(query) {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(' ');
  const all = await localTracks();
  return all.filter((t) => {
    const hay = norm(t.title + ' ' + t.artist + ' ' + t.album);
    return words.every((w) => hay.includes(w));
  });
}

export async function localArtists() {
  const all = await localTracks();
  const counts = new Map();
  for (const t of all) {
    for (const a of t.artists) {
      const k = norm(a.name);
      if (!k || k === 'неизвестный артист') continue;
      const cur = counts.get(k) || { name: a.name, count: 0 };
      cur.count++;
      counts.set(k, cur);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}
