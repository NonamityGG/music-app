// Резонанс OS: icons. Simple 24×24 shapes in one colour, and the weather in
// several colours.

const NS = 'http://www.w3.org/2000/svg';

const P = {
  play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
  pause: 'M7 5h3.2v14H7zM13.8 5H17v14h-3.2z',
  next: 'M6 6.2v11.6a.8.8 0 0 0 1.23.67L15.5 13v4.8h2.5V6.2h-2.5V11L7.23 5.53A.8.8 0 0 0 6 6.2z',
  prev: 'M18 6.2v11.6a.8.8 0 0 1-1.23.67L8.5 13v4.8H6V6.2h2.5V11l8.27-5.47A.8.8 0 0 1 18 6.2z',
  gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  moon: 'M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5 8.6 8.6 0 1 0 20.5 14.6z',
  sliders: 'M4 7h9v2H4zM17 7h3v2h-3zM13 5h4v6h-4zM4 15h3v2H4zM11 15h9v2h-9zM7 13h4v6H7z',
  home: 'M12 3.2 2.8 11h2.7v9h5v-6h3v6h5v-9h2.7z',
  star: 'm12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z',
  hide: 'M2.7 4.1 4.1 2.7l17.2 17.2-1.4 1.4-3.3-3.3A10.6 10.6 0 0 1 12 19C6.5 19 2.7 14.6 1.5 12a13 13 0 0 1 4.1-5.1zM12 5c5.5 0 9.3 4.4 10.5 7a13.4 13.4 0 0 1-3 4l-3-3A4.5 4.5 0 0 0 11 7.5L8.9 5.4A10.6 10.6 0 0 1 12 5z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z',
  move: 'M12 2.5 15.5 6H13v5h5V8.5l3.5 3.5-3.5 3.5V13h-5v5h2.5L12 21.5 8.5 18H11v-5H6v2.5L2.5 12 6 8.5V11h5V6H8.5z',
  open: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
  chevron: 'M9 5.5 15.5 12 9 18.5 7.6 17.1 12.7 12 7.6 6.9z',
  wifi: 'M12 18.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM5.6 13.4a9.2 9.2 0 0 1 12.8 0l-1.7 1.7a6.8 6.8 0 0 0-9.4 0zM2.1 9.9a14 14 0 0 1 19.8 0l-1.7 1.7a11.6 11.6 0 0 0-16.4 0z',
  eth: 'M4 4h16v11h-4v3h-2v3h-4v-3H8v-3H4zm3 3v2h2V7zm4 0v2h2V7zm4 0v2h2V7z',
  nonet: 'M3.3 2 22 20.7l-1.4 1.4-4.9-4.9a6.6 6.6 0 0 0-1.5-.9L12 18.5h0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6l-4.6-2.9 1.4-1.4L1.9 3.4z',
  sber: 'M12 2.5a9.5 9.5 0 1 0 9.1 6.8l-1.9 1.4a7.4 7.4 0 1 1-2.7-4.1l1.8-1.3A9.4 9.4 0 0 0 12 2.5zm8.6 3.2-8.6 6.4-4-2.5v2.9l4 2.5 9.7-7.2a9.5 9.5 0 0 0-1.1-2.1z',
  waves: 'M3 10h2v4H3zM7 7h2v10H7zM11 4h2v16h-2zM15 8h2v8h-2zM19 11h2v2h-2z',
};

export function icon(name, cls) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', P[name] || '');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(p);
  return svg;
}

// ---------- weather, in colour ----------

// the parts have classes, so big pictures can move (see .wx-anim in style.css)
const SUN = '<circle cx="12" cy="12" r="4.6" fill="#ffd36b"/><g class="wx-rays" stroke="#ffd36b" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5"/></g>';
const MOON = '<path class="wx-moon" d="M19.5 14.4A8 8 0 0 1 9.6 4.5a8 8 0 1 0 9.9 9.9z" fill="#e8dcff"/>';
const CLOUD = (y = 0, c = '#eef0ff') => `<g transform="translate(0 ${y})"><path class="wx-cloud" d="M7 19h10.2a4.3 4.3 0 0 0 .5-8.6A5.8 5.8 0 0 0 6.6 11.2 3.9 3.9 0 0 0 7 19z" fill="${c}"/></g>`;
const SMALL_SUN = '<g transform="translate(-3.2 -3.4) scale(.78)">' + SUN + '</g>';
const SMALL_MOON = '<g transform="translate(-2.4 -2.6) scale(.72)">' + MOON + '</g>';
const RAIN = '<g stroke="#7fb5ff" stroke-width="1.7" stroke-linecap="round"><path class="wx-drop" d="M8.5 19.8l-1 2.4"/><path class="wx-drop d2" d="M12.5 19.8l-1 2.4"/><path class="wx-drop d3" d="M16.5 19.8l-1 2.4"/></g>';
const SNOW = '<g fill="#ffffff"><circle class="wx-flake" cx="8" cy="21" r="1.1"/><circle class="wx-flake d2" cx="12" cy="22.2" r="1.1"/><circle class="wx-flake d3" cx="16" cy="21" r="1.1"/></g>';
const BOLT = '<path class="wx-bolt" d="M12.8 15.5 10 20.2h2.4l-1 3.3 3.6-5h-2.4l1.2-3z" fill="#ffd36b"/>';
const FOG = '<g stroke="#d9dcf0" stroke-width="1.8" stroke-linecap="round"><path class="wx-fog" d="M4 10h16"/><path class="wx-fog d2" d="M6 14h12"/><path class="wx-fog d3" d="M4 18h16"/></g>';

// WMO weather codes (Open-Meteo) -> picture and words
export function weatherLook(code, day) {
  const c = Number(code);
  let svg;
  let words;
  if (c === 0) {
    svg = day ? SUN : MOON;
    words = 'ясно';
  } else if (c <= 2) {
    svg = (day ? SMALL_SUN : SMALL_MOON) + CLOUD(1.5);
    words = c === 1 ? 'малооблачно' : 'переменная облачность';
  } else if (c === 3) {
    svg = CLOUD(-1, '#c9cce6');
    words = 'пасмурно';
  } else if (c === 45 || c === 48) {
    svg = FOG;
    words = 'туман';
  } else if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) {
    svg = CLOUD(-2.5, '#c9cce6') + RAIN;
    words = c >= 80 ? 'ливень' : c <= 57 ? 'морось' : 'дождь';
  } else if ((c >= 71 && c <= 77) || c === 85 || c === 86) {
    svg = CLOUD(-2.5) + SNOW;
    words = 'снег';
  } else if (c >= 95) {
    svg = CLOUD(-2.5, '#b9bcd8') + BOLT;
    words = 'гроза';
  } else {
    svg = CLOUD(0);
    words = 'облачно';
  }
  return { svg: `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`, words };
}
