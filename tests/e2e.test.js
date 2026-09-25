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
    await a.fab();
    await page.click('.sheet button[data-type="調整"]');
    await page.selectOption('select[aria-label="帳戶"]', { label: '錢包現金' });
    await page.fill('input[aria-label="實際餘額"]', '3000');
    await page.waitForFunction(() => /將調整 \+35 TWD/.test(document.querySelector('.sheet').innerText));
    await a.save();
    await page.waitForSelector('.sheet', { state: 'detached' });
    const boot = a.bootstrap();
    assert.equal(boot.balances.find((x) => boot.accounts.find((ac) => ac.id === x.accountId).name === '錢包現金').qty, 3000);
    assert.equal(boot.month.expense, 17105, '調整不算收入或支出');
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
