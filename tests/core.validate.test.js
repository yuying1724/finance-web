'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../core/validate.js');
const { masters, tx } = require('./helpers/fixtures.js');

const m = masters();
const food = m.catByName('午餐').id;
const salary = m.catByName('薪資', '收入').id;
const ctx = (extra) => Object.assign({ accounts: m.accounts, categories: m.categories, instruments: m.instruments, prices: m.prices, base: 'TWD', today: '2026-03-10', transactions: {} }, extra);
const fields = (r) => r.errors.map((e) => e.field);

test('支出：合法輸入通過並正規化', () => {
  const r = V.validateTransaction({ type: '支出', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: '120', categoryId: food, note: ' 拉麵 ' }, ctx());
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.tx.srcQty, 120);
  assert.equal(r.tx.note, '拉麵');
  assert.equal(r.tx.status, '有效');
  assert.equal(r.tx.dstAccount, '');
});

test('支出：缺帳戶、缺分類、金額為 0 或負數、台幣帶小數都會被擋', () => {
  const base = { type: '支出', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 100, categoryId: food };
  assert.ok(fields(V.validateTransaction({ ...base, srcAccount: '' }, ctx())).includes('srcAccount'));
  assert.ok(fields(V.validateTransaction({ ...base, categoryId: '' }, ctx())).includes('categoryId'));
  assert.ok(fields(V.validateTransaction({ ...base, srcQty: 0 }, ctx())).includes('srcQty'));
  assert.ok(fields(V.validateTransaction({ ...base, srcQty: -5 }, ctx())).includes('srcQty'));
  assert.ok(fields(V.validateTransaction({ ...base, srcQty: 10.5 }, ctx())).includes('srcQty'));
  assert.ok(fields(V.validateTransaction({ ...base, srcQty: 'abc' }, ctx())).includes('srcQty'));
  assert.ok(fields(V.validateTransaction({ ...base, dstAccount: 'A002', dstSymbol: 'TWD', dstQty: 100 }, ctx())).includes('dstAccount'));
});

test('分類類型要符合：支出不能用收入分類，反之亦然', () => {
  const e = V.validateTransaction({ type: '支出', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 100, categoryId: salary }, ctx());
  assert.ok(fields(e).includes('categoryId'));
  const i = V.validateTransaction({ type: '收入', date: '2026-03-02', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 100, categoryId: food }, ctx());
  assert.ok(fields(i).includes('categoryId'));
  const sys = m.catByName('餘額調整').id;
  const s = V.validateTransaction({ type: '支出', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 100, categoryId: sys }, ctx());
  assert.ok(fields(s).includes('categoryId'));
});

test('停用的帳戶、分類、標的不能用於新交易，但編輯既有交易時保留原值不報錯', () => {
  const input = { type: '支出', date: '2026-03-02', srcAccount: 'A006', srcSymbol: 'TWD', srcQty: 100, categoryId: food };
  assert.ok(fields(V.validateTransaction(input, ctx())).includes('srcAccount'));
  const existing = tx({ type: '支出', srcAccount: 'A006', srcSymbol: 'TWD', srcQty: 90, categoryId: food });
  assert.ok(V.validateTransaction(input, ctx({ existing })).ok);
});

test('轉帳：同帳戶、幣別不同、金額不同都被擋；合法則通過且不需分類', () => {
  const base = { type: '轉帳', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 1000, dstAccount: 'A002', dstSymbol: 'TWD', dstQty: 1000 };
  assert.ok(V.validateTransaction(base, ctx()).ok);
  assert.ok(fields(V.validateTransaction({ ...base, dstAccount: 'A001' }, ctx())).includes('dstAccount'));
  assert.ok(fields(V.validateTransaction({ ...base, dstSymbol: 'USD', dstQty: 1000 }, ctx())).includes('dstSymbol'));
  assert.ok(fields(V.validateTransaction({ ...base, dstQty: 999 }, ctx())).includes('dstQty'));
  const withCat = V.validateTransaction({ ...base, categoryId: food }, ctx());
  assert.equal(withCat.tx.categoryId, ''); // 轉帳沒有分類
});

test('換匯：兩邊必須不同的法幣；匯率與市價差太多會警告但不擋', () => {
  const base = { type: '換匯', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 3200, dstAccount: 'A004', dstSymbol: 'USD', dstQty: 100 };
  const ok = V.validateTransaction(base, ctx());
  assert.ok(ok.ok); assert.equal(ok.warnings.length, 0);
  assert.ok(fields(V.validateTransaction({ ...base, dstSymbol: 'TWD', dstQty: 3200 }, ctx())).includes('dstSymbol'));
  assert.ok(fields(V.validateTransaction({ ...base, dstSymbol: 'BTC', dstQty: 0.01 }, ctx())).includes('dstSymbol'));
  const off = V.validateTransaction({ ...base, dstQty: 80 }, ctx()); // 3200 TWD 只換到 80 USD → 匯率 40，差 25%
  assert.ok(off.ok); assert.equal(off.warnings.length, 1);
  assert.ok(V.validateTransaction({ ...base, dstQty: 100.555 }, ctx()).errors.some((e) => e.field === 'dstQty')); // USD 最多 2 位小數
});

test('調整：只能填一邊，並自動歸入系統分類「餘額調整」', () => {
  const up = V.validateTransaction({ type: '調整', date: '2026-03-02', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 50 }, ctx());
  assert.ok(up.ok);
  assert.equal(up.tx.categoryId, m.catByName('餘額調整').id);
  const down = V.validateTransaction({ type: '調整', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 50 }, ctx());
  assert.ok(down.ok);
  const both = V.validateTransaction({ type: '調整', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 5, dstAccount: 'A002', dstSymbol: 'TWD', dstQty: 5 }, ctx());
  assert.ok(!both.ok);
  assert.ok(!V.validateTransaction({ type: '調整', date: '2026-03-02' }, ctx()).ok);
});

test('退款：可連回原支出；連到非支出報錯；幣別或金額不符給警告', () => {
  const orig = tx({ id: 'T000900', type: '支出', srcAccount: 'A003', srcSymbol: 'TWD', srcQty: 500, categoryId: food });
  const inc = tx({ id: 'T000901', type: '收入', dstAccount: 'A001', dstSymbol: 'TWD', dstQty: 500, categoryId: salary });
  const transactions = { T000900: orig, T000901: inc };
  const base = { type: '退款', date: '2026-03-05', dstAccount: 'A003', dstSymbol: 'TWD', dstQty: 200, categoryId: food, relatedTxId: 'T000900' };
  assert.ok(V.validateTransaction(base, ctx({ transactions })).ok);
  assert.ok(fields(V.validateTransaction({ ...base, relatedTxId: 'T000901' }, ctx({ transactions }))).includes('relatedTxId'));
  assert.ok(fields(V.validateTransaction({ ...base, relatedTxId: 'T999999' }, ctx({ transactions }))).includes('relatedTxId'));
  const over = V.validateTransaction({ ...base, dstQty: 600 }, ctx({ transactions }));
  assert.ok(over.ok); assert.ok(over.warnings.some((w) => w.includes('大於')));
  assert.ok(V.validateTransaction({ type: '退款', date: '2026-03-05', dstAccount: 'A003', dstSymbol: 'TWD', dstQty: 200, categoryId: food }, ctx()).ok); // 不連結也可以
});

test('日期：格式錯誤、超出範圍被擋；未來日期只警告', () => {
  const base = { type: '支出', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 1, categoryId: food };
  assert.ok(fields(V.validateTransaction({ ...base, date: '2026-02-30' }, ctx())).includes('date'));
  assert.ok(fields(V.validateTransaction({ ...base, date: '1999-01-01' }, ctx())).includes('date'));
  assert.ok(fields(V.validateTransaction({ ...base, date: '2026/03/02' }, ctx())).includes('date'));
  const fut = V.validateTransaction({ ...base, date: '2026-04-01' }, ctx());
  assert.ok(fut.ok); assert.equal(fut.warnings.length, 1);
});

test('不存在的交易類型會被拒絕', () => {
  assert.ok(!V.validateTransaction({ type: 'abc', date: '2026-03-02' }, ctx()).ok);
});

test('備註以 = + - @ 開頭時前面補空白，避免在試算表被當成公式', () => {
  ['=IMPORTXML("http://x")', '+1+1', '-5', '@SUM(A1)'].forEach((note) => {
    const r = V.validateTransaction({ type: '支出', date: '2026-03-02', srcAccount: 'A001', srcSymbol: 'TWD', srcQty: 1, categoryId: food, note }, ctx());
    assert.ok(r.ok);
    assert.ok(r.tx.note.startsWith(' '));
  });
});
