// Резонанс для ПК — the volume pill shown by the volume keys instead of Windows'
// own flyout. The helper takes the keys, changes the volume and says what it is
// now; the main process shows this window for a moment and hides it again.

const $ = (id) => document.getElementById(id);
const body = document.body;
const bars = $('bars');
const val = $('val');
const ic = $('ic');

const N = 24;
// a soft wave of heights, like the Резонанс logo: low at the edges, high in the middle
const cells = [];
for (let i = 0; i < N; i++) {
  const b = document.createElement('i');
  const x = i / (N - 1);
  const h = 0.38 + 0.62 * Math.pow(Math.sin(Math.PI * x), 0.8) * (0.8 + 0.2 * Math.sin(x * 9));
  b.style.height = `${Math.round(h * 100)}%`;
  bars.appendChild(b);
  cells.push(b);
}

const ICON = {
  off: 'M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z',
  low: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12z',
  high: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z',
};

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICON[name]);
  s.appendChild(p);
  ic.replaceChildren(s);
}

function show(d) {
  const vol = Math.max(0, Math.min(100, Math.round(Number(d.vol) || 0)));
  const muted = !!d.muted || vol === 0;
  const lit = Math.round((vol / 100) * N);
  cells.forEach((c, i) => {
    c.classList.toggle('on', i < lit);
    c.classList.toggle('edge', i === lit - 1);
  });
  val.textContent = String(vol);
  body.classList.toggle('muted', muted);
  icon(muted ? 'off' : vol < 50 ? 'low' : 'high');
}

function colors(s) {
  const c = (s && s.paletteColors) || ['#7c4dff', '#c3a6ff', '#ff6fd8'];
  body.style.setProperty('--acc', c[0]);
  body.style.setProperty('--acc3', c[1]);
  body.style.setProperty('--acc2', c[2]);
}

window.rez.onSettings(colors);
window.rez.settings().then(colors);
window.rez.onOsd((d) => {
  if (!d) return;
  if (d.open === false) return body.classList.remove('open');
  show(d);
  body.classList.add('open');
});
