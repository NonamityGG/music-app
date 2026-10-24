// Builds the web part of the app into www/ (bundled JS, CSS with local fonts).
import { build } from 'esbuild';
import { mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = 'www';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

const version = process.env.APP_VERSION_NAME || JSON.parse(readFileSync('package.json', 'utf8')).version;

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome100'],
  minify: true,
  sourcemap: false,
  outfile: join(out, 'app.js'),
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
});

// Fonts: only Cyrillic and Latin subsets of the weights the CSS uses.
const fonts = [
  ['unbounded', 'Unbounded', [500, 700]],
  ['onest', 'Onest', [400, 500, 600, 700]],
];
const ranges = {
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
};
let faces = '';
for (const [pkg, family, weights] of fonts) {
  for (const w of weights) {
    for (const subset of ['cyrillic', 'latin']) {
      const file = `${pkg}-${subset}-${w}-normal.woff2`;
      copyFileSync(join('node_modules', '@fontsource', pkg, 'files', file), join(out, 'fonts', file));
      faces += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format('woff2');unicode-range:${ranges[subset]};}\n`;
    }
  }
}

writeFileSync(join(out, 'style.css'), faces + readFileSync('src/style.css', 'utf8'));
copyFileSync('src/index.html', join(out, 'index.html'));
console.log(`built www/ (version ${version})`);
