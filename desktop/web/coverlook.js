// Резонанс для ПК: the colours of the menus (Start, Quick settings) when the
// palette is "from the cover" — the colours of what's playing, worked out from
// its cover the same way the waves do; otherwise (or with nothing playing) the
// palette's own colours.

import { coverColors, setCoverColors } from './looks.js';

const FALLBACK = ['#7c4dff', '#c3a6ff', '#ff6fd8'];
let thumb = '';
let cols = null; // the colours of `thumb`, false when it has none worth using
let pending = '';

// apply(colors, wavePalette) is called at once with what is known, and once
// more when a new cover's colours are ready
export function coverAccent(s, media, apply) {
  const fixed = (s && s.paletteColors) || FALLBACK;
  if (!s || s.palette !== 'cover') return apply(fixed, (s && s.palette) || 'violet');
  const t = (media && media.status !== 'none' && media.thumb) || '';
  const keep = () => (cols ? apply(cols, 'cover') : apply(fixed, s.lastPalette));
  if (!t) {
    // nothing playing: the last cover's colours stay, like on the wallpaper
    return keep();
  }
  if (t === thumb) return keep();
  keep(); // the old colours until the new ones are worked out
  if (t === pending) return;
  pending = t;
  coverColors(t).then((c) => {
    if (pending !== t) return;
    pending = '';
    thumb = t;
    cols = c || false;
    if (c) setCoverColors(c);
    keep();
  });
}
