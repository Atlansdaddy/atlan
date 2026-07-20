import pw from '/usr/lib/node_modules/playwright/index.js';
import { readFileSync } from 'node:fs';
const TOKEN = readFileSync(new URL('../.auth-token', import.meta.url), 'utf8').trim();
const b = await pw.chromium.launch();
const page = await b.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.addInitScript((t) => localStorage.setItem('atlanToken', t), TOKEN);
await page.goto('http://127.0.0.1:4589/');
await page.waitForTimeout(1200);
console.log('halo canvas present:', await page.locator('#atlanHalo').count() === 1);
console.log('greeting shown:', (await page.locator('#atlanLine').innerText()).length > 5, '→', await page.locator('#atlanLine').innerText());
// canvas actually drawing? sample pixels twice, must differ (animation) and be non-blank
const active = await page.evaluate(() => new Promise((ok) => {
  const cv = document.getElementById('atlanHalo'), cx = cv.getContext('2d');
  const sum = () => cx.getImageData(0, 0, cv.width, cv.height).data.reduce((a, v) => a + v, 0);
  const s1 = sum();
  setTimeout(() => ok({ nonBlank: s1 > 0, animating: sum() !== s1 }), 400);
}));
console.log('halo drawing:', active.nonBlank, '| animating:', active.animating);
// mood switch drives aura + line
await page.evaluate(() => document.body.classList.add('night'));
await page.waitForTimeout(200);
console.log('night class dims phone:', await page.evaluate(() => getComputedStyle(document.querySelector('.phone')).filter.includes('brightness')));
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
