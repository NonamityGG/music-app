// Резонанс для ПК: the main process helpers that don't need Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lyrics = require('../desktop/lib/lyrics.js');
const colors = require('../desktop/lib/colors.js');

test('LRC lines are read with their times, several stamps per line, sorted', () => {
  const lines = lyrics.parseLrc('[ar: x]\n[00:12.50]Первая\n[00:05.00][01:00.25]Припев\n[00:20]\n[00:30.1]<00:30.10>Слово <00:31.00>за словом');
  assert.deepEqual(
    lines.map((l) => [l.t, l.text]),
    [
      [5, 'Припев'],
      [12.5, 'Первая'],
      [20, ''],
      [30.1, 'Слово за словом'],
      [60.25, 'Припев'],
    ]
  );
});

test('titles lose the extras that break the lyrics search', () => {
  assert.equal(lyrics.clean('Song (feat. Someone) [Remastered 2011]'), 'Song');
  assert.equal(lyrics.clean('Песня - Radio Edit'), 'Песня');
  assert.equal(lyrics.clean('Track (Official Video)'), 'Track');
  assert.equal(lyrics.clean('Обычное название'), 'Обычное название');
  assert.equal(lyrics.firstArtist('Artist A, Artist B'), 'Artist A');
  assert.equal(lyrics.firstArtist('Artist A feat. B'), 'Artist A');
});

test('found lyrics stay cached, "not found" is asked again after a day', () => {
  const day = 24 * 3600 * 1000;
  const now = 10 * day;
  const words = { synced: true, lines: [] };
  assert.deepEqual(lyrics.fromCache(undefined, now), { hit: false });
  assert.deepEqual(lyrics.fromCache(words, now), { hit: true, res: words });
  assert.deepEqual(lyrics.fromCache({ miss: now - 1000 }, now), { hit: true, res: null });
  assert.equal(lyrics.fromCache({ miss: now - day - 1 }, now).hit, false);
  // saved by older versions: a bare null, no time
  assert.equal(lyrics.fromCache(null, now).hit, false);
});

test('Windows gets eight accent shades from the palette, the accent in the middle', () => {
  const c = colors.forPalette('violet');
  assert.equal(c.accent, '#7c4dff');
  assert.equal(c.palette.length, 8);
  assert.equal(c.palette[3], '#7c4dff');
  for (const h of c.palette) assert.match(h, /^#[0-9a-f]{6}$/);
  // lighter shades first, darker after
  const lum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  assert.ok(lum(c.palette[0]) > lum(c.palette[2]) && lum(c.palette[2]) > lum(c.palette[3]) && lum(c.palette[3]) > lum(c.palette[6]));
  // the selection colour is darker than the accent (white text reads on it)
  assert.ok(lum(c.highlight) < lum(c.accent));
  assert.equal(colors.forPalette('nope').accent, '#7c4dff');
});
