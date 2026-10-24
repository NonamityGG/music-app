// Picker for wave style and colours, used in the profile and in the player.

import { h, icon, clear } from './util.js';
import { settings, saveSettings } from './settings.js';
import { STYLES, PALETTES, renderPreview, configure } from './waves.js';

export function applyWaveSettings() {
  configure({ style: settings.wavesStyle, palette: settings.wavesPalette });
}

export function wavesPicker() {
  const root = h('div', { class: 'wave-picker' });

  const render = () => {
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

    root.append(grid, colors);
    // thumbnails need the layout, so draw them once the picker is on screen
    let tries = 0;
    const paint = () => {
      if (!root.isConnected) return ++tries < 120 && requestAnimationFrame(paint);
      for (const [cv, id] of canvases) renderPreview(cv, id, settings.wavesPalette);
    };
    requestAnimationFrame(paint);
  };

  render();
  return root;
}
