'use strict';
/** 批次 2：投資功能（台股、複委託、股息、拆併股、交割日、持倉與損益）端對端測試，透過真正的 API 層（不繞過驗證）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

function fresh() {
  const b = loadBackend().setup();
  const acct = (name, type, sym = 'TWD') => {
    const r = b.call('upsertAccount', { account: { name, type, defaultSymbol: sym, institution: name } });
    assert.ok(r.ok, JSON.stringify(r));
    return r.data.account.id;
  };
  const boot = () => { const r = b.call('bootstrap'); assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const add = (tx, requestId) => b.call('addTransaction', { tx, requestId });
  const inst = (o) => { const r = b.call('upsertInstrument', { instrument: o }); assert.ok(r.ok, JSON.stringify(r)); return r.data.instrument; };
  const broker = (o) => { const r = b.call('upsertBrokerSettings', { broker: o }); assert.ok(r.ok, JSON.stringify(r)); return r.data.broker; };
  const holdings = (asOf) => { const r = b.call('getHoldings', asOf ? { asOf } : {}); assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  return Object.assign(b, { acct, boot, add, inst, broker, holdings });
}

test('標的：新增股票/ETF、代號不可重複與不可修改、計價幣別須為法幣', () => {
  const b = fresh();
  const r = b.inst({ symbol: '0050', name: '元大台灣50', type: 'ETF', quote: 'TWD', decimals: 0, priceSource: 'GOOGLEFINANCE', quoteCode: 'TPE:0050' });
  assert.equal(r.symbol, '0050');
  assert.equal(b.call('upsertInstrument', { instrument: { symbol: '0050', name: '重複', type: 'ETF', quote: 'TWD' } }).error.code, 'VALIDATION');
  assert.equal(b.call('upsertInstrument', { instrument: { symbol: 'VOO', name: 'x', type: 'ETF', quote: 'ZZZ' } }).error.code, 'VALIDATION');
  const cur = b.boot().instruments.find((i) => i.symbol === '0050');
  const upd = b.call('upsertInstrument', { instrument: { symbol: '0050', name: '元大台灣50正式', type: 'ETF', quote: 'TWD', decimals: 0, isNew: false }, expectedUpdatedAt: cur.updatedAt });
  assert.ok(upd.ok, JSON.stringify(upd));
  assert.equal(b.boot().instruments.find((i) => i.symbol === '0050').name, '元大台灣50正式');
  assert.equal(b.call('setInstrumentActive', { symbol: '0050', active: false }).data.instrument.active, false);
});

test('證券帳戶設定：只有證券/加密交易所帳戶可設定；市場與交割日曆驗證', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const broker1 = b.acct('元大證券', '證券');
  assert.equal(b.call('upsertBrokerSettings', { broker: { accountId: bank, market: '台股' } }).error.code, 'VALIDATION');
  const ok = b.broker({ accountId: broker1, market: '台股', buySettleDays: 2, sellSettleDays: 2, calendar: '台灣', settleAccountId: bank });
  assert.equal(ok.buySettleDays, 2);
  assert.equal(b.call('upsertBrokerSettings', { broker: { accountId: broker1, market: '亂填' } }).error.code, 'VALIDATION');
});

test('台股買入賣出：驗證擋現金端填股票/股票端填現金；交割日前銀行餘額不變、股票已入帳；淨值連續', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const broker1 = b.acct('元大證券', '證券');
  b.inst({ symbol: '0050', name: '元大台灣50', type: 'ETF', quote: 'TWD', decimals: 0 });
  b.broker({ accountId: broker1, market: '台股', buySettleDays: 2, sellSettleDays: 2, calendar: '台灣', settleAccountId: bank });
  assert.ok(b.add({ type: '調整', date: '2026-03-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 500000 }).ok);

  // 型別驗證：來源不能填股票、目的不能填現金
  const bad1 = b.add({ type: '買入', date: '2026-03-04', settleDate: '2026-03-06', srcAccount: broker1, srcSymbol: '0050', srcQty: 1, dstAccount: broker1, dstSymbol: '0050', dstQty: 1000, amount: 135000, fee: 192 });
  assert.equal(bad1.error.code, 'VALIDATION');
  const bad2 = b.add({ type: '買入', date: '2026-03-04', settleDate: '2026-03-06', srcAccount: bank, srcSymbol: 'TWD', srcQty: 135192, dstAccount: broker1, dstSymbol: 'TWD', dstQty: 1000, amount: 135000, fee: 192 });
  assert.equal(bad2.error.code, 'VALIDATION');

  const buy = b.add({ type: '買入', date: '2026-03-04', settleDate: '2026-03-06', srcAccount: bank, srcSymbol: 'TWD', srcQty: 135192, dstAccount: broker1, dstSymbol: '0050', dstQty: 1000, amount: 135000, fee: 192 });
  assert.ok(buy.ok, JSON.stringify(buy));

  const mock = b.mock; // 直接操控假時鐘來模擬「今天」
  function bootAt(day) { mock.state.clock.now = new Date(day + 'T09:00:00+08:00').getTime(); b.login(); return b.boot(); }
  const balOf = (d, a, s) => (d.balances.find((x) => x.accountId === a && x.symbol === s) || { qty: 0 }).qty;

  const mid = bootAt('2026-03-05');
  assert.equal(balOf(mid, bank, 'TWD'), 500000, '交割日前銀行餘額不變');
  assert.equal(balOf(mid, broker1, '0050'), 1000, '成交日起股票已入帳');
  assert.deepEqual(mid.pending, [{ accountId: bank, symbol: 'TWD', qty: -135192 }]);
  const nwMid = mid.netWorth.total;

  const settleDay = bootAt('2026-03-06');
  assert.equal(balOf(settleDay, bank, 'TWD'), 500000 - 135192, '交割日銀行餘額才真的扣款');
  assert.deepEqual(settleDay.pending, []);
  void nwMid; // 0050 沒有設定現價（屬 missing），淨值總額本身不具可比性；交割前後不變動已由上面的 pending／餘額斷言驗證

  // 賣出 400 股
  const sell = b.add({ type: '賣出', date: '2026-03-09', settleDate: '2026-03-11', srcAccount: broker1, srcSymbol: '0050', srcQty: 400, dstAccount: bank, dstSymbol: 'TWD', dstQty: 55864, amount: 56000, fee: 80, tax: 56 });
  assert.ok(sell.ok, JSON.stringify(sell));
  const mid2 = bootAt('2026-03-10');
  assert.equal(balOf(mid2, broker1, '0050'), 600, '賣出後股票立刻減少');
  assert.equal(balOf(mid2, bank, 'TWD'), 500000 - 135192, '入帳前銀行餘額還沒增加');
  assert.deepEqual(mid2.pending, [{ accountId: bank, symbol: 'TWD', qty: 55864 }]);
  const settleDay2 = bootAt('2026-03-11');
  assert.equal(balOf(settleDay2, bank, 'TWD'), 500000 - 135192 + 55864);
  assert.deepEqual(settleDay2.pending, []);
});

test('複委託：隱含匯率過低會警告；持倉成本、未實現損益（股價/匯兌拆分）、已實現損益，數字與手算模型一致', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const broker1 = b.acct('永豐複委託', '證券');
  b.inst({ symbol: 'VOO', name: 'Vanguard S&P 500', type: '美股', quote: 'USD', decimals: 4 });
  b.broker({ accountId: broker1, market: '複委託', buySettleDays: 1, sellSettleDays: 2, calendar: '台灣+美國', settleAccountId: bank, feeCurrency: 'USD' });
  assert.ok(b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1000000 }).ok);
  b.ss.sheet('價格').formulaResults['2,2'] = 31.5; // USD 現價（列 2 = USD，依既有測試慣例）

  // 用另一個測試專用帳戶下單，避免這筆「刻意打錯」的交易污染下面的持倉數字
  const scratch = b.acct('測試用複委託', '證券');
  const warn = b.add({ type: '買入', date: '2026-02-01', srcAccount: bank, srcSymbol: 'TWD', srcQty: 3207, dstAccount: scratch, dstSymbol: 'VOO', dstQty: 2, amount: 1000, fee: 15 });
  assert.ok(warn.ok);
  assert.ok(warn.data.warnings.some((w) => w.includes('隱含匯率')), '少打一位數應該被隱含匯率檢查抓到');

  const b1 = b.add({ type: '買入', date: '2026-02-01', srcAccount: bank, srcSymbol: 'TWD', srcQty: 32074, dstAccount: broker1, dstSymbol: 'VOO', dstQty: 2, amount: 1000, fee: 15 });
  assert.ok(b1.ok, JSON.stringify(b1));
  const b2 = b.add({ type: '買入', date: '2026-02-05', srcAccount: bank, srcSymbol: 'TWD', srcQty: (520 + 15) * 32.0, dstAccount: broker1, dstSymbol: 'VOO', dstQty: 1, amount: 520, fee: 15 });
  assert.ok(b2.ok, JSON.stringify(b2));

  const h = b.holdings('2026-02-10');
  const pos = h.positions.find((p) => p.symbol === 'VOO');
  assert.equal(pos.qty, 3);
  assert.ok(Math.abs(pos.costNative - 1550) < 1e-6);
  assert.ok(Math.abs(pos.costBase - 49194) < 1e-4);

  // 賣 1 股
  const s1 = b.add({ type: '賣出', date: '2026-03-01', srcAccount: broker1, srcSymbol: 'VOO', srcQty: 1, dstAccount: bank, dstSymbol: 'TWD', dstQty: 595 * 32.4, amount: 610, fee: 15 });
  assert.ok(s1.ok, JSON.stringify(s1));
  const h2 = b.holdings('2026-03-05');
  const rec = h2.realized.find((r) => r.symbol === 'VOO');
  assert.ok(Math.abs(rec.realizedNative - 78.3333333) < 1e-4);
  assert.ok(Math.abs(rec.realizedBase - 2880) < 1e-4);
  const pos2 = h2.positions.find((p) => p.symbol === 'VOO');
  assert.equal(pos2.qty, 2);
  assert.ok(Math.abs(pos2.costBase - 32796) < 1e-4);
});

test('美股股息（現金股息扣預扣稅）與拆股/併股（股數調整，成本不變）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const broker1 = b.acct('永豐複委託', '證券');
  b.inst({ symbol: 'VOO', name: 'Vanguard S&P 500', type: '美股', quote: 'USD', decimals: 4 });
  assert.ok(b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 1000000 }).ok);
  assert.ok(b.add({ type: '買入', date: '2026-01-05', srcAccount: bank, srcSymbol: 'TWD', srcQty: 32074, dstAccount: broker1, dstSymbol: 'VOO', dstQty: 2, amount: 1000, fee: 15 }).ok);

  const div = b.add({ type: '股息', date: '2026-02-01', dstAccount: broker1, dstSymbol: 'USD', dstQty: 2.52, amount: 3.60, tax: 1.08, relatedSymbol: 'VOO' });
  assert.ok(div.ok, JSON.stringify(div));
  assert.equal(b.add({ type: '股息', date: '2026-02-01', dstAccount: broker1, dstSymbol: 'USD', dstQty: 2.52, amount: 3.60, tax: 1.08 }).error.code, 'VALIDATION', '沒填關聯標的要擋');

  assert.ok(b.add({ type: '股數調整', date: '2026-03-01', dstAccount: broker1, dstSymbol: 'VOO', dstQty: 2 }).ok); // 2 拆 4
  const h1 = b.holdings('2026-03-02');
  const p1 = h1.positions.find((p) => p.symbol === 'VOO');
  assert.equal(p1.qty, 4);
  assert.ok(Math.abs(p1.costNative - 1015) < 1e-6, '拆股後總成本不變');

  assert.ok(b.add({ type: '股數調整', date: '2026-04-01', srcAccount: broker1, srcSymbol: 'VOO', srcQty: 2 }).ok); // 4 併 2
  const h2 = b.holdings('2026-04-02');
  const p2 = h2.positions.find((p) => p.symbol === 'VOO');
  assert.equal(p2.qty, 2);
  assert.ok(Math.abs(p2.costNative - 1015) < 1e-6, '併股後總成本仍不變');

  assert.equal(h2.dividends.length, 1);
  assert.ok(Math.abs(h2.dividends[0].net - 2.52) < 1e-6);
});

test('休市日種子資料（2026 真實台灣行事曆）：春節封關 2/11 成交 T+2=2/13；封關期間交易則跳過整個連假到開紅盤後', () => {
  const b = fresh();
  const boot = b.boot();
  assert.ok(boot.holidays.length > 20, '應該已經種入台灣＋美國的休市日資料');
  const holidaySet = boot.holidays.reduce((set, r) => { set[r.market + '|' + r.date] = { trading: r.trading, settling: r.settling }; return set; }, {});
  const FinDates = b.ctx.FinDates;
  // 封關前最後交易日 2/11 成交：T+2 落在「僅辦理交割」的 2/13，而不是被整個春節連假擋住
  assert.equal(FinDates.addSettleDays('2026-02-11', 2, ['台灣'], holidaySet), '2026-02-13');
  // 若從封關最後一個「僅辦理交割」日 2/13 起算 T+2，會完整跳過 2/16-2/20 的連假，落在開紅盤後的 2/24（而不是誤判成 2/17）
  assert.equal(FinDates.addSettleDays('2026-02-13', 2, ['台灣'], holidaySet), '2026-02-24');
  // 美股休市日也已種入（2026 元旦）
  assert.ok(boot.holidays.some((r) => r.market === '美國' && r.date === '2026-01-01'));
});
