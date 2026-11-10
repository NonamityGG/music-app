// Walks through the launcher like a hand would, in Chromium, and takes pictures.
// node launcher/test/scenarios.mjs <outdir> [name…]
import { open, shot, wait, errors, browser, srv } from './shots.mjs';

const only = process.argv.slice(3);
const STORE = JSON.stringify({ s: { homeAsked: true, introSeen: true }, l: {} });
const phone = { width: 393, height: 851, mobile: true };
const tabletL = { width: 1280, height: 800, mobile: true };
const tabletP = { width: 800, height: 1280, mobile: true };
const results = [];
const check = (name, ok, note = '') => {
  results.push([ok ? 'ok  ' : 'FAIL', name, note]);
};

const S = {
  async home() {
    const { page, ctx } = await open('home', phone, { store: STORE });
    await shot(page, 'phone-home');
    check('home has dock apps', (await page.locator('#dock .item').count()) >= 3);
    check('home has widgets', (await page.locator('.item.w').count()) >= 2);
    await ctx.close();
  },
  async drawer() {
    const { page, ctx } = await open('drawer', phone, { store: STORE });
    await page.click('#handle');
    await wait(700);
    await shot(page, 'phone-drawer');
    await page.fill('#q', 'тел');
    await wait(300);
    await shot(page, 'phone-drawer-search');
    check('search finds Телефон', (await page.locator('#drlist .item').count()) >= 1);
    await page.fill('#q', '12*3+4');
    await wait(300);
    await shot(page, 'phone-drawer-calc');
    await ctx.close();
  },
  async menu() {
    const { page, ctx } = await open('menu', phone, { store: STORE });
    const box = await page.locator('#pager .item.app').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.down();
    await wait(520);
    await shot(page, 'phone-menu');
    check('menu opens on long press', await page.locator('#menu.on').count());
    await page.mouse.up();
    await ctx.close();
  },
  async drag() {
    const { page, ctx } = await open('drag', phone, { store: STORE });
    const items = page.locator('#pager .item.app');
    const a = await items.nth(0).boundingBox();
    const b = await items.nth(5).boundingBox();
    const before = await page.evaluate(() => [...document.querySelectorAll('#pager .item.app')].map((n) => n.dataset.p));
    await page.mouse.move(a.x + a.width / 2, a.y + 30);
    await page.mouse.down();
    await wait(520);
    await page.mouse.move(a.x + a.width / 2 + 20, a.y + 60, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 10 });
    await wait(300);
    await shot(page, 'phone-drag');
    await page.mouse.up();
    await wait(500);
    const after = await page.evaluate(() => [...document.querySelectorAll('#pager .item.app')].map((n) => n.dataset.p));
    check('drag reorders', JSON.stringify(before) !== JSON.stringify(after), after.slice(0, 7).join(','));
    await shot(page, 'phone-dragged');
    await ctx.close();
  },
  async folder() {
    const { page, ctx } = await open('folder', phone, { store: STORE });
    const items = page.locator('#pager .item.app');
    const a = await items.nth(0).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 30);
    await page.mouse.down();
    await wait(520);
    await page.mouse.move(a.x + a.width / 2 + 20, a.y + 40, { steps: 4 });
    // the other icons moved while the first was lifted: the target is looked up again
    await wait(450);
    const t = await page.locator('#pager .item.app').nth(1).boundingBox();
    const ic = await page.locator('#pager .item.app').nth(1).locator('.ic').boundingBox();
    await page.mouse.move(ic.x + ic.width / 2, ic.y + ic.height / 2, { steps: 12 });
    await wait(900);
    await shot(page, 'phone-merge');
    await page.mouse.up();
    await wait(600);
    check('folder created', (await page.locator('#pager .item.folder').count()) === 1);
    await shot(page, 'phone-folder-made');
    await page.locator('#pager .item.folder').first().click();
    await wait(500);
    await shot(page, 'phone-folder-open');
    void t;
    await ctx.close();
  },
  async dots() {
    const { page, ctx } = await open('dots', phone, { store: STORE });
    const n = await page.evaluate(() => [document.querySelectorAll('#pager .page').length, document.querySelectorAll('#dots .dot').length, JSON.parse(localStorage.getItem('rez.l.state') || '{}').l]);
    check('pages', true, JSON.stringify([n[0], n[1], n[2] && n[2].pages && n[2].pages.map((p) => p.length)]));
    await ctx.close();
  },
  async settings() {
    const { page, ctx } = await open('settings', phone, { store: STORE });
    await page.click('#handle');
    await wait(500);
    await page.click('#drgear');
    await wait(600);
    await shot(page, 'phone-settings');
    for (const [i, id] of ['wall', 'colors', 'icons', 'desk', 'feed', 'drawer', 'gest', 'sys'].entries()) {
      await page.evaluate((k) => document.querySelectorAll('#stbody .st-row.nav')[k] && document.querySelectorAll('#stbody .st-row.nav')[k].click(), [0, 1, 2, 3, 4, 5, 6, 7][i]);
      await wait(350);
      await shot(page, 'phone-set-' + id);
      await page.click('#stback');
      await wait(250);
    }
    await ctx.close();
  },
  async widgets() {
    const { page, ctx } = await open('widgets', phone, { store: STORE });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('rez-open-widgets')));
    await wait(600);
    await shot(page, 'phone-widgets');
    await ctx.close();
  },
  async feed() {
    const { page, ctx } = await open('feed', phone, { store: STORE });
    await page.evaluate(() => document.getElementById('pager').scrollTo({ left: 0, behavior: 'instant' }));
    await wait(500);
    await shot(page, 'phone-feed');
    await ctx.close();
  },
  async tablet() {
    const { page, ctx } = await open('tabletL', tabletL, { store: STORE, tablet: true, insets: { t: 24, b: 0, l: 0, r: 0, ime: 0 } });
    await shot(page, 'tablet-land');
    await page.click('#handle');
    await wait(700);
    await shot(page, 'tablet-land-drawer');
    await ctx.close();
    const p = await open('tabletP', tabletP, { store: STORE, tablet: true, insets: { t: 24, b: 0, l: 0, r: 0, ime: 0 } });
    await shot(p.page, 'tablet-port');
    await p.page.evaluate(() => document.dispatchEvent(new CustomEvent('rez-open-settings')));
    await wait(600);
    await shot(p.page, 'tablet-port-settings');
    await p.ctx.close();
  },
  async sys() {
    const { page, ctx } = await open('sys', phone, { store: STORE });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('rez-open-widgets')));
    await wait(500);
    await shot(page, 'phone-sys-picker');
    check('picker lists app widgets', (await page.locator('.wgs').count()) === 2);
    await page.locator('.wgs .btn').first().click();
    await wait(900);
    await shot(page, 'phone-sys-added');
    check('placeholder on desktop', (await page.locator('#pager .item.w-sys').count()) === 1);
    const frames = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'frames').map((c) => c[1]));
    const f = JSON.parse(frames[frames.length - 1] || '[]');
    check('frame sent for widget 41', f.length === 1 && f[0].id === 41 && f[0].w > 100, JSON.stringify(f));
    // a menu hides the widgets, the long press from Android opens it
    await page.evaluate(() => window.__rezEmit('widgetLong', { id: 41 }));
    await wait(400);
    await shot(page, 'phone-sys-menu');
    check('menu opened', await page.locator('#menu.on').count());
    const frames2 = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'frames').map((c) => c[1]));
    check('widgets hidden under menu', frames2[frames2.length - 1] === '[]');
    await page.locator('#menu .mi-sizes .sz').nth(3).click();
    await wait(500);
    await page.evaluate(() => window.__rezEmit('widgetLong', { id: 41 }));
    await wait(300);
    await page.locator('#menu .mi.danger, #menu .danger').first().click();
    await wait(500);
    check('placeholder removed', (await page.locator('#pager .item.w-sys').count()) === 0);
    const rm = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'widgetRemove'));
    check('native told to let go', rm.length === 1 && rm[0][1] === 41, JSON.stringify(rm));
    await ctx.close();
  },
  async looks() {
    const variants = [
      ['fire-ember', { palette: 'fire', bg: 'ember', style: 'neon' }],
      ['aurora-capsules', { palette: 'aurora', bg: 'aurora', style: 'capsules' }],
      ['mono-amoled-circle', { palette: 'mono', bg: 'amoled', shape: 'circle', style: 'orb' }],
      ['sakura-round-list', { palette: 'sakura', shape: 'round', iconSize: 1.2 }],
    ];
    for (const [name, s] of variants) {
      const store = JSON.stringify({ s: { homeAsked: true, introSeen: true, ...s }, l: {} });
      const { page, ctx } = await open('look-' + name, phone, { store });
      await shot(page, 'look-' + name);
      await ctx.close();
    }
  },
};

const names = only.length ? only : Object.keys(S);
for (const n of names) {
  try {
    await S[n]();
  } catch (e) {
    check(n, false, e.message.split('\n')[0]);
  }
}
for (const r of results) console.log(r.join(' '));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
srv.close();
