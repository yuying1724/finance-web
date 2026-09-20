/* Service Worker：讓網站可安裝成 App，並在離線時至少能開啟外殼。
 * 策略：同網域的檔案「網路優先、失敗才用快取」，這樣更新程式後不會被舊快取卡住。
 * 呼叫後端 API 的請求（跨網域 POST）完全不經過快取。 */
const VERSION = 'fin-v0.4.0';
const SHELL = [
  './', 'index.html', 'config.js', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/api.js', 'js/store.js', 'js/data.js', 'js/dom.js', 'js/icons.js', 'js/fmt.js', 'js/ui.js',
  'js/views/login.js', 'js/views/home.js', 'js/views/transactions.js', 'js/views/accounts.js', 'js/views/settings.js',
  'js/views/txform.js', 'js/views/accountform.js', 'js/views/categories.js',
  'js/views/invest.js', 'js/views/holdings.js', 'js/views/instruments.js', 'js/views/instrumentform.js', 'js/views/brokers.js', 'js/views/brokerform.js',
  'js/views/liability.js', 'js/views/recurring.js',
  'js/core/money.js', 'js/core/dates.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
