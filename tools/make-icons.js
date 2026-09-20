'use strict';
/** 產生 PWA 圖示 PNG（開發用，需要 Playwright）。docs/icons 內已附上產出的檔案，一般不需要重跑。 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const dir = path.join(__dirname, '../docs/icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const fullBleed = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#8fac97"/>${inner}</svg>`;
const coinOnly = svg.replace(/^[\s\S]*?<circle/, '<circle');           // 去掉圓角底，只留硬幣
const inner = coinOnly.replace(/<\/svg>\s*$/, '');
const maskable = fullBleed(`<g transform="translate(256 256) scale(.78) translate(-256 -256)">${inner}</g>`);
const touch = fullBleed(inner);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  async function render(markup, size, file) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await page.screenshot({ path: path.join(dir, file), omitBackground: true });
  }
  await render(svg, 192, 'icon-192.png');
  await render(svg, 512, 'icon-512.png');
  await render(maskable, 512, 'icon-maskable-512.png');
  await render(touch, 180, 'apple-touch-icon.png');
  await browser.close();
  console.log('icons done');
})();
