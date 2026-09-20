'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

function fresh() {
  const b = loadBackend().setup();
  const acct = (name, type, sym = 'TWD') => {
    const r = b.call('upsertAccount', { account: { name, type, defaultSymbol: sym, institution: name } });
    assert.ok(r.ok, JSON.stringify(r));
    return r.data.account.id;
  };
  const boot = () => { const r = b.call('bootstrap'); assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const cat = (name, type) => boot().categories.find((c) => c.name === name && (!type || c.type === type)).id;
  const add = (tx, requestId) => b.call('addTransaction', { tx, requestId });
  return Object.assign(b, { acct, boot, cat, add });
}

test('全新系統的首頁資料：沒有帳戶、淨值 0、分類與幣別已就緒', () => {
  const b = fresh();
  const d = b.boot();
  assert.equal(d.today, '2026-03-10');
  assert.equal(d.netWorth.total, 0);
  assert.deepEqual(d.accounts, []);
  assert.ok(d.categories.length > 50);
  assert.ok(d.instruments.some((i) => i.symbol === 'USD' && i.decimals === 2));
  assert.deepEqual(d.enabledTxTypes, ['收入', '支出', '轉帳', '換匯', '退款', '調整']);
  assert.match(d.sheetUrl, /docs\.google\.com/);
  assert.equal(d.issues.count, 0);
  const s = JSON.stringify(d);
  assert.ok(!/HMAC|salt|PIN|hash/i.test(s), '不該洩漏任何驗證資料');
});

test('帳戶：新增、重名被擋、修改、停用（有餘額時警告）、啟用', () => {
  const b = fresh();
  const id = b.acct('玉山活存', '銀行');
  assert.equal(id, 'A001');
  assert.equal(b.acct('現金', '現金'), 'A002');
  const dup = b.call('upsertAccount', { account: { name: '玉山活存', type: '銀行' } });
  assert.equal(dup.error.code, 'VALIDATION');
  assert.equal(b.call('upsertAccount', { account: { name: '玉山活存'.toLowerCase(), type: '銀行' } }).ok, false);
  assert.equal(b.call('upsertAccount', { account: { name: 'x', type: '亂填' } }).error.code, 'VALIDATION');
  assert.equal(b.call('upsertAccount', { account: { name: 'x', type: '銀行', defaultSymbol: 'ZZZ' } }).error.code, 'VALIDATION');
  assert.equal(b.call('upsertAccount', { account: { name: '', type: '銀行' } }).error.code, 'VALIDATION');
  assert.equal(b.call('upsertAccount', { account: { name: 'x'.repeat(41), type: '銀行' } }).error.code, 'VALIDATION');

  const cur = b.boot().accounts.find((a) => a.id === id);
  const upd = b.call('upsertAccount', { account: { id, name: '玉山銀行活存', type: '銀行', defaultSymbol: 'TWD' }, expectedUpdatedAt: cur.updatedAt });
  assert.ok(upd.ok, JSON.stringify(upd));
  assert.equal(b.boot().accounts[0].name, '玉山銀行活存');

  b.add({ type: '調整', date: '2026-03-01', dstAccount: id, dstSymbol: 'TWD', dstQty: 100 });
  const off = b.call('setAccountActive', { id, active: false });
  assert.ok(off.ok); assert.equal(off.data.warnings.length, 1);
  assert.equal(b.boot().accounts.find((a) => a.id === id).active, false);
  assert.equal(b.boot().netWorth.total, 100, '停用的帳戶餘額仍計入淨值');
  assert.equal(b.add({ type: '調整', date: '2026-03-01', dstAccount: id, dstSymbol: 'TWD', dstQty: 5 }).error.code, 'VALIDATION');
  assert.ok(b.call('setAccountActive', { id, active: true }).ok);
});

test('分類：新增子分類、重名、層數限制、類型不可改、系統分類不可改', () => {
  const b = fresh();
  const parent = b.cat('飲食', '支出');
  const r = b.call('upsertCategory', { category: { type: '支出', parentId: parent, name: '宵夜', icon: '', color: '#aabbcc' } });
  assert.ok(r.ok, JSON.stringify(r));
  const id = r.data.category.id;
  assert.equal(b.call('upsertCategory', { category: { type: '支出', parentId: parent, name: '宵夜' } }).error.code, 'VALIDATION');
  assert.equal(b.call('upsertCategory', { category: { type: '支出', parentId: id, name: '第三層' } }).error.code, 'VALIDATION');
  assert.equal(b.call('upsertCategory', { category: { type: '收入', parentId: parent, name: '類型不同' } }).error.code, 'VALIDATION');
  assert.equal(b.call('upsertCategory', { category: { type: '支出', name: 'bad', color: 'red' } }).error.code, 'VALIDATION');
  assert.equal(b.call('upsertCategory', { category: { type: '系統', name: 'x' } }).error.code, 'VALIDATION');
  const cur = b.boot().categories.find((c) => c.id === id);
  assert.equal(b.call('upsertCategory', { category: { id, type: '收入', name: '宵夜', parentId: parent }, expectedUpdatedAt: cur.updatedAt }).error.code, 'VALIDATION');
  const sys = b.boot().categories.find((c) => c.type === '系統');
  assert.equal(b.call('upsertCategory', { category: { id: sys.id, name: 'hack' }, expectedUpdatedAt: sys.updatedAt }).error.code, 'VALIDATION');
  assert.equal(b.call('setCategoryActive', { id: sys.id, active: false }).error.code, 'VALIDATION');
  assert.ok(b.call('setCategoryActive', { id, active: false }).ok);
  const top = b.call('upsertCategory', { category: { type: '支出', name: '寵物', icon: '🐶' } });
  assert.ok(top.ok);
  // 有子分類的分類不能被放到別人底下
  const p2 = b.boot().categories.find((c) => c.id === parent);
  assert.equal(b.call('upsertCategory', { category: { id: parent, type: '支出', name: '飲食', parentId: top.data.category.id }, expectedUpdatedAt: p2.updatedAt }).error.code, 'VALIDATION');
});

test('完整記帳情境：收入、支出、轉帳、換匯、退款、調整，餘額與淨值都正確', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  const cash = b.acct('現金', '現金');
  const card = b.acct('信用卡', '信用卡');
  const usd = b.acct('美元帳戶', '銀行', 'USD');
  const salary = b.cat('薪資', '收入'), lunch = b.cat('午餐', '支出');

  assert.ok(b.add({ type: '收入', date: '2026-03-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 60000, categoryId: salary, note: '三月薪水' }).ok);
  const e = b.add({ type: '支出', date: '2026-03-02', srcAccount: card, srcSymbol: 'TWD', srcQty: 1000, categoryId: lunch, note: '聚餐' });
  assert.ok(e.ok);
  assert.ok(b.add({ type: '轉帳', date: '2026-03-03', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1000, dstAccount: card, dstSymbol: 'TWD', dstQty: 1000 }).ok); // 繳卡費
  assert.ok(b.add({ type: '換匯', date: '2026-03-04', srcAccount: bank, srcSymbol: 'TWD', srcQty: 32000, dstAccount: usd, dstSymbol: 'USD', dstQty: 1000 }).ok);
  assert.ok(b.add({ type: '退款', date: '2026-03-05', dstAccount: card, dstSymbol: 'TWD', dstQty: 200, categoryId: lunch, relatedTxId: e.data.tx.id }).ok);
  assert.ok(b.add({ type: '調整', date: '2026-03-06', dstAccount: cash, dstSymbol: 'TWD', dstQty: 350 }).ok);

  const d = b.boot();
  const bal = (a, s) => (d.balances.find((x) => x.accountId === a && x.symbol === s) || { qty: 0 }).qty;
  assert.equal(bal(bank, 'TWD'), 60000 - 1000 - 32000);
  assert.equal(bal(card, 'TWD'), -1000 + 1000 + 200); // 欠款清掉後又退款 200 → 多了 200
  assert.equal(bal(usd, 'USD'), 1000);
  assert.equal(bal(cash, 'TWD'), 350);
  assert.equal(d.month.income, 60000);
  assert.equal(d.month.expense, 800, '支出 1000 − 退款 200');
  // 匯率還沒有價格（GOOGLEFINANCE 尚未算出）→ 美元帳戶列入缺價格，不計入淨值
  assert.deepEqual(d.netWorth.missing, ['USD']);
  assert.equal(d.netWorth.total, 27000 + 200 + 350);
  assert.equal(d.recent.length, 6);
  assert.equal(d.recent[0].type, '調整');

  // 價格公式算出來之後，美元計入淨值
  b.ss.sheet('價格').formulaResults['2,2'] = 32;
  b.ctx.dailyJob();
  const d2 = b.boot();
  assert.deepEqual(d2.netWorth.missing, []);
  assert.equal(d2.netWorth.total, 27000 + 200 + 350 + 32000);
  assert.equal(d2.netWorth.byType['銀行'], 27000 + 32000);
  assert.equal(d2.netWorth.liabilities, 0);
  assert.equal(d2.prices.USD.status, '正常');
});

test('新增交易的驗證錯誤會帶回欄位資訊，且不會寫入任何資料', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  const before = b.ss.sheet('交易').getLastRow();
  const r = b.add({ type: '支出', date: '2026-03-02', srcAccount: bank, srcSymbol: 'TWD', srcQty: 10.5, categoryId: b.cat('午餐') });
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.details.errors[0].field, 'srcQty');
  assert.equal(b.ss.sheet('交易').getLastRow(), before);
  assert.equal(b.add({ type: '買入', date: '2026-03-02' }).error.code, 'VALIDATION'); // 尚未開放
  assert.equal(b.call('addTransaction', {}).error.code, 'BAD_REQUEST');
  assert.equal(b.call('addTransaction', { tx: 'x' }).error.code, 'BAD_REQUEST');
});

test('交易 ID 依序遞增；日期與時間戳記以純文字存進 Sheet（不會被轉成日期物件）', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  const r1 = b.add({ type: '調整', date: '2026-03-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1 });
  const r2 = b.add({ type: '調整', date: '2026-03-02', dstAccount: bank, dstSymbol: 'TWD', dstQty: 2 });
  assert.equal(r1.data.tx.id, 'T000001'); assert.equal(r2.data.tx.id, 'T000002');
  const cells = b.ss.sheet('交易')._cell(2, 2);
  assert.equal(typeof cells.v, 'string');
  assert.equal(cells.v, '2026-03-01');
  assert.equal(typeof b.ss.sheet('交易')._cell(2, 21).v, 'string');
  assert.equal(b.ss.sheet('交易')._cell(2, 21).v, '2026-03-10 12:00:00');
});

test('備註以 = 開頭不會變成試算表公式', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  const r = b.add({ type: '支出', date: '2026-03-02', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1, categoryId: b.cat('午餐'), note: '=IMPORTXML("http://evil.example","//a")' });
  assert.ok(r.ok);
  const cell = b.ss.sheet('交易')._cell(2, 19);
  assert.equal(cell.f, null);
  assert.equal(typeof cell.v, 'string');
  // 帳戶名稱（不是純文字格式的欄位也一樣被擋）
  const a = b.call('upsertAccount', { account: { name: '=1+1', type: '銀行', institution: '=HYPERLINK("x")', note: '+cmd' } });
  assert.ok(a.ok);
  const sh = b.ss.sheet('帳戶');
  for (let c = 1; c <= 10; c++) assert.equal(sh._cell(3, c).f, null, '第 ' + c + ' 欄不該是公式');
});

test('重送保護：同一個 requestId 只會新增一次', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  const tx = { type: '調整', date: '2026-03-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 500 };
  const a = b.add(tx, 'req-1'), c = b.add(tx, 'req-1');
  assert.equal(a.data.tx.id, c.data.tx.id);
  assert.equal(b.boot().netWorth.total, 500);
  const d = b.add(tx, 'req-2');
  assert.notEqual(d.data.tx.id, a.data.tx.id);
  assert.equal(b.boot().netWorth.total, 1000);
});

test('修改交易：更新內容、樂觀並發檢查（別處已改過會回 CONFLICT）、稽核紀錄', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  const lunch = b.cat('午餐');
  const added = b.add({ type: '支出', date: '2026-03-02', srcAccount: bank, srcSymbol: 'TWD', srcQty: 100, categoryId: lunch, note: 'a' });
  const t = added.data.tx;
  b.advance(5000);
  const upd = b.call('updateTransaction', { id: t.id, expectedUpdatedAt: t.updatedAt, tx: { ...t, srcQty: 120, note: 'b' } });
  assert.ok(upd.ok, JSON.stringify(upd));
  assert.equal(upd.data.tx.srcQty, 120);
  assert.equal(b.call('listTransactions').data.items[0].note, 'b');
  assert.equal(b.call('listTransactions').data.items[0].createdAt, t.createdAt);
  // 用舊的 updatedAt 再改 → 衝突
  const stale = b.call('updateTransaction', { id: t.id, expectedUpdatedAt: t.updatedAt, tx: { ...t, srcQty: 999 } });
  assert.equal(stale.error.code, 'CONFLICT');
  assert.equal(stale.error.details.current.srcQty, 120);
  assert.equal(b.call('updateTransaction', { id: t.id, tx: { ...t } }).error.code, 'BAD_REQUEST');
  assert.equal(b.call('updateTransaction', { id: 'T999999', expectedUpdatedAt: 'x', tx: t }).error.code, 'NOT_FOUND');
  const log = b.ss.sheet('異動紀錄').dump();
  assert.ok(log.some((r) => r[1] === '修改' && r[2] === '交易' && r[3] === t.id));
  assert.ok(log.some((r) => r[1] === '新增' && r[5] === '測試手機'), '稽核紀錄要記下是哪台裝置');
});

test('作廢與還原：作廢後不計入餘額與報表，可還原；已作廢不能編輯', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  const t = b.add({ type: '收入', date: '2026-03-02', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1000, categoryId: b.cat('薪資', '收入') }).data.tx;
  assert.equal(b.boot().netWorth.total, 1000);
  const v = b.call('voidTransaction', { id: t.id, expectedUpdatedAt: t.updatedAt });
  assert.ok(v.ok, JSON.stringify(v));
  assert.equal(b.boot().netWorth.total, 0);
  assert.equal(b.boot().month.income, 0);
  assert.equal(b.call('listTransactions').data.total, 0, '預設不列出作廢');
  assert.equal(b.call('listTransactions', { filters: { includeVoid: true } }).data.total, 1);
  assert.equal(b.call('updateTransaction', { id: t.id, expectedUpdatedAt: v.data.tx.updatedAt, tx: t }).error.code, 'VOIDED');
  assert.equal(b.call('voidTransaction', { id: t.id, expectedUpdatedAt: v.data.tx.updatedAt }).error.code, 'BAD_STATE');
  const r = b.call('restoreTransaction', { id: t.id, expectedUpdatedAt: v.data.tx.updatedAt });
  assert.ok(r.ok);
  assert.equal(b.boot().netWorth.total, 1000);
});

test('清單篩選與分頁', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行'), cash = b.acct('現金', '現金');
  const lunch = b.cat('午餐'), dinner = b.cat('晚餐');
  b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000 });
  for (let i = 1; i <= 25; i++) b.add({ type: '支出', date: `2026-03-${String(i).padStart(2, '0')}`, srcAccount: i % 2 ? bank : cash, srcSymbol: 'TWD', srcQty: i, categoryId: i % 3 ? lunch : dinner, note: i === 7 ? '特別的一筆' : '' });
  const all = b.call('listTransactions', { filters: { from: '2026-03-01', to: '2026-03-31' }, limit: 10 }).data;
  assert.equal(all.total, 25); assert.equal(all.items.length, 10);
  assert.equal(all.items[0].date, '2026-03-25');
  const page3 = b.call('listTransactions', { filters: { from: '2026-03-01', to: '2026-03-31' }, limit: 10, offset: 20 }).data;
  assert.equal(page3.items.length, 5);
  assert.equal(b.call('listTransactions', { filters: { q: '特別' } }).data.total, 1);
  assert.equal(b.call('listTransactions', { filters: { accountId: cash } }).data.total, 12);
  assert.equal(b.call('listTransactions', { filters: { categoryId: dinner } }).data.total, 8);
  assert.equal(b.call('listTransactions', { filters: { type: '調整' } }).data.total, 1);
  assert.equal(b.call('listTransactions', { limit: 100000 }).data.items.length, 26);
  assert.equal(b.call('listTransactions', { filters: { from: 'garbage' } }).data.total, 26, '無效的篩選條件被忽略');
  const m = b.call('monthSummary', { ym: '2026-03' }).data;
  assert.equal(m.expense, 325);
  assert.equal(b.call('monthSummary', { ym: '2026-3' }).error.code, 'BAD_REQUEST');
});

test('超過 1000 列時會自動擴充工作表，且新增的列仍是純文字格式', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  for (let i = 0; i < 1005; i++) {
    const r = b.add({ type: '調整', date: '2026-03-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1 });
    assert.ok(r.ok, `第 ${i + 1} 筆失敗：` + JSON.stringify(r));
  }
  assert.ok(b.ss.insertedRows > 0);
  assert.equal(b.boot().netWorth.total, 1005);
  const sh = b.ss.sheet('交易');
  assert.equal(typeof sh._cell(1006, 2).v, 'string', '擴充後新增的列，日期仍是文字');
  assert.equal(sh._cell(1006, 2).v, '2026-03-01');
  assert.equal(b.call('listTransactions', { limit: 500, offset: 500 }).data.items.length, 500);
});

test('鎖：成功或失敗之後都會釋放；鎖被占用時回「系統忙碌」而不是壞掉', () => {
  const b = fresh();
  const bank = b.acct('玉山活存', '銀行');
  b.add({ type: '支出', date: 'bad', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1, categoryId: b.cat('午餐') }); // 驗證失敗
  assert.equal(b.state.lockHeld, false);
  b.state.lockHeld = true; // 模擬另一個請求正在寫入
  const busy = b.add({ type: '調整', date: '2026-03-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1 });
  assert.equal(busy.error.code, 'BUSY');
  b.state.lockHeld = false;
  assert.ok(b.add({ type: '調整', date: '2026-03-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1 }).ok);
  assert.equal(b.state.lockHeld, false);
});

test('內部錯誤不會把細節（堆疊、Sheet ID）回給前端', () => {
  const b = fresh();
  b.ctx.FinLedger.computeBalances = () => { throw new Error('boom SS_MAIN secret'); };
  const r = b.call('bootstrap');
  assert.equal(r.error.code, 'INTERNAL');
  assert.ok(!JSON.stringify(r).includes('SS_MAIN'));
  assert.ok(b.state.logs.some((l) => l.includes('boom')));
});
