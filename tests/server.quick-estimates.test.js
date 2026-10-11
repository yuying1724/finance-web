'use strict';
/** 常用交易範本（saveQuickTx／deleteQuickTx）與定期範本「各月預估」 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');
const FinRecurring = require('../core/recurring.js');

function at(b, day, hour = 7) { b.mock.state.clock.now = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime(); if (b.token) b.login(); }
function run(b, day) { at(b, day); return b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now); }
function fresh(day) {
  const b = loadBackend().setup();
  at(b, day, 9);
  const acct = (name, type) => { const r = b.call('upsertAccount', { account: { name, type, defaultSymbol: 'TWD', institution: name } }); assert.ok(r.ok, JSON.stringify(r)); return r.data.account.id; };
  const cat = (n, t = '支出') => b.call('bootstrap').data.categories.find((c) => c.name === n && c.type === t).id;
  const txOf = (rid) => b.call('listTransactions', { filters: { includeVoid: true }, limit: 200 }).data.items.filter((t) => t.recurringId === rid).sort((x, y) => (x.plannedDate < y.plannedDate ? -1 : 1));
  return Object.assign(b, { acct, cat, txOf });
}

test('core：各月預估的格式、那個月沒填就看前後一個月、確認後學到實際金額', () => {
  assert.deepEqual(FinRecurring.parseMonthEstimates('1月:2500、3月:670, 5:1800,13:5,x'), { 1: 2500, 3: 670, 5: 1800 });
  assert.equal(FinRecurring.formatMonthEstimates({ 11: 6590, 1: 2500 }), '1月:2500、11月:6590');
  const tpl = { type: '支出', srcQty: 4300, monthEstimates: '1月:2500、3月:670、5月:1800、7月:5730、9月:8311、11月:6590' };
  assert.deepEqual(FinRecurring.estimateFor(tpl, '2026-11-09').amount, 6590);
  assert.equal(FinRecurring.estimateFor(tpl, '2026-12-01').amount, 6590, '12 月沒填 → 前一個月');
  assert.equal(FinRecurring.estimateFor(Object.assign({}, tpl, { monthEstimates: '' }), '2026-11-09').amount, 4300, '沒填各月就用範本金額');
  assert.equal(FinRecurring.estimateFor({ type: '買入', srcQty: 3000, monthEstimates: '1月:1' }, '2027-01-05').amount, 3000, '投資不用');
  assert.equal(FinRecurring.learnMonthEstimate(tpl, '2026-11-12', 7000), '1月:2500、3月:670、5月:1800、7月:5730、9月:8311、11月:7000');
  assert.equal(FinRecurring.learnMonthEstimate(tpl, '2026-12-02', 7000), '1月:2500、3月:670、5月:1800、7月:5730、9月:8311、11月:7000', '同一期晚付到 12 月，還是更新 11 月');
  assert.equal(FinRecurring.learnMonthEstimate(Object.assign({}, tpl, { monthEstimates: '' }), '2026-11-12', 7000), null);
});

test('各月預估：待確認、即將到來、下一次都用那個月的金額；確認時改成實際金額，那個月跟著更新', () => {
  const b = fresh('2026-11-01');
  const card = b.acct('街口商務卡', '信用卡');
  const bad = b.call('upsertRecurring', { recurring: { name: 'x', freq: '每N個月', days: [2], holiday: '不調整', startDate: '2026-11-09', type: '支出', srcAccount: card, srcSymbol: 'TWD', srcQty: 4300, categoryId: b.cat('其他支出'), mode: '提醒確認', monthEstimates: '1月:abc' } });
  assert.equal(bad.error.code, 'VALIDATION');
  const r = b.call('upsertRecurring', { recurring: { name: '娘家-電費', freq: '每N個月', days: [2], holiday: '不調整', startDate: '2026-11-09', type: '支出', srcAccount: card, srcSymbol: 'TWD', srcQty: 4300, categoryId: b.cat('其他支出'), mode: '提醒確認', anchor: '實際日期', monthEstimates: '11:6590,1:2500,3:670' } });
  assert.ok(r.ok, JSON.stringify(r));
  const rid = r.data.recurring.id;
  assert.equal(r.data.recurring.monthEstimates, '1月:2500、3月:670、11月:6590');
  let bt = b.call('bootstrap').data;
  assert.equal(bt.recurringNext[rid].amount, 6590);
  assert.equal(bt.upcoming.items.find((x) => x.recurringId === rid).amount, 6590);
  run(b, '2026-11-09');
  const p = b.txOf(rid)[0];
  assert.deepEqual([p.status, p.srcQty], ['待確認', 6590]);
  assert.ok(b.call('confirmPending', { id: p.id, trade: { date: '2026-11-10', srcQty: 7012 } }).ok);
  bt = b.call('bootstrap').data;
  const tpl = bt.recurring.find((x) => x.id === rid);
  assert.equal(tpl.monthEstimates, '1月:2500、3月:670、11月:7012', '11 月學到實際金額');
  assert.equal(bt.recurringNext[rid].date, '2027-01-10');
  assert.equal(bt.recurringNext[rid].amount, 2500, '下一期（1 月）用 1 月的預估');
  // 清掉各月預估就回到範本金額
  const r2 = b.call('upsertRecurring', { recurring: Object.assign({}, tpl, { days: [2], monthEstimates: '' }), expectedUpdatedAt: tpl.updatedAt });
  assert.ok(r2.ok, JSON.stringify(r2));
  assert.equal(b.call('bootstrap').data.recurringNext[rid].amount, 4300);
});

test('常用交易：新增、修改、刪除，驗證帳戶／分類，bootstrap 帶下來', () => {
  const b = fresh('2026-10-11');
  const card = b.acct('J卡', '信用卡');
  const bank = b.acct('綜存', '銀行');
  const lunch = b.cat('午餐');
  assert.equal(b.call('saveQuickTx', { item: { name: '', type: '支出' } }).error.code, 'VALIDATION');
  assert.equal(b.call('saveQuickTx', { item: { name: 'x', type: '買入' } }).error.code, 'VALIDATION');
  assert.equal(b.call('saveQuickTx', { item: { name: 'x', type: '收入', categoryId: lunch } }).error.code, 'VALIDATION', '收入不能用支出分類');
  assert.equal(b.call('saveQuickTx', { item: { name: 'x', type: '轉帳', acct: bank, acct2: bank } }).error.code, 'VALIDATION');
  const r = b.call('saveQuickTx', { item: { name: '午餐便當', type: '支出', acct: card, categoryId: lunch, merchant: '池上便當', amount: '' } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([r.data.item.id, r.data.item.amount, r.data.item.merchant], ['Q1', null, '池上便當']);
  const r2 = b.call('saveQuickTx', { item: { name: '繳卡費', type: '轉帳', acct: bank, acct2: card, amount: 1000, categoryId: lunch } });
  assert.ok(r2.ok);
  assert.equal(r2.data.item.categoryId, '', '轉帳不存分類');
  assert.equal(b.call('saveQuickTx', { item: Object.assign({}, r.data.item, { name: '便當' }) }).data.items[0].name, '便當');
  assert.deepEqual(b.call('bootstrap').data.quickTx.map((q) => q.name), ['便當', '繳卡費']);
  assert.equal(b.call('deleteQuickTx', { id: 'Q9' }).error.code, 'NOT_FOUND');
  assert.deepEqual(b.call('deleteQuickTx', { id: 'Q1' }).data.items.map((q) => q.id), ['Q2']);
  assert.equal(b.call('saveQuickTx', { item: { name: '新的', type: '收入' } }).data.item.id, 'Q3', '編號不重複使用');
});

test('年度總覽 getYearSummary：今年／去年每月支出與收入、分類、今年最大筆；今年只算到這個月', () => {
  const b = fresh('2026-10-11');
  const bank = b.acct('綜存', '銀行');
  const lunch = b.cat('午餐');
  const salaryCat = b.call('bootstrap').data.categories.find((c) => c.type === '收入').id;
  const add = (date, type, qty, cat) => { const tx = type === '收入' ? { type, date, dstAccount: bank, dstSymbol: 'TWD', dstQty: qty, categoryId: cat } : { type, date, srcAccount: bank, srcSymbol: 'TWD', srcQty: qty, categoryId: cat }; const r = b.call('addTransaction', { tx }); assert.ok(r.ok, JSON.stringify(r)); };
  add('2025-03-05', '支出', 1000, lunch);
  add('2025-11-05', '支出', 9999, lunch); // 去年 11 月：不在「去年同期」（1～10 月）
  add('2026-01-10', '支出', 55500, lunch);
  add('2026-03-02', '支出', 300, lunch);
  add('2026-10-01', '收入', 54000, salaryCat);
  add('2026-12-20', '支出', 777, lunch); // 未來：今年只算到 10 月，不列進最大筆
  const r = b.call('getYearSummary', {});
  assert.ok(r.ok, JSON.stringify(r));
  const d = r.data;
  assert.equal(d.year, 2026);
  assert.equal(d.cutoffMonth, 10);
  assert.equal(d.months.length, 12);
  assert.equal(d.prevMonths.length, 12);
  assert.equal(d.months[0].expense, 55500);
  assert.equal(d.months[9].income, 54000);
  assert.equal(d.prevMonths[2].expense, 1000);
  assert.equal(d.prevMonths[10].expense, 9999);
  assert.deepEqual(d.topItems.map((x) => x.amount), [55500, 300]);
  assert.equal(d.months[0].byCategory[0].categoryId, lunch);
  assert.equal(d.months[9].incomeByCategory[0].amount, 54000);
  const past = b.call('getYearSummary', { year: 2025 }).data;
  assert.equal(past.cutoffMonth, 12);
  assert.deepEqual(past.topItems.map((x) => x.amount), [9999, 1000]);
  assert.equal(b.call('getYearSummary', { year: 2027 }).error.code, 'VALIDATION');
  // 月圖表的結果不變
  const m = b.call('getMonthlyExpenses', { months: 12 }).data;
  assert.equal(m.months.find((x) => x.ym === '2026-01').expense, 55500);
  assert.equal(m.months.find((x) => x.ym === '2026-01').items.length, 1);
});
