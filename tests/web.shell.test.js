'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOCS = path.join(__dirname, '..', 'docs');
const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');
const shell = eval(/const SHELL = (\[[\s\S]*?\]);/.exec(sw)[1]); // 只是取出陣列文字

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

test('離線快取清單：每個檔案都存在（否則 Service Worker 會安裝失敗）', () => {
  for (const f of shell) {
    if (f === './') continue;
    assert.ok(fs.existsSync(path.join(DOCS, f)), '快取清單裡的檔案不存在：' + f);
  }
});

test('離線快取清單：所有 js 檔都在清單內（新增檔案時不能漏掉）', () => {
  const jsFiles = walk(path.join(DOCS, 'js')).map((f) => path.relative(DOCS, f).split(path.sep).join('/'));
  for (const f of jsFiles) assert.ok(shell.includes(f), 'js 檔沒有加進 sw.js 的 SHELL：' + f);
});

test('index.html 與 manifest 參照的檔案都存在', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="(?!https?:|#|data:)([^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(DOCS, m[1].split('?')[0])), 'index.html 參照的檔案不存在：' + m[1]);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(DOCS, icon.src)), 'manifest 圖示不存在：' + icon.src);
});

test('前端沒有直接寫入 innerHTML（避免備註等文字被當成 HTML 執行）', () => {
  // icons.js 只塞寫死的 SVG 常數，不含使用者輸入，例外放行；其餘檔案一律不可以
  for (const f of walk(path.join(DOCS, 'js')).filter((x) => !x.includes(path.join('js', 'core')) && !x.endsWith('icons.js'))) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(src), f + ' 使用了 innerHTML／insertAdjacentHTML');
  }
});
