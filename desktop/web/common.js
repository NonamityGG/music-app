// Резонанс для ПК: what every page shares — what's playing (with the position
// running on between the helper's reports), names of the players, time format.

export const $ = (id) => document.getElementById(id);

// AppUserModelID of the player -> a name people know
const APPS = [
  [/yandex/i, 'Яндекс Музыка'],
  [/spotify/i, 'Spotify'],
  [/zvuk|sber/i, 'Звук'],
  [/vk\b|vkmusic|vk\.music/i, 'VK Музыка'],
  [/chrome/i, 'Chrome'],
  [/msedge|edge/i, 'Edge'],
  [/firefox/i, 'Firefox'],
  [/opera/i, 'Opera'],
  [/brave/i, 'Brave'],
  [/zunemusic|media ?player/i, 'Медиаплеер'],
  [/aimp/i, 'AIMP'],
  [/foobar/i, 'foobar2000'],
  [/vlc/i, 'VLC'],
  [/telegram/i, 'Telegram'],
  [/apple ?music|itunes/i, 'Apple Music'],
  [/deezer/i, 'Deezer'],
  [/tidal/i, 'TIDAL'],
  [/youtube/i, 'YouTube Music'],
  [/rezonans|electron/i, 'Резонанс'],
];

export function appName(id) {
  const s = String(id || '');
  for (const [re, name] of APPS) if (re.test(s)) return name;
  const last = s.split(/[!\\/]/).pop().replace(/\.exe$/i, '');
  return last.length > 1 && last.length < 24 ? last : 'Плеер';
}

export function fmt(ms) {
  if (!(ms >= 0)) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// The playing state as reported by Windows, with the position kept running.
export function mediaState(onChange) {
  const st = { status: 'none', title: '', artist: '', album: '', app: '', pos: 0, dur: 0, canNext: false, canPrev: false, thumb: '' };
  let posAt = performance.now();
  let lastRep = null; // the last position the player itself reported, and when it changed
  const api = {
    st,
    active: () => !!(st.status && st.status !== 'none' && (st.title || st.artist)),
    playing: () => st.status === 'playing',
    key: () => (api.active() ? `${st.app}|${st.title}|${st.artist}` : ''),
    position() {
      if (!(st.dur > 0)) return Math.max(0, st.pos || 0) + (st.status === 'playing' ? performance.now() - posAt : 0);
      const extra = st.status === 'playing' ? performance.now() - posAt : 0;
      return Math.min(st.dur, (st.pos || 0) + extra);
    },
    // a local change that feels instant; Windows confirms it a moment later
    setLocal(patch) {
      if ('pos' in patch || 'status' in patch) {
        st.pos = 'pos' in patch ? patch.pos : api.position();
        posAt = performance.now();
      }
      Object.assign(st, patch);
      onChange(st, false);
    },
  };
  window.rez.onMedia((m) => {
    if (!m) return;
    if (m.status === 'none') {
      Object.assign(st, { status: 'none', title: '', artist: '', album: '', app: '', pos: 0, dur: 0, thumb: '' });
    } else {
      const thumbChanged = m.thumb !== undefined && m.thumb !== st.thumb;
      const now = performance.now();
      const running = api.position();
      const same = st.status === 'playing' && m.status !== 'paused' && m.status !== 'stopped' && (m.title === undefined || m.title === st.title) && (m.app === undefined || m.app === st.app);
      let keep = !('pos' in m);
      if (!keep && same) {
        // Some players (browsers) keep reporting the same position while the
        // song plays on, or one a little behind: the clock here runs on instead
        // of stepping back every second (the lyrics flickered with it). A real
        // seek — a new position, or one far back — is taken at once.
        const frozen = lastRep && Math.abs(m.pos - lastRep.pos) < 250 && now - lastRep.at > 700;
        const behind = running - m.pos;
        if (frozen || (behind > 0 && behind < 1500)) keep = true;
      }
      if ('pos' in m && (!lastRep || Math.abs(m.pos - lastRep.pos) >= 250)) lastRep = { pos: m.pos, at: now };
      Object.assign(st, m);
      if (keep) st.pos = running;
      if (m.thumb === undefined) st.thumb = st.thumb || '';
      st._thumbChanged = thumbChanged;
    }
    posAt = performance.now();
    onChange(st, true);
  });
  return api;
}

// The palette colours the page should use for its accents (the cover's own
// when the palette is "Из обложки" and a cover is known).
export function hexAlpha(hex, a) {
  const h = String(hex || '#7c4dff').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// The little level bars (logo, island): each bar is measured against its own
// recent range — its quietest and loudest of the last second or two — so they
// follow the beat. Raw levels of loud, mastered music sit near the top all the
// time and pinned the bars up. groups: [from, to) band ranges; returns a
// function (bands, out) -> out with 0..1 per bar, and whether anything is heard.
export function beatMeter(groups) {
  const n = groups.length;
  const lo = new Float32Array(n).fill(1);
  const hi = new Float32Array(n);
  const raw = new Float32Array(n);
  return (bands, out) => {
    let heard = false;
    for (let i = 0; i < n; i++) {
      const [a, b] = groups[i];
      let s = 0;
      for (let k = a; k < b; k++) s += bands[k];
      const v = s / Math.max(1, b - a);
      raw[i] = v;
      if (v > 0.04) heard = true;
      hi[i] = v > hi[i] ? v : hi[i] - (hi[i] - v) * 0.03;
      lo[i] = v < lo[i] ? v : lo[i] + (v - lo[i]) * 0.03;
      const span = Math.max(0.1, hi[i] - lo[i]);
      out[i] = Math.max(0, Math.min(1, (v - lo[i]) / span));
    }
    return heard;
  };
}
