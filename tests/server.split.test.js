'use strict';
/** 拆帳：一次刷卡拆成多個分類（同群組的多筆支出）；總額要對；整組作廢／還原 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

test('拆帳：拆成多筆同群組支出，金額加總要等於總額；帳戶餘額扣總額；分類各自計入；整組作廢與還原', () => {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-10T18:00:00+08:00').getTime(); b.login();
  const card = b.call('upsertAccount', { account: { name: '好市多卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
  const cats = b.call('bootstrap').data.categories;
  const cat = (n) => cats.find((c) => c.name === n && c.type === '支出').id;
  const base = { type: '支出', date: '2026-10-10', srcAccount: card, srcSymbol: 'TWD', srcQty: 3500, categoryId: cat('生鮮雜貨'), merchant: '好市多', note: '週末採買' };
  // 加總不對
  let r = b.call('addTransaction', { tx: base, splits: [{ categoryId: cat('生鮮雜貨'), amount: 2300 }, { categoryId: cat('日用品'), amount: 1000 }] });
  assert.equal(r.error.code, 'VALIDATION'); assert.match(r.error.message, /要等於總額/);
  // 只有一行
  assert.equal(b.call('addTransaction', { tx: base, splits: [{ categoryId: cat('生鮮雜貨'), amount: 3500 }] }).error.code, 'VALIDATION');
  // 某行缺分類
  r = b.call('addTransaction', { tx: base, splits: [{ categoryId: '', amount: 2300 }, { categoryId: cat('日用品'), amount: 1200 }] });
  assert.equal(r.error.code, 'VALIDATION'); assert.match(r.error.message, /第 1 行/);
  // 正確
  r = b.call('addTransaction', { tx: base, splits: [{ categoryId: cat('生鮮雜貨'), amount: 2300 }, { categoryId: cat('日用品'), amount: 1200, note: '衛生紙' }], requestId: 'split-1' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.split.length, 2);
  const [a, c2] = r.data.split;
  assert.equal(a.groupId, a.id); assert.equal(c2.groupId, a.id);
  assert.deepEqual([a.merchant, c2.merchant, a.note, c2.note], ['好市多', '好市多', '週末採買', '衛生紙']);
  // 重送不重複
  assert.equal(b.call('addTransaction', { tx: base, splits: [{ categoryId: cat('生鮮雜貨'), amount: 2300 }, { categoryId: cat('日用品'), amount: 1200 }], requestId: 'split-1' }).data.split[0].id, a.id);
  const boot = b.call('bootstrap').data;
  assert.equal(boot.balances.find((x) => x.accountId === card).qty, -3500);
  assert.equal(boot.month.expense, 3500);
  const m = b.call('getMonthlyExpenses', { months: 1 }).data.months[0];
  assert.deepEqual(Object.fromEntries(m.byCategory.map((x) => [x.categoryId, x.amount])), { [cat('生鮮雜貨')]: 2300, [cat('日用品')]: 1200 });
  // 整組作廢
  r = b.call('voidTransaction', { id: a.id, wholeGroup: true, expectedUpdatedAt: a.updatedAt });
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.data.txs.length, 2);
  assert.equal((b.call('bootstrap').data.balances.find((x) => x.accountId === card) || { qty: 0 }).qty, 0);
  const c2v = r.data.txs.find((x) => x.id === c2.id);
  r = b.call('restoreTransaction', { id: c2.id, wholeGroup: true, expectedUpdatedAt: c2v.updatedAt });
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.data.txs.length, 2);
  // 單筆作廢（不帶 wholeGroup）只動一筆
  r = b.call('voidTransaction', { id: c2.id, expectedUpdatedAt: r.data.txs.find((x) => x.id === c2.id).updatedAt });
  assert.ok(r.ok); assert.equal(r.data.txs, undefined);
  assert.equal(b.call('bootstrap').data.balances.find((x) => x.accountId === card).qty, -2300);
  // 收入不能拆帳
  const bank = b.call('upsertAccount', { account: { name: '銀行', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
  const inc = cats.find((x) => x.name === '薪資' && x.type === '收入' && x.parentId).id;
  assert.equal(b.call('addTransaction', { tx: { type: '收入', date: '2026-10-10', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100, categoryId: inc }, splits: [{ categoryId: inc, amount: 50 }, { categoryId: inc, amount: 50 }] }).error.code, 'VALIDATION');
});
