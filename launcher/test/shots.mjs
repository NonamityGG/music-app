// Looks at the launcher in Chromium: phone and tablet sizes, a few states.
// node launcher/test/shots.mjs <outdir> — builds nothing, serves launcher's built www.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, mockScript } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.LAUNCHER_OUT || join(here, '..', 'android', 'app', 'src', 'main', 'assets', 'www');
const outDir = process.argv[2] || join(here, 'out');
mkdirSync(outDir, { recursive: true });
const { srv, port } = await serve(www);
const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function open(name, vp, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: !!vp.mobile, locale: 'ru-RU' });
  const page = await ctx.newPage();
  page.on('console', (m) => (m.type() === 'error' ? errors.push(name + ': ' + m.text()) : process.env.V && console.log(name, m.text())));
  page.on('pageerror', (e) => errors.push(name + ' PAGEERROR: ' + e.message));
  await page.addInitScript(mockScript(opts));
  await page.goto(`http://127.0.0.1:${port}/?nointro=1`);
  await wait(1500);
  return { page, ctx };
}

const shot = (page, name) => page.screenshot({ path: join(outDir, name + '.png') });

export { open, shot, wait, errors, browser, srv, outDir };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const phone = { width: 393, height: 851, mobile: true };
  const { page } = await open('phone', phone);
  await shot(page, 'phone-home');
  await page.evaluate(() => document.getElementById('pager').scrollTo({ left: 400, behavior: 'instant' }));
  await wait(400);
  await shot(page, 'phone-page2');
  await page.evaluate(() => document.getElementById('pager').scrollTo({ left: 0, behavior: 'instant' }));
  await wait(300);
  await page.click('#handle');
  await wait(700);
  await shot(page, 'phone-drawer');
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await browser.close();
  srv.close();
}
