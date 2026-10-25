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
      Object.assign(st, m);
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
