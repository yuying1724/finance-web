/* Service Worker：讓網站可安裝成 App，並在離線時至少能開啟外殼。
 * 策略：同網域的檔案「網路優先、失敗才用快取」，這樣更新程式後不會被舊快取卡住。
 * 向網路要檔案時一律帶 cache: 'no-cache'（先問伺服器有沒有新版，沒變就回 304，很省流量）：
 * GitHub Pages 會叫瀏覽器把檔案快取 10 分鐘，不這樣做的話手機剛更新完的 10 分鐘內重新整理還是舊畫面。
 * 呼叫後端 API 的請求（跨網域 POST）完全不經過快取。 */
const VERSION = 'fin-v0.9.30';
const SHELL = [
  './', 'index.html', 'config.js', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/api.js', 'js/store.js', 'js/data.js', 'js/dom.js', 'js/icons.js', 'js/fmt.js', 'js/ui.js',
  'js/views/login.js', 'js/views/home.js', 'js/views/transactions.js', 'js/views/accounts.js', 'js/views/settings.js',
  'js/views/txform.js', 'js/views/accountform.js', 'js/views/categories.js',
  'js/views/invest.js', 'js/views/holdings.js', 'js/views/instruments.js', 'js/views/instrumentform.js', 'js/views/brokers.js', 'js/views/brokerform.js',
  'js/views/liability.js', 'js/views/recurring.js', 'js/views/cards.js', 'js/views/installments.js', 'js/views/nwchart.js', 'js/views/cashflow.js', 'js/views/todo.js', 'js/views/spending.js',
  'js/core/money.js', 'js/core/dates.js',
];

self.addEventListener('install', (e) => {
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
  // 頁面導覽（mode: navigate）的 Request 不能再帶 RequestInit，所以改用網址重新發一次
  const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
  e.respondWith(
    fresh.then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
