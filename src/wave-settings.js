// Picker for wave style and colours, used in the profile and in the player.

import { h, icon, clear } from './util.js';
import { settings, saveSettings } from './settings.js';
import { STYLES, PALETTES, renderPreview, configure } from './waves.js';
import { waveStatus, setWaveMode } from './player.js';

export function applyWaveSettings() {
  configure({ style: settings.wavesStyle, palette: settings.wavesPalette });
}

export function wavesPicker() {
  const root = h('div', { class: 'wave-picker' });
  let gen = 0;

  const render = () => {
    const my = ++gen;
    clear(root);
    const grid = h('div', { class: 'wave-grid' });
    const canvases = [];
    for (const st of STYLES) {
      const cv = h('canvas', { class: 'wave-thumb' });
      canvases.push([cv, st.id]);
      grid.appendChild(
        h(
          'button',
          {
            class: 'wave-tile' + (settings.wavesStyle === st.id ? ' active' : ''),
            'aria-pressed': settings.wavesStyle === st.id ? 'true' : 'false',
            onclick: () => {
              saveSettings({ wavesStyle: st.id });
              applyWaveSettings();
              render();
            },
          },
          cv,
          h('span', null, st.name)
        )
      );
    }
    grid.appendChild(
      h(
        'button',
        {
          class: 'wave-tile wave-off' + (settings.wavesStyle === 'off' ? ' active' : ''),
          'aria-pressed': settings.wavesStyle === 'off' ? 'true' : 'false',
          onclick: () => {
            saveSettings({ wavesStyle: 'off' });
            applyWaveSettings();
            render();
          },
        },
        h('div', { class: 'wave-thumb wave-thumb-off' }, icon('close', 26)),
        h('span', null, 'Выключить')
      )
    );

    const colors = h(
      'div',
      { class: 'palette-row' },
      PALETTES.map((p) =>
        h(
          'button',
          {
            class: 'palette' + (settings.wavesPalette === p.id ? ' active' : ''),
            'aria-pressed': settings.wavesPalette === p.id ? 'true' : 'false',
            onclick: () => {
              saveSettings({ wavesPalette: p.id });
              applyWaveSettings();
              render();
            },
          },
          h('span', { class: 'palette-swatch', style: { background: `linear-gradient(135deg, ${p.colors.join(', ')})` } }),
          h('span', null, p.name)
        )
      )
    );

    // listening to the track vs moving on their own
    const reactive = settings.wavesReactive !== false;
    const mode = h(
      'div',
      { class: 'seg wave-mode' },
      [
        [true, 'Слышат музыку'],
        [false, 'Простой режим'],
      ].map(([v, label]) =>
        h(
          'button',
          {
            class: 'seg-btn' + (reactive === v ? ' active' : ''),
            'aria-pressed': reactive === v ? 'true' : 'false',
            onclick: () => {
              setWaveMode(v);
              render();
            },
          },
          label
        )
      )
    );
    const hint = h(
      'div',
      { class: 'muted small' },
      reactive
        ? 'Волны берут ритм из самого трека.'
        : 'Волны двигаются сами, звук идёт напрямую — выбирай, если при выключенном экране обрывается музыка.'
    );
    const status = h('div', { class: 'wave-status' });
    const tick = () => {
      if (my !== gen || (!root.isConnected && tries > 0)) return;
      status.textContent = waveStatus();
      status.classList.toggle('ok', status.textContent === 'Волны слышат музыку');
      setTimeout(tick, 1000);
    };
    root.append(mode, hint, status, grid, colors);
    // thumbnails need the layout, so draw them once the picker is on screen
    let tries = 0;
    const paint = () => {
      if (!root.isConnected) return ++tries < 120 && requestAnimationFrame(paint);
      for (const [cv, id] of canvases) renderPreview(cv, id, settings.wavesPalette);
      tries = 1;
      tick();
    };
    requestAnimationFrame(paint);
  };

  render();
  return root;
}
