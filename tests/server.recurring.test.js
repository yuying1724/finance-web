'use strict';
/**
 * 第 4 批：定期交易（四種執行方式）、待確認、確認／略過／延後、排程、提醒信——端對端測試，透過真正的 API／排程層。
 * 直接對應 claude/verify_recurring.py 與 claude/verify_recurring_modes.py 的情境（R8~R17、M4~M13、M17、M18；
 * 到期日推算與交割天數的純數學部分已在 tests/core.recurring.test.js 驗證過，這裡驗證的是「排程＋帳本＋API」整條路徑）。
 */
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
  const loan = (o) => { const r = b.call('upsertLoanSettings', { loan: o }); assert.ok(r.ok, JSON.stringify(r)); return r.data.loan; };
  const recurring = (o) => b.call('upsertRecurring', { recurring: o });
  const setActive = (id, active) => b.call('setRecurringActive', { id, active });
  const runAt = (day, hour = '09:00:00') => {
    b.mock.state.clock.now = new Date(day + 'T' + hour + '+08:00').getTime();
    b.login();
    const r = b.call('runRecurringScheduler', {});
    assert.ok(r.ok, JSON.stringify(r));
    return r.data;
  };
  const cat = (name, type = '支出') => { const c = boot().categories.find((x) => x.name === name && x.type === type); return c ? c.id : boot().categories.find((x) => x.type === type).id; };
  return Object.assign(b, { acct, boot, add, inst, broker, loan, recurring, setActive, runAt, cat });
}

test('範本驗證：類型與執行方式必須相容；帳戶／標的必須存在；買入的目的標的不能是現金', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const brokerAcct = b.acct('元大證券', '證券');
  assert.equal(b.recurring({ name: '房租', freq: '每月', days: [5], type: '支出', mode: '手動下單', srcAccount: bank, srcSymbol: 'TWD', srcQty: 15000, startDate: '2026-01-01', categoryId: b.cat('房租') }).error.code, 'VALIDATION', '手動下單只能用在買入/賣出');
  assert.equal(b.recurring({ name: '亂填', freq: '每月', days: [5], type: '支出', mode: '自動入帳', srcAccount: 'A999', srcSymbol: 'TWD', srcQty: 100, startDate: '2026-01-01', categoryId: b.cat('房租') }).error.code, 'VALIDATION', '帳戶不存在');
  const inst = b.inst({ symbol: 'VOO', name: 'Vanguard S&P500', type: '美股', quote: 'USD', decimals: 5 });
  void inst;
  assert.equal(b.recurring({ name: '定期定額', freq: '每月', days: [6], type: '買入', mode: '券商定期定額', srcAccount: bank, srcSymbol: 'TWD', dstAccount: brokerAcct, dstSymbol: 'TWD', srcQty: 3000, startDate: '2026-01-01' }).error.code, 'VALIDATION', '買入的目的標的不能是現金');
  const ok = b.recurring({ name: '房租', freq: '每月', days: [5], holiday: '順延', type: '支出', mode: '自動入帳', srcAccount: bank, srcSymbol: 'TWD', srcQty: 15000, startDate: '2026-01-01', categoryId: b.cat('房租') });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.data.recurring.active, true);
});

test('自動入帳：到期直接產生「有效」交易；停用的範本排程不會處理；重複執行不會重複產生（R9/R16 對應）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  b.recurring({ name: '房租', freq: '每月', days: [5], type: '支出', mode: '自動入帳', srcAccount: bank, srcSymbol: 'TWD', srcQty: 15000, startDate: '2026-06-01', categoryId: b.cat('房租') });
  const inactiveId = b.recurring({ name: '停用中', freq: '每月', days: [5], type: '支出', mode: '自動入帳', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1, startDate: '2026-06-01', categoryId: b.cat('房租') }).data.recurring.id;
  b.setActive(inactiveId, false);

  const r1 = b.runAt('2026-06-05');
  assert.equal(r1.created, 1, '只有啟用中的範本會產生');
  let d = b.boot();
  const tx = d.recent.length ? null : null; void tx;
  const list = b.call('listTransactions', { filters: { type: '支出' } }).data.items;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, '有效');
  assert.equal(list[0].date, '2026-06-05');
  assert.equal(list[0].srcQty, 15000);

  // 同一天重複執行排程，不會重複產生
  const r2 = b.runAt('2026-06-05', '18:00:00');
  assert.equal(r2.created, 0);
  assert.equal(b.call('listTransactions', { filters: { type: '支出' } }).data.total, 1);
});

test('漏跑補跑：好幾個月沒執行，一次補齊，且不重複（對應 R11）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  b.recurring({ name: '房租', freq: '每月', days: [5], type: '支出', mode: '自動入帳', srcAccount: bank, srcSymbol: 'TWD', srcQty: 15000, startDate: '2026-06-01', categoryId: b.cat('房租') });
  const r = b.runAt('2026-09-10'); // 6、7、8、9 月的 5 號都補上
  assert.equal(r.created, 4);
  const again = b.runAt('2026-09-11');
  assert.equal(again.created, 0);
});

test('提醒確認：產生待確認、不影響餘額，確認後可用不同金額入帳、確認後才計入餘額（R8/R10/R12/R14 對應）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000 });
  b.recurring({ name: '電話費', freq: '每月', days: [10], type: '支出', mode: '提醒確認', srcAccount: bank, srcSymbol: 'TWD', srcQty: 600, startDate: '2026-06-01', categoryId: b.cat('日用') });
  const r = b.runAt('2026-06-10');
  assert.equal(r.created, 1);
  const pend = b.boot().pendingConfirmations;
  assert.equal(pend.length, 1);
  assert.equal(pend[0].status, '待確認');
  const before = b.boot().balances.find((x) => x.accountId === bank && x.symbol === 'TWD').qty;
  assert.equal(before, 100000, '待確認不影響餘額');

  const c = b.call('confirmPending', { id: pend[0].id, trade: { srcQty: 650 } }); // 實際帳單比預計金額高
  assert.ok(c.ok, JSON.stringify(c));
  assert.equal(c.data.transactions[0].status, '有效');
  assert.equal(c.data.transactions[0].srcQty, 650);
  const after = b.boot().balances.find((x) => x.accountId === bank && x.symbol === 'TWD').qty;
  assert.equal(after, 100000 - 650);
  assert.equal(b.boot().pendingConfirmations.length, 0);
});

test('略過：不入帳、不再是待確認，之後排程再跑也不會重新產生（R15/R16 對應）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  b.recurring({ name: '電話費', freq: '每月', days: [10], type: '支出', mode: '提醒確認', srcAccount: bank, srcSymbol: 'TWD', srcQty: 600, startDate: '2026-06-01', categoryId: b.cat('日用') });
  b.runAt('2026-06-10');
  const pend = b.boot().pendingConfirmations[0];
  const s = b.call('skipPending', { id: pend.id });
  assert.ok(s.ok, JSON.stringify(s));
  assert.equal(b.boot().pendingConfirmations.length, 0);
  assert.equal(b.call('listTransactions', { filters: { status: '已略過' } }).data.total, 1);
  const again = b.runAt('2026-06-10', '18:00:00');
  assert.equal(again.created, 0, '略過後不會重新產生同一（定期ID、預定日）');
});

test('券商定期定額（買入）：交割日＝成交日（0 天），待確認不影響餘額，確認後碎股 5 位小數不失真（對應 R17、M4/M5）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const brokerAcct = b.acct('元大複委託', '證券');
  b.broker({ accountId: brokerAcct, market: '複委託', buySettleDays: 1, sellSettleDays: 2, calendar: '台灣+美國', settleAccountId: bank });
  b.inst({ symbol: 'VOO', name: 'Vanguard S&P500', type: '美股', quote: 'USD', decimals: 5 });
  b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000 });
  b.recurring({ name: 'VOO定期定額', freq: '每月', days: [6], type: '買入', mode: '券商定期定額', srcAccount: bank, srcSymbol: 'TWD', dstAccount: brokerAcct, dstSymbol: 'VOO', srcQty: 3000, startDate: '2026-06-01' });
  const r = b.runAt('2026-06-06'); // 週六 -> 順延（预定日6/6是週六，2026年查證：實際看排程結果即可）
  assert.equal(r.created, 1);
  const pend = b.boot().pendingConfirmations[0];
  assert.equal(pend.mode, '券商定期定額');
  assert.equal(pend.settleDate, pend.date, '交割日＝成交日（0 天）');
  const bal0 = b.boot().balances.find((x) => x.accountId === bank && x.symbol === 'TWD');
  assert.equal(bal0 ? bal0.qty : 0, 100000, '確認前餘額不受影響');

  const c = b.call('confirmPending', { id: pend.id, trade: { date: pend.date, qty: '0.13456', cashQty: '3001', amount: '94.71', fee: '0.03' } });
  assert.ok(c.ok, JSON.stringify(c));
  const t = c.data.transactions[0];
  assert.equal(t.settleDate, t.date, '確認後仍是當天交割，沒有待交割款');
  assert.equal(t.dstQty, 0.13456);
  // 到期日（交割日）本身才是餘額真正變動的那一天
  b.mock.state.clock.now = new Date(t.date + 'T09:00:00+08:00').getTime(); b.login();
  const bal1 = b.boot().balances.find((x) => x.accountId === bank && x.symbol === 'TWD').qty;
  assert.equal(bal1, 100000 - 3001);
  const pending1 = b.boot().pending;
  assert.equal(pending1.length, 0, '券商定期定額當天交割，沒有待交割款');
});

test('手動下單：當天提醒不影響餘額；延後不會多產生一筆；確認時依「實際成交日」重算交割日（對應 M6/M7/M8/M9/M10/M11）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const brokerAcct = b.acct('元大證券', '證券');
  b.broker({ accountId: brokerAcct, market: '台股', buySettleDays: 2, sellSettleDays: 2, calendar: '台灣', settleAccountId: bank });
  b.inst({ symbol: '00631L', name: '元大台灣50正2', type: 'ETF', quote: 'TWD', decimals: 0 });
  b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 500000 });
  b.recurring({ name: '正二不定額', freq: '每月', days: [4], type: '買入', mode: '手動下單', srcAccount: bank, srcSymbol: 'TWD', dstAccount: brokerAcct, dstSymbol: '00631L', srcQty: 20000, startDate: '2026-03-01' });
  const wed = '2026-03-04';
  const r = b.runAt(wed);
  assert.equal(r.created, 1);
  let pend = b.boot().pendingConfirmations[0];
  assert.equal(pend.date, wed);
  const balBefore = b.boot().balances.find((x) => x.accountId === bank && x.symbol === 'TWD').qty;
  assert.equal(balBefore, 500000, '待確認（尚未下單）不影響餘額');

  // 延後到隔天，仍是同一筆待確認
  const pp = b.call('postponePending', { id: pend.id, date: '2026-03-05' });
  assert.ok(pp.ok, JSON.stringify(pp));
  assert.equal(b.boot().pendingConfirmations.length, 1);
  assert.equal(b.boot().pendingConfirmations[0].date, '2026-03-05');

  // 隔天實際下單：100 股、實付 20020
  const c = b.call('confirmPending', { id: pend.id, trade: { date: '2026-03-05', qty: '100', cashQty: '20020', amount: '20000', fee: '20' } });
  assert.ok(c.ok, JSON.stringify(c));
  const t = c.data.transactions[0];
  assert.equal(t.date, '2026-03-05');
  assert.equal(t.settleDate, '2026-03-09', '依實際成交日（週四）+2 個營業日＝週一 3/9，不是提醒日 3/4 起算');

  // 交割前（3/6，成交日之後、交割日 3/9 之前）：銀行餘額不變、股票已入帳、有待交割款
  b.mock.state.clock.now = new Date('2026-03-06T09:00:00+08:00').getTime(); b.login();
  const holdingsMid = b.call('getHoldings', { asOf: '2026-03-06' }).data.positions;
  const pos = holdingsMid.find((p) => p.symbol === '00631L');
  assert.equal(pos.qty, 100, '成交日起就計入持倉');
  const balMid = b.boot().balances.find((x) => x.accountId === bank && x.symbol === 'TWD').qty;
  assert.equal(balMid, 500000, '交割前銀行餘額不變（與銀行 App 一致）');
  const pendingList = b.boot().pending;
  assert.equal(pendingList.length, 1);
  assert.equal(pendingList[0].qty, -20020, '待交割款只來自手動下單這筆');
});

test('貸款還款範本：自動入帳直接產生同群組的轉帳(本金)+支出(利息)；提醒確認則產生待確認、群組一次確認（對應貸款還款流程）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const loanAcct = b.acct('房貸', '貸款');
  b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 500000 });
  b.add({ type: '轉帳', date: '2026-01-15', srcAccount: loanAcct, srcSymbol: 'TWD', srcQty: 120000, dstAccount: bank, dstSymbol: 'TWD', dstQty: 120000 });
  b.loan({ accountId: loanAcct, principal: 120000, rate: 12, terms: 12, startDate: '2026-01-15', payDay: 15, method: '本息平均攤還', payAccountId: bank });
  b.recurring({ name: '房貸月付', freq: '每月', days: [15], type: '貸款還款', mode: '提醒確認', srcAccount: bank, dstAccount: loanAcct, startDate: '2026-02-01' });
  const r = b.runAt('2026-02-15');
  assert.equal(r.created, 2, '本金+利息兩筆');
  const pend = b.boot().pendingConfirmations;
  assert.equal(pend.length, 2);
  assert.equal(pend[0].groupId, pend[1].groupId);
  const c = b.call('confirmPending', { id: pend[0].id }); // 沒有 trade：群組一次確認，金額已由攤還表算好
  assert.ok(c.ok, JSON.stringify(c));
  assert.equal(c.data.transactions.length, 2);
  assert.ok(c.data.transactions.every((t) => t.status === '有效'));
  assert.equal(b.boot().pendingConfirmations.length, 0);
});

test('確認買入待確認時沒有帶實際成交結果會被擋下（避免產生金額是空的交易）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const brokerAcct = b.acct('元大證券', '證券');
  b.broker({ accountId: brokerAcct, market: '台股', buySettleDays: 2, sellSettleDays: 2, calendar: '台灣', settleAccountId: bank });
  b.inst({ symbol: '00631L', name: '元大台灣50正2', type: 'ETF', quote: 'TWD', decimals: 0 });
  b.recurring({ name: '正二不定額', freq: '每月', days: [4], type: '買入', mode: '手動下單', srcAccount: bank, srcSymbol: 'TWD', dstAccount: brokerAcct, dstSymbol: '00631L', srcQty: 20000, startDate: '2026-03-01' });
  b.runAt('2026-03-04');
  const pend = b.boot().pendingConfirmations[0];
  const r = b.call('confirmPending', { id: pend.id });
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(b.boot().pendingConfirmations.length, 1, '沒有成功確認，仍然是待確認');
});

test('資金備妥提醒信：券商定期定額到期日前一個營業日會寄信；手動下單當天會寄「今天該買」的信', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const brokerAcct = b.acct('元大複委託', '證券');
  b.broker({ accountId: brokerAcct, market: '複委託', buySettleDays: 1, sellSettleDays: 2, calendar: '台灣+美國', settleAccountId: bank });
  b.inst({ symbol: 'VOO', name: 'Vanguard S&P500', type: '美股', quote: 'USD', decimals: 5 });
  b.recurring({ name: 'VOO定期定額', freq: '每月', days: [10], type: '買入', mode: '券商定期定額', srcAccount: bank, srcSymbol: 'TWD', dstAccount: brokerAcct, dstSymbol: 'VOO', srcQty: 3000, startDate: '2026-06-01', remindDays: 1 });
  b.mock.state.mail.length = 0;
  const r = b.runAt('2026-06-09'); // 6/10 前一個營業日（週三）
  void r;
  const fundingMail = b.mock.state.mail.filter((m) => m.subject.indexOf('資金備妥') >= 0);
  assert.ok(fundingMail.length >= 1, '應該寄出資金備妥提醒信');

  const brokerAcct2 = b.acct('元大證券', '證券');
  b.broker({ accountId: brokerAcct2, market: '台股', buySettleDays: 2, sellSettleDays: 2, calendar: '台灣', settleAccountId: bank });
  b.inst({ symbol: '00631L', name: '元大台灣50正2', type: 'ETF', quote: 'TWD', decimals: 0 });
  b.recurring({ name: '正二不定額', freq: '每月', days: [11], type: '買入', mode: '手動下單', srcAccount: bank, srcSymbol: 'TWD', dstAccount: brokerAcct2, dstSymbol: '00631L', srcQty: 20000, startDate: '2026-06-01' });
  b.mock.state.mail.length = 0;
  b.runAt('2026-06-11');
  const todayMail = b.mock.state.mail.filter((m) => m.subject.indexOf('今天該買') >= 0);
  assert.ok(todayMail.length >= 1, '手動下單當天應該寄提醒信');
});

test('待確認放太久會寄提醒信', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  b.recurring({ name: '電話費', freq: '每月', days: [10], type: '支出', mode: '提醒確認', srcAccount: bank, srcSymbol: 'TWD', srcQty: 600, startDate: '2026-06-01', categoryId: b.cat('日用') });
  b.runAt('2026-06-10');
  b.mock.state.mail.length = 0;
  b.runAt('2026-06-14'); // 放了 4 天
  const staleMail = b.mock.state.mail.filter((m) => m.subject.indexOf('放了好幾天') >= 0);
  assert.ok(staleMail.length >= 1);
});

test('建議金額出現在手動下單模式的待確認清單裡（有部位時用平均成本當基準）', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const brokerAcct = b.acct('元大證券', '證券');
  b.broker({ accountId: brokerAcct, market: '台股', buySettleDays: 2, sellSettleDays: 2, calendar: '台灣', settleAccountId: bank });
  b.inst({ symbol: '00631L', name: '元大台灣50正2', type: 'ETF', quote: 'TWD', decimals: 0 });
  b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 500000 });
  // 先建立一個部位：均價 100
  b.add({ type: '買入', date: '2026-02-01', settleDate: '2026-02-03', srcAccount: bank, srcSymbol: 'TWD', srcQty: 10000, dstAccount: brokerAcct, dstSymbol: '00631L', dstQty: 100, amount: 10000, fee: 0, tax: 0 });
  b.recurring({ name: '正二不定額', freq: '每月', days: [4], type: '買入', mode: '手動下單', srcAccount: bank, srcSymbol: 'TWD', dstAccount: brokerAcct, dstSymbol: '00631L', srcQty: 20000, startDate: '2026-03-01' });
  b.runAt('2026-03-04');
  // 手動把現價設低於基準 5% 以上（94），驗證建議金額出現且方向正確
  const priceSheet = b.ss.sheet('價格');
  const dump = priceSheet.dump();
  const rowIdx = dump.findIndex((row) => row[0] === '00631L');
  assert.ok(rowIdx >= 0, '找不到 00631L 的價格列');
  priceSheet.poke(rowIdx + 1, 2, 94);
  const pend = b.boot().pendingConfirmations[0];
  assert.ok(pend.suggested, JSON.stringify(pend));
  assert.equal(pend.suggested.amount, 24000);
});
