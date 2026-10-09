'use strict';
/** 未來扣款日曆（getCashflow）與餘額不足提醒 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

function fresh(day) {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date(day + 'T09:00:00+08:00').getTime(); b.login();
  const acct = (name, type) => { const r = b.call('upsertAccount', { account: { name, type, defaultSymbol: 'TWD', institution: name } }); assert.ok(r.ok, JSON.stringify(r)); return r.data.account.id; };
  const cats = () => b.call('bootstrap').data.categories;
  const cat = (n) => cats().find((c) => c.name === n && c.type === '支出').id;
  return Object.assign(b, { acct, cat });
}

test('扣款日曆：信用卡上期帳單、本期預估、定期扣款都依「扣款帳戶」分組；從今天的餘額累計，不夠時標示不足的日期與金額', () => {
  const b = fresh('2026-10-09');
  const bank = b.acct('富邦數位', '銀行');
  const other = b.acct('永豐', '銀行');
  const cardA = b.acct('富邦卡', '信用卡');
  const cardB = b.acct('沒設扣款帳戶的卡', '信用卡');
  assert.ok(b.call('addTransaction', { tx: { type: '調整', date: '2026-10-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 10000, categoryId: '' } }).ok);
  assert.ok(b.call('addTransaction', { tx: { type: '調整', date: '2026-10-01', dstAccount: other, dstSymbol: 'TWD', dstQty: 50000, categoryId: '' } }).ok);
  assert.ok(b.call('upsertCardSettings', { card: { accountId: cardA, statementDay: 5, dueDay: 20, limit: 100000, payAccountId: bank } }).ok);
  assert.ok(b.call('upsertCardSettings', { card: { accountId: cardB, statementDay: 5, dueDay: 25, limit: 100000 } }).ok);
  const food = b.cat('午餐');
  // 上期（9/6～10/5）刷 8,000 → 10/20 從富邦數位扣；本期（10/6～）刷 3,000 → 11/20 繳（預估）
  assert.ok(b.call('addTransaction', { tx: { type: '支出', date: '2026-09-20', srcAccount: cardA, srcSymbol: 'TWD', srcQty: 8000, categoryId: food } }).ok);
  assert.ok(b.call('addTransaction', { tx: { type: '支出', date: '2026-10-07', srcAccount: cardA, srcSymbol: 'TWD', srcQty: 3000, categoryId: food } }).ok);
  assert.ok(b.call('addTransaction', { tx: { type: '支出', date: '2026-09-21', srcAccount: cardB, srcSymbol: 'TWD', srcQty: 500, categoryId: food } }).ok);
  // 每月 15 號從富邦數位扣 1,500
  assert.ok(b.call('upsertRecurring', { recurring: { name: '保險', freq: '每月', days: [15], holiday: '不調整', startDate: '2026-10-15', type: '支出', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1500, categoryId: food, mode: '自動入帳' } }).ok);

  const cf = b.call('getCashflow', { days: 60 }).data;
  const g = cf.accounts.find((a) => a.accountId === bank);
  assert.equal(g.balance, 10000);
  assert.deepEqual(g.items.map((r) => [r.date, r.amount, r.balanceAfter]), [
    ['2026-10-15', 1500, 8500], ['2026-10-20', 8000, 500], ['2026-11-15', 1500, -1000], ['2026-11-20', 3000, -4000],
  ]);
  assert.equal(g.shortDate, '2026-11-15');
  assert.equal(g.shortfall, 4000);
  assert.ok(g.items.find((r) => r.date === '2026-11-20').estimated, '本期帳單是預估');
  assert.equal(cf.accounts[0].accountId, bank, '不足的帳戶排最前面');
  assert.ok(!cf.accounts.find((a) => a.accountId === other), '沒有扣款的帳戶不列');
  // 沒設扣款帳戶的卡放在 unassigned
  assert.equal(cf.unassigned.length, 1);
  assert.match(cf.unassigned[0].name, /沒設扣款帳戶的卡/);
  assert.equal(cf.shortCount, 1);
  // 首頁摘要
  const alert = b.call('bootstrap').data.cashAlert;
  assert.equal(alert.short.length, 1);
  assert.equal(alert.short[0].shortDate, '2026-11-15');
  assert.equal(alert.unassigned, 1);
});

test('交割款：已成交、交割日還沒到的買入列在付款帳戶；餘額不足提醒在第一次不足的 3 天前與前 1 天寄信', () => {
  const b = fresh('2026-10-09');
  const bank = b.acct('交割帳戶', '銀行');
  const broker = b.acct('證券', '證券');
  assert.ok(b.call('addTransaction', { tx: { type: '調整', date: '2026-10-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1000, categoryId: '' } }).ok);
  assert.ok(b.call('upsertInstrument', { instrument: { symbol: '2330', name: '台積電', type: '台股', quote: 'TWD', decimals: 0, priceSource: '手動', isNew: true } }).ok);
  const r = b.call('addTransaction', { tx: { type: '買入', date: '2026-10-09', settleDate: '2026-10-13', srcAccount: bank, srcSymbol: 'TWD', srcQty: 5000, dstAccount: broker, dstSymbol: '2330', dstQty: 5, amount: 5000, fee: 0, tax: 0 } });
  assert.ok(r.ok, JSON.stringify(r));
  const cf = b.call('getCashflow', { days: 30 }).data;
  const g = cf.accounts.find((a) => a.accountId === bank);
  assert.equal(g.items[0].kind, '交割');
  assert.equal(g.items[0].date, '2026-10-13');
  assert.equal(g.shortfall, 4000);
  // 10/10 是交割日前 3 天 → 寄信
  b.mock.state.clock.now = new Date('2026-10-10T07:00:00+08:00').getTime();
  b.state.mail.length = 0;
  b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  const m = b.state.mail.find((x) => /餘額可能不夠扣款/.test(x.subject));
  assert.ok(m, '有寄餘額不足提醒');
  assert.match(m.body, /交割帳戶　2026-10-13 起可能不足，還差約 4000 TWD/);
  // 10/11（前 2 天）不寄
  b.mock.state.clock.now = new Date('2026-10-11T07:00:00+08:00').getTime();
  b.state.mail.length = 0;
  b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  assert.ok(!b.state.mail.find((x) => /餘額可能不夠扣款/.test(x.subject)));
});
