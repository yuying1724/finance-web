'use strict';
/** 台股／ETF 股息自動偵測（FinDividends）、股息確認、扣款日曆列出待確認股息、美股股息範本 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

function at(b, day, hour = 9) { b.mock.state.clock.now = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+08:00`).getTime(); if (b.token) b.login(); }

function fresh(day) {
  const b = loadBackend().setup();
  at(b, day); b.login();
  const acct = (name, type, sym = 'TWD') => { const r = b.call('upsertAccount', { account: { name, type, defaultSymbol: sym, institution: name } }); assert.ok(r.ok, JSON.stringify(r)); return r.data.account.id; };
  const inst = (o) => { const r = b.call('upsertInstrument', { instrument: Object.assign({ quote: 'TWD', decimals: 0, priceSource: '手動', isNew: true }, o) }); assert.ok(r.ok, JSON.stringify(r)); };
  const add = (tx) => { const r = b.call('addTransaction', { tx }); assert.ok(r.ok, JSON.stringify(r)); return r.data.transaction || r.data; };
  return Object.assign(b, { acct, inst, add });
}

/** 模擬證交所／櫃買中心的除權除息預告 */
function feeds(b, { twse = [], tpex = [], fail = {} } = {}) {
  b.state.urlFetch.handler = (url) => {
    if (/TWT48U_ALL/.test(url)) return fail.twse ? { code: 500, body: 'x' } : { body: twse };
    if (/tpex_exright_prepost/.test(url)) return fail.tpex ? { code: 500, body: 'x' } : { body: tpex };
    return { body: [] };
  };
}

function setupHoldings() {
  const b = fresh('2026-10-01');
  const broker = b.acct('元大-證券', '證券');
  const cma = b.acct('元大-CMA', '銀行');
  const settle = b.acct('元大-綜存', '銀行');
  assert.ok(b.call('upsertBrokerSettings', { broker: { accountId: broker, market: '台股', feeRate: 0.001425, feeDiscount: 1, feeCurrency: 'TWD', buySettleDays: 2, sellSettleDays: 2, calendar: '台灣', settleAccountId: settle, dividendAccountId: cma } }).ok);
  b.inst({ symbol: '0056', name: '元大高股息', type: 'ETF' });
  b.inst({ symbol: '2330', name: '台積電', type: '台股' });
  b.inst({ symbol: '6488', name: '環球晶', type: '台股' });
  b.inst({ symbol: '9999', name: '沒持有', type: '台股' });
  b.add({ type: '調整', date: '2026-09-01', dstAccount: settle, dstSymbol: 'TWD', dstQty: 5000000, categoryId: '' });
  // 0056 先買 30,000 股；除息日（10/16）前一天再買 1,000 股；除息當天買的 500 股不算
  b.add({ type: '買入', date: '2026-09-02', settleDate: '2026-09-04', srcAccount: settle, srcSymbol: 'TWD', srcQty: 1000000, dstAccount: broker, dstSymbol: '0056', dstQty: 30000, amount: 1000000, fee: 0, tax: 0 });
  b.add({ type: '買入', date: '2026-10-15', settleDate: '2026-10-19', srcAccount: settle, srcSymbol: 'TWD', srcQty: 35000, dstAccount: broker, dstSymbol: '0056', dstQty: 1000, amount: 35000, fee: 0, tax: 0 });
  b.add({ type: '買入', date: '2026-10-16', settleDate: '2026-10-20', srcAccount: settle, srcSymbol: 'TWD', srcQty: 17500, dstAccount: broker, dstSymbol: '0056', dstQty: 500, amount: 17500, fee: 0, tax: 0 });
  b.add({ type: '買入', date: '2026-09-02', settleDate: '2026-09-04', srcAccount: settle, srcSymbol: 'TWD', srcQty: 100000, dstAccount: broker, dstSymbol: '2330', dstQty: 100, amount: 100000, fee: 0, tax: 0 });
  b.add({ type: '買入', date: '2026-09-02', settleDate: '2026-09-04', srcAccount: settle, srcSymbol: 'TWD', srcQty: 50000, dstAccount: broker, dstSymbol: '6488', dstQty: 100, amount: 50000, fee: 0, tax: 0 });
  return { b, broker, cma, settle };
}

const pendingDivs = (b) => b.call('bootstrap').data.pendingConfirmations.filter((t) => t.type === '股息');

test('民國日期轉換與預估金額：元以下捨去、單筆 ≥ 2 萬才扣二代健保 2.11%、匯費 10 元', () => {
  const b = loadBackend();
  const D = b.ctx.FinDividends;
  assert.equal(D.rocToIso('1151016'), '2026-10-16');
  assert.equal(D.rocToIso('115/10/16'), '2026-10-16');
  assert.equal(D.rocToIso('20261016'), '2026-10-16');
  assert.equal(D.rocToIso(''), '');
  assert.equal(D.addMonthsToDate('2026-01-31', 1), '2026-02-28');
  const c = { settings: {} };
  const est = (cc, sh, cash) => JSON.parse(JSON.stringify(D.estimate(cc, sh, cash)));
  assert.deepEqual(est(c, 31000, 0.8), { gross: 24800, fee: 10, tax: 523, net: 24267 });
  assert.deepEqual(est(c, 100, 4.5), { gross: 450, fee: 10, tax: 0, net: 440 });
  assert.deepEqual(est(c, 1, 5), { gross: 5, fee: 0, tax: 0, net: 5 }, '金額小於匯費時不扣匯費');
  assert.deepEqual(est({ settings: { 股息匯費: '0', 二代健保門檻: '50000' } }, 31000, 0.8), { gross: 24800, fee: 0, tax: 0, net: 24800 }, '「設定」分頁可以覆寫');
});

test('除息日前先記住公告；到除息日才用前一天的持股產生待確認股息（入「股息入帳帳戶」、日期＝除息日＋1 個月）', () => {
  const { b, cma } = setupHoldings();
  const twse = [
    { Date: '1151016', Code: '0056', Name: '元大高股息', Exdividend: '息', CashDividend: '0.8', StockDividendRatio: '' },
    { Date: '1151016', Code: '9999', Name: '沒持有', Exdividend: '息', CashDividend: '1' },
    { Date: '1151016', Code: '1234', Name: '沒建立標的', Exdividend: '息', CashDividend: '1' },
    { Date: '1151016', Code: '2330', Name: '台積電', Exdividend: '權', CashDividend: '' },
  ];
  const tpex = [{ ExRrightsExDividendDate: '1151020', SecuritiesCompanyCode: '6488', CompanyName: '環球晶', ExRrightsExDividend: '除息', CashDividend: '4.50000000' }];
  feeds(b, { twse, tpex });
  at(b, '2026-10-10', 7);
  let r = b.call('checkDividends').data;
  assert.equal(r.created.length, 0, '還沒到除息日');
  assert.deepEqual(r.waiting.map((w) => w.symbol).sort(), ['0056', '6488', '9999'], '只記住有建立標的的台股／ETF；配股（權）不算');
  // 10/16 早上排程：預告表已經拿掉 0056 了也照樣產生
  feeds(b, { twse: [], tpex });
  at(b, '2026-10-16', 7);
  b.state.mail.length = 0;
  const sum = b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  assert.equal(sum.dividends, 1);
  const list = pendingDivs(b);
  assert.equal(list.length, 1, '沒持有的 9999 不產生');
  const t = list[0];
  assert.equal(t.relatedSymbol, '0056');
  assert.equal(t.dstAccount, cma);
  assert.equal(t.plannedDate, '2026-10-16');
  assert.equal(t.date, '2026-11-16');
  assert.equal(t.amount, 24800, '31,000 股 × 0.8（除息當天買的 500 股不算）');
  assert.equal(t.fee, 10);
  assert.equal(t.tax, 523);
  assert.equal(t.dstQty, 24267);
  assert.equal(t.autoDividend, true);
  assert.match(t.templateName, /股息　0056 元大高股息/);
  assert.match(t.note, /除息日 2026-10-16，每股 0.8 元 × 31000 股/);
  const m = b.state.mail.find((x) => /偵測到股息/.test(x.subject));
  assert.ok(m, '有寄信通知');
  assert.match(m.body, /0056 元大高股息　除息日 2026-10-16　預估 24267 元入 元大-CMA/);
  // 再跑一次不重複
  at(b, '2026-10-17', 7);
  b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  assert.equal(pendingDivs(b).length, 1);
  // 10/20 環球晶（上櫃）：100 股 × 4.5 = 450，未達門檻不扣健保
  at(b, '2026-10-20', 7);
  b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  const g = pendingDivs(b).find((x) => x.relatedSymbol === '6488');
  assert.deepEqual([g.amount, g.fee, g.tax, g.dstQty, g.date], [450, 10, 0, 440, '2026-11-20']);
  // 扣款日曆：待確認股息列在 元大-CMA 的入帳
  const cf = b.call('getCashflow', { days: 60 }).data;
  const acc = cf.accounts.find((a) => a.accountId === cma);
  assert.ok(acc, '股息入帳帳戶出現在日曆');
  assert.deepEqual(acc.items.map((x) => [x.date, x.kind, x.direction, x.amount, x.estimated]), [['2026-11-16', '待確認', 'in', 24267, true], ['2026-11-20', '待確認', 'in', 440, true]]);
  assert.match(acc.items[0].name, /股息 0056 元大高股息（待確認）/);
  // 略過之後不會再產生
  assert.ok(b.call('skipPending', { id: g.id }).ok);
  at(b, '2026-10-21', 7);
  b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  assert.ok(!pendingDivs(b).find((x) => x.relatedSymbol === '6488'));
  assert.equal(b.call('listTransactions', { filters: { type: '股息', includeVoid: true } }).data.items.filter((x) => x.relatedSymbol === '6488').length <= 1, true);
});

test('確認股息：可以改實收金額與入帳日，確認後計入餘額；自己先記過的不產生', () => {
  const { b, cma } = setupHoldings();
  feeds(b, { twse: [{ Date: '1151016', Code: '0056', Name: '元大高股息', Exdividend: '息', CashDividend: '0.8' }, { Date: '1151016', Code: '2330', Name: '台積電', Exdividend: '息', CashDividend: '5' }] });
  // 台積電的股息你自己先記了（除息後）
  b.add({ type: '股息', date: '2026-10-18', dstAccount: cma, dstSymbol: 'TWD', dstQty: 490, relatedSymbol: '2330', categoryId: '' });
  // 10/19 才第一次跑（排程停了幾天）：0056 照樣補產生；台積電已經手動記了 → 不產生
  at(b, '2026-10-19', 7);
  b.call('checkDividends');
  const list = pendingDivs(b);
  assert.deepEqual(list.map((x) => x.relatedSymbol), ['0056']);
  const t = list[0];
  const bal = () => b.call('bootstrap').data.balances.find((x) => x.accountId === cma && x.symbol === 'TWD');
  const before = bal() ? bal().qty : 0;
  // 缺實收金額 → 驗證錯誤
  const bad = b.call('confirmPending', { id: t.id, trade: { date: '2026-11-12' } });
  assert.equal(bad.error.code, 'VALIDATION');
  // 實際只收到 24,277（沒扣匯費）
  const ok = b.call('confirmPending', { id: t.id, trade: { date: '2026-11-12', dstQty: 24277, amount: 24800, fee: 0, tax: 523 } });
  assert.ok(ok.ok, JSON.stringify(ok));
  const row = b.call('listTransactions', { filters: { type: '股息' } }).data.items.find((x) => x.id === t.id);
  assert.deepEqual([row.status, row.date, row.dstQty, row.amount, row.fee, row.tax], ['有效', '2026-11-12', 24277, 24800, 0, 523]);
  at(b, '2026-11-13', 9);
  assert.equal(bal().qty - before, 24277);
  // 再跑排程也不會重複產生
  b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  assert.equal(pendingDivs(b).length, 0);
});

test('來源抓不到不影響排程；證券帳戶沒有設定入帳帳戶就不產生（也不會因此卡住其他股票）', () => {
  const b = fresh('2026-10-01');
  const broker = b.acct('某證券', '證券');
  const bank = b.acct('銀行', '銀行');
  b.inst({ symbol: '0050', name: '元大台灣50', type: 'ETF' });
  b.add({ type: '調整', date: '2026-09-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000, categoryId: '' });
  b.add({ type: '買入', date: '2026-09-02', settleDate: '2026-09-04', srcAccount: bank, srcSymbol: 'TWD', srcQty: 10000, dstAccount: broker, dstSymbol: '0050', dstQty: 100, amount: 10000, fee: 0, tax: 0 });
  feeds(b, { twse: [{ Date: '1151016', Code: '0050', Name: '元大台灣50', Exdividend: '息', CashDividend: '1' }], fail: { tpex: true } });
  at(b, '2026-10-16', 7);
  const sum = b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  assert.equal(sum.dividends, 0);
  assert.equal(sum.dividendErrors.length, 1);
  const r = b.call('checkDividends').data;
  assert.equal(r.skipped[0].reason, '證券帳戶沒有設定股息入帳帳戶或預設交割帳戶');
  // 補上設定（只填預設交割帳戶）之後隔天就會產生
  assert.ok(b.call('upsertBrokerSettings', { broker: { accountId: broker, market: '台股', feeCurrency: 'TWD', calendar: '台灣', settleAccountId: bank } }).ok);
  at(b, '2026-10-17', 7);
  b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  const t = pendingDivs(b)[0];
  assert.equal(t.dstAccount, bank);
  assert.equal(t.dstQty, 90, '100 股 × 1 元 − 匯費 10');
  // 沒授權外部連線（UrlFetchApp 丟例外）也不會讓排程失敗
  b.state.urlFetch.handler = null;
  at(b, '2026-10-18', 7);
  const s2 = b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  assert.equal(s2.dividends, 0);
});

test('美股股息範本：每季產生待確認、金額留空，確認時填實收（以「來源標的」記是哪檔股票）', () => {
  const b = fresh('2026-09-01');
  const fub = b.acct('元大-複委託', '證券', 'USD');
  const cma = b.acct('元大-CMA', '銀行');
  b.inst({ symbol: 'VOO', name: 'Vanguard S&P 500', type: 'ETF', quote: 'USD', decimals: 4 });
  const bad = b.call('upsertRecurring', { recurring: { name: 'VOO 股息', freq: '每季', days: [31], holiday: '不調整', startDate: '2026-09-30', type: '股息', dstAccount: cma, dstSymbol: 'TWD', mode: '提醒確認' } });
  assert.equal(bad.error.code, 'VALIDATION', '沒選標的');
  const r = b.call('upsertRecurring', { recurring: { name: 'VOO 股息', freq: '每季', days: [31], holiday: '不調整', startDate: '2026-09-30', type: '股息', srcAccount: fub, srcSymbol: 'VOO', dstAccount: cma, dstSymbol: 'TWD', mode: '提醒確認' } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.recurring.srcAccount, '', '股息範本沒有來源帳戶');
  at(b, '2026-09-30', 7);
  b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now);
  const t = pendingDivs(b)[0];
  assert.ok(t);
  assert.equal(t.relatedSymbol, 'VOO');
  assert.equal(t.date, '2026-09-30');
  assert.equal(t.dstQty, null, '金額等入帳再填');
  assert.equal(t.templateName, 'VOO 股息');
  // 日曆：金額未定
  const cf = b.call('getCashflow', { days: 120 }).data;
  const acc = cf.accounts.find((a) => a.accountId === cma);
  assert.equal(acc.items[0].amount, null);
  assert.equal(acc.items.filter((x) => x.kind === '定期').map((x) => x.date)[0], '2026-12-31', '下一季照樣列出');
  const ok = b.call('confirmPending', { id: t.id, trade: { date: '2026-10-02', dstQty: 1234 } });
  assert.ok(ok.ok, JSON.stringify(ok));
  const row = b.call('listTransactions', { filters: { type: '股息' } }).data.items[0];
  assert.deepEqual([row.status, row.dstQty, row.relatedSymbol, row.categoryId !== ''], ['有效', 1234, 'VOO', true]);
});
