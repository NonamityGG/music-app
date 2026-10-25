// Unit tests for the parts that don't need a phone: tags, matching, Zvuk client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// localStorage shim for settings.js
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => {
  const buf = readFileSync(join(here, 'fixtures', name));
  return new File([buf], name, { type: 'audio/mpeg' });
};

const { readTags, tagsFromFileName } = await import('../src/id3.js');
const { matchScore, bestMatch, norm } = await import('../src/match.js');
const zvuk = await import('../src/zvuk.js');
zvuk.setPacing({ gap: 0, botRetryMs: 0 });
const { saveSettings } = await import('../src/settings.js');

// ---------- tags ----------

test('ID3v2.4 UTF-8 with cover', async () => {
  const t = await readTags(fx('v24_utf8.mp3'));
  assert.equal(t.title, 'Кукла колдуна');
  assert.equal(t.artist, 'Король и Шут');
  assert.equal(t.album, 'Камнем по голове');
  assert.ok(t.picture && t.picture.data.length > 100, 'cover found');
  assert.equal(t.picture.mime, 'image/jpeg');
  assert.equal(t.picture.data[0], 0xff, 'JPEG starts with FF D8');
  assert.equal(t.picture.data[1], 0xd8);
});

test('ID3v2.3 UTF-16', async () => {
  const t = await readTags(fx('v23_utf16.mp3'));
  assert.equal(t.title, 'Группа крови');
  assert.equal(t.artist, 'Кино');
  assert.ok(t.picture && t.picture.data[0] === 0xff && t.picture.data[1] === 0xd8, 'cover after UTF-16 description');
});

test('Latin-1 frames holding Windows-1251 bytes decode as Cyrillic', async () => {
  const t = await readTags(fx('v23_cp1251.mp3'));
  assert.equal(t.title, 'Звезда_____');
  assert.equal(t.artist, 'Цой________');
});

test('ID3v1 only', async () => {
  const t = await readTags(fx('v1only.mp3'));
  assert.equal(t.title, 'Numb');
  assert.equal(t.artist, 'Linkin Park');
  assert.equal(t.album, 'Meteora');
});

test('no tags: name of the file is used', async () => {
  const t = await readTags(fx('Linkin Park - Numb.mp3'));
  assert.equal(t.title, 'Numb');
  assert.equal(t.artist, 'Linkin Park');
  assert.deepEqual(tagsFromFileName('03. Баста - Сансара.mp3'), { artist: 'Баста', title: 'Сансара' });
  assert.deepEqual(tagsFromFileName('track_without_artist.mp3'), { title: 'track without artist' });
});

// ---------- matching ----------

test('same song across sources is matched, different songs are not', () => {
  const z = { title: 'Сансара (feat. Скриптонит)', artists: [{ name: 'Баста' }], duration: 285 };
  const l = { title: 'Сансара', artist: 'Баста', duration: 284 };
  assert.ok(matchScore(z, l) >= 0.7);
  assert.equal(matchScore(z, { title: 'Сансара', artist: 'Другой артист' }) < 0.7, true);
  assert.equal(matchScore(z, { title: 'Выпускной', artist: 'Баста' }), 0);
  assert.equal(norm('Ёлка [Remastered 2020]'), 'елка');
  const pick = bestMatch({ title: 'Numb', artist: 'Linkin Park' }, [
    { key: 'a', title: 'Numb / Encore', artist: 'JAY-Z, Linkin Park' },
    { key: 'b', title: 'Numb', artists: [{ name: 'Linkin Park' }] },
  ]);
  assert.equal(pick.key, 'b');
});

// ---------- Zvuk client (network mocked) ----------

function mockZvuk(handler) {
  const calls = [];
  zvuk.setTransport(async (req) => {
    calls.push(req);
    return handler(req, calls.length);
  });
  return calls;
}

test('guest token is fetched once and sent as X-Auth-Token with GraphQL', async () => {
  saveSettings({ token: '', anonToken: '' });
  const calls = mockZvuk((req) => {
    if (req.url.endsWith('/api/tiny/profile')) return { status: 200, data: { result: { token: 'GUEST', is_anonymous: true } } };
    assert.equal(req.method, 'POST');
    assert.equal(req.data.operationName, 'quickSearch');
    assert.equal(req.headers['X-Auth-Token'], 'GUEST');
    assert.equal(req.headers['Origin'], 'https://zvuk.com');
    return {
      status: 200,
      data: {
        data: {
          quickSearch: {
            content: [
              { __typename: 'Track', id: 101, title: 'Numb', duration: 187, artists: [{ id: 7, title: 'Linkin Park', image: { src: '/pic?id=7' } }], release: { id: 55, title: 'Meteora', image: { src: 'https://cdn.zvuk.com/pic?type=release&id=55&size={size}' } } },
              { __typename: 'Artist', id: 7, title: 'Linkin Park', image: { src: 'https://cdn.zvuk.com/pic?type=artist&id=7' } },
              { __typename: 'Release', id: 55, title: 'Meteora', date: '2003-03-25T00:00:00', type: 'album', image: null, artists: [{ id: 7, title: 'Linkin Park' }] },
            ],
          },
        },
      },
    };
  });
  const r = await zvuk.quickSearch('numb');
  await zvuk.quickSearch('numb');
  assert.equal(calls.filter((c) => c.url.endsWith('/profile')).length, 1, 'guest token cached');
  assert.equal(r.tracks.length, 1);
  const t = r.tracks[0];
  assert.equal(t.key, 'z:101');
  assert.equal(t.artist, 'Linkin Park');
  assert.equal(t.releaseId, '55');
  assert.equal(t.cover, 'https://cdn.zvuk.com/pic?type=release&id=55&size=300x300');
  assert.equal(r.artists[0].image, 'https://cdn.zvuk.com/pic?type=artist&id=7&size=300x300');
  assert.equal(r.releases[0].cover, '');
});

test('anti-bot page: one calm retry, then the app backs off', async () => {
  saveSettings({ token: 'USER' });
  zvuk.resetBotState();
  let calls = mockZvuk(() => ({ status: 418, data: '<html><body>checking your browser</body></html>' }));
  await assert.rejects(zvuk.quickSearch('x'), (e) => e.kind === 'bot');
  assert.equal(calls.length, 2, 'retried once');
  assert.equal(zvuk.botBlocked(), true);
  calls = mockZvuk(() => ({ status: 200, data: { data: { quickSearch: { content: [] } } } }));
  await assert.rejects(zvuk.quickSearch('x'), (e) => e.kind === 'bot');
  assert.equal(calls.length, 0, 'no requests while backing off');

  zvuk.resetBotState();
  mockZvuk(() => ({ status: 200, data: '<!doctype html><html>bot activity detected</html>' }));
  await assert.rejects(zvuk.quickSearch('x'), (e) => e.kind === 'bot');
  zvuk.resetBotState();

  // a block that clears on the retry is invisible to the user
  calls = mockZvuk((req, n) => (n === 1 ? { status: 418, data: '<html></html>' } : { status: 200, data: { data: { quickSearch: { content: [] } } } }));
  const r = await zvuk.quickSearch('x');
  assert.equal(r.tracks.length, 0);
  assert.equal(zvuk.botBlocked(), false);
});

test('requests are spaced out and limited to two at a time', async () => {
  saveSettings({ token: 'USER' });
  zvuk.setPacing({ gap: 60 });
  let live = 0;
  let maxLive = 0;
  const starts = [];
  mockZvuk(async () => {
    starts.push(Date.now());
    live++;
    maxLive = Math.max(maxLive, live);
    await new Promise((r) => setTimeout(r, 100));
    live--;
    return { status: 200, data: { data: { quickSearch: { content: [] } } } };
  });
  await Promise.all([1, 2, 3, 4, 5].map((i) => zvuk.quickSearch('q' + i)));
  zvuk.setPacing({ gap: 0 });
  assert.ok(maxLive <= 2, 'at most two in flight, got ' + maxLive);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 55, 'gap between starts');
});

test('stream: high quality first, then normal quality', async () => {
  saveSettings({ token: 'USER', quality: 'high' });
  const calls = mockZvuk((req) => {
    if (req.params.quality === 'high') return { status: 403, data: { error: 'subscription required' } };
    return { status: 200, data: { result: { stream: 'https://cdn.zvuk.com/track/mid.mp3' } } };
  });
  const url = await zvuk.streamUrl('101');
  assert.equal(url, 'https://cdn.zvuk.com/track/mid.mp3');
  assert.deepEqual(calls.map((c) => c.params.quality), ['high', 'mid']);
  assert.equal(calls[0].params.id, '101');
});

test('stream: track Zvuk refuses is reported as unavailable', async () => {
  saveSettings({ token: 'USER', quality: 'high' });
  mockZvuk(() => ({ status: 403, data: {} }));
  await assert.rejects(zvuk.streamUrl('5'), (e) => e.kind === 'unavailable' && /подписка/.test(e.message));
});

test('GraphQL errors without data become readable errors; partial data is kept', async () => {
  saveSettings({ token: 'USER' });
  mockZvuk(() => ({ status: 200, data: { errors: [{ message: 'Cannot query field' }], data: null } }));
  await assert.rejects(zvuk.getTracks(['1']), (e) => e.kind === 'gql');
  mockZvuk(() => ({ status: 200, data: { errors: [{ message: 'one track hidden' }], data: { getTracks: [{ id: 2, title: 'B', artists: [] }, null] } } }));
  const t = await zvuk.getTracks(['1', '2']);
  assert.deepEqual(t.map((x) => x.zid), ['2']);
});

test('playlists of the user come back in collection order with track counts', async () => {
  saveSettings({ token: 'USER' });
  mockZvuk((req) => {
    if (req.data.operationName === 'userPlaylists') return { status: 200, data: { data: { collection: { playlists: [{ id: 3 }, { id: 1 }] } } } };
    return {
      status: 200,
      data: { data: { getPlaylists: [{ id: 1, title: 'Один', image: null, tracks: [{ id: 9 }] }, { id: 3, title: 'Три', image: { src: '/p.jpg' }, tracks: [{ id: 1 }, { id: 2 }] }] } },
    };
  });
  const p = await zvuk.userPlaylists();
  assert.deepEqual(p.map((x) => x.title), ['Три', 'Один']);
  assert.equal(p[0].trackIds.length, 2);
  assert.equal(p[0].cover, 'https://zvuk.com/p.jpg?size=300x300');
});

test('a guest token on a profile check is refused as a login', async () => {
  mockZvuk(() => ({ status: 200, data: { result: { token: 'X', is_anonymous: true } } }));
  await assert.rejects(zvuk.checkToken('X'), (e) => e.kind === 'auth');
  mockZvuk(() => ({ status: 200, data: { result: { token: 'X', is_anonymous: false, name: 'Сергей' } } }));
  const r = await zvuk.checkToken('X');
  assert.equal(r.name, 'Сергей');
});

test('back-off grows with repeated blocks: 30 s, then 60 s', async () => {
  saveSettings({ token: 'USER' });
  zvuk.resetBotState();
  mockZvuk(() => ({ status: 418, data: '<html></html>' }));
  await assert.rejects(zvuk.quickSearch('a'), (e) => e.kind === 'bot' && /30 с/.test(e.message));
  const first = zvuk.botRemaining();
  assert.ok(first > 28000 && first <= 30000, 'first wait ~30 s, got ' + first);
  zvuk.resetBotState();
  // simulate a second block within ten minutes by blocking twice in a row without clearing history
  mockZvuk(() => ({ status: 418, data: '<html></html>' }));
  await assert.rejects(zvuk.quickSearch('b'));
  const until = zvuk.botRemaining();
  assert.ok(until > 28000, 'blocked again');
  zvuk.resetBotState();
});

// ---------- importers ----------

const imp = await import('../src/importers.js');

test('pasted list: "Artist - Title" lines with numbers and durations', () => {
  const t = imp.parseTextList('1. Кино - Группа крови 4:45\n2) Баста — Сансара\n\nLinkin Park – Numb');
  assert.deepEqual(t.map((x) => [x.artist, x.title]), [['Кино', 'Группа крови'], ['Баста', 'Сансара'], ['Linkin Park', 'Numb']]);
  assert.equal(t[0].src, 'ext');
  assert.equal(t[0].key, 'x:кино|группа крови');
});

test('pasted list copied from a web page: title / artist / duration blocks', () => {
  const t = imp.parseTextList('Группа крови\nКино\n4:45\nСансара\nБаста\n5:03\n');
  assert.equal(t.length, 2);
  assert.equal(t[0].title, 'Группа крови');
  assert.equal(t[0].artist, 'Кино');
  assert.equal(t[0].duration, 285);
  assert.equal(t[0].ambiguous, true);
  // matching tries both orders, so a swapped block still finds the MP3
  const swapped = imp.parseTextList('Кино\nГруппа крови\n4:45')[0];
  assert.ok(bestMatch(swapped, [{ title: 'Группа крови', artist: 'Кино' }]));
});

test('CSV exports: Spotify-style, several playlists in one file, semicolons', () => {
  const exportify = 'Track URI,Track Name,Artist Name(s),Album Name,Track Duration (ms)\nspotify:track:1,"Numb","Linkin Park","Meteora",185586\nspotify:track:2,"Hello, World","A, B",X,200000\n';
  const [p] = imp.parseExportFile(exportify, 'Мой плейлист.csv');
  assert.equal(p.name, 'Мой плейлист');
  assert.equal(p.tracks.length, 2);
  assert.equal(p.tracks[0].duration, 186);
  assert.equal(p.tracks[1].title, 'Hello, World');
  assert.equal(p.tracks[1].artists.length, 2);

  const tmm = 'Track name,Artist name,Album,Playlist name,Type\nКукла колдуна,Король и Шут,Камнем по голове,Рок,Playlist\nНумб,LP,,Другой,Playlist\n';
  const groups = imp.parseExportFile(tmm, 'export.csv');
  assert.deepEqual(groups.map((g) => g.name), ['Рок', 'Другой']);

  const semi = 'Исполнитель;Название\nКино;Звезда по имени Солнце\n';
  assert.equal(imp.parseExportFile(semi, 'list.csv')[0].tracks[0].artist, 'Кино');
  // plain text file falls back to the line parser
  assert.equal(imp.parseExportFile('Кино - Пачка сигарет', 'a.txt')[0].tracks[0].title, 'Пачка сигарет');
});

test('links are recognised', () => {
  assert.deepEqual(imp.detectLink('https://music.yandex.ru/users/serg.m/playlists/1003?utm=1'), { service: 'yandex', kind: 'user-playlist', owner: 'serg.m', id: '1003' });
  assert.equal(imp.detectLink('https://music.yandex.ru/playlists/lk.6f0e0b3e-1a2b').kind, 'playlist-uuid');
  assert.equal(imp.detectLink('https://music.yandex.ru/album/123').kind, 'album');
  assert.deepEqual(imp.detectLink('https://open.spotify.com/intl-ru/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x'), { service: 'spotify', kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
  assert.equal(imp.detectLink('https://vk.com/music/playlist/1_2').service, 'vk');
  assert.equal(imp.detectLink('просто текст'), null);
});

test('Yandex playlist by link, including tracks that come as ids only', async () => {
  const calls = [];
  imp.setImportTransport(async (req) => {
    calls.push(req);
    if (req.url.endsWith('/users/serg/playlists/5')) {
      return {
        status: 200,
        data: {
          result: {
            title: 'Вечер',
            tracks: [
              { id: 1, track: { id: 1, title: 'Хочешь?', artists: [{ name: 'Земфира' }], albums: [{ title: 'ПММЛ', coverUri: 'avatars.yandex.net/get-music-content/1/%%' }], durationMs: 245000 } },
              { id: 2, albumId: 9 },
            ],
          },
        },
      };
    }
    if (req.url.endsWith('/tracks')) {
      assert.match(req.data, /track-ids=2%3A9/);
      return { status: 200, data: { result: [{ id: 2, title: 'Романс', version: 'Live', artists: [{ name: 'Сплин' }], albums: [], durationMs: 200000 }] } };
    }
    return { status: 404, data: {} };
  });
  const r = await imp.importFromLink('https://music.yandex.ru/users/serg/playlists/5');
  assert.equal(r.name, 'Вечер');
  assert.deepEqual(r.tracks.map((t) => t.title), ['Хочешь?', 'Романс (Live)']);
  assert.equal(r.tracks[0].cover, 'https://avatars.yandex.net/get-music-content/1/300x300');
  assert.equal(r.tracks[0].duration, 245);

  imp.setImportTransport(async () => ({ status: 403, data: {} }));
  await assert.rejects(imp.importFromLink('https://music.yandex.ru/users/serg/playlists/6'), /закрытый/);
});

test('Spotify playlist from the public embed page', async () => {
  const next = { props: { pageProps: { state: { data: { entity: { name: 'Chill', trackList: [{ title: 'Numb', subtitle: 'Linkin Park', duration: 185000 }, { title: 'Hey', subtitle: 'A, B', duration: 1000 }] } } } } } };
  imp.setImportTransport(async (req) => {
    assert.match(req.url, /open\.spotify\.com\/embed\/playlist\/abc/);
    return { status: 200, data: `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></html>` };
  });
  const r = await imp.importFromLink('https://open.spotify.com/playlist/abc');
  assert.equal(r.name, 'Chill');
  assert.equal(r.tracks[1].artist, 'A, B');
  assert.equal(r.tracks[0].duration, 185);
  imp.setImportTransport(null);
});

// ---------- Yandex Music ----------

const ya = await import('../src/yandex.js');
const { md5 } = await import('../src/md5.js');
const online = await import('../src/online.js');
const { onlinePatch } = await import('../src/matcher.js');

test('md5 matches the reference values', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5('Привет'), '8a669e9418750c81ab90ae159a8ec410');
});

test('Yandex token is taken from the sign-in redirect', () => {
  assert.equal(ya.tokenFromUrl('https://music.yandex.ru/#access_token=y0_AbC-123&token_type=bearer&expires_in=31536000'), 'y0_AbC-123');
  assert.equal(ya.tokenFromUrl('https://music.yandex.ru/'), '');
});

test('Yandex: sign-in, track shapes, stream link signing', async () => {
  const calls = [];
  ya.setYandexTransport(async (req) => {
    calls.push(req);
    const u = new URL(req.url);
    if (u.pathname === '/account/status') {
      assert.equal(req.headers.Authorization, 'OAuth tok1');
      return { status: 200, data: { result: { account: { uid: 42, login: 'masha', displayName: 'Маша' }, plus: { hasPlus: true } } } };
    }
    if (u.pathname === '/tracks' && req.method === 'POST') {
      assert.match(req.data, /track-ids=10%2C11/);
      return {
        status: 200,
        data: {
          result: [
            { id: 11, title: 'Би-2', version: 'Live', durationMs: 200500, artists: [{ id: 7, name: 'Би-2' }], albums: [{ id: 3, title: 'Альбом', coverUri: 'avatars.yandex.net/x/%%' }] },
            { id: 10, title: 'Полковник', durationMs: 245000, artists: [{ id: 7, name: 'Би-2' }], albums: [{ id: 3, title: 'Альбом' }], coverUri: 'avatars.yandex.net/y/%%' },
          ],
        },
      };
    }
    if (u.pathname === '/tracks/10/download-info') {
      return {
        status: 200,
        data: { result: [ { codec: 'mp3', bitrateInKbps: 192, downloadInfoUrl: 'https://dl/192' }, { codec: 'mp3', bitrateInKbps: 320, downloadInfoUrl: 'https://dl/320' }, { codec: 'aac', bitrateInKbps: 64, downloadInfoUrl: 'https://dl/aac' } ] },
      };
    }
    if (req.url === 'https://dl/320') {
      return { status: 200, data: '<?xml version="1.0"?><download-info><host>s1.storage.yandex.net</host><path>/rmusic/abc/track.mp3</path><ts>0005f</ts><region>-1</region><s>salt9</s></download-info>' };
    }
    return { status: 404, data: {} };
  });

  const a = await ya.loginWithToken('tok1');
  assert.deepEqual(a, { uid: '42', login: 'masha', name: 'Маша', plus: true });
  assert.ok(ya.isLoggedIn());

  const tracks = await ya.getTracks(['y:10', '11']);
  assert.deepEqual(tracks.map((t) => t.key), ['y:10', 'y:11'], 'order of the request is kept');
  assert.equal(tracks[1].title, 'Би-2 (Live)');
  assert.equal(tracks[1].duration, 201);
  assert.equal(tracks[1].cover, 'https://avatars.yandex.net/x/300x300');
  assert.equal(tracks[0].releaseId, 'y:3');
  assert.equal(tracks[0].artists[0].id, 'y:7');

  saveSettings({ quality: 'high' });
  const url = await ya.streamUrl('y:10');
  const sign = md5('XGRlBW9FXlekgbPrRHuSiA' + 'rmusic/abc/track.mp3' + 'salt9');
  assert.equal(url, `https://s1.storage.yandex.net/get-mp3/${sign}/0005f/rmusic/abc/track.mp3`);
  assert.ok(calls.every((c) => !c.url.includes('api.music.yandex.net') || c.headers['X-Yandex-Music-Client']));

  // the app-wide layer: Yandex ids route to Yandex, and Yandex becomes the main service
  saveSettings({ token: '' });
  assert.equal(online.primaryId(), 'yandex');
  assert.deepEqual(online.refOf(tracks[0]), { p: 'yandex', id: '10' });
  assert.equal(online.refOf({ src: 'zvuk', zid: '5' }), null, 'Zvuk no longer plays');
  assert.deepEqual(online.refOf({ src: 'ext', match: 'online', yid: '10' }), { p: 'yandex', id: '10' });
  assert.equal(online.likeKey(tracks[0]), 'y:10');

  const patch = onlinePatch({ title: 'Полковник', artist: 'Би-2' }, tracks[0]);
  assert.equal(patch.match, 'online');
  assert.equal(patch.yid, '10');
  assert.equal(patch.zid, undefined);

  await ya.logout();
  assert.ok(!ya.isLoggedIn());
  await assert.rejects(online.quickSearch('кино'), (e) => e.kind === 'nologin');
  ya.setYandexTransport(null);
});

test('Zvuk block response is described for the error journal', async () => {
  zvuk.resetBotState();
  zvuk.setTransport(async () => ({ status: 200, type: 'text/html', data: '<!DOCTYPE html><html><head><title>Проверка браузера</title><script>var x=1</script></head><body><p>Подождите   секунду</p></body></html>' }));
  const err = await zvuk.quickSearch('кино').catch((e) => e);
  assert.equal(err.kind, 'bot');
  assert.match(err.detail, /«Проверка браузера»/);
  assert.match(err.detail, /Подождите секунду/);
  assert.doesNotMatch(err.detail, /var x/);
  zvuk.resetBotState();
  zvuk.setTransport(null);
});

// ---------- Zvuk: transfer only ----------

const zi = await import('../src/zvuk-import.js');

test('Zvuk share links are recognised', () => {
  assert.deepEqual(zi.detectZvukLink('Слушай https://zvuk.com/playlist/7823546?utm=1'), { kind: 'playlist', id: '7823546', url: 'https://zvuk.com/playlist/7823546' });
  assert.equal(zi.detectZvukLink('https://zvuk.com/release/42').kind, 'release');
  assert.equal(zi.detectZvukLink('https://zvuk.com/sh/AbC12').kind, 'page');
  assert.equal(zi.detectZvukLink('просто текст'), null);
});

test('Tracks are found in a web page data blob of any shape', () => {
  const page = {
    props: {
      pageProps: {
        menu: [{ title: 'Главная' }, { title: 'Подкасты' }],
        playlist: {
          title: 'Ночная смена',
          tracks: [
            { id: 1, title: 'Группа крови', duration: 285, artists: [{ title: 'Кино' }], release: { title: 'Группа крови' } },
            { id: 2, title: 'Сансара', duration: 260000, artists: [{ title: 'Баста' }, { title: 'Скриптонит' }] },
            { id: 3, title: 'Корабли', artistNames: ['Pyrokinesis'] },
          ],
        },
      },
    },
  };
  const r = zi.findTracksIn(page);
  assert.equal(r.title, 'Ночная смена');
  assert.equal(r.tracks.length, 3);
  assert.equal(r.tracks[1].artist, 'Баста, Скриптонит');
  assert.equal(r.tracks[1].duration, 260);
  assert.equal(r.tracks[0].album, 'Группа крови');
  const ext = zi.toExt({ title: 'Сансара', artist: 'Баста', album: '', duration: 260, cover: '' });
  assert.equal(ext.src, 'ext');
  assert.equal(ext.artists.length, 1);
});

test('Old Zvuk tracks in playlists become songs to match', async () => {
  const pl = await import('../src/playlists.js');
  const p = pl.createPlaylist('Старый', [
    { key: 'z:1', src: 'zvuk', zid: '1', title: 'Лесник', artist: 'Король и Шут', artists: [], duration: 200 },
    { key: 'x:a|b', src: 'ext', title: 'B', artist: 'A', artists: [], match: 'zvuk', zid: '9' },
    { key: 'x:c|d', src: 'ext', title: 'D', artist: 'C', artists: [], match: 'local', lid: 'L1' },
  ]);
  pl.migrateFromZvuk(zi.toExt);
  const t = pl.getPlaylist(p.id).tracks;
  assert.equal(t[0].src, 'ext');
  assert.equal(t[0].title, 'Лесник');
  assert.ok(!t[0].match);
  assert.ok(!t[1].match && !t[1].zid);
  assert.equal(t[2].match, 'local');
  pl.deletePlaylist(p.id);
});

// ---------- lyrics ----------

const lyr = await import('../src/lyrics.js');

test('LRC lyrics are parsed with times, offsets and repeated stamps', () => {
  const r = lyr.parseLrc('[ar:Кино]\n[offset:+500]\n[00:12.50]Белый снег, серый лёд\n[00:16.00][01:10.00]На растрескавшейся земле\n[00:20.30]\n[00:22.10]Одеялом лоскутным на ней');
  assert.equal(r.synced, true);
  assert.equal(r.lines.length, 5);
  assert.equal(r.lines[0].t, 12);
  assert.equal(r.lines[0].text, 'Белый снег, серый лёд');
  assert.equal(r.lines[4].t, 69.5, 'repeated line sorted to its place');
  const p = lyr.parseLrc('Первая строка\n\n\nВторая строка\n');
  assert.equal(p.synced, false);
  assert.deepEqual(p.lines.map((l) => l.text), ['Первая строка', '', 'Вторая строка']);
});

test('Yandex lyrics requests are signed like the apps do', async () => {
  assert.equal(await ya.signLyrics('1234567', 1700000000), '2tRbULpJWJBXMsc8OvFSM1g9/0PNkx3lj7ZyLXgU9ZM=');
});

test('LRCLIB: the same song is chosen, synced preferred, wrong length rejected', () => {
  const t = { title: 'Группа крови', artist: 'Кино', duration: 285 };
  const res = [
    { trackName: 'Группа крови (live)', artistName: 'Кино', duration: 400, plainLyrics: 'x' },
    { trackName: 'Группа крови', artistName: 'Кино', duration: 286, plainLyrics: 'plain' },
    { trackName: 'Группа крови', artistName: 'Кино', duration: 284, syncedLyrics: '[00:01.00]synced' },
    { trackName: 'Другая', artistName: 'Кто-то', duration: 285, syncedLyrics: '[00:01.00]no' },
  ];
  assert.equal(lyr.pickLrclib(t, res), '[00:01.00]synced');
  assert.equal(lyr.pickLrclib({ ...t, duration: 200 }, res.slice(1, 3)), null);
});

const lv = await import('../src/lyrics-view.js');

test('Lyrics view: active line search and pauses', () => {
  const lines = [{ t: 10, text: 'a' }, { t: 14, text: 'b' }, { t: 20, text: '' }, { t: 35, text: 'c' }];
  assert.equal(lv.activeIndex(lines, 5), -1);
  assert.equal(lv.activeIndex(lines, 10), 0);
  assert.equal(lv.activeIndex(lines, 19.9), 1);
  assert.equal(lv.activeIndex(lines, 100), 3);
  const w = lv.withPauses(lines, 200);
  assert.equal(w[0].pause, true, 'long intro gets dots');
  assert.ok(w.some((l) => l.pause && l.t === 20), 'long gap gets dots');
  assert.equal(w.filter((l) => l.text).length, 3);
});

// ---------- Spotify transfer, endless music ----------

const sp = await import('../src/spotify.js');

test('Spotify: playlists and liked songs come over with paging', async () => {
  const seen = [];
  sp.setToken('tok');
  sp.setSpotifyTransport(async ({ url, headers }) => {
    seen.push(url);
    assert.equal(headers.Authorization, 'Bearer tok');
    const u = new URL(url);
    if (u.pathname === '/v1/me/playlists') return { status: 200, data: { items: [{ id: 'p1', name: 'Дорога' }, { id: 'p2', name: 'Discover Weekly' }], next: null } };
    if (u.pathname === '/v1/me/tracks') {
      if (!u.searchParams.get('offset')) return { status: 200, data: { items: [{ track: { name: 'Numb', duration_ms: 185000, artists: [{ name: 'Linkin Park' }], album: { name: 'Meteora' } } }], next: 'https://api.spotify.com/v1/me/tracks?offset=50&limit=50' } };
      return { status: 200, data: { items: [{ track: { name: 'Кукушка', duration_ms: 400000, artists: [{ name: 'Кино' }] } }], next: null } };
    }
    if (u.pathname === '/v1/playlists/p1/tracks') return { status: 200, data: { items: [{ track: { name: 'Сансара', duration_ms: 260000, artists: [{ name: 'Баста' }, { name: 'Скриптонит' }] } }, { track: null }], next: null } };
    if (u.pathname === '/v1/playlists/p2/tracks') return { status: 404, data: {} };
    return { status: 404, data: {} };
  });
  const got = [];
  await sp.importAll({ onStep: () => {}, onList: (g) => got.push(g) });
  assert.deepEqual(got.map((g) => g.name), ['Любимые треки (Spotify)', 'Дорога']);
  assert.equal(got[0].tracks.length, 2, 'second page read');
  assert.equal(got[0].tracks[0].duration, 185);
  assert.equal(got[1].tracks[0].artist, 'Баста, Скриптонит');
  assert.equal(got[1].origin, 'spotify:p1');
  const skipped = [];
  await sp.importAll({ onStep: () => {}, onList: (g) => skipped.push(g), skip: new Set(['spotify:liked', 'spotify:p1']) });
  assert.equal(skipped.length, 0, 'already brought over');
  sp.setSpotifyTransport(null);
});

test('Yandex station tracks for endless music', async () => {
  saveSettings({ yaToken: 'T', yaUid: '77' });
  ya.setYandexTransport(async (req) => {
    const u = new URL(req.url);
    assert.equal(u.pathname, '/rotor/station/track:10/tracks');
    assert.equal(u.searchParams.get('queue'), '10');
    return { status: 200, data: { result: { sequence: [{ type: 'track', track: { id: 31, title: 'Похожая', artists: [{ id: 1, name: 'Кто-то' }], albums: [{ id: 2 }], durationMs: 200000 } }] } } };
  });
  const r = await ya.stationTracks('track:10', 'y:10');
  assert.equal(r[0].key, 'y:31');
  ya.setYandexTransport(null);
  saveSettings({ yaToken: '', yaUid: '' });
});

test('Yandex "Моя волна" pages through the stream', async () => {
  saveSettings({ yaToken: 'T', yaUid: '77' });
  const queues = [];
  let n = 0;
  ya.setYandexTransport(async (req) => {
    const u = new URL(req.url);
    assert.equal(u.pathname, '/rotor/station/user:onyourwave/tracks');
    queues.push(u.searchParams.get('queue'));
    const batch = [0, 1, 2].map((i) => {
      const id = 100 + n * 3 + i;
      return { type: 'track', track: { id, title: 'Т' + id, artists: [{ id: 1, name: 'А' }], albums: [{ id: 2 }], durationMs: 180000 } };
    });
    n++;
    return { status: 200, data: { result: { sequence: batch } } };
  });
  const r = await ya.myWave(7);
  assert.equal(r.length, 7);
  assert.deepEqual(r.map((t) => t.key), ['y:100', 'y:101', 'y:102', 'y:103', 'y:104', 'y:105', 'y:106']);
  assert.deepEqual(queues, [null, '102', '105'], 'each request continues after the last track');
  ya.setYandexTransport(null);
  saveSettings({ yaToken: '', yaUid: '' });
});

test('Yandex personal playlists from the landing', async () => {
  saveSettings({ yaToken: 'T', yaUid: '77' });
  ya.setYandexTransport(async (req) => {
    const u = new URL(req.url);
    assert.equal(u.pathname, '/landing3');
    assert.equal(u.searchParams.get('blocks'), 'personalplaylists');
    return {
      status: 200,
      data: {
        result: {
          blocks: [
            {
              entities: [
                { data: { type: 'playlistOfTheDay', data: { uid: 503646255, kind: 101, title: 'Плейлист дня', trackCount: 60, cover: { uri: 'avatars.yandex.net/x/%%' } } } },
                { data: { type: 'neverHeard', data: { uid: 503646255, kind: 102, title: 'Дежавю' } } },
                { data: { type: 'kidsDaily', data: { uid: 1, kind: 3, title: 'Детям' } } },
                { data: { type: 'broken' } },
              ],
            },
          ],
        },
      },
    };
  });
  const r = await ya.personalPlaylists();
  assert.equal(r.length, 2);
  assert.equal(r[0].id, 'y:503646255:101');
  assert.equal(r[0].title, 'Плейлист дня');
  assert.equal(r[0].trackCount, 60);
  assert.ok(r[0].cover.startsWith('https://avatars.yandex.net/x/'));
  assert.equal(r[1].title, 'Дежавю');
  ya.setYandexTransport(null);
  saveSettings({ yaToken: '', yaUid: '' });
});

test('transferred tracks found in Yandex can be liked', async () => {
  const online = await import('../src/online.js');
  saveSettings({ yaToken: 'T', yaUid: '77' });
  assert.equal(online.serviceOf({ src: 'ext', yid: '5', key: 'x' }), 'yandex');
  assert.equal(online.serviceOf({ src: 'ext', key: 'x' }), '', 'not found in Yandex yet');
  assert.equal(online.serviceOf({ src: 'local', key: 'l' }), '');
  assert.equal(online.serviceOf({ src: 'yandex', yid: '9', key: 'y:9' }), 'yandex');
  saveSettings({ yaToken: '', yaUid: '' });
  assert.equal(online.serviceOf({ src: 'yandex', yid: '9', key: 'y:9' }), '', 'signed out');
});

test('LRCLIB: another recording of the song gives words without timings', () => {
  const t = { title: 'После той зимы', artist: 'есть что сказать', duration: 193 };
  const synced = '[00:05.00]После той зимы мы не встретимся точно\n[00:09.00]После тишины идёт многоточие';
  const r = lyr.pickLrclib(t, [{ trackName: 'После той зимы', artistName: 'есть что сказать', duration: 201, syncedLyrics: synced }]);
  assert.ok(r && !/\[\d/.test(r), 'timings removed for a version 8 s longer');
  assert.equal(lyr.parseLrc(r).synced, false);
  assert.equal(lyr.pickLrclib(t, [{ trackName: 'После той зимы', artistName: 'есть что сказать', duration: 194, syncedLyrics: synced }]), synced);
});

test('Likes from Звук go to Yandex «Мне нравится» in the same order', async () => {
  const pl = await import('../src/playlists.js');
  const lt = await import('../src/liketransfer.js');
  saveSettings({ yaToken: 'T', yaUid: '77' });
  const ext = (title, artist, extra = {}) => ({ key: 'e:' + title, src: 'ext', title, artist, artists: [{ name: artist }], duration: 200, ...extra });
  const p = pl.createPlaylist('Мне нравится (Звук)', [
    ext('Первая', 'Кино', { match: 'online', yid: '11' }),
    ext('Вторая', 'Земфира'), // not searched yet
    ext('Третья', 'Сплин', { match: 'none' }), // not found earlier
    ext('Четвёртая', 'Ария', { match: 'local', lid: 'L1' }), // plays from an MP3
    ext('Пятая', 'ДДТ', { match: 'online', yid: '15' }), // already liked
  ], 'zvuk', { origin: 'zvuk:liked' });
  const added = [];
  ya.setYandexTransport(async (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/users/77/likes/tracks') return { status: 200, data: { result: { library: { tracks: [{ id: '15' }] } } } };
    if (u.pathname === '/search') {
      const q = u.searchParams.get('text');
      const hit = q.includes('Вторая') ? { id: 12, title: 'Вторая', artists: [{ id: 2, name: 'Земфира' }], albums: [{ id: 1 }], durationMs: 200000 } : q.includes('Четвёртая') ? { id: 14, title: 'Четвёртая', artists: [{ id: 4, name: 'Ария' }], albums: [{ id: 1 }], durationMs: 200000 } : null;
      return { status: 200, data: { result: { tracks: { results: hit ? [hit] : [] } } } };
    }
    if (u.pathname === '/users/77/likes/tracks/add-multiple') {
      added.push(new URLSearchParams(req.data).get('track-ids'));
      return { status: 200, data: { result: 'ok' } };
    }
    return { status: 404, data: {} };
  });
  assert.ok(lt.looksLiked(p));
  const r = await lt.likeInYandex(p.id);
  assert.deepEqual(added, ['14,12,11'], 'last song first, the liked one skipped');
  assert.equal(r.added, 3);
  assert.equal(r.already, 1);
  assert.deepEqual(r.missing.map((t) => t.title), ['Третья']);
  const after = pl.getPlaylist(p.id).tracks;
  assert.equal(after[3].match, 'local', 'the MP3 song keeps playing from the file');
  assert.equal(after[3].yid, '14');
  assert.equal(after[1].yid, '12');
  pl.deletePlaylist(p.id);
  ya.setYandexTransport(null);
  saveSettings({ yaToken: '', yaUid: '' });
});
