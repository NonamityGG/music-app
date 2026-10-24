// Picker for wave style, colours and mode, used in the profile and in the player.
// Built once; a tap only moves the marks (rebuilding it redrew seven preview
// canvases at once, which is what made switching stutter).

import { h, icon } from './util.js';
import { settings, saveSettings } from './settings.js';
import { STYLES, PALETTES, renderPreview, configure } from './waves.js';
import { waveStatus, setWaveMode } from './player.js';

export function applyWaveSettings() {
  configure({ style: settings.wavesStyle, palette: settings.wavesPalette });
}

const check = (size) => h('span', { class: 'tile-check', 'aria-hidden': 'true' }, icon('check', size));

export function wavesPicker() {
  const root = h('div', { class: 'wave-picker' });

  // --- mode ---
  const modeBtns = [
    [true, 'Слышат музыку'],
    [false, 'Простой режим'],
  ].map(([v, label]) => {
    const b = h('button', { class: 'seg-btn' }, label);
    b.onclick = () => {
      if ((settings.wavesReactive !== false) === v) return;
      markMode(v);
      // let the marks move first, then switch the sound over
      requestAnimationFrame(() => setTimeout(() => setWaveMode(v), 0));
    };
    b._v = v;
    return b;
  });
  const mode = h('div', { class: 'seg wave-mode' }, modeBtns);
  const hint = h('div', { class: 'muted small' });
  function markMode(v = settings.wavesReactive !== false) {
    for (const b of modeBtns) {
      b.classList.toggle('active', b._v === v);
      b.setAttribute('aria-pressed', b._v === v ? 'true' : 'false');
    }
    hint.textContent = v ? 'Волны берут ритм из самого трека.' : 'Волны двигаются сами, звук идёт напрямую — выбирай, если при выключенном экране обрывается музыка.';
  }

  // --- styles ---
  const tiles = [];
  const grid = h('div', { class: 'wave-grid' });
  for (const st of [...STYLES, { id: 'off', name: 'Выключить' }]) {
    const thumb = st.id === 'off' ? h('div', { class: 'wave-thumb wave-thumb-off' }, icon('close', 26)) : h('canvas', { class: 'wave-thumb' });
    const tile = h('button', { class: 'wave-tile' + (st.id === 'off' ? ' wave-off' : '') }, thumb, h('span', null, st.name));
    tile._id = st.id;
    tile._thumb = thumb;
    tile.onclick = () => {
      if (settings.wavesStyle === st.id) return;
      saveSettings({ wavesStyle: st.id });
      markStyle();
      applyWaveSettings();
    };
    tiles.push(tile);
    grid.appendChild(tile);
  }
  function markStyle() {
    for (const t of tiles) {
      const on = t._id === settings.wavesStyle;
      t.classList.toggle('active', on);
      t.setAttribute('aria-pressed', on ? 'true' : 'false');
      const c = t.querySelector('.tile-check');
      if (on && !c) t.appendChild(check(14));
      if (!on && c) c.remove();
    }
  }

  // --- colours ---
  const pals = PALETTES.map((p) => {
    const sw = h('span', { class: 'palette-swatch', style: { background: `linear-gradient(135deg, ${p.colors.join(', ')})` } });
    const b = h('button', { class: 'palette' }, sw, h('span', null, p.name));
    b._id = p.id;
    b._sw = sw;
    b.onclick = () => {
      if (settings.wavesPalette === p.id) return;
      saveSettings({ wavesPalette: p.id });
      markPalette();
      applyWaveSettings();
      paintPreviews();
    };
    return b;
  });
  const colors = h('div', { class: 'palette-row' }, pals);
  function markPalette() {
    for (const b of pals) {
      const on = b._id === settings.wavesPalette;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const svg = b._sw.querySelector('svg');
      if (on && !svg) b._sw.appendChild(icon('check', 18));
      if (!on && svg) svg.remove();
    }
  }

  // previews are drawn one per frame, never all at once
  let paintGen = 0;
  function paintPreviews() {
    const my = ++paintGen;
    const list = tiles.filter((t) => t._id !== 'off');
    let i = 0;
    let waited = 0;
    const step = () => {
      if (my !== paintGen || i >= list.length) return;
      if (!root.isConnected) return ++waited < 120 && requestAnimationFrame(step); // wait until on screen
      renderPreview(list[i]._thumb, list[i]._id, settings.wavesPalette);
      i++;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // --- status line ---
  const status = h('div', { class: 'wave-status' });
  let ticks = 0;
  const tick = () => {
    if (!root.isConnected && ++ticks > 120) return;
    if (root.isConnected) {
      ticks = 0;
      const text = waveStatus();
      if (status.textContent !== text) {
        status.textContent = text;
        status.classList.toggle('ok', text === 'Волны слышат музыку');
      }
    }
    setTimeout(tick, 1000);
  };

  root.append(mode, hint, status, grid, colors);
  markMode();
  markStyle();
  markPalette();
  paintPreviews();
  tick();
  return root;
}
