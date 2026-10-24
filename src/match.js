// Fuzzy matching of the same song across sources (Zvuk ↔ local MP3).

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[([{].*?[)\]}]/g, ' ') // (feat. X), [Remastered], {Live}
    .replace(/\b(feat|ft|prod)\.?\s.*$/i, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function artistTokens(track) {
  const names = track.artists && track.artists.length ? track.artists.map((a) => a.name) : String(track.artist || '').split(/,|&|\sfeat\.?\s|\sft\.?\s|\sx\s/i);
  return names.map(norm).filter(Boolean);
}

// 0..1, how sure we are that a and b are the same song.
export function matchScore(a, b) {
  const ta = norm(a.title);
  const tb = norm(b.title);
  if (!ta || !tb) return 0;
  let titleScore = 0;
  if (ta === tb) titleScore = 1;
  else if (ta.length > 3 && tb.length > 3 && (ta.includes(tb) || tb.includes(ta))) titleScore = 0.75;
  else return 0;

  const aa = artistTokens(a);
  const ab = artistTokens(b);
  if (!aa.length || !ab.length) return titleScore * 0.6;
  const artistHit = aa.some((x) => ab.some((y) => x === y || (x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x)))));
  if (!artistHit) return titleScore * 0.3;

  let score = titleScore;
  if (a.duration && b.duration) {
    const diff = Math.abs(a.duration - b.duration);
    if (diff > 20) score *= 0.85;
  }
  return score;
}

export function bestMatch(track, candidates, threshold = 0.7) {
  let best = null;
  let bestScore = threshold;
  for (const c of candidates) {
    const s = matchScore(track, c);
    if (s >= bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}
