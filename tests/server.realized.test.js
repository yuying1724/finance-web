'use strict';
/** 已實現分析（realizedReport）：每筆賣出的損益／報酬率／持有天數、期間統計（勝率、最賺最賠、依標的、每月）、補登持股標 approx */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

function setup() {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-20T09:00:00+08:00').getTime();
  b.login();
  const acct = (name, type) => b.call('upsertAccount', { account: { name, type, defaultSymbol: 'TWD', institution: name } }).data.account.id;
  const cash = acct('元大-CMA', '銀行'), broker = acct('元大-證券', '證券');
  for (const [symbol, name] of [['4126', '太醫'], ['00757', '統一FANG+'], ['009810', '統一美債']]) {
    assert.ok(b.call('upsertInstrument', { instrument: { symbol, name, type: symbol === '4126' ? '台股' : 'ETF', quote: 'TWD', decimals: 0 } }).ok);
  }
  const add = (tx) => { const r = b.call('addTransaction', { tx }); assert.ok(r.ok, JSON.stringify(r)); return r.data.tx; };
  add({ type: '調整', date: '2026-01-01', dstAccount: cash, dstSymbol: 'TWD', dstQty: 1000000 });
  return { b, cash, broker, add };
}

test('已實現分析：損益與持倉頁一致、持有天數用加權平均買進日、勝率／最賺最賠／依標的／每月；補登持股標 approx；期間篩選', () => {
  const { b, cash, broker, add } = setup();
  // 太醫：1/10 買 1000 @100、3/10 買 1000 @120（平均成本 110，平均買進日 2/9）；7/18 賣 1000 @130（淨收 129,000）→ 賺 19,000
  add({ type: '買入', date: '2026-01-10', settleDate: '2026-01-10', srcAccount: cash, srcSymbol: 'TWD', srcQty: 100000, dstAccount: broker, dstSymbol: '4126', dstQty: 1000, amount: 100000, fee: 0 });
  add({ type: '買入', date: '2026-03-10', settleDate: '2026-03-10', srcAccount: cash, srcSymbol: 'TWD', srcQty: 120000, dstAccount: broker, dstSymbol: '4126', dstQty: 1000, amount: 120000, fee: 0 });
  add({ type: '賣出', date: '2026-07-18', settleDate: '2026-07-18', srcAccount: broker, srcSymbol: '4126', srcQty: 1000, dstAccount: cash, dstSymbol: 'TWD', dstQty: 129000, amount: 130000, fee: 600, tax: 400 });
  // 統一FANG+：9/21 開帳補登 500 @100；10/12 賣 500 @90 → 賠 5,000；持有天數只能算到補登日（approx）
  add({ type: '買入', date: '2026-09-21', settleDate: '2026-09-21', srcAccount: cash, srcSymbol: 'TWD', srcQty: 50000, dstAccount: broker, dstSymbol: '00757', dstQty: 500, amount: 50000, fee: 0, note: '開帳補登' });
  add({ type: '賣出', date: '2026-10-12', settleDate: '2026-10-14', srcAccount: broker, srcSymbol: '00757', srcQty: 500, dstAccount: cash, dstSymbol: 'TWD', dstQty: 45000, amount: 45000, fee: 0, tax: 0 });
  // 統一美債：10/1 買 2000 @20；10/12 賣 1000 @21 → 賺 1,000；10/13 賣 1000 @20 → 0
  add({ type: '買入', date: '2026-10-01', settleDate: '2026-10-01', srcAccount: cash, srcSymbol: 'TWD', srcQty: 40000, dstAccount: broker, dstSymbol: '009810', dstQty: 2000, amount: 40000, fee: 0 });
  add({ type: '賣出', date: '2026-10-12', settleDate: '2026-10-14', srcAccount: broker, srcSymbol: '009810', srcQty: 1000, dstAccount: cash, dstSymbol: 'TWD', dstQty: 21000, amount: 21000, fee: 0, tax: 0 });
  add({ type: '賣出', date: '2026-10-13', settleDate: '2026-10-15', srcAccount: broker, srcSymbol: '009810', srcQty: 1000, dstAccount: cash, dstSymbol: 'TWD', dstQty: 20000, amount: 20000, fee: 0, tax: 0 });

  let r = b.call('realizedReport', {});
  assert.ok(r.ok, JSON.stringify(r));
  const d = r.data;
  assert.equal(d.totalTrades, 4);
  assert.equal(d.firstTrade, '2026-07-18');
  const s = d.summary;
  assert.deepEqual([s.count, s.wins, s.losses, s.flat, s.realized, s.cost, s.proceeds], [4, 2, 1, 1, 15000, 200000, 215000]);
  assert.equal(Math.round(s.winRate * 1000), 667, '2 勝 1 敗（平手不算）');
  assert.equal(Math.round(s.returnPct * 10000), 750, '15,000 ÷ 200,000');
  assert.equal(s.approx, true);
  assert.deepEqual([s.best.symbol, s.best.realized], ['4126', 19000]);
  assert.deepEqual([s.worst.symbol, s.worst.realized], ['00757', -5000]);
  const t = Object.fromEntries(d.trades.map((x) => [x.symbol + '|' + x.date, x]));
  const taiyi = t['4126|2026-07-18'];
  assert.deepEqual([taiyi.qty, taiyi.price, taiyi.proceeds, taiyi.cost, taiyi.realized, taiyi.approx], [1000, 130, 129000, 110000, 19000, false]);
  assert.equal(Math.round(taiyi.returnPct * 10000), 1727, '19,000 ÷ 110,000');
  assert.equal(taiyi.holdingDays, 160, '7/18 − 平均買進日 2/8.5（1/10 與 3/10 各 1000 股）');
  const fang = t['00757|2026-10-12'];
  assert.deepEqual([fang.realized, fang.holdingDays, fang.approx], [-5000, 21, true]);
  assert.deepEqual([t['009810|2026-10-12'].realized, t['009810|2026-10-13'].realized, t['009810|2026-10-13'].holdingDays], [1000, 0, 12]);
  // 平均持有天數：(159 + 21 + 11 + 12) / 4
  assert.equal(s.avgHoldingDays, Math.round((160 + 21 + 11 + 12) / 4));
  // 依標的、每月
  assert.deepEqual(d.bySymbol.map((x) => [x.symbol, x.count, x.wins, x.realized]), [['4126', 1, 1, 19000], ['009810', 2, 1, 1000], ['00757', 1, 0, -5000]]);
  assert.deepEqual(d.months.map((m) => [m.ym, m.count, m.realized]), [['2026-07', 1, 19000], ['2026-10', 3, -4000]]);
  // 最新的在前
  assert.deepEqual(d.trades.map((x) => x.date), ['2026-10-13', '2026-10-12', '2026-10-12', '2026-07-18']);
  // 期間篩選：10 月
  r = b.call('realizedReport', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual([r.data.summary.count, r.data.summary.realized, r.data.summary.approx, r.data.totalTrades], [3, -4000, true, 4]);
  assert.equal(r.data.summary.best.symbol, '009810');
  assert.equal(r.data.summary.worst.symbol, '00757');
  // 跟持倉頁的已實現一致
  const hr = b.call('getHoldings').data.realized;
  assert.equal(hr.reduce((a, x) => a + x.realizedBase, 0), 15000);
});
