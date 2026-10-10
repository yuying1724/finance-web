'use strict';
/**
 * 端到端測試：真的開瀏覽器（手機尺寸）操作網頁，後端是「打包後的 Code.gs + 記憶體版 Google 服務」。
 * 需要 Playwright；沒有安裝時整份測試會自動略過（不影響其他測試）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

let playwright = null;
try { playwright = require('playwright'); } catch (e) {
  try { playwright = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright'); } catch (e2) { /* 沒有 Playwright */ }
}
const skip = playwright ? false : '未安裝 Playwright，略過瀏覽器測試（npm i -D playwright 後可執行）';
const { startDevServer } = require('../tools/dev-server.js');

let browser;
test.before(async () => { if (playwright) browser = await playwright.chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function open(opts = {}) {
  const s = await startDevServer({ demo: opts.demo !== false });
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, locale: 'zh-TW', hasTouch: true, isMobile: !opts.desktop, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(s.url);
  const api = {
    s, ctx, page, errors,
    async login(pin = s.pin, token = s.token) {
      await page.waitForSelector('input[aria-label="PIN"]');
      if (await page.locator('input[placeholder^="XXXXX"]').isVisible()) await page.fill('input[placeholder^="XXXXX"]', token);
      await page.fill('input[aria-label="PIN"]', pin);
      await page.click('button[type=submit]');
    },
        async networth() { return (await page.locator('[data-testid=networth]').innerText()).replace(/[^\d-]/g, ''); },
    bootstrap() { return s.backend.call('bootstrap').data; },
    async close() { await ctx.close(); await s.close(); },
    async tab(id) { await page.click(`.tabbar a[data-tab=${id}]`); await page.waitForTimeout(150); },
    async fab() { await page.click('.fab'); await page.waitForSelector('.sheet'); },
    async pickCategory(...names) { for (const n of names) await page.click(`.sheet button[data-cat="${n}"]`); },
    async save() { await page.click('[data-testid=tx-save]'); },
    toast() { return page.locator('.toast').last(); },
  };
  return api;
}
async function withApp(opts, fn) { const a = await open(opts); try { await fn(a); assert.deepEqual(a.errors, [], '瀏覽器主控台不該有錯誤'); } finally { await a.close(); } }
const digits = (s) => Number(String(s).replace(/[^\d.-]/g, ''));

test('登入：授權碼錯誤、PIN 錯誤顯示訊息；正確後進入首頁；重新整理仍保持登入', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await page.fill('input[placeholder^="XXXXX"]', 'AAAAA-BBBBB-CCCCC-DDDDD');
    await page.fill('input[aria-label="PIN"]', a.s.pin);
    await page.click('button[type=submit]');
    await page.waitForSelector('.notice.bad[role=alert]:not([style*="none"])');
    assert.match(await page.locator('.notice.bad').innerText(), /授權碼或 PIN 錯誤/);
    await page.fill('input[placeholder^="XXXXX"]', a.s.token);
    await page.fill('input[aria-label="PIN"]', '000000');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => /還可以再試 4 次/.test(document.body.innerText));
    await page.fill('input[aria-label="PIN"]', a.s.pin);
    await page.click('button[type=submit]');
    await page.waitForSelector('[data-testid=networth]');
    assert.equal(digits(await a.networth()), 276095);
    await page.reload();
    await page.waitForSelector('[data-testid=networth]'); // 沒有再要求登入
    assert.ok(await page.evaluate(() => localStorage.getItem('fin.token')));
  });
});

test('已授權的裝置重新登入時只需要 PIN', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await page.evaluate(() => localStorage.removeItem('fin.session'));
    await page.reload();
    await page.waitForSelector('input[aria-label="PIN"]');
    assert.equal(await page.locator('input[placeholder^="XXXXX"]').isVisible(), false);
    await page.fill('input[aria-label="PIN"]', a.s.pin);
    await page.click('button[type=submit]');
    await page.waitForSelector('[data-testid=networth]');
  });
});

test('記一筆支出：選帳戶、分類，儲存後淨值與帳戶餘額立即更新；可復原', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const before = digits(await a.networth());
    await a.fab();
    await page.fill('input[aria-label="金額"]', '350');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '錢包現金' });
    await a.pickCategory('飲食', '午餐');
    await page.fill('input[placeholder^="例如"]', '<b>牛肉麵</b>');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b - 350, before);
    const boot = a.bootstrap();
    assert.equal(boot.balances.find((x) => x.symbol === 'TWD' && boot.accounts.find((ac) => ac.id === x.accountId).name === '錢包現金').qty, 2615);
    // 備註是純文字顯示，不會被當成 HTML
    assert.equal(await page.locator('.list b').count(), 0);
    assert.ok(await page.locator('.list').getByText('<b>牛肉麵</b>').count() > 0);
    // 復原
    await page.click('.toast button');
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b, before);
  });
});

test('表單驗證：缺分類、台幣帶小數會就地顯示錯誤，且不會送出', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const count = a.bootstrap().recent.length;
    await a.fab();
    await a.save();
    assert.match(await page.locator('.field.err .msg').first().innerText(), /請輸入金額/);
    await page.fill('input[aria-label="金額"]', '10.5');
    await a.save();
    assert.match(await page.locator('.field.err .msg').first().innerText(), /最多 0 位小數/);
    await page.fill('input[aria-label="金額"]', '10');
    await a.save();
    assert.match(await page.locator('.field.err .msg').first().innerText(), /請選擇分類/);
    assert.equal(a.s.backend.call('listTransactions').data.total, 11);
    assert.equal(count, 8);
    // 關閉後沒有新增
    await page.click('.sheet button[aria-label=關閉]');
    await page.waitForSelector('.sheet', { state: 'detached' });
  });
});

test('轉帳與換匯：畫面顯示匯率，儲存後餘額正確', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const before = digits(await a.networth());
    await a.fab();
    await page.click('.sheet button[data-type="轉帳"]');
    await page.fill('input[aria-label="金額"]', '5000');
    await page.selectOption('select[aria-label="轉出帳戶"]', { label: '玉山活存' });
    await page.selectOption('select[aria-label="轉入帳戶"]', { label: '錢包現金' });
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForTimeout(200);
    assert.equal(digits(await a.networth()), before, '轉帳不改變淨值');
    // 換匯 TWD → USD
    await a.fab();
    await page.click('.sheet button[data-type="換匯"]');
    await page.fill('input[aria-label="賣出（付出）"]', '6400');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '玉山活存' });
    await page.fill('input[aria-label="買入（收到）"]', '200');
    await page.selectOption('select[aria-label="入帳帳戶"]', { label: '美元活存' });
    await page.waitForFunction(() => /1 USD ≈ 32 TWD/.test(document.querySelector('.sheet').innerText));
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    const boot = a.bootstrap();
    const bal = (name, sym) => boot.balances.find((x) => x.symbol === sym && boot.accounts.find((ac) => ac.id === x.accountId).name === name).qty;
    assert.equal(bal('美元活存', 'USD'), 2700);
    assert.equal(bal('錢包現金', 'TWD'), 2965 + 5000);
    assert.equal(bal('玉山活存', 'TWD'), 194410 - 5000 - 6400);
  });
});

test('餘額調整（對帳）：輸入實際餘額，自動算出差額', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const expenseBefore = a.bootstrap().month.expense;
    await a.fab();
    await page.click('.sheet button[data-type="調整"]');
    await page.selectOption('select[aria-label="帳戶"]', { label: '錢包現金' });
    await page.fill('input[aria-label="實際餘額"]', '3000');
    await page.waitForFunction(() => /將調整 \+35 TWD/.test(document.querySelector('.sheet').innerText));
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    const boot = a.bootstrap();
    assert.equal(boot.balances.find((x) => boot.accounts.find((ac) => ac.id === x.accountId).name === '錢包現金').qty, 3000);
    assert.equal(boot.month.expense, expenseBefore, '調整不算收入或支出');
  });
});

test('投資頁：新增標的、設定券商帳戶，持倉正確顯示', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    const b = a.s.backend;
    const brokerAcct = b.call('upsertAccount', { account: { name: '國泰證券', type: '證券', defaultSymbol: 'TWD', institution: '國泰' } }).data.account.id;

    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('invest');
    await page.waitForSelector('.subtabs');

    // 新增標的
    await page.click('[data-testid=subtab-instruments]');
    await page.click('[data-testid=add-instrument]');
    await page.waitForSelector('.sheet');
    await page.fill('.sheet input[maxlength="20"]', '2330');
    await page.fill('.sheet input[maxlength="60"]', '台積電');
    await page.click('[data-testid=instrument-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction(() => /2330/.test(document.body.innerText));
    assert.ok(a.bootstrap().instruments.some((i) => i.symbol === '2330' && i.name === '台積電'), '新標的已建立');

    // 設定券商（用預設值直接儲存）
    await page.click('[data-testid=subtab-brokers]');
    await page.waitForSelector('.card .item');
    await page.click('.card .item:has-text("國泰證券")');
    await page.waitForSelector('.sheet');
    await page.click('[data-testid=broker-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    assert.ok(b.call('bootstrap').data.brokerSettings.some((x) => x.accountId === brokerAcct && x.market === '台股'), '券商設定已建立');

    // 買入 2330，確認持倉頁顯示正確
    await a.fab();
    await page.click('.sheet button[data-type="買入"]');
    await page.selectOption('select[aria-label="標的"]', { label: '2330　台積電' });
    await page.selectOption('select[aria-label="證券帳戶（存入股票）"]', { label: '國泰證券' });
    await page.fill('input[aria-label="成交股數"]', '100');
    await page.fill('input[aria-label="成交金額（TWD）"]', '100000');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '玉山活存' });
    await page.fill('input[aria-label="實付金額"]', '100000');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });

    await page.click('.subtabs button:has-text("持倉")');
    await page.waitForFunction(() => /台積電/.test(document.body.innerText) && /缺價格/.test(document.body.innerText));
    const holdings = b.call('getHoldings', {}).data;
    const pos = holdings.positions.find((p) => p.symbol === '2330');
    assert.equal(pos.qty, 100);
    assert.equal(pos.costNative, 100000);
  });
});

test('交易清單：篩選、開啟詳情、編輯、作廢、顯示已作廢並還原', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('tx');
    await page.waitForSelector('.list .item');
    await page.fill('input[type=search]', '房租');
    await page.waitForFunction(() => document.querySelectorAll('.list .item').length === 1);
    await page.click('.list .item');
    await page.waitForSelector('.sheet');
    assert.match(await page.locator('.sheet').innerText(), /房租/);
    await page.click('.sheet button:has-text("編輯")');
    await page.waitForSelector('.sheet input[aria-label="金額"]');
    await page.fill('.sheet input[aria-label="金額"]', '12500');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction(() => /12,500/.test((document.querySelector('.list') || { innerText: '' }).innerText));
    // 作廢
    await page.click('.list .item');
    await page.click('.sheet button:has-text("作廢")');
    await page.click('.sheet button:has-text("作廢") >> nth=-1');
    await page.waitForFunction(() => /沒有符合條件/.test(document.body.innerText));
    await page.check('text=顯示已作廢的交易');
    await page.waitForSelector('.list .item.voided');
    await page.click('.list .item.voided');
    await page.click('.sheet button:has-text("還原")');
    await page.waitForFunction(() => !document.querySelector('.list .item.voided'));
    assert.equal(a.s.backend.call('listTransactions', { filters: { q: '房租' } }).data.items[0].srcQty, 12500);
  });
});

test('樂觀更新：儲存後視窗立刻關閉、淨值立刻更新；後端失敗會自動還原並提示', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const before = digits(await a.networth());
    // 讓 addTransaction 這一筆請求回「系統忙碌」（其他請求照常）
    await page.route('**/api', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action === 'addTransaction') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'BUSY', message: '系統忙碌中，請稍後再試' } }) });
      else await route.continue();
    });
    await a.fab();
    await page.fill('input[aria-label="金額"]', '500');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '錢包現金' });
    await a.pickCategory('飲食', '午餐');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    // 先看到樂觀更新後的淨值，再被還原
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b, before);
    await page.waitForSelector('.toast.bad');
    assert.match(await page.locator('.toast.bad').innerText(), /儲存失敗，已還原/);
    assert.equal(await page.locator('.toast.bad button').innerText(), '重試');
    const boot = a.bootstrap();
    assert.equal(boot.recent.length, (a.s.backend.call('bootstrap').data.recent || []).length);
    await page.unroute('**/api');
    // 按「重試」會把剛才的內容帶回表單，再儲存一次就成功
    await page.click('.toast.bad button');
    await page.waitForSelector('.sheet');
    assert.equal(await page.inputValue('input[aria-label="金額"]'), '500');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b - 500, before);
  });
});

test('本機快取秒開：重新整理時先顯示上次的資料，不用等後端；背景更新完成後顯示更新時間', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await page.waitForFunction(() => /更新於/.test(document.body.innerText));
    assert.ok(await page.evaluate(() => !!localStorage.getItem('fin.cache')));
    // 讓 bootstrap 慢 3 秒：畫面仍應立刻出現（用快取），而且顯示「更新中…」
    await page.route('**/api', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action === 'bootstrap') await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    const t0 = Date.now();
    await page.reload();
    await page.waitForSelector('[data-testid=networth]');
    assert.ok(Date.now() - t0 < 2500, '有快取時應該不用等 bootstrap 就顯示畫面');
    assert.match(await page.locator('body').innerText(), /更新中…/);
    await page.waitForFunction(() => !/更新中…/.test(document.body.innerText), null, { timeout: 8000 });
    await page.unroute('**/api');
  });
});

test('帳戶頁：同一家銀行兩個以上帳戶時，標題顯示各幣別合計（不同幣別不混加）', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('accounts');
    const head = page.locator('[data-testid=inst-total][data-inst="玉山銀行"]');
    await head.waitFor();
    const boot = a.bootstrap();
    const ids = boot.accounts.filter((x) => x.institution === '玉山銀行' && ['銀行', '數位錢包', '現金'].includes(x.type)).map((x) => x.id);
    const twd = boot.balances.filter((b) => ids.includes(b.accountId) && b.symbol === 'TWD').reduce((s, b) => s + b.qty, 0);
    const text = await head.innerText();
    assert.match(text, /^合計 NT\$/);
    assert.ok(text.includes('NT$' + twd.toLocaleString('en-US')), text);
    assert.match(text, /US\$2,500\.00/);
    // 只有一個帳戶的機構不顯示合計
    assert.equal(await page.locator('[data-testid=inst-total][data-inst="其他"]').count(), 0);
  });
});

test('投資頁：按「更新價格」會立即更新價格並提示；1 分鐘內再按會提示稍後再試', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('invest');
    await page.click('[data-testid=refresh-prices]');
    await page.waitForFunction(() => /價格已更新（\d+ 檔）/.test(document.body.innerText));
    await page.waitForSelector('[data-testid=refresh-prices]:not([disabled])');
    await page.click('[data-testid=refresh-prices]');
    await page.waitForFunction(() => /剛更新過，請 \d+ 秒後再試/.test(document.body.innerText));
  });
});

test('投資頁持倉：第二次進來先顯示上次的結果（不再「載入中…」），背景更新；重新整理後也用快取', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('invest');
    await page.waitForFunction(() => !/載入中…/.test(document.querySelector('main').innerText));
    let calls = 0;
    await page.route('**/api', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.action === 'getHoldings') { calls++; await new Promise((r) => setTimeout(r, 1500)); }
      await route.continue();
    });
    await a.tab('home'); await a.tab('invest');
    assert.doesNotMatch(await page.locator('main').innerText(), /載入中…/, '有快取時直接顯示');
    await page.waitForTimeout(300);
    assert.equal(calls, 0, '資料沒變、5 分鐘內不重抓');
    await page.reload(); // 網址還在 #/invest：有快取的話不用等後端（後端被故意延遲 1.5 秒）就會畫出持倉
    await page.waitForFunction(() => /目前沒有投資部位|未實現損益/.test(document.querySelector('main') ? document.querySelector('main').innerText : ''), null, { timeout: 8000 });
    assert.equal(await page.locator('[data-testid=holdings-status]').innerText(), '更新中…', '先畫快取，背景才在抓新資料');
    await page.waitForFunction(() => !/更新中…/.test(document.querySelector('main').innerText), null, { timeout: 10000 });
    assert.ok(calls >= 1 && calls <= 2, `背景更新次數 ${calls}`);
    await page.unroute('**/api');
  });
});

test('後端回應被轉址成 GET（回「後端運作中」）時自動重送；不完整的舊快取不會畫出來；連續失敗會還原並提示沒有寫入', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await page.waitForFunction(() => /更新於/.test(document.body.innerText));
    const before = digits(await a.networth());
    // 1) 快取被寫成不完整的資料（沒有 accounts）：重新整理後不能出現「畫面發生錯誤」
    await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('fin.cache')); c.data = { name: 'finance-web', version: '0.9.0', message: '後端運作中。請用網頁版登入使用。' }; localStorage.setItem('fin.cache', JSON.stringify(c)); });
    // 2) 第一次 bootstrap 回舊版 doGet 訊息（沒有 via）、第二次回新版（via:'GET'）、第一次記帳也回 via:'GET'：都代表後端沒有執行
    const oldStyle = JSON.stringify({ ok: true, data: { name: 'finance-web', version: '0.9.0', message: '後端運作中。請用網頁版登入使用。' } });
    const newStyle = JSON.stringify({ ok: true, via: 'GET', data: { name: 'finance-web', version: '0.9.15', message: '後端運作中。請用網頁版登入使用。' } });
    const queue = { bootstrap: [oldStyle, newStyle], addTransaction: [newStyle] };
    await page.route('**/api', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const q = queue[body.action];
      if (q && q.length) return route.fulfill({ status: 200, contentType: 'application/json', body: q.shift() });
      return route.continue();
    });
    await page.reload();
    await page.waitForSelector('[data-testid=networth]');
    assert.doesNotMatch(await page.locator('body').innerText(), /畫面發生錯誤/);
    assert.equal(digits(await a.networth()), before);
    assert.equal(queue.bootstrap.length, 0, '被轉址的 bootstrap 有自動重送');
    await a.fab();
    await page.fill('input[aria-label="金額"]', '120');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '錢包現金' });
    await a.pickCategory('飲食', '午餐');
    await a.save();
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b - 120, before);
    const countOf = (n) => a.s.backend.call('listTransactions', { filters: {}, limit: 200 }).data.items.filter((t) => Number(t.srcQty) === n).length;
    for (let i = 0; i < 50 && countOf(120) === 0; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(1500); // 等重送與背景重新整理都結束
    assert.equal(queue.addTransaction.length, 0);
    assert.equal(countOf(120), 1, '重送後只記了一筆');
    assert.doesNotMatch(await page.locator('body').innerText(), /儲存失敗/);
    assert.ok(await page.evaluate(() => Array.isArray(JSON.parse(localStorage.getItem('fin.cache')).data.accounts)), '快取已換成完整資料');

    // 3) 連續 3 次都被轉址：不能假裝成功，要還原並提示「沒有寫入」，可以按重試
    queue.addTransaction = [newStyle, newStyle, newStyle];
    const mid = digits(await a.networth());
    await a.fab();
    await page.fill('input[aria-label="金額"]', '77');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '錢包現金' });
    await a.pickCategory('飲食', '午餐');
    await a.save();
    await page.waitForFunction(() => /儲存失敗，已還原.*沒有寫入/.test(document.body.innerText), null, { timeout: 15000 });
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b, mid);
    assert.equal(countOf(77), 0, '後端沒有這筆');
    await page.unroute('**/api');
  });
});

test('信用卡總覽：帳戶頁依類型分區可收合；同銀行合併帳單只顯示一列；總覽頁看待繳與繳款日；一鍵記繳款', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const acct = (name, inst) => be.call('upsertAccount', { account: { name, type: '信用卡', defaultSymbol: 'TWD', institution: inst } }).data.account.id;
    const fA = acct('富邦-J卡', '富邦'), fB = acct('富邦-數位生活卡', '富邦');
    const today = be.ctx.FinDates.today(Date.now());
    const day = (n) => be.ctx.FinDates.addDays(today, n);
    const dom = (d) => Number(d.slice(8, 10));
    // 結帳日＝5 天前的那個日子、繳款日＝7 天後的那個日子：上期帳單已結、還沒到繳款日
    const statementDay = dom(day(-5)), dueDay = dom(day(7));
    for (const id of [fA, fB]) assert.ok(be.call('upsertCardSettings', { card: { accountId: id, statementDay, dueDay, limit: 320000, limitGroup: '富邦' } }).ok);
    const cats = be.call('bootstrap').data.categories;
    const food = cats.find((c) => c.name === '午餐' && c.type === '支出').id;
    assert.ok(be.call('addTransaction', { tx: { type: '支出', date: day(-20), srcAccount: fA, srcSymbol: 'TWD', srcQty: 4000, categoryId: food } }).ok);
    assert.ok(be.call('addTransaction', { tx: { type: '支出', date: day(-15), srcAccount: fB, srcSymbol: 'TWD', srcQty: 6000, categoryId: food } }).ok);
    const ov = be.call('getCardOverview', {}).data;
    const fubon = ov.items.find((x) => x.name === '富邦');
    assert.equal(fubon.statementAmountDue, 10000);

    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const before = digits(await a.networth());
    // 首頁提醒卡
    await page.waitForSelector('[data-testid=card-due-notice]');
    assert.match(await page.locator('[data-testid=card-due-notice]').innerText(), /信用卡待繳/);

    // 帳戶頁：分區＋信用卡區只有「富邦」一列（2 張卡）與未設定的國泰卡一列
    await a.tab('accounts');
    await page.waitForSelector('[data-section=cards]');
    const cardRows = page.locator('[data-card-group]');
    assert.equal(await cardRows.count(), 2);
    assert.match(await page.locator('[data-card-group="富邦"]').innerText(), /2 張卡/);
    assert.equal(await page.locator('[data-account="富邦-J卡"]').count(), 0, '個別卡片不再各自攤在清單裡');
    // 收合「現金與銀行」並重新整理後仍保持收合
    await page.click('[data-section=cash]');
    assert.equal(await page.locator('[data-section=cash]').getAttribute('aria-expanded'), 'false');
    await page.reload(); await page.waitForSelector('[data-section=cash]');
    assert.equal(await page.locator('[data-section=cash]').getAttribute('aria-expanded'), 'false');
    await page.click('[data-section=cash]');

    // 信用卡總覽子分頁
    await page.click('[data-testid=subtab-cards]');
    await page.waitForSelector('[data-testid=card-total-due]');
    assert.equal(digits(await page.locator('[data-testid=card-total-due]').innerText()), 10000);
    await page.click('[data-card-group="富邦"]');
    await page.waitForSelector('.sheet');
    const sheetText = await page.locator('.sheet').innerText();
    assert.match(sheetText, /合併帳單（2 張卡）/);
    assert.match(sheetText, /富邦-J卡/); assert.match(sheetText, /富邦-數位生活卡/);
    // 一鍵記繳款：轉帳表單預帶目的帳戶與金額
    await page.click('[data-testid=card-pay]');
    await page.waitForSelector('[data-testid=tx-save]');
    assert.equal(await page.inputValue('input[aria-label="金額"]'), '10000');
    assert.equal(await page.locator('select[aria-label="轉入帳戶"] option:checked').innerText(), '富邦-J卡', '轉入帳戶預帶合併帳單的第一張卡');
    await page.selectOption('select[aria-label="轉出帳戶"]', { label: '玉山活存' });
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid=card-total-due]').innerText.replace(/[^\d-]/g, '')) === 0, null, { timeout: 15000 });
    const ov2 = be.call('getCardOverview', {}).data;
    assert.equal(ov2.items.find((x) => x.name === '富邦').statementAmountDue, 0);
    assert.equal(ov2.items.find((x) => x.name === '富邦').paid, true);
    await a.tab('home'); await page.waitForSelector('[data-testid=networth]');
    assert.equal(digits(await a.networth()), before, '轉帳繳卡費不影響淨值');
    assert.equal(await page.locator('[data-testid=card-due-notice]').count(), 0, '繳清後首頁不再提醒');
  });
});

test('A 組：商家／標籤／外幣欄位、轉帳手續費、跨月搜尋、首頁待辦卡', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const before = digits(await a.networth());
    // 支出：商家＋標籤＋外幣金額
    await a.fab();
    await page.fill('input[aria-label="金額"]', '2500');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '錢包現金' });
    await a.pickCategory('飲食', '午餐');
    await page.fill('input[aria-label="商家"]', '一蘭拉麵');
    await page.click('[data-testid=tx-more]');
    await page.fill('input[aria-label="標籤"]', '日本旅遊, 美食');
    await page.fill('input[aria-label="原幣金額"]', '11800');
    await page.selectOption('select[aria-label="原幣"]', 'JPY');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b - 2500, before);
    await page.waitForFunction(() => /一蘭拉麵/.test(document.body.innerText));
    const tx = be.call('listTransactions', { filters: { q: '一蘭' } }).data.items[0];
    assert.equal(tx.merchant, '一蘭拉麵'); assert.equal(tx.tags, '日本旅遊,美食'); assert.equal(tx.fxSymbol, 'JPY'); assert.equal(tx.fxQty, 11800);
    // 詳情顯示商家／原幣／標籤
    await page.locator('.list').getByText('一蘭拉麵').first().click();
    await page.waitForSelector('.sheet');
    const detail = await page.locator('.sheet').innerText();
    assert.match(detail, /商家/); assert.match(detail, /¥11,800|JPY/); assert.match(detail, /日本旅遊/);
    await page.click('.sheet [aria-label="關閉"]');
    await page.waitForSelector('.sheet', { state: 'detached' });

    // 轉帳＋手續費 → 兩筆同群組
    await a.fab();
    await page.click('.sheet button[data-type="轉帳"]');
    await page.fill('input[aria-label="金額"]', '3000');
    await page.selectOption('select[aria-label="轉出帳戶"]', { label: '玉山活存' });
    await page.selectOption('select[aria-label="轉入帳戶"]', { label: '錢包現金' });
    await page.fill('input[aria-label="手續費"]', '15');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b - 2500 - 15, before);
    const fee = be.call('listTransactions', { filters: { q: '手續費' } }).data.items[0];
    assert.equal(fee.srcQty, 15); assert.ok(fee.groupId);

    // 跨月搜尋：把一筆交易改到上個月，關鍵字仍找得到
    const boot = be.call('bootstrap').data;
    const old = boot.recent.find((t) => t.merchant === '一蘭拉麵');
    const lastMonth = be.ctx.FinDates.addDays(boot.today, -40);
    assert.ok(be.call('updateTransaction', { id: old.id, expectedUpdatedAt: old.updatedAt, tx: { ...old, date: lastMonth } }).ok);
    await a.tab('tx');
    await page.fill('input[aria-label="搜尋"]', '一蘭');
    await page.waitForSelector('[data-testid=search-scope]');
    assert.match(await page.locator('[data-testid=search-scope]').innerText(), /全部期間共 1 筆/);
    assert.ok(await page.locator('.list').getByText('一蘭拉麵').count() > 0, '上個月的交易也搜得到');

    // 首頁待辦卡：加一個下週到期的定期範本後出現在「未來 30 天」
    const inDays = (n) => be.ctx.FinDates.addDays(boot.today, n);
    const bank = boot.accounts.find((x) => x.name === '玉山活存').id;
    const cat = boot.categories.find((c) => c.name === '房租房貸' && c.type === '支出').id;
    assert.ok(be.call('upsertRecurring', { recurring: { name: '房租', freq: '每月', days: [Number(inDays(7).slice(8, 10))], holiday: '不調整', startDate: inDays(7), type: '支出', srcAccount: bank, srcSymbol: 'TWD', srcQty: 20000, categoryId: cat, mode: '自動入帳' } }).ok);
    await a.tab('home');
    await page.reload(); await page.waitForSelector('[data-testid=todo-card]');
    const todo = await page.locator('[data-testid=todo-card]').innerText();
    assert.match(todo, /待辦與未來 30 天/); assert.match(todo, /房租/); assert.match(todo, /預計支出/);
  });
});

test('分期付款：記一筆勾選分期 → 淨值扣全額、帳單只算當期、清單顯示分 N 期；交易詳情可提前清償', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const boot0 = be.call('bootstrap').data;
    const card = boot0.accounts.find((x) => x.name === '國泰信用卡').id;
    const today = boot0.today;
    const dom = (d) => Number(d.slice(8, 10));
    // 結帳日＝昨天那個日子（今天刷落在下一期）、繳款日＝結帳後 15 天
    const stDay = dom(be.ctx.FinDates.addDays(today, -1)), dueDay = dom(be.ctx.FinDates.addDays(today, 14));
    assert.ok(be.call('upsertCardSettings', { card: { accountId: card, statementDay: stDay, dueDay, limit: 100000 } }).ok);
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const before = digits(await a.networth());
    await a.fab();
    await page.fill('input[aria-label="金額"]', '30001');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '國泰信用卡' });
    await page.check('[data-testid=inst-toggle]');
    await page.fill('input[aria-label="分期期數"]', '6');
    assert.match(await page.locator('[data-testid=inst-preview]').innerText(), /每期 NT\$5,000.*第 1 期 NT\$5,001/);
    await a.pickCategory('購物');
    await page.fill('input[aria-label="商家"]', 'Apple');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction((b) => Number(document.querySelector('[data-testid=networth]').innerText.replace(/[^\d-]/g, '')) === b - 30001, before);
    await page.waitForFunction(() => /分 6 期/.test(document.body.innerText));
    const d = be.call('bootstrap').data;
    assert.equal(d.installments.length, 1);
    const ov = d.cardOverview.items.find((x) => x.name === '國泰信用卡');
    assert.equal(ov.installmentRemaining, 25000, '本期第 1 期 5,001，之後第 2～6 期 25,000 未出帳');
    assert.equal(ov.currentSpend, 5001 + 0, '本期消費只算第 1 期（demo 裡這張卡其他消費都在更早的週期）');
    // 信用卡總覽點進去看到分期中
    await a.tab('accounts');
    await page.click('[data-testid=subtab-cards]');
    await page.click('[data-card-group="國泰信用卡"]');
    await page.waitForSelector('[data-testid=inst-list]');
    assert.match(await page.locator('[data-testid=inst-list]').innerText(), /Apple[\s\S]*分 6 期/);
    await page.click('.sheet [aria-label="關閉"]'); await page.waitForSelector('.sheet', { state: 'detached' });
    // 交易詳情 → 提前清償
    await a.tab('tx');
    await page.locator('.list').getByText('分 6 期').first().click();
    await page.waitForSelector('.sheet');
    await page.getByRole('button', { name: '提前清償' }).click();
    await page.getByRole('button', { name: '提前清償' }).last().click();
    await page.waitForFunction(() => /已提前清償/.test(document.body.innerText));
    const d2 = be.call('bootstrap').data;
    assert.equal(d2.installments[0].payoffDate, d2.today);
    assert.equal(d2.cardOverview.items.find((x) => x.name === '國泰信用卡').installmentRemaining, 0, '提前清償後全部進本期');
  });
});

test('信用卡入帳日：結帳日前刷、還沒填入帳日 → 顯示「可能列入下期」與提醒；填上入帳日後帳單期別跟銀行一致', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const card = be.call('upsertAccount', { account: { name: 'E2E卡', type: '信用卡', defaultSymbol: 'TWD', institution: 'E2E銀行' } }).data.account.id;
    const today = be.ctx.FinDates.today(Date.now());
    const day = (n) => be.ctx.FinDates.addDays(today, n);
    const dom = (d) => Number(d.slice(8, 10));
    // 上期結帳日＝15 天前、繳款日＝3 天前（已過繳款日）；結帳日前一天刷了一筆 137，還沒填入帳日
    assert.ok(be.call('upsertCardSettings', { card: { accountId: card, statementDay: dom(day(-15)), dueDay: dom(day(-3)), limit: 50000 } }).ok);
    const food = be.call('bootstrap').data.categories.find((c) => c.name === '午餐' && c.type === '支出').id;
    assert.ok(be.call('addTransaction', { tx: { type: '支出', date: day(-16), srcAccount: card, srcSymbol: 'TWD', srcQty: 137, categoryId: food, merchant: '結帳前小吃' } }).ok);
    const item = be.call('getCardOverview', {}).data.items.find((x) => x.name === 'E2E卡');
    assert.equal(item.statementAmountDue, 137);
    assert.equal(item.dueLikelyNextPeriod, true);
    assert.equal(item.overdue, false, '待繳全是結帳日前未入帳的消費：不當成逾期');

    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('accounts');
    await page.click('[data-testid=subtab-cards]');
    await page.waitForSelector('[data-card-group="E2E卡"]');
    assert.match(await page.locator('[data-card-group="E2E卡"]').innerText(), /可能列入下期/);
    await page.click('[data-card-group="E2E卡"]');
    await page.waitForSelector('[data-testid=near-close-notice]');
    assert.match(await page.locator('[data-testid=near-close-notice]').innerText(), /還沒填入帳日[\s\S]*不用理會/);
    await page.click('.sheet [aria-label="關閉"]'); await page.waitForSelector('.sheet', { state: 'detached' });

    // 編輯那筆消費：在「更多」填上入帳日（結帳後 2 天）
    await a.tab('tx');
    await page.fill('input[aria-label="搜尋"]', '結帳前小吃');
    await page.locator('.list').getByText('結帳前小吃').first().click();
    await page.waitForSelector('.sheet');
    await page.getByRole('button', { name: '編輯' }).click();
    await page.waitForSelector('[data-testid=tx-save]');
    await page.click('[data-testid=tx-more]');
    assert.match(await page.locator('[data-testid=tx-more]').innerText(), /收起/);
    await page.fill('input[aria-label="信用卡入帳日"]', day(-13));
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    let tx = null;
    for (let i = 0; i < 50 && !(tx && tx.settleDate); i++) { await page.waitForTimeout(100); tx = be.call('listTransactions', { filters: { q: '結帳前小吃' } }).data.items[0]; }
    assert.equal(tx.settleDate, day(-13));
    const item2 = be.call('getCardOverview', {}).data.items.find((x) => x.name === 'E2E卡');
    assert.equal(item2.statementAmountDue, 0, '填了入帳日：列入下一期，上期不再有待繳');
    assert.equal(item2.currentSpend, 137);
    // 詳情顯示入帳日；入帳日早於消費日會被擋
    await a.tab('home'); await a.tab('tx');
    await page.fill('input[aria-label="搜尋"]', '結帳前小吃');
    await page.locator('.list').getByText('結帳前小吃').first().click();
    await page.waitForSelector('.sheet');
    assert.match(await page.locator('.sheet').innerText(), /信用卡入帳日/);
    await page.getByRole('button', { name: '編輯' }).click();
    await page.waitForSelector('[data-testid=tx-save]');
    await page.fill('input[aria-label="信用卡入帳日"]', day(-20));
    await page.click('[data-testid=tx-save]');
    await page.waitForFunction(() => /入帳日不能早於消費日/.test(document.body.innerText));
  });
});

test('首頁淨資產走勢：只有今天時顯示說明；有過去的快照後畫出走勢與變化；設定頁可以立即備份', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await page.waitForSelector('[data-testid=nw-trend]');
    await page.waitForFunction(() => /明天起就能看到走勢/.test(document.querySelector('[data-testid=nw-trend]').innerText));
    // 補 3 天前、1 天前的快照（模擬每天排程記錄），重新整理首頁後畫出走勢
    const now = be.state.clock.now;
    const today = be.ctx.FinDates.today(now);
    const nwToday = Math.round(be.call('bootstrap').data.netWorth.total);
    be.ctx.FinRepo.reset();
    be.ctx.FinRepo.append('snapshots', [
      { date: be.ctx.FinDates.addDays(today, -3), netWorth: nwToday - 5000, assets: nwToday, liabilities: 5000 },
      { date: be.ctx.FinDates.addDays(today, -1), netWorth: nwToday - 2000, assets: nwToday, liabilities: 2000 },
    ]);
    await page.click('button[aria-label="重新整理"]');
    await page.waitForSelector('[data-testid=nw-trend] svg.nw-chart');
    assert.match(await page.locator('[data-testid=nw-trend-diff]').innerText(), /\+NT\$5,000/);
    await page.click('[data-testid=nw-trend] .chip >> text=全部');
    await page.waitForSelector('[data-testid=nw-trend] .chip.on >> text=全部');
    const box = await page.locator('[data-testid=nw-trend] svg').boundingBox();
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.waitForFunction(() => /淨資產 NT\$/.test(document.querySelector('.nw-tip').innerText));
    // 設定頁：立即備份
    await a.tab('settings');
    await page.waitForSelector('[data-testid=backup-block]');
    await page.waitForFunction(() => /還沒有備份過/.test(document.querySelector('[data-testid=backup-block]').innerText));
    await page.click('[data-testid=backup-now]');
    await page.waitForFunction(() => /已備份：財務管理系統備份/.test(document.body.innerText));
    await page.waitForFunction(() => /上次備份/.test(document.querySelector('[data-testid=backup-block]').innerText));
    assert.equal(be.state.drive.files.filter((f) => !f.trashed).length, 1);
  });
});

test('未來扣款日曆：首頁提醒餘額不足的帳戶；打開日曆依帳戶看累計餘額、切換依日期；沒指定扣款帳戶的另外列出', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const today = be.ctx.FinDates.today(Date.now());
    const day = (n) => be.ctx.FinDates.addDays(today, n);
    const dom = (d) => Number(d.slice(8, 10));
    const bank = be.call('upsertAccount', { account: { name: '扣款小帳戶', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
    const card = be.call('upsertAccount', { account: { name: '日曆測試卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
    const card2 = be.call('upsertAccount', { account: { name: '沒設繳款帳戶卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
    assert.ok(be.call('addTransaction', { tx: { type: '調整', date: day(-10), dstAccount: bank, dstSymbol: 'TWD', dstQty: 1000, categoryId: '' } }).ok);
    // 結帳日＝5 天前、繳款日＝10 天後：上期帳單已出、還沒到繳款日
    for (const id of [card, card2]) assert.ok(be.call('upsertCardSettings', { card: { accountId: id, statementDay: dom(day(-5)), dueDay: dom(day(10)), limit: 50000, payAccountId: id === card ? bank : '' } }).ok);
    const food = be.call('bootstrap').data.categories.find((c) => c.name === '午餐' && c.type === '支出').id;
    assert.ok(be.call('addTransaction', { tx: { type: '支出', date: day(-12), srcAccount: card, srcSymbol: 'TWD', srcQty: 3000, categoryId: food } }).ok);
    assert.ok(be.call('addTransaction', { tx: { type: '支出', date: day(-12), srcAccount: card2, srcSymbol: 'TWD', srcQty: 400, categoryId: food } }).ok);

    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await page.waitForSelector('[data-testid=cash-alert]');
    assert.match(await page.locator('[data-testid=cash-alert]').innerText(), /帳戶餘額可能不夠扣款[\s\S]*扣款小帳戶[\s\S]*還差 NT\$2,000/);
    await page.click('[data-testid=cash-alert]');
    await page.waitForSelector('[data-testid=cf-account][data-account="扣款小帳戶"]');
    const blk = await page.locator('[data-testid=cf-account][data-account="扣款小帳戶"]').innerText();
    assert.match(blk, /不足/); assert.match(blk, /目前 NT\$1,000/); assert.match(blk, /日曆測試卡 上期帳單/); assert.match(blk, /餘額 -NT\$2,000/);
    assert.match(await page.locator('[data-testid=cf-short]').first().innerText(), /最多還差 NT\$2,000/);
    assert.match(await page.locator('[data-testid=cf-unassigned]').innerText(), /1 筆不知道從哪個帳戶扣款/);
    assert.match(await page.locator('.sheet').innerText(), /未指定扣款帳戶[\s\S]*沒設繳款帳戶卡/);
    await page.click('.sheet .chip >> text=依日期');
    await page.waitForSelector('.sheet .chip.on >> text=依日期');
    assert.ok(await page.locator('.sheet [data-testid=cf-item]').count() >= 2);
    assert.match(await page.locator('.sheet').innerText(), /扣款小帳戶/);
    await page.click('.sheet [aria-label="關閉"]'); await page.waitForSelector('.sheet', { state: 'detached' });
    // 待辦卡底下的連結也能打開
    await page.click('[data-testid=open-cashflow]');
    await page.waitForSelector('.sheet [data-testid=cf-item]'); // 記得上次選的「依日期」
  });
});

test('股息：除息日自動產生待確認，定期頁顯示預估明細；確認時改稅前／匯費自動重算實收，入帳後餘額更新；可手動檢查股息', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const today = be.ctx.FinDates.today(Date.now());
    const day = (n) => be.ctx.FinDates.addDays(today, n);
    const roc = (d) => String(Number(d.slice(0, 4)) - 1911) + d.slice(5, 7) + d.slice(8, 10);
    const broker = be.call('upsertAccount', { account: { name: '股息證券', type: '證券', defaultSymbol: 'TWD' } }).data.account.id;
    const cma = be.call('upsertAccount', { account: { name: '股息入帳戶', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
    assert.ok(be.call('upsertBrokerSettings', { broker: { accountId: broker, market: '台股', feeCurrency: 'TWD', calendar: '台灣', dividendAccountId: cma } }).ok);
    assert.ok(be.call('upsertInstrument', { instrument: { symbol: '00919', name: '群益台灣精選高息', type: 'ETF', quote: 'TWD', decimals: 0, priceSource: '手動', isNew: true } }).ok);
    assert.ok(be.call('addTransaction', { tx: { type: '調整', date: day(-30), dstAccount: broker, dstSymbol: '00919', dstQty: 2000, categoryId: '' } }).ok);
    be.state.urlFetch.handler = (url) => (/TWT48U_ALL/.test(url) ? { body: [{ Date: roc(today), Code: '00919', Name: '群益台灣精選高息', Exdividend: '息', CashDividend: '0.72' }] } : { body: [] });
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('todo');
    await page.click('[data-testid=check-dividends]');
    await page.waitForSelector('[data-testid=pending-item]');
    await page.waitForSelector('[data-testid=todo-later] [data-testid=pending-item]'); // 預估發放日在一個月後：放在「還沒到日子」
    const row = await page.locator('[data-testid=pending-item]').first().innerText();
    assert.match(row, /股息　00919 群益台灣精選高息/);
    assert.match(row, /預估實收 NT\$1,430/); // 2,000 × 0.72 = 1,440 − 匯費 10
    assert.match(row, new RegExp(`除息日 ${today}　稅前 NT\\$1,440－匯費 NT\\$10`));
    await page.click('[data-testid=confirm-pending]');
    await page.waitForSelector('.sheet [data-testid=div-net]');
    assert.equal(await page.locator('.sheet [data-testid=div-net]').inputValue(), '1430');
    // 實際沒扣匯費：把匯費改成 0 → 實收自動變 1,440
    const feeInput = page.locator('.sheet label.field:has-text("匯費") input');
    await feeInput.fill('0');
    assert.equal(await page.locator('.sheet [data-testid=div-net]').inputValue(), '1440');
    await page.click('.sheet [data-testid=confirm-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForSelector('[data-testid=pending-item]', { state: 'detached' });
    const t = be.call('listTransactions', { filters: { type: '股息' } }).data.items[0];
    assert.deepEqual([t.status, t.dstQty, t.fee, t.relatedSymbol], ['有效', 1440, 0, '00919']);
  });
});

test('定期「每N天」：表單選每 N 天＋從實際付款日起算，列表顯示「每 30 天（從實際付款日起算）」；到期的待確認可以延後', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const today = be.ctx.FinDates.today(Date.now());
    const bank = be.call('upsertAccount', { account: { name: '月票付款帳戶', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('recurring');
    await page.click('[data-testid=add-recurring]');
    await page.waitForSelector('.sheet [data-testid=recurring-freq]');
    const field = (label) => page.locator(`.sheet label.field:has(span.lbl:text-is("${label}"))`);
    await field('名稱').locator('input').fill('捷運月票');
    await page.selectOption('.sheet [data-testid=recurring-freq]', '每N天');
    await page.waitForSelector('.sheet [data-testid=recurring-anchor]');
    await field('每幾天一次（例如 31）').locator('input').fill('30');
    await page.selectOption('.sheet [data-testid=recurring-anchor]', '實際日期');
    await field('假日處理').locator('select').selectOption('不調整');
    assert.match(await page.locator('.sheet').innerText(), /還沒付就按「延後」/);
    await field('付款帳戶').locator('select').selectOption(bank);
    await field('預計金額').locator('input').fill('1200');
    const catSel = field('分類').locator('select');
    const firstCat = await catSel.locator('option').nth(1).getAttribute('value');
    await catSel.selectOption(firstCat);
    await page.click('.sheet [data-testid=recurring-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForSelector('[data-testid=recurring-item]:has-text("捷運月票")');
    assert.match(await page.locator('[data-testid=recurring-item]:has-text("捷運月票")').innerText(), /每 30 天（從實際付款日起算）　支出／提醒確認/);
    const tpl = be.call('bootstrap').data.recurring.find((t) => t.name === '捷運月票');
    assert.deepEqual([tpl.freq, String(tpl.days), tpl.anchor, tpl.mode, tpl.startDate], ['每N天', '30', '實際日期', '提醒確認', today]);
    const sum = be.ctx.FinRecurringJob.runDaily(be.state.clock.now);
    assert.equal(sum.created, 1, JSON.stringify(sum));
    await page.reload(); await page.waitForSelector('.tabbar a[data-tab=home]');
    await a.tab('home'); await a.tab('todo');
    await page.waitForSelector('[data-testid=todo-now] [data-testid=pending-item]:has-text("捷運月票")');
    await page.click('[data-testid=pending-item]:has-text("捷運月票") [data-testid=postpone-pending]');
    await page.waitForSelector('.sheet');
    assert.match(await page.locator('.sheet').innerText(), /預計哪天付款/);
    await page.click('.sheet button:text-is("取消")'); await page.waitForSelector('.sheet', { state: 'detached' });
    // 確認時可以換付款帳戶
    const other = be.call('upsertAccount', { account: { name: '這次用的卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
    await page.waitForTimeout(500); // 關閉視窗會用 history.back()，等它跑完再重新整理
    await page.reload(); await page.waitForSelector('.tabbar a[data-tab=home]'); await a.tab('home'); await a.tab('todo');
    await page.click('[data-testid=pending-item]:has-text("捷運月票") [data-testid=confirm-pending]');
    await page.waitForSelector('.sheet [data-testid=confirm-account]');
    assert.match(await page.locator('.sheet').innerText(), /實際付款日[\s\S]*下一次會從這天起算 30 天/);
    await page.selectOption('.sheet [data-testid=confirm-account]', other);
    await page.click('.sheet [data-testid=confirm-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    const t = be.call('listTransactions', { filters: { includeVoid: true }, limit: 200 }).data.items.find((x) => x.recurringId === tpl.id);
    assert.deepEqual([t.status, t.srcAccount], ['有效', other]);
  });
});

test('待辦頁：到期的待確認與 7 天內的信用卡帳單在「現在要處理」、底部分頁顯示件數；還沒到日子的另外列；定期頁只留範本', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const today = be.ctx.FinDates.today(Date.now());
    const day = (n) => be.ctx.FinDates.addDays(today, n);
    const dom = (d) => Number(d.slice(8, 10));
    const bank = be.call('upsertAccount', { account: { name: '待辦測試銀行', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
    const card = be.call('upsertAccount', { account: { name: '待辦測試卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
    assert.ok(be.call('upsertCardSettings', { card: { accountId: card, statementDay: dom(day(-5)), dueDay: dom(day(3)), limit: 50000, payAccountId: bank } }).ok);
    const food = be.call('bootstrap').data.categories.find((c) => c.name === '午餐' && c.type === '支出').id;
    assert.ok(be.call('addTransaction', { tx: { type: '支出', date: day(-12), srcAccount: card, srcSymbol: 'TWD', srcQty: 1234, categoryId: food } }).ok);
    // 今天到期的提醒確認（現在要處理）、10 天後到期的（還沒到日子：先產生再把日期延後模擬）
    const r1 = be.call('upsertRecurring', { recurring: { name: '待辦-今天', freq: '每月', days: [dom(today)], holiday: '不調整', startDate: today, type: '支出', srcAccount: bank, srcSymbol: 'TWD', srcQty: 100, categoryId: food, mode: '提醒確認' } });
    assert.ok(r1.ok, JSON.stringify(r1));
    be.ctx.FinRecurringJob.runDaily(be.state.clock.now);
    const later = be.call('addTransaction', { tx: { type: '股息', date: day(20), dstAccount: bank, dstSymbol: 'TWD', dstQty: 50, relatedSymbol: 'USD', categoryId: '' } });
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await page.waitForSelector('.tabbar .nav-badge[data-badge-tab=todo]:not([style*="none"])');
    assert.equal((await page.locator('.tabbar .nav-badge[data-badge-tab=todo]').innerText()).trim(), '2', '1 筆到期待確認＋1 張 7 天內到期的卡');
    await a.tab('todo');
    const now = await page.locator('[data-testid=todo-now]').innerText();
    assert.match(now, /現在要處理（2）/); assert.match(now, /待辦測試卡/); assert.match(now, /待辦-今天/);
    assert.ok(await page.locator('[data-testid=todo-now] [data-testid=todo-pay]').count() === 1);
    assert.match(await page.locator('[data-testid=todo-later]').innerText(), /還沒到日子（0）/);
    // 繳款按鈕開「記一筆」轉帳，金額帶待繳
    await page.click('[data-testid=todo-now] [data-testid=todo-pay]');
    await page.waitForSelector('.sheet');
    assert.match(await page.locator('.sheet').innerText(), /轉帳/);
    await page.click('.sheet [aria-label="關閉"]'); await page.waitForSelector('.sheet', { state: 'detached' });
    // 定期頁只留範本，有連結到待辦
    await a.tab('recurring');
    await page.waitForSelector('[data-testid=recurring-todo-link]');
    assert.equal(await page.locator('[data-testid=pending-item]').count(), 0);
    // 首頁待確認提示連到待辦
    await a.tab('home');
    assert.equal(await page.locator('[data-testid=pending-notice]').getAttribute('href'), '#/todo');
    void later;
  });
});

test('每月支出圖表：首頁開啟，顯示本月合計與大分類排行；點分類展開細項並只看這個分類；點長條換月份', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const today = be.ctx.FinDates.today(Date.now());
    const ym = today.slice(0, 7), prevYm = be.ctx.FinDates.addMonths(ym, -1);
    const bank = be.call('upsertAccount', { account: { name: '圖表銀行', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
    const cats = be.call('bootstrap').data.categories;
    const id = (n) => cats.find((c) => c.name === n && c.type === '支出').id;
    assert.ok(be.call('addTransaction', { tx: { type: '調整', date: prevYm + '-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000, categoryId: '' } }).ok);
    const add = (date, n, amt) => assert.ok(be.call('addTransaction', { tx: { type: '支出', date, srcAccount: bank, srcSymbol: 'TWD', srcQty: amt, categoryId: id(n) } }).ok);
    add(prevYm + '-05', '早餐', 1000); add(ym + '-01', '早餐', 3000); add(ym + '-01', '午餐', 700);
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    const before = be.call('getMonthlyExpenses', { months: 6 }).data.months;
    const curTotal = before[before.length - 1].expense, prevTotal = before[before.length - 2].expense;
    await page.click('[data-testid=open-spending]');
    await page.waitForSelector('[data-testid=sp-total]');
    assert.equal(digits(await page.locator('[data-testid=sp-total]').innerText()), curTotal);
    assert.ok(await page.locator('.sp-chart .sp-bar').count() >= 1);
    // 圓餅圖：有片、最多 6 片（前 5 類＋其他），分類清單有同色圓點
    const segs = await page.locator('[data-testid=sp-donut] [data-seg]').count();
    assert.ok(segs >= 1 && segs <= 6, '圓餅片數 ' + segs);
    assert.ok(await page.locator('[data-testid=sp-cat] .sp-dot').count() >= 1);
    // 點「飲食」：展開早餐／午餐，圖改成只看飲食
    await page.click('[data-testid=sp-cat][data-cat="飲食"]');
    await page.waitForSelector('[data-testid=sp-filter]');
    assert.match(await page.locator('[data-testid=sp-filter]').innerText(), /只看：飲食/);
    const food = await page.locator('.sheet').innerText();
    assert.match(food, /飲食▾[\s\S]*早餐/); assert.match(food, /飲食▾[\s\S]*午餐/); // 展示資料本身也有飲食消費，只檢查細項有展開
    assert.ok(digits(await page.locator('[data-testid=sp-total]').innerText()) >= 3700);
    // 圖下有每個月合計；點上個月的長條
    assert.ok(await page.locator(`[data-testid=sp-months] .sp-month[data-ym="${ym}"]`).count() === 1);
    await page.click(`.sp-chart .sp-hit[data-ym="${prevYm}"]`);
    await page.waitForFunction((t) => document.querySelector('[data-testid=sp-total]') && document.querySelector('.sheet').innerText.includes(t), `${Number(prevYm.slice(5))} 月`);
    // 取消只看
    await page.click('[data-testid=sp-filter]');
    await page.waitForSelector('[data-testid=sp-filter]', { state: 'detached' });
    assert.equal(digits(await page.locator('[data-testid=sp-total]').innerText()), prevTotal);
  });
});

test('快結帳提醒：信用卡結帳日前 3 天內記帳會問這期或下期請款；選下期自動填入帳日；卡片設定「幾天後請款」時自動預估', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const today = be.ctx.FinDates.today(Date.now());
    const day = (n) => be.ctx.FinDates.addDays(today, n);
    const dom = (d) => Number(d.slice(8, 10));
    // 結帳日＝後天（月底附近會被調整，所以用實際算出的日期）
    const closeDay = dom(day(2));
    const cardA = be.call('upsertAccount', { account: { name: '快結帳卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
    const cardB = be.call('upsertAccount', { account: { name: '設定延遲卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
    const far = be.call('upsertAccount', { account: { name: '還很久卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
    assert.ok(be.call('upsertCardSettings', { card: { accountId: cardA, statementDay: closeDay, dueDay: 25, limit: 50000 } }).ok);
    assert.ok(be.call('upsertCardSettings', { card: { accountId: cardB, statementDay: closeDay, dueDay: 25, limit: 50000, postDelayDays: 3 } }).ok);
    assert.ok(be.call('upsertCardSettings', { card: { accountId: far, statementDay: dom(day(10)), dueDay: 25, limit: 50000 } }).ok);
    assert.equal(be.call('upsertCardSettings', { card: { accountId: far, statementDay: 5, dueDay: 25, postDelayDays: 99 } }).error.code, 'VALIDATION');
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.fab();
    await page.fill('input[aria-label="金額"]', '120');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '還很久卡' });
    assert.equal(await page.locator('[data-testid=close-prompt]').isVisible(), false, '離結帳日還很久：不問');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '快結帳卡' });
    await page.waitForSelector('[data-testid=close-prompt] .notice');
    assert.match(await page.locator('[data-testid=close-prompt]').innerText(), /結帳（還有 2 天）[\s\S]*這筆是/);
    await page.click('[data-testid=close-next]');
    assert.match(await page.locator('[data-testid=close-status]').innerText(), /會列入下一期帳單/);
    await a.pickCategory('飲食', '午餐');
    await page.fill('input[placeholder^="例如：和同事"]', '快結帳測試A');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    let tx = null;
    for (let i = 0; i < 50 && !tx; i++) { await page.waitForTimeout(100); tx = be.call('listTransactions', { filters: { q: '快結帳測試A' } }).data.items[0]; }
    assert.equal(tx.settleDate, day(3), '入帳日＝結帳日隔天');
    // 卡片設定 3 天後請款：自動預估，不用選
    await a.fab();
    await page.fill('input[aria-label="金額"]', '80');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '設定延遲卡' });
    await page.waitForSelector('[data-testid=close-status]');
    assert.match(await page.locator('[data-testid=close-status]').innerText(), /依卡片設定（刷卡後 3 天請款）[\s\S]*會列入下一期帳單/);
    // 改成這期請款
    await page.click('[data-testid=close-this]');
    assert.match(await page.locator('[data-testid=close-status]').innerText(), /列入這一期帳單/);
    await a.pickCategory('飲食', '午餐');
    await page.fill('input[placeholder^="例如：和同事"]', '快結帳測試B');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    tx = null;
    for (let i = 0; i < 50 && !tx; i++) { await page.waitForTimeout(100); tx = be.call('listTransactions', { filters: { q: '快結帳測試B' } }).data.items[0]; }
    assert.equal(tx.settleDate || '', '', '選了這期：不填入帳日');
  });
});

test('拆帳：一次刷卡拆成食材＋日用品，加總不對會擋；存成一組，清單合成一列，可整筆作廢', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    const card = be.call('upsertAccount', { account: { name: '拆帳卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
    void card;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.fab();
    await page.fill('input[aria-label="金額"]', '3500');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '拆帳卡' });
    await page.check('[data-testid=split-toggle]');
    await page.waitForSelector('[data-testid=split-box] [data-testid=split-cat]');
    assert.equal(await page.locator('.sheet .cat-grid').count(), 0, '拆帳時不顯示單一分類');
    const cats = page.locator('[data-testid=split-cat]');
    const optVal = async (label) => page.evaluate((l) => [...document.querySelector('[data-testid=split-cat]').options].find((o) => o.textContent === l).value, label);
    await cats.nth(0).selectOption(await optVal('飲食 › 生鮮雜貨'));
    await page.locator('[data-testid=split-amt]').nth(0).fill('2300');
    await cats.nth(1).selectOption(await optVal('購物 › 日用品'));
    await page.locator('[data-testid=split-amt]').nth(1).fill('1000');
    assert.match(await page.locator('[data-testid=split-summary]').innerText(), /還沒分配 NT\$200/);
    await page.fill('input[placeholder^="例如：全聯"]', '好市多');
    await a.save();
    await page.waitForSelector('.sheet [data-field=splits].err');
    assert.match(await page.locator('.sheet [data-field=splits]').innerText(), /加起來要等於/);
    await page.locator('[data-testid=split-rest]').nth(1).click();
    assert.equal(await page.locator('[data-testid=split-amt]').nth(1).inputValue(), '1200');
    assert.match(await page.locator('[data-testid=split-summary]').innerText(), /已分完/);
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    let legs = [];
    for (let i = 0; i < 50 && legs.length < 2; i++) { await page.waitForTimeout(100); legs = be.call('listTransactions', { filters: { q: '好市多' } }).data.items; }
    assert.equal(legs.length, 2);
    assert.equal(legs[0].groupId, legs[1].groupId);
    assert.deepEqual(legs.map((x) => x.srcQty).sort(), [1200, 2300]);
    // 交易清單：合成一列
    await a.tab('tx');
    await page.waitForSelector('[data-testid=split-row]');
    assert.match(await page.locator('[data-testid=split-row]').first().innerText(), /好市多[\s\S]*拆 2 類[\s\S]*生鮮雜貨、日用品|好市多[\s\S]*拆 2 類[\s\S]*日用品、生鮮雜貨/);
    assert.match(await page.locator('[data-testid=split-row]').first().innerText(), /NT\$3,500/);
    await page.click('[data-testid=split-row]');
    await page.waitForSelector('[data-testid=split-detail]');
    await page.click('[data-testid=split-void]');
    await page.click('.dialog button:text-is("作廢"), .sheet button:text-is("作廢")');
    for (let i = 0; i < 50; i++) { await page.waitForTimeout(100); const items = be.call('listTransactions', { filters: { q: '好市多', includeVoid: true } }).data.items; if (items.every((x) => x.status === '作廢')) break; }
    const after = be.call('listTransactions', { filters: { q: '好市多', includeVoid: true } }).data.items;
    assert.deepEqual(after.map((x) => x.status), ['作廢', '作廢']);
  });
});

test('拆帳＋代墊：幫朋友／同事訂飲料，自己的算支出、其他的代墊到自動建立的「代墊款」；清單一列顯示含代墊；待辦可以收回', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page, s } = a;
    const be = s.backend;
    be.call('upsertAccount', { account: { name: '外送卡', type: '信用卡', defaultSymbol: 'TWD' } });
    const lp = be.call('upsertAccount', { account: { name: '我的LINE Pay', type: '數位錢包', defaultSymbol: 'TWD' } }).data.account.id;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.fab();
    await page.fill('input[aria-label="金額"]', '400');
    await page.selectOption('select[aria-label="付款帳戶"]', { label: '外送卡' });
    await page.check('[data-testid=split-toggle]');
    await page.waitForSelector('[data-testid=split-box] [data-testid=split-cat]');
    const cats = page.locator('[data-testid=split-cat]');
    const optVal = async (label) => page.evaluate((l) => [...document.querySelector('[data-testid=split-cat]').options].find((o) => o.textContent === l).value, label);
    // 全部選代墊會被擋
    await cats.nth(0).selectOption('adv:__new__');
    await cats.nth(1).selectOption('adv:__new__');
    await page.locator('[data-testid=split-amt]').nth(0).fill('200');
    await page.locator('[data-testid=split-rest]').nth(1).click();
    await a.save();
    await page.waitForSelector('.sheet [data-field=splits].err');
    assert.match(await page.locator('.sheet [data-field=splits]').innerText(), /至少要有一行是自己的消費/);
    await cats.nth(0).selectOption(await optVal('飲食 › 飲料點心'));
    await page.locator('[data-testid=split-amt]').nth(0).fill('80');
    await page.locator('[data-testid=split-rest]').nth(1).click();
    assert.equal(await page.locator('[data-testid=split-who]').count(), 1, '只有代墊那行有「幫誰付」');
    assert.equal(await page.locator('[data-testid=split-newacct]').inputValue(), '代墊款', '新代墊帳戶名稱預設「代墊款」，可以改');
    await page.fill('[data-testid=split-who]', '小王 80、小李 120、阿明 120');
    assert.match(await page.locator('[data-testid=split-summary]').innerText(), /已分完[\s\S]*自己 NT\$80[\s\S]*代墊 NT\$320/);
    await page.fill('input[placeholder^="例如：全聯"]', 'foodpanda');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    let legs = [];
    for (let i = 0; i < 50 && legs.length < 2; i++) { await page.waitForTimeout(100); legs = be.call('listTransactions', { filters: { q: 'foodpanda' } }).data.items; }
    assert.equal(legs.length, 2);
    const adv = be.call('bootstrap').data.accounts.find((x) => x.name === '代墊款');
    assert.ok(adv && adv.type === '應收');
    const lent = legs.find((x) => x.type === '轉帳');
    assert.deepEqual([lent.dstAccount, lent.srcQty, lent.note], [adv.id, 320, '小王 80、小李 120、阿明 120']);
    // 交易清單：一列，含代墊
    await a.tab('tx');
    await page.waitForSelector('[data-testid=split-row]');
    const rowText = await page.locator('[data-testid=split-row]').first().innerText();
    assert.match(rowText, /foodpanda[\s\S]*含代墊[\s\S]*飲料點心、代墊 NT\$320/);
    assert.match(rowText, /NT\$400/);
    await page.click('[data-testid=split-row]');
    await page.waitForSelector('[data-testid=split-detail]');
    assert.match(await page.locator('[data-testid=split-leg-adv]').innerText(), /幫別人代墊 → 代墊款[\s\S]*小王/);
    assert.match(await page.locator('[data-testid=split-detail]').innerText(), /自己的消費[\s\S]*NT\$80/);
    await page.click('.sheet button[aria-label="關閉"]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    // 待辦：代墊還沒收回 → 收回 120 到 LINE Pay
    await a.tab('todo');
    await page.waitForSelector('[data-testid=todo-receivable]');
    assert.match(await page.locator('[data-testid=todo-receivable]').innerText(), /代墊款[\s\S]*NT\$320/);
    await page.click('[data-testid=todo-collect]');
    await page.waitForSelector('.sheet select[aria-label="轉出帳戶"]');
    assert.equal(await page.locator('.sheet select[aria-label="轉出帳戶"]').inputValue(), adv.id);
    await page.selectOption('.sheet select[aria-label="轉入帳戶"]', lp);
    await page.fill('input[aria-label="金額"]', '120');
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    let bal = null;
    for (let i = 0; i < 50; i++) { await page.waitForTimeout(100); bal = be.call('bootstrap').data.balances.find((x) => x.accountId === adv.id); if (bal && bal.qty === 200) break; }
    assert.equal(bal.qty, 200);
    assert.equal(be.call('bootstrap').data.balances.find((x) => x.accountId === lp).qty, 120);
  });
});

test('新增帳戶與分類', { skip }, async () => {
  await withApp({ demo: false }, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    assert.match(await page.locator('.card.empty').innerText(), /歡迎使用/);
    await page.click('text=新增第一個帳戶');
    await page.fill('.sheet input[maxlength="40"] >> nth=0', '測試銀行活存');
    await page.click('[data-testid=account-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction(() => /測試銀行活存/.test(document.body.innerText));
    await a.tab('accounts');
    await page.click('[data-testid=subtab-categories]');
    await page.waitForSelector('.card .item');
    await page.click('button[aria-label="在 飲食 底下新增子分類"]');
    await page.fill('.sheet input[maxlength="30"]', '零食');
    await page.click('.sheet .btn-primary');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForFunction(() => /零食/.test(document.body.innerText));
    assert.ok(a.bootstrap().categories.some((c) => c.name === '零食'));
  });
});

test('隱私遮蔽：金額顯示 ****，重新整理後仍保持', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await page.click('button[aria-label=隱藏金額]');
    assert.equal(await page.locator('[data-testid=networth]').innerText(), '****');
    await page.reload();
    await page.waitForSelector('[data-testid=networth]');
    assert.equal(await page.locator('[data-testid=networth]').innerText(), '****');
    assert.ok(!/\d{3}/.test(await page.locator('.main').innerText().then((t) => t.replace(/20\d\d/g, '').replace(/\d+\/\d+/g, ''))), '整頁不該出現金額數字');
  });
});

test('手機「上一頁」會先關閉視窗，而不是離開頁面', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('accounts');
    await a.fab();
    await page.goBack();
    await page.waitForSelector('.sheet', { state: 'detached' });
    assert.match(page.url(), /#\/accounts/);
    // 視窗接著關閉、再開新視窗，也不會亂掉
    await a.fab();
    await page.click('.sheet button[aria-label=關閉]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.waitForTimeout(50);
    assert.match(page.url(), /#\/accounts/);
  });
});

test('鎖定：回到登入畫面，資料清除；設定頁可切換外觀與漲跌顏色', { skip }, async () => {
  await withApp({}, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    await a.tab('settings');
    await page.click('.seg button:has-text("深色")');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    await page.click('.seg button:has-text("綠漲紅跌")');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-updown')), 'us');
    await page.click('button:has-text("鎖定並登出")');
    await page.waitForSelector('input[aria-label="PIN"]');
    assert.equal(await page.evaluate(() => localStorage.getItem('fin.session')), null);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', '外觀設定保留');
  });
});

test('版面：各頁在 360px 寬度不會左右捲動；電腦寬度顯示側邊欄', { skip }, async () => {
  await withApp({ viewport: { width: 360, height: 740 } }, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    for (const id of ['home', 'tx', 'accounts', 'invest', 'settings']) {
      await a.tab(id); await page.waitForTimeout(400);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `${id} 頁橫向溢出 ${over}px`);
    }
    await a.fab();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, '表單橫向溢出');
  });
  await withApp({ viewport: { width: 1280, height: 800 }, desktop: true }, async (a) => {
    const { page } = a;
    await a.login(); await page.waitForSelector('[data-testid=networth]');
    assert.equal(await page.locator('.sidebar').isVisible(), true);
    assert.equal(await page.locator('.tabbar').isVisible(), false);
    await page.click('.sidebar a[data-tab=accounts]');
    await page.waitForSelector('[data-testid=add-account]');
  });
});
