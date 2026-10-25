// Builds the Резонанс OS page into the Android project's assets (www/): one
// bundled script for old TV browser engines, the styles, the fonts. The waves
// are the phone app's (src/waves.js) and the PC app's looks, fed by the TV's
// own sound through web/graph.js.
import { build } from 'esbuild';
import { mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'android', 'app', 'src', 'main', 'assets', 'www');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

const tvGraph = {
  name: 'tv-audio-graph',
  setup(b) {
    b.onResolve({ filter: /audio-graph\.js$/ }, () => ({ path: join(here, 'web', 'graph.js') }));
  },
};

await build({
  entryPoints: [join(here, 'web', 'main.js')],
  outfile: join(out, 'app.js'),
  bundle: true,
  format: 'iife',
  // TV boxes keep old browser engines (Android 9 shipped Chrome 66-69)
  target: ['chrome61'],
  minify: true,
  plugins: [tvGraph],
  logLevel: 'warning',
});

for (const f of ['index.html', 'style.css']) copyFileSync(join(here, 'web', f), join(out, f));

const ranges = {
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
};
let faces = '';
for (const [pkg, family, weights] of [
  ['unbounded', 'Unbounded', [500, 700]],
  ['onest', 'Onest', [400, 500, 600, 700]],
]) {
  for (const w of weights) {
    for (const subset of ['cyrillic', 'latin']) {
      const file = `${pkg}-${subset}-${w}-normal.woff2`;
      copyFileSync(join(root, 'node_modules', '@fontsource', pkg, 'files', file), join(out, 'fonts', file));
      faces += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:block;src:url(fonts/${file}) format('woff2');unicode-range:${ranges[subset]};}\n`;
    }
  }
}
writeFileSync(join(out, 'fonts.css'), faces);
console.log('built tv/android/app/src/main/assets/www');
