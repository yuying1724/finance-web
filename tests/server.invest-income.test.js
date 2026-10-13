'use strict';
/** 首頁「投資收益」（bootstrap.invest）：本月與今年累計的股息（實收）與已實現損益，不算進一般收入 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

test('投資收益：股息與已實現損益分月份／今年累計；一般收入不受影響', () => {
  const b = loadBackend().setup();
  const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const acct = (name, type) => ok(b.call('upsertAccount', { account: { name, type, defaultSymbol: 'TWD', institution: name } })).account.id;
  const bank = acct('銀行', '銀行');
  const tw = acct('台股證券', '證券');
  ok(b.call('upsertInstrument', { instrument: { symbol: '0050', name: '元大台灣50', type: 'ETF', quote: 'TWD', decimals: 0, isNew: true } }));
  ok(b.call('upsertBrokerSettings', { broker: { accountId: tw, market: '台股', buySettleDays: 0, sellSettleDays: 0, calendar: '台灣', settleAccountId: bank } }));
  const add = (tx) => ok(b.call('addTransaction', { tx }));
  // 今天是 2026-03-10
  add({ type: '調整', date: '2026-01-02', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000 });
  add({ type: '買入', date: '2026-01-05', settleDate: '2026-01-05', srcAccount: bank, srcSymbol: 'TWD', srcQty: 20000, dstAccount: tw, dstSymbol: '0050', dstQty: 200, amount: 20000 });
  // 2 月賣 50 股：成本 5,000，淨收 5,990 → 已實現 +990
  add({ type: '賣出', date: '2026-02-10', settleDate: '2026-02-10', srcAccount: tw, srcSymbol: '0050', srcQty: 50, dstAccount: bank, dstSymbol: 'TWD', dstQty: 5990, amount: 6000, fee: 5, tax: 5 });
  // 3 月賣 50 股：成本 5,000，淨收 4,700 → 已實現 -300
  add({ type: '賣出', date: '2026-03-03', settleDate: '2026-03-03', srcAccount: tw, srcSymbol: '0050', srcQty: 50, dstAccount: bank, dstSymbol: 'TWD', dstQty: 4700, amount: 4710, fee: 5, tax: 5 });
  add({ type: '股息', date: '2026-01-20', dstAccount: bank, dstSymbol: 'TWD', dstQty: 800, relatedSymbol: '0050' });
  add({ type: '股息', date: '2026-03-08', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1200, relatedSymbol: '0050' });
  // 去年的股息不算今年
  add({ type: '股息', date: '2025-12-20', dstAccount: bank, dstSymbol: 'TWD', dstQty: 999, relatedSymbol: '0050' });

  const d = b.call('bootstrap').data;
  assert.equal(d.month.income, 0, '股息、賣出不算一般收入');
  assert.equal(d.invest.ym, '2026-03');
  assert.deepEqual(d.invest.month, { dividends: 1200, realized: -300, total: 900 });
  assert.deepEqual(d.invest.ytd, { dividends: 2000, realized: 690, total: 2690 });
  assert.equal(d.invest.year, '2026');
});
