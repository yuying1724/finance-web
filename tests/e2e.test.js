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
    for (const id of ['home', 'tx', 'accounts', 'settings']) {
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
