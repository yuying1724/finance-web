'use strict';
/** 交割款項（getSettlements／首頁 settleSoon）：依交割帳戶＋交割日合計、已交割／今日／未交割、券商定期定額不算進交割金額、交割後餘額與不足提醒 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

function setupAt(day) {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date(day + 'T09:00:00+08:00').getTime();
  b.login();
  const acct = (name, type) => b.call('upsertAccount', { account: { name, type, defaultSymbol: 'TWD', institution: name } }).data.account.id;
  const cash = acct('元大-CMA', '銀行');
  const broker = acct('元大-證券', '證券');
  assert.ok(b.call('upsertBrokerSettings', { broker: { accountId: broker, market: '台股', buySettleDays: 2, sellSettleDays: 2, calendar: '台灣', settleAccountId: cash } }).ok);
  for (const [symbol, name] of [['0050', '元大台灣50'], ['00850', '元大臺灣ESG永續'], ['4126', '太醫']]) {
    assert.ok(b.call('upsertInstrument', { instrument: { symbol, name, type: symbol === '4126' ? '台股' : 'ETF', quote: 'TWD', decimals: 0 } }).ok);
  }
  const add = (tx) => { const r = b.call('addTransaction', { tx }); assert.ok(r.ok, JSON.stringify(r)); return r.data.tx; };
  return { b, cash, broker, add };
}

test('交割款項：依交割日合計、狀態、明細；首頁 7 天內提醒；交割後餘額與不足', () => {
  const { b, cash, broker, add } = setupAt('2026-10-15');
  add({ type: '調整', date: '2026-10-01', dstAccount: cash, dstSymbol: 'TWD', dstQty: 60000 });
  add({ type: '調整', date: '2026-10-01', dstAccount: broker, dstSymbol: '4126', dstQty: 3000 });
  // 10/13 買（10/15 交割＝今日）
  add({ type: '買入', date: '2026-10-13', settleDate: '2026-10-15', srcAccount: cash, srcSymbol: 'TWD', srcQty: 6878, dstAccount: broker, dstSymbol: '0050', dstQty: 20, amount: 6873, fee: 5 });
  // 10/15 一賣一買（10/19 交割）
  add({ type: '賣出', date: '2026-10-15', settleDate: '2026-10-19', srcAccount: broker, srcSymbol: '4126', srcQty: 2000, dstAccount: cash, dstSymbol: 'TWD', dstQty: 153607, amount: 154200, fee: 131, tax: 462 });
  add({ type: '買入', date: '2026-10-15', settleDate: '2026-10-19', srcAccount: cash, srcSymbol: 'TWD', srcQty: 245874, dstAccount: broker, dstSymbol: '00850', dstQty: 2600, amount: 245700, fee: 174 });
  // 10/9 買、10/13 已交割
  add({ type: '買入', date: '2026-10-09', settleDate: '2026-10-13', srcAccount: cash, srcSymbol: 'TWD', srcQty: 1000, dstAccount: broker, dstSymbol: '0050', dstQty: 3, amount: 999, fee: 1 });

  let r = b.call('getSettlements', { days: 0 });
  assert.ok(r.ok, JSON.stringify(r));
  let g = r.data.groups;
  assert.deepEqual(g.map((x) => [x.date, x.status, x.net, x.count]), [['2026-10-15', '今日', -6878, 1], ['2026-10-19', '未交割', -92267, 2]]);
  const d19 = g[1];
  assert.equal(d19.accountName, '元大-CMA');
  assert.deepEqual([d19.pay, d19.receive], [245874, 153607]);
  assert.deepEqual(d19.items.map((i) => [i.type, i.symbol, i.qty, i.cash, i.direction]), [['賣出', '4126', 2000, 153607, 'in'], ['買入', '00850', 2600, 245874, 'out']]);
  assert.equal(d19.items[0].name, '太醫');
  assert.equal(Math.round(d19.items[0].price * 100) / 100, 77.1);
  // 餘額：60000 −1000（10/13）−6878（今日）＝52122；10/19 交割完 −40145，不足 40145
  const a = r.data.accounts.find((x) => x.accountId === cash);
  assert.deepEqual([a.balance, a.pending, a.after, a.shortDate, a.shortfall], [52122, -92267, -40145, '2026-10-19', 40145]);
  assert.equal(d19.balanceAfter, -40145);
  // 往回看 7 天：多了 10/13 已交割
  r = b.call('getSettlements', { days: 7 });
  assert.deepEqual(r.data.groups.map((x) => [x.date, x.status]), [['2026-10-13', '已交割'], ['2026-10-15', '今日'], ['2026-10-19', '未交割']]);
  // 首頁：只列明天起 7 天內的
  const soon = b.call('bootstrap').data.settleSoon;
  assert.deepEqual(soon.map((s) => [s.date, s.accountName, s.net, s.count, s.balanceAfter]), [['2026-10-19', '元大-CMA', -92267, 2, -40145]]);
  // 作廢的不算
  const t = b.call('listTransactions', { filters: { type: '投資' }, limit: 50 }).data.items.find((x) => x.dstSymbol === '00850');
  assert.ok(b.call('voidTransaction', { id: t.id, expectedUpdatedAt: t.updatedAt }).ok);
  r = b.call('getSettlements', { days: 0 });
  assert.deepEqual(r.data.groups.find((x) => x.date === '2026-10-19').net, 153607);
  assert.equal(r.data.accounts[0].shortfall, 0);
});

test('交割款項：券商定期定額另外標示、不算進交割金額（跟券商 App 一致）', () => {
  const { b, cash, broker, add } = setupAt('2026-10-15');
  add({ type: '調整', date: '2026-10-01', dstAccount: cash, dstSymbol: 'TWD', dstQty: 100000 });
  const rec = b.call('upsertRecurring', { recurring: { name: '0050 定期定額', freq: '每月', days: [15], holiday: '順延', startDate: '2026-10-15', type: '買入', srcAccount: cash, srcSymbol: 'TWD', srcQty: 2000, dstAccount: broker, dstSymbol: '0050', mode: '券商定期定額' } });
  assert.ok(rec.ok, JSON.stringify(rec));
  assert.ok(b.call('runRecurringScheduler', {}).ok);
  const pend = b.call('listTransactions', { filters: { status: '待確認' }, limit: 10 }).data.items.find((x) => x.recurringId === rec.data.recurring.id);
  assert.ok(pend);
  // 待確認的還不算
  assert.equal(b.call('getSettlements', { days: 0 }).data.groups.length, 0);
  const c = b.call('confirmPending', { id: pend.id, trade: { date: '2026-10-15', qty: 17, amount: 1855, fee: 1, tax: 0, cashQty: 1856, settleDate: '2026-10-17' } });
  assert.ok(c.ok, JSON.stringify(c));
  add({ type: '買入', date: '2026-10-15', settleDate: '2026-10-17', srcAccount: cash, srcSymbol: 'TWD', srcQty: 10000, dstAccount: broker, dstSymbol: '0050', dstQty: 90, amount: 9990, fee: 10 });
  const g = b.call('getSettlements', { days: 0 }).data.groups;
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].net, g[0].count, g[0].regular.count, g[0].regular.amount], [-10000, 1, 1, -1856]);
  assert.deepEqual(g[0].items.map((i) => i.regular), [false, true], '定期定額排在後面');
});
