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
