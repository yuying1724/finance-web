'use strict';
/** 投資報表：期間損益＝未實現變化＋已實現＋股息；每月一覽；依標的；修正 Dietz 報酬率；價格歷史記錄與補抓 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

// 今天是 2026-03-10（模擬時鐘）
function setup() {
  const b = loadBackend().setup();
  const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const acct = (name, type) => ok(b.call('upsertAccount', { account: { name, type, defaultSymbol: 'TWD', institution: name } })).account.id;
  const bank = acct('銀行', '銀行');
  const tw = acct('台股證券', '證券');
  ok(b.call('upsertInstrument', { instrument: { symbol: '0050', name: '元大台灣50', type: 'ETF', quote: 'TWD', decimals: 0, priceSource: '手動', isNew: true } }));
  ok(b.call('upsertBrokerSettings', { broker: { accountId: tw, market: '台股', buySettleDays: 0, sellSettleDays: 0, calendar: '台灣', settleAccountId: bank } }));
  const add = (tx) => ok(b.call('addTransaction', { tx }));
  add({ type: '調整', date: '2026-01-02', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000 });
  // 第一筆投資紀錄（舊部位補登）：100 股、成本 10,000
  add({ type: '買入', date: '2026-01-05', settleDate: '2026-01-05', srcAccount: bank, srcSymbol: 'TWD', srcQty: 10000, dstAccount: tw, dstSymbol: '0050', dstQty: 100, amount: 10000 });
  add({ type: '買入', date: '2026-02-10', settleDate: '2026-02-10', srcAccount: bank, srcSymbol: 'TWD', srcQty: 12800, dstAccount: tw, dstSymbol: '0050', dstQty: 100, amount: 12800 });
  add({ type: '賣出', date: '2026-03-03', settleDate: '2026-03-03', srcAccount: tw, srcSymbol: '0050', srcQty: 50, dstAccount: bank, dstSymbol: 'TWD', dstQty: 6500, amount: 6510, fee: 5, tax: 5 });
  add({ type: '股息', date: '2026-03-05', dstAccount: bank, dstSymbol: 'TWD', dstQty: 300, relatedSymbol: '0050' });
  // 價格歷史與現價
  b.ctx.FinJobs.recordCloses('', [
    { date: '2026-01-05', symbol: '0050', close: 120 }, { date: '2026-01-30', symbol: '0050', close: 130 },
    { date: '2026-02-27', symbol: '0050', close: 125 },
  ]);
  const sh = b.ss.sheet('價格');
  const header = sh.dump()[0];
  const col = (name) => header.indexOf(name) + 1;
  const row = sh.dump().findIndex((r) => r[col('標的代號') - 1] === '0050') + 1;
  sh.poke(row, col('上次有效價'), 140);
  return { b, ok, bank, tw, add };
}

test('投資報表：整段期間與每月；兩種算法（市值變化 vs 損益拆解）一致；修正 Dietz 報酬率', () => {
  const { b, ok } = setup();
  const r = ok(b.call('investReport', {}));
  assert.equal(r.dataStart, '2026-01-05');
  const s = r.summary;
  assert.equal(s.startDate, '2026-01-05', '第一天（補登）從那天收盤起算');
  assert.deepEqual([s.startValue, s.endValue, s.buys, s.sells, s.netInvest], [12000, 21000, 12800, 6500, 6300]);
  assert.deepEqual([s.unrealizedChange, s.realized, s.dividends, s.total], [1900, 800, 300, 3000]);
  assert.equal(s.endValue - s.startValue - s.netInvest + s.dividends, s.total);
  assert.equal(s.returnPct, 0.1776); // 3000 ÷ (12000 + 12800×28/64 − 6500×7/64)
  assert.deepEqual(r.months.map((m) => [m.ym, m.unrealizedChange, m.realized, m.dividends, m.total, m.netInvest]), [
    ['2026-01', 1000, 0, 0, 1000, 0],
    ['2026-02', -800, 0, 0, -800, 12800],
    ['2026-03', 1700, 800, 300, 2800, -6500],
  ]);
  assert.equal(r.bySymbol.length, 1);
  assert.deepEqual([r.bySymbol[0].symbol, r.bySymbol[0].name, r.bySymbol[0].total, r.bySymbol[0].held], ['0050', '元大台灣50', 3000, true]);
  assert.equal(r.estimated, false);

  // 只看本月：期初＝2/28（用 2/27 收盤 125）
  const m = ok(b.call('investReport', { from: '2026-03-01', to: '2026-03-31' })).summary;
  assert.deepEqual([m.from, m.to, m.startDate, m.startValue, m.total], ['2026-03-01', '2026-03-10', '2026-02-28', 25000, 2800]);
  // 早於第一筆紀錄的起點會被拉到第一天
  assert.equal(ok(b.call('investReport', { from: '2025-01-01' })).summary.from, '2026-01-05');

  // 交易頁月份統計帶投資數字；股息、賣出仍不算一般收入
  const ms = ok(b.call('monthSummary', { ym: '2026-03' }));
  assert.equal(ms.income, 0);
  assert.deepEqual([ms.invest.buys, ms.invest.sells, ms.invest.realized, ms.invest.dividends, ms.invest.total], [0, 6500, 800, 300, 2800]);
  assert.equal(ok(b.call('monthSummary', { ym: '2026-05' })).invest, undefined, '未來月份沒有投資數字');
  // 交易篩選「投資」
  const list = ok(b.call('listTransactions', { filters: { type: '投資' }, limit: 50 }));
  assert.deepEqual(list.items.map((t) => t.type).sort(), ['股息', '買入', '買入', '賣出'].sort());
});

test('投資報表：沒有歷史價格時用目前價格估算並列出缺的標的', () => {
  const b = loadBackend().setup();
  const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const bank = ok(b.call('upsertAccount', { account: { name: '銀行', type: '銀行', defaultSymbol: 'TWD' } })).account.id;
  const tw = ok(b.call('upsertAccount', { account: { name: '證券', type: '證券', defaultSymbol: 'TWD' } })).account.id;
  ok(b.call('upsertInstrument', { instrument: { symbol: '2330', name: '台積電', type: '台股', quote: 'TWD', decimals: 0, priceSource: '手動', isNew: true } }));
  ok(b.call('addTransaction', { tx: { type: '買入', date: '2026-01-05', settleDate: '2026-01-05', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1000, dstAccount: tw, dstSymbol: '2330', dstQty: 1, amount: 1000 } }));
  ok(b.call('addTransaction', { tx: { type: '買入', date: '2026-02-05', settleDate: '2026-02-05', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1000, dstAccount: tw, dstSymbol: '2330', dstQty: 1, amount: 1000 } }));
  const r = ok(b.call('investReport', { from: '2026-02-01' }));
  assert.equal(r.estimated, false, '沒有現價也沒有歷史價時用成本，不算估算');
  assert.equal(r.summary.total, 0);
  const sh = b.ss.sheet('價格');
  const header = sh.dump()[0];
  const row = sh.dump().findIndex((x) => x[header.indexOf('標的代號')] === '2330') + 1;
  sh.poke(row, header.indexOf('上次有效價') + 1, 1500);
  const r2 = ok(b.call('investReport', { from: '2026-02-01' }));
  assert.equal(r2.estimated, true);
  assert.deepEqual(r2.missing, ['2330']);
});

test('價格歷史：更新價格時記下當天價格（同一天覆蓋）；補抓台股月成交資訊（上市找不到改查上櫃），已有的不重抓', () => {
  const { b, ok } = setup();
  const sh = b.ss.sheet('價格');
  const header = sh.dump()[0];
  const col = (name) => header.indexOf(name) + 1;
  const row = sh.dump().findIndex((r) => r[col('標的代號') - 1] === '0050') + 1;
  sh.poke(row, col('現價'), 141);
  b.ctx.FinJobs.refreshPrices();
  const hist = () => b.ss.sheet('價格歷史').dump().slice(1).filter((r) => r[0] !== '' && r[0] !== null);
  const todays = hist().filter((r) => r[1] === '0050' && String(r[2]) !== '' && (r[0] instanceof Date ? b.ctx.FinDates.today(r[0].getTime()) : r[0]) === '2026-03-10');
  assert.equal(todays.length, 1);
  assert.equal(Number(todays[0][2]), 141);
  sh.poke(row, col('現價'), 142);
  b.ctx.FinJobs.refreshPrices();
  const again = hist().filter((r) => r[1] === '0050' && (r[0] instanceof Date ? b.ctx.FinDates.today(r[0].getTime()) : r[0]) === '2026-03-10');
  assert.deepEqual(again.map((r) => Number(r[2])), [142], '同一天只留一筆，換成新價格');

  // 補抓：0050 上市（證交所），8069 上櫃（證交所查無 → 櫃買）
  ok(b.call('upsertInstrument', { instrument: { symbol: '8069', name: '元太', type: '台股', quote: 'TWD', decimals: 0, priceSource: '手動', isNew: true } }));
  const tw = b.call('bootstrap').data.accounts.find((a) => a.name === '台股證券').id;
  const bank = b.call('bootstrap').data.accounts.find((a) => a.name === '銀行').id;
  ok(b.call('addTransaction', { tx: { type: '買入', date: '2026-02-11', settleDate: '2026-02-11', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1500, dstAccount: tw, dstSymbol: '8069', dstQty: 10, amount: 1500 } }));
  const urls = [];
  b.state.urlFetch.handler = (url) => {
    urls.push(url);
    if (/STOCK_DAY\?/.test(url)) {
      if (/stockNo=8069/.test(url)) return { body: { stat: '很抱歉，沒有符合條件的資料!' } };
      const ym = /date=(\d{6})01/.exec(url)[1];
      const roc = String(Number(ym.slice(0, 4)) - 1911) + '/' + ym.slice(4, 6);
      return { body: { stat: 'OK', data: [[roc + '/02', '1', '1', '1', '1', '1', '111.50', '', '', ''], [roc + '/03', '1', '1', '1', '1', '1', '1,112.00', '', '', '']] } };
    }
    if (/tradingStock/.test(url)) return { body: { tables: [{ data: [['115/02/12', '1', '1', '1', '1', '1', '150.50', '1', '1']] }] } };
    return { body: {} };
  };
  b.advance(120000);
  const res = ok(b.call('backfillPriceHistory', {}));
  assert.deepEqual(res.failed, []);
  const by = Object.fromEntries(res.symbols.map((x) => [x.symbol, x.days]));
  assert.ok(by['0050'] >= 4, JSON.stringify(res)); // 12 月底～3 月每個月 2 天（1/5、1/30、2/27 原本就有，不重複）
  assert.equal(by['8069'], 1);
  assert.ok(urls.some((u) => /tradingStock\?response=json&code=8069&date=2026\/02\/01/.test(u)));
  const n = hist().length;
  b.advance(120000);
  const res2 = ok(b.call('backfillPriceHistory', {}));
  assert.equal(res2.added, 0, '已經有的日期不重抓');
  assert.equal(hist().length, n);
  // 1,112.00 這種有千分位的也看得懂
  assert.ok(hist().some((r) => r[1] === '0050' && Number(r[2]) === 1112));
});
