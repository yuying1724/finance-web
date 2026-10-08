'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const FinHoldings = require('../core/holdings.js');

// 數字取自使用者 2026-10-08 元大證券 app 截圖：券商「損益」= 市值 − 成本 − 預估賣出手續費 − 證交稅
const TW_BROKER = { market: '台股', feeRate: 0, feeDiscount: 1, taxRateStock: 0.003, taxRateEtf: 0.001 };
const stock = { type: '台股', quote: 'TWD' };
const etf = { type: 'ETF', quote: 'TWD' };

test('預估賣出費用：跟券商 app 的損益一致（手續費 0.1425%、股票證交稅 0.3%、ETF 0.1%，各自捨去到元）', () => {
  const cases = [
    { inst: etf, mv: 114.95 * 215, cost: 18907, broker: 5748 }, // 0050
    { inst: stock, mv: 1965 * 9, cost: 15799, broker: 1808 }, // 台達電
    { inst: stock, mv: 144 * 485, cost: 85185, broker: -15653 }, // 元太
  ];
  for (const c of cases) {
    const v = { mvBase: c.mv, totalBase: c.mv - c.cost, missing: false };
    const sc = FinHoldings.estimateSellCost(v, c.inst, TW_BROKER, 'TWD');
    assert.equal(Math.round(v.totalBase - sc.total), c.broker);
  }
  const hua = FinHoldings.estimateSellCost({ mvBase: 367200, missing: false }, stock, TW_BROKER, 'TWD'); // 華固
  assert.deepEqual([hua.fee, hua.tax, hua.total], [523, 1101, 1624]);
});

test('預估賣出費用：美股／複委託、缺價格不扣；證券帳戶有設定費率就用「費率 × 折扣」', () => {
  const us = FinHoldings.estimateSellCost({ mvBase: 49000, missing: false }, { type: 'ETF', quote: 'USD' }, { market: '複委託' }, 'TWD');
  assert.equal(us.total, 0);
  assert.equal(FinHoldings.estimateSellCost({ mvBase: 1000, missing: false }, etf, { market: '複委託' }, 'TWD').total, 0);
  assert.equal(FinHoldings.estimateSellCost({ missing: true }, stock, TW_BROKER, 'TWD').total, 0);
  const disc = FinHoldings.estimateSellCost({ mvBase: 100000, missing: false }, stock, { market: '台股', feeRate: 0.001425, feeDiscount: 0.28, taxRateStock: 0.003 }, 'TWD');
  assert.deepEqual([disc.fee, disc.tax], [39, 300]);
  // 沒有證券帳戶設定：用預設費率
  assert.equal(FinHoldings.estimateSellCost({ mvBase: 100000, missing: false }, stock, null, 'TWD').total, 142 + 300);
});
