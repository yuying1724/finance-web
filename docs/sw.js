/* Service Worker（由 tools/build-web.js 自動產生，請勿直接編輯；要改請改 tools/build-web.js 再 npm run build）
 * 讓網站可以安裝成 App，離線時也能開啟。
 * 策略：同網域的檔案「快取優先」——安裝時整批存好這一版（VERSION＝所有檔案內容的雜湊，改版就整批換新），
 * 所以訊號差、離線都能秒開；改版時瀏覽器抓到新的 sw.js 會先把新的一批裝好，新版接手後畫面自動重新載入一次。
 * 呼叫後端 API 的請求（跨網域 POST）完全不經過快取。 */
const VERSION = 'fin-edf39decf7';
const SHELL = [
  "./",
  "config.js",
  "css/app.css",
  "icons/icon-192.png",
  "icons/icon.svg",
  "index.html",
  "js/api.js",
  "js/app.js",
  "js/biometric.js",
  "js/core/dates.js",
  "js/core/money.js",
  "js/data.js",
  "js/dom.js",
  "js/fmt.js",
  "js/icons.js",
  "js/readcache.js",
  "js/store.js",
  "js/ui.js",
  "js/views/accountform.js",
  "js/views/accounts.js",
  "js/views/allocation.js",
  "js/views/brokerform.js",
  "js/views/brokers.js",
  "js/views/cardrecon.js",
  "js/views/cards.js",
  "js/views/cashflow.js",
  "js/views/categories.js",
  "js/views/dividends.js",
  "js/views/holdings.js",
  "js/views/home.js",
  "js/views/installments.js",
  "js/views/instrumentform.js",
  "js/views/instruments.js",
  "js/views/invest.js",
  "js/views/investreport.js",
  "js/views/liability.js",
  "js/views/lockscreen.js",
  "js/views/login.js",
  "js/views/merchants.js",
  "js/views/nwchart.js",
  "js/views/quicktx.js",
  "js/views/realized.js",
  "js/views/recurring.js",
  "js/views/settings.js",
  "js/views/settlements.js",
  "js/views/spending.js",
  "js/views/todo.js",
  "js/views/transactions.js",
  "js/views/txform.js",
  "js/views/yearview.js",
  "manifest.webmanifest"
];

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
