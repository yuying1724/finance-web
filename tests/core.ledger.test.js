'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../core/ledger.js');
const V = require('../core/valuation.js');
const R = require('../core/report.js');
const { masters, tx } = require('./helpers/fixtures.js');

const m = masters();
const food = m.catByName('午餐').id;
const salary = m.catByName('薪資', '收入').id;

function bal(txs, opts) {
  const { units } = L.computeBalances(txs, m.instruments, opts);
  return units;
}

test('收入、支出讓帳戶餘額增減；轉帳只在帳戶間搬移、總額不變', () => {
  const txs = [
    tx({ type: '收入', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 50000, categoryId: salary }),
    tx({ type: '支出', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 120, categoryId: food }),
    tx({ type: '轉帳', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 10000, dstAccount: 'A002', dstSymbol: 'TWD', dstQty: 10000 }),
  ];
  const b = bal(txs);
  assert.equal(b['A001|TWD'], 50000 - 120 - 10000);
  assert.equal(b['A002|TWD'], 10000);
  const nw = V.netWorth(L.balanceList(b, m.instruments), { instruments: m.instruments, prices: m.prices, accounts: m.accounts, base: 'TWD' });
  assert.equal(nw.total, 50000 - 120); // 轉帳不改變淨值
});

test('轉帳不算收入也不算支出（月報表只看收入與支出）', () => {
  const txs = [
    tx({ type: '收入', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 50000, categoryId: salary }),
    tx({ type: '支出', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 500, categoryId: food }),
    tx({ type: '轉帳', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 20000, dstAccount: 'A002', dstSymbol: 'TWD', dstQty: 20000 }),
    tx({ type: '換匯', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 3200, dstAccount: 'A004', dstSymbol: 'USD', dstQty: 100 }),
    tx({ type: '調整', dstAccount: 'A002', dstSymbol: 'TWD', dstQty: 77 }),
  ];
  const s = R.monthSummary(txs, { instruments: m.instruments, prices: m.prices, base: 'TWD', categories: m.categories }, '2026-03');
  assert.equal(s.income, 50000);
  assert.equal(s.expense, 500);
  assert.equal(s.net, 49500);
});

test('退款抵銷同分類支出，且兩者都不會讓收入變多', () => {
  const txs = [
    tx({ type: '支出', srcAccount: 'A003', srcSymbol: 'TWD', srcQty: 1000, categoryId: food }),
    tx({ type: '退款', dstAccount: 'A003', dstSymbol: 'TWD', dstQty: 300, categoryId: food }),
  ];
  const s = R.monthSummary(txs, { instruments: m.instruments, prices: m.prices, base: 'TWD', categories: m.categories }, '2026-03');
  assert.equal(s.expense, 700);
  assert.equal(s.income, 0);
  assert.equal(s.byCategory.find((c) => c.categoryId === food).amount, 700);
  assert.equal(bal(txs)['A003|TWD'], -700); // 信用卡欠款 700
});

test('作廢、待確認的交易不計入餘額與報表', () => {
  const txs = [
    tx({ type: '收入', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 1000, categoryId: salary }),
    tx({ type: '收入', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 5000, categoryId: salary, status: '作廢' }),
    tx({ type: '收入', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 7000, categoryId: salary, status: '待確認' }),
    tx({ type: '收入', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 9000, categoryId: salary, status: '已略過' }),
  ];
  assert.equal(bal(txs)['A001|TWD'], 1000);
});

test('多幣別：外幣以匯率換算成台幣；換匯前後淨值只差匯差', () => {
  const txs = [
    tx({ type: '收入', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 33000, categoryId: salary }),
    tx({ type: '換匯', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 32000, dstAccount: 'A004', dstSymbol: 'USD', dstQty: 1000 }),
  ];
  const b = bal(txs);
  assert.equal(b['A001|TWD'], 1000);
  assert.equal(b['A004|USD'], 100000); // 1000.00 USD = 100000 個「分」
  const nw = V.netWorth(L.balanceList(b, m.instruments), { instruments: m.instruments, prices: m.prices, accounts: m.accounts, base: 'TWD' });
  assert.equal(nw.total, 1000 + 1000 * 32);
  assert.equal(nw.byType['銀行'], 33000);
});

test('比特幣 8 位小數不失真，並經 USD 換算成台幣（兩層計價）', () => {
  const txs = [
    tx({ type: '調整', dstAccount: 'A005', dstSymbol: 'BTC', dstQty: 0.1 }),
    tx({ type: '調整', dstAccount: 'A005', dstSymbol: 'BTC', dstQty: 0.2 }),
  ];
  const b = bal(txs);
  assert.equal(b['A005|BTC'], 30000000);
  const list = L.balanceList(b, m.instruments);
  assert.equal(list[0].qty, 0.3);
  const nw = V.netWorth(list, { instruments: m.instruments, prices: m.prices, accounts: m.accounts, base: 'TWD' });
  assert.equal(nw.total, Math.round(0.3 * 60000 * 32)); // 576,000
});

test('缺價格的標的不會讓淨值變成錯誤數字，而是列入 missing', () => {
  const txs = [tx({ type: '調整', dstAccount: 'A004', dstSymbol: 'EUR', dstQty: 100 }), tx({ type: '調整', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 500 })];
  const nw = V.netWorth(L.balanceList(bal(txs), m.instruments), { instruments: m.instruments, prices: m.prices, accounts: m.accounts, base: 'TWD' });
  assert.equal(nw.total, 500);
  assert.deepEqual(nw.missing, ['EUR']);
});

test('信用卡欠款算負債；淨值 = 資產 − 負債', () => {
  const txs = [
    tx({ type: '調整', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 100000 }),
    tx({ type: '支出', srcAccount: 'A003', srcSymbol: 'TWD', srcQty: 8000, categoryId: food }),
  ];
  const nw = V.netWorth(L.balanceList(bal(txs), m.instruments), { instruments: m.instruments, prices: m.prices, accounts: m.accounts, base: 'TWD' });
  assert.equal(nw.assets, 100000);
  assert.equal(nw.liabilities, 8000);
  assert.equal(nw.total, 92000);
  // 還款：轉帳到信用卡，淨值不變、負債歸零
  txs.push(tx({ type: '轉帳', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 8000, dstAccount: 'A003', dstSymbol: 'TWD', dstQty: 8000 }));
  const nw2 = V.netWorth(L.balanceList(bal(txs), m.instruments), { instruments: m.instruments, prices: m.prices, accounts: m.accounts, base: 'TWD' });
  assert.equal(nw2.total, 92000);
  assert.equal(nw2.liabilities, 0);
});

test('信用卡多繳（餘額為正）算資產；銀行帳戶透支（餘額為負）算負債 —— 依餘額正負，不依帳戶類型', () => {
  const ctx = { instruments: m.instruments, prices: m.prices, accounts: m.accounts, base: 'TWD' };
  const txs = [
    tx({ type: '調整', dstAccount: 'A003', dstSymbol: 'TWD', dstQty: 500 }), // 信用卡多繳 500
    tx({ type: '調整', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 300 }), // 銀行透支 300
  ];
  const nw = V.netWorth(L.balanceList(bal(txs), m.instruments), ctx);
  assert.equal(nw.assets, 500);
  assert.equal(nw.liabilities, 300);
  assert.equal(nw.total, 200);
});

test('現金那一端用交割日、其他標的用成交日；截至某日的餘額', () => {
  // 之後買股票會用到：股票成交日入帳，現金交割日才扣款（此處用 0050 作為「非法幣」端）
  const t = tx({ type: '買入', date: '2026-03-04', settleDate: '2026-03-06', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 135192, dstAccount: 'A002', dstSymbol: '0050', dstQty: 1000 });
  const before = bal([t], { asOf: '2026-03-05' });
  assert.equal(before['A002|0050'], 1000);
  assert.equal(before['A001|TWD'], undefined); // 錢還沒扣
  const after = bal([t], { asOf: '2026-03-06' });
  assert.equal(after['A001|TWD'], -135192);
  assert.equal(bal([t], { asOf: '2026-03-03' })['A002|0050'], undefined);
});

test('未知標的與壞資料會回報 issues 而不是讓整個計算失敗', () => {
  const good = tx({ type: '調整', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 100 });
  const badSym = tx({ type: '調整', dstAccount: 'A001', dstSymbol: 'XYZ', dstQty: 5 });
  const badQty = tx({ type: '調整', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 'abc' });
  const r = L.computeBalances([good, badSym, badQty], m.instruments);
  assert.equal(r.units['A001|TWD'], 100);
  assert.equal(r.issues.length, 2);
});

test('對帳：輸入實際餘額算出差額與方向', () => {
  assert.deepEqual(L.adjustmentFor(10000, 10500, 0), { side: 'dst', qty: 500 });
  assert.deepEqual(L.adjustmentFor(10000, 9800, 0), { side: 'src', qty: 200 });
  assert.deepEqual(L.adjustmentFor(10000, 10000, 0), { side: null, qty: 0 });
  assert.deepEqual(L.adjustmentFor(12345, 12000.5, 2), { side: 'dst', qty: 11877.05 }); // 目前 123.45 → 實際 12000.50
  assert.deepEqual(L.adjustmentFor(0, 0.1 + 0.2, 8), { side: 'dst', qty: 0.3 });
});

test('篩選：預設不含作廢；依帳戶、分類（含上層）、關鍵字、月份；新到舊排序', () => {
  const parent = m.catByName('飲食').id;
  const txs = [
    tx({ date: '2026-03-01', type: '支出', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 100, categoryId: food, note: '拉麵' }),
    tx({ date: '2026-03-05', type: '支出', srcAccount: 'A002', srcSymbol: 'TWD', srcQty: 50, categoryId: m.catByName('大眾運輸').id, note: '' }),
    tx({ date: '2026-02-20', type: '支出', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 70, categoryId: food }),
    tx({ date: '2026-03-03', type: '支出', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 70, categoryId: food, status: '作廢' }),
  ];
  const lk = { accounts: m.accounts, categories: m.categories };
  assert.equal(L.filterTransactions(txs, {}, lk).length, 3);
  assert.equal(L.filterTransactions(txs, { includeVoid: true }, lk).length, 4);
  assert.deepEqual(L.filterTransactions(txs, { from: '2026-03-01', to: '2026-03-31' }, lk).map((t) => t.date), ['2026-03-05', '2026-03-01']);
  assert.equal(L.filterTransactions(txs, { accountId: 'A002' }, lk).length, 1);
  assert.equal(L.filterTransactions(txs, { categoryId: parent }, lk).length, 2); // 上層分類含子分類
  assert.equal(L.filterTransactions(txs, { q: '拉麵' }, lk).length, 1);
  assert.equal(L.filterTransactions(txs, { q: '玉山' }, lk).length, 2); // 搜尋帳戶名稱
  assert.equal(L.filterTransactions(txs, { status: '作廢' }, lk).length, 1);
});
