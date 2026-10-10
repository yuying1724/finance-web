'use strict';
/** 每月支出（getMonthlyExpenses）：各月合計、分類金額、退款抵銷、轉帳／收入不算 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

test('每月支出：最近 N 個月每月合計與分類；退款抵銷同分類，轉帳與收入分類不列', () => {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-10T09:00:00+08:00').getTime(); b.login();
  const bank = b.call('upsertAccount', { account: { name: '銀行', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
  const bank2 = b.call('upsertAccount', { account: { name: '銀行2', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
  const cats = b.call('bootstrap').data.categories;
  const cat = (n, t = '支出') => cats.find((c) => c.name === n && c.type === t).id;
  const add = (tx) => { const r = b.call('addTransaction', { tx }); assert.ok(r.ok, JSON.stringify(r)); };
  add({ type: '調整', date: '2026-08-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000, categoryId: '' });
  add({ type: '支出', date: '2026-08-05', srcAccount: bank, srcSymbol: 'TWD', srcQty: 300, categoryId: cat('早餐') });
  add({ type: '支出', date: '2026-09-05', srcAccount: bank, srcSymbol: 'TWD', srcQty: 500, categoryId: cat('早餐') });
  add({ type: '支出', date: '2026-09-06', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1200, categoryId: cat('大眾運輸') });
  add({ type: '退款', date: '2026-09-07', dstAccount: bank, dstSymbol: 'TWD', dstQty: 200, categoryId: cat('大眾運輸') });
  add({ type: '收入', date: '2026-09-15', dstAccount: bank, dstSymbol: 'TWD', dstQty: 50000, categoryId: cat('薪資', '收入') });
  add({ type: '轉帳', date: '2026-09-16', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1000, dstAccount: bank2, dstSymbol: 'TWD', dstQty: 1000 });
  add({ type: '支出', date: '2026-10-02', srcAccount: bank, srcSymbol: 'TWD', srcQty: 80, categoryId: cat('午餐') });
  const r = b.call('getMonthlyExpenses', { months: 3 });
  assert.ok(r.ok, JSON.stringify(r));
  const m = r.data.months;
  assert.deepEqual(m.map((x) => [x.ym, x.expense]), [['2026-08', 300], ['2026-09', 1500], ['2026-10', 80]]);
  const sep = Object.fromEntries(m[1].byCategory.map((x) => [x.categoryId, x.amount]));
  assert.deepEqual(sep, { [cat('早餐')]: 500, [cat('大眾運輸')]: 1000 }, '退款抵銷、收入分類不列');
  assert.equal(b.call('getMonthlyExpenses', { months: 99 }).data.months.length, 24, '最多 24 個月');
  assert.deepEqual(b.call('getMonthlyExpenses', { months: 2, endYm: '2026-09' }).data.months.map((x) => x.ym), ['2026-08', '2026-09']);
});

test('每月支出：分期改用每期金額算在出帳的月份；startYm＝最早一筆非分期支出的月份', () => {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-10T09:00:00+08:00').getTime(); b.login();
  const bank = b.call('upsertAccount', { account: { name: '銀行', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
  const card = b.call('upsertAccount', { account: { name: '卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
  assert.ok(b.call('upsertCardSettings', { card: { accountId: card, statementDay: 25, dueDay: 10, limit: 200000, payAccountId: bank } }).ok);
  const cats = b.call('bootstrap').data.categories;
  const cat = (n) => cats.find((c) => c.name === n && c.type === '支出').id;
  // 5/8 買 12,000 分 12 期（每期 1,000，5/25 起每月結帳）
  const r = b.call('addInstallment', { tx: { type: '支出', date: '2026-05-08', srcAccount: card, srcSymbol: 'TWD', srcQty: 12000, categoryId: cat('3C 電子') }, terms: 12 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(b.call('addTransaction', { tx: { type: '支出', date: '2026-09-03', srcAccount: card, srcSymbol: 'TWD', srcQty: 250, categoryId: cat('早餐') } }).ok);
  const d = b.call('getMonthlyExpenses', { months: 7 }).data;
  assert.equal(d.startYm, '2026-09', '最早一筆一般支出在 9 月');
  assert.deepEqual(d.months.map((m) => [m.ym, m.expense, m.installment]), [
    ['2026-04', 0, 0], ['2026-05', 1000, 1000], ['2026-06', 1000, 1000], ['2026-07', 1000, 1000], ['2026-08', 1000, 1000], ['2026-09', 1250, 1000], ['2026-10', 1000, 1000],
  ]);
  const sep = Object.fromEntries(d.months[5].byCategory.map((x) => [x.categoryId, x.amount]));
  assert.deepEqual(sep, { [cat('3C 電子')]: 1000, [cat('早餐')]: 250 });
});
