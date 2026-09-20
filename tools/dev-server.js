'use strict';
/**
 * 本機開發伺服器：提供 docs/ 靜態檔案，並在 POST /api 執行「真正打包後的 Code.gs」（搭配記憶體版 Google 服務）。
 * 用途：不必部署到 Google 就能在瀏覽器完整試用、跑端到端測試。資料只存在記憶體，關掉就消失。
 *   node tools/dev-server.js [--port 8787] [--demo]
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadBackend } = require('../tests/helpers/backend.js');

const DOCS = path.join(__dirname, '../docs');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function seedDemo(b) {
  const acct = (name, type, sym = 'TWD', inst = name) => b.call('upsertAccount', { account: { name, type, defaultSymbol: sym, institution: inst } }).data.account.id;
  const bank = acct('玉山活存', '銀行', 'TWD', '玉山銀行');
  const cash = acct('錢包現金', '現金');
  const card = acct('國泰信用卡', '信用卡', 'TWD', '國泰世華');
  const usd = acct('美元活存', '銀行', 'USD', '玉山銀行');
  const cats = b.call('bootstrap').data.categories;
  const cat = (n, t) => cats.find((c) => c.name === n && (!t || c.type === t)).id;
  const today = b.ctx.FinDates.today(Date.now());
  const day = (n) => b.ctx.FinDates.addDays(today, -n);
  const add = (tx) => { const r = b.call('addTransaction', { tx }); if (!r.ok) throw new Error(JSON.stringify(r)); };
  add({ type: '調整', date: day(40), dstAccount: bank, dstSymbol: 'TWD', dstQty: 180000, note: '期初餘額' });
  add({ type: '調整', date: day(40), dstAccount: cash, dstSymbol: 'TWD', dstQty: 3200 });
  add({ type: '調整', date: day(40), dstAccount: usd, dstSymbol: 'USD', dstQty: 1500 });
  add({ type: '收入', date: day(9), dstAccount: bank, dstSymbol: 'TWD', dstQty: 62000, categoryId: cat('薪資', '收入'), note: '本月薪資' });
  add({ type: '支出', date: day(8), srcAccount: card, srcSymbol: 'TWD', srcQty: 1280, categoryId: cat('晚餐'), note: '和朋友聚餐' });
  add({ type: '支出', date: day(6), srcAccount: cash, srcSymbol: 'TWD', srcQty: 85, categoryId: cat('早餐') });
  add({ type: '支出', date: day(5), srcAccount: bank, srcSymbol: 'TWD', srcQty: 12000, categoryId: cat('房租房貸'), note: '房租' });
  add({ type: '支出', date: day(3), srcAccount: card, srcSymbol: 'TWD', srcQty: 3590, categoryId: cat('3C 電子'), note: '行動電源' });
  add({ type: '轉帳', date: day(2), srcAccount: bank, srcSymbol: 'TWD', srcQty: 3590, dstAccount: card, dstSymbol: 'TWD', dstQty: 3590, note: '繳卡費' });
  add({ type: '換匯', date: day(1), srcAccount: bank, srcSymbol: 'TWD', srcQty: 32000, dstAccount: usd, dstSymbol: 'USD', dstQty: 1000 });
  add({ type: '支出', date: today, srcAccount: cash, srcSymbol: 'TWD', srcQty: 150, categoryId: cat('午餐'), note: '便當' });
  // 匯率公式在真實試算表會自動算出，開發環境手動放一個
  b.ss.sheet('價格').formulaResults['2,2'] = 32;
  b.ctx.dailyJob();
}

function startDevServer({ port = 0, demo = false, pin = '246810' } = {}) {
  const b = loadBackend();
  b.state.clock.now = Date.now();
  b.ctx.FinClock.now = () => Date.now();
  b.setup({ pin });
  if (demo) seedDemo(b);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        const out = b.ctx.doPost({ postData: { contents: body } });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(out.getContent());
      });
      return;
    }
    if (url.pathname === '/config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); res.end("window.FIN_CONFIG = { apiUrl: '/api' };"); return; }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(DOCS, rel);
    if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    resolve({ server, backend: b, port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, token: b.token, pin: b.pin, close: () => new Promise((r) => server.close(r)) });
  }));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8787;
  startDevServer({ port, demo: args.includes('--demo') }).then((s) => {
    console.log(`開發伺服器：${s.url}\n裝置授權碼：${s.token}\nPIN：${s.pin}\n（資料只存在記憶體，關掉就消失）`);
  });
}
module.exports = { startDevServer };
