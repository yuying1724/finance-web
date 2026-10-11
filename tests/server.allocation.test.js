'use strict';
/** 資產配置（bootstrap.allocation）：依類別、幣別分組，負債另列，單一最大持股 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

test('資產配置：台幣現金、台股、海外股票、外幣現金、應收分開算；幣別看計價幣別；信用卡欠款列在負債；找出最大一檔', () => {
  const b = loadBackend().setup();
  const acct = (name, type, sym = 'TWD') => { const r = b.call('upsertAccount', { account: { name, type, defaultSymbol: sym, institution: name } }); assert.ok(r.ok, JSON.stringify(r)); return r.data.account.id; };
  const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const bank = acct('銀行', '銀行');
  const usd = acct('外幣帳戶', '銀行', 'USD');
  const tw = acct('台股證券', '證券');
  const us = acct('複委託', '證券');
  const card = acct('信用卡', '信用卡');
  const recv = acct('代墊款', '應收');
  ok(b.call('upsertInstrument', { instrument: { symbol: '0050', name: '元大台灣50', type: 'ETF', quote: 'TWD', decimals: 0, isNew: true } }));
  ok(b.call('upsertInstrument', { instrument: { symbol: 'VOO', name: 'Vanguard S&P 500', type: 'ETF', quote: 'USD', decimals: 4, isNew: true } }));
  ok(b.call('upsertBrokerSettings', { broker: { accountId: tw, market: '台股', buySettleDays: 0, sellSettleDays: 0, calendar: '台灣', settleAccountId: bank } }));
  ok(b.call('upsertBrokerSettings', { broker: { accountId: us, market: '複委託', calendar: '台灣+美國', settleAccountId: bank } }));
  const add = (tx) => ok(b.call('addTransaction', { tx }));
  add({ type: '調整', date: '2026-03-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 200000 });
  add({ type: '調整', date: '2026-03-01', dstAccount: usd, dstSymbol: 'USD', dstQty: 1000 });
  add({ type: '買入', date: '2026-03-02', settleDate: '2026-03-02', srcAccount: bank, srcSymbol: 'TWD', srcQty: 21000, dstAccount: tw, dstSymbol: '0050', dstQty: 215, amount: 21000 });
  add({ type: '買入', date: '2026-03-02', settleDate: '2026-03-02', srcAccount: bank, srcSymbol: 'TWD', srcQty: 30000, dstAccount: us, dstSymbol: 'VOO', dstQty: 2, amount: 950 });
  add({ type: '轉帳', date: '2026-03-03', srcAccount: bank, srcSymbol: 'TWD', srcQty: 500, dstAccount: recv, dstSymbol: 'TWD', dstQty: 500 });
  const lunch = b.call('bootstrap').data.categories.find((c) => c.name === '午餐' && c.type === '支出').id;
  add({ type: '支出', date: '2026-03-04', srcAccount: card, srcSymbol: 'TWD', srcQty: 3000, categoryId: lunch });

  const sh = b.ss.sheet('價格');
  const header = sh.dump()[0];
  const col = (name) => header.indexOf(name) + 1;
  const rowOf = (sym) => sh.dump().findIndex((r) => r[col('標的代號') - 1] === sym) + 1;
  sh.poke(rowOf('0050'), col('上次有效價'), 100);
  sh.poke(rowOf('VOO'), col('上次有效價'), 500);
  sh.poke(rowOf('USD'), col('上次有效價'), 31.86);

  const al = b.call('bootstrap').data.allocation;
  const val = (list) => Object.fromEntries(list.map((g) => [g.key, g.value]));
  assert.deepEqual(al.byClass.map((g) => g.key), ['twdCash', 'twStock', 'usStock', 'fxCash', 'receivable'], '類別依固定順序');
  assert.deepEqual(val(al.byClass), { twdCash: 148500, twStock: 21500, usStock: 31860, fxCash: 31860, receivable: 500 });
  assert.equal(al.assets, 234220);
  assert.deepEqual(val(al.byCurrency), { TWD: 170500, USD: 63720 }, 'VOO 算美金、0050 和應收算台幣');
  assert.equal(al.byCurrency[0].key, 'TWD');
  assert.equal(al.liabilities, 3000);
  assert.deepEqual(al.byLiability.map((g) => [g.key, g.value]), [['信用卡', 3000]]);
  assert.equal(al.top.symbol, 'VOO');
  assert.equal(al.top.value, 31860);
  const usStock = al.byClass.find((g) => g.key === 'usStock');
  assert.deepEqual(usStock.items.map((x) => x.label), ['VOO Vanguard S&P 500']);
  const usdItems = al.byCurrency.find((g) => g.key === 'USD').items.map((x) => x.label).sort();
  assert.deepEqual(usdItems, ['VOO Vanguard S&P 500', '外幣帳戶']);
});
