'use strict';
/**
 * 前端建置：
 *  1. 把前端需要的核心模組（金額、日期）複製到 docs/js/core/，去掉 Node 專用區塊（前端與後端共用同一份計算邏輯）。
 *  2. 產生 docs/sw.js：把 docs/ 底下所有檔案列進快取清單，版本號用「檔案內容的雜湊」——
 *     改了任何一個檔案版本就自動變，不用手動維護清單和版本號，手機上的 App 一定會抓到新版。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { strip } = require('./build-gas.js');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const SHARED = ['money.js', 'dates.js'];

function buildCore() {
  const outDir = path.join(DOCS, 'js/core');
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of SHARED) {
    const src = fs.readFileSync(path.join(ROOT, 'core', f), 'utf8');
    fs.writeFileSync(path.join(outDir, f), '/* 自動產生自 core/' + f + '，請勿直接編輯 */\n' + strip(src));
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function buildSw() {
  // 大張的 png 圖示（512、apple-touch）只有安裝到主畫面時才用到，不放進離線快取；192 的有放
  const files = walk(DOCS).map((p) => path.relative(DOCS, p).split(path.sep).join('/'))
    .filter((f) => f !== 'sw.js' && (!f.endsWith('.png') || f === 'icons/icon-192.png')).sort();
  const hash = crypto.createHash('sha256');
  files.forEach((f) => hash.update(f).update(fs.readFileSync(path.join(DOCS, f))));
  const version = 'fin-' + hash.digest('hex').slice(0, 10);
  const shell = ['./'].concat(files);
  const src = `/* Service Worker（由 tools/build-web.js 自動產生，請勿直接編輯；要改請改 tools/build-web.js 再 npm run build）
 * 讓網站可以安裝成 App，離線時也能開啟。
 * 策略：同網域的檔案「快取優先」——安裝時整批存好這一版（VERSION＝所有檔案內容的雜湊，改版就整批換新），
 * 所以訊號差、離線都能秒開；改版時瀏覽器抓到新的 sw.js 會先把新的一批裝好，新版接手後畫面自動重新載入一次。
 * 呼叫後端 API 的請求（跨網域 POST）完全不經過快取。 */
const VERSION = '${version}';
const SHELL = ${JSON.stringify(shell, null, 2)};

self.addEventListener('install', (e) => {
  // cache: 'reload'：略過瀏覽器的 HTTP 快取（GitHub Pages 會叫瀏覽器把檔案記 10 分鐘），確保存進來的是這一版的檔案
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => {
    if (hit) return hit;
    return fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }).catch((err) => (req.mode === 'navigate' ? c.match('./').then((x) => x || c.match('index.html')) : Promise.reject(err)));
  })));
});
`;
  fs.writeFileSync(path.join(DOCS, 'sw.js'), src);
  return { version, files: shell };
}

function build() { buildCore(); return buildSw(); }
if (require.main === module) { const r = build(); console.log(`docs/js/core 已更新；docs/sw.js 已產生（${r.version}，${r.files.length} 個檔案）`); }
module.exports = { build };
