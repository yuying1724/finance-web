'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const FinCreditCard = require('../core/creditcard.js');

function tx(fields) {
  return Object.assign({
    date: '', type: '', srcAccount: '', srcSymbol: '', srcQty: null, dstAccount: '', dstSymbol: '', dstQty: null, status: '有效',
  }, fields);
}

test('periodContaining：結帳日 5 號，refDate 在結帳日之前／當天／之後分屬不同區間', () => {
  const before = FinCreditCard.periodContaining(5, '2026-03-04');
  assert.deepEqual(before, { start: '2026-02-06', end: '2026-03-05' });
  const onDay = FinCreditCard.periodContaining(5, '2026-03-05');
  assert.deepEqual(onDay, { start: '2026-02-06', end: '2026-03-05' });
  const after = FinCreditCard.periodContaining(5, '2026-03-06');
  assert.deepEqual(after, { start: '2026-03-06', end: '2026-04-05' });
});

test('periodContaining：結帳日設 31 號，遇小月（2 月）自動取月底，區間邊界仍正確銜接不重疊不漏掉', () => {
  const jan = FinCreditCard.periodContaining(31, '2026-02-01'); // 1/31 結帳後、2/28 結帳前
  assert.deepEqual(jan, { start: '2026-02-01', end: '2026-02-28' });
  const feb = FinCreditCard.periodContaining(31, '2026-03-01'); // 2/28 結帳後、3/31 結帳前
  assert.deepEqual(feb, { start: '2026-03-01', end: '2026-03-31' });
});

test('dueDateFor：繳款日晚於結帳日時同月，早於或等於結帳日時順延到下個月', () => {
  assert.equal(FinCreditCard.dueDateFor(25, '2026-03-05'), '2026-03-25'); // 25 > 5，同月
  assert.equal(FinCreditCard.dueDateFor(3, '2026-03-05'), '2026-04-03'); // 3 <= 5，順延到下個月
  assert.equal(FinCreditCard.dueDateFor(5, '2026-03-05'), '2026-04-05'); // 等於結帳日，視為已過，順延
});

test('periodSpend：只計入該卡為來源的支出，扣掉退回這張卡的退款；不含還款轉帳', () => {
  const txs = [
    tx({ date: '2026-03-01', type: '支出', srcAccount: 'CARD', srcSymbol: 'TWD', srcQty: 1000 }),
    tx({ date: '2026-03-10', type: '支出', srcAccount: 'CARD', srcSymbol: 'TWD', srcQty: 500 }),
    tx({ date: '2026-03-12', type: '退款', dstAccount: 'CARD', dstSymbol: 'TWD', dstQty: 200 }),
    tx({ date: '2026-03-15', type: '轉帳', srcAccount: 'BANK', srcSymbol: 'TWD', srcQty: 300, dstAccount: 'CARD', dstSymbol: 'TWD', dstQty: 300 }), // 還款，不算消費
    tx({ date: '2026-02-20', type: '支出', srcAccount: 'CARD', srcSymbol: 'TWD', srcQty: 9999 }), // 區間外
  ];
  const period = { start: '2026-03-01', end: '2026-03-31' };
  const spend = FinCreditCard.periodSpend(txs, 'CARD', 'TWD', 0, period);
  assert.equal(spend, 1000 + 500 - 200);
});

test('summary：本期消費、上期待繳金額與繳款日、目前總欠款（含還款後降低）、逾期判斷、可用額度', () => {
  const cardSettings = { statementDay: 5, dueDay: 20, limit: 50000 };
  const txs = [
    // 上一期（2/6~3/5）：刷 10000
    tx({ date: '2026-02-10', type: '支出', srcAccount: 'CARD', srcSymbol: 'TWD', srcQty: 10000 }),
    // 本期（3/6~4/5）：刷 3000，目前是 3/20
    tx({ date: '2026-03-10', type: '支出', srcAccount: 'CARD', srcSymbol: 'TWD', srcQty: 3000 }),
  ];
  const s = FinCreditCard.summary(txs, 'CARD', 'TWD', 0, cardSettings, '2026-03-20');
  assert.deepEqual(s.currentPeriod, { start: '2026-03-06', end: '2026-04-05' });
  assert.equal(s.currentSpend, 3000);
  assert.deepEqual(s.lastClosedPeriod, { start: '2026-02-06', end: '2026-03-05' });
  assert.equal(s.statementAmountDue, 10000, '上一期結帳金額 = 10000，繳款日前應顯示這筆待繳金額');
  assert.equal(s.dueDate, '2026-03-20');
  assert.equal(s.currentlyOwed, 10000 + 3000, '目前總欠款含本期已刷但未結帳的消費');
  assert.equal(s.overdue, false, '3/20 還沒到繳款日 3/20');
  assert.equal(s.availableCredit, 50000 - 13000);

  // 繳款日過了還沒繳：逾期
  const s2 = FinCreditCard.summary(txs, 'CARD', 'TWD', 0, cardSettings, '2026-03-26');
  assert.equal(s2.overdue, true);

  // 繳清上一期帳單後：statementAmountDue 對應的餘額因為還款而降低，currentlyOwed 也跟著降低
  const paid = txs.concat([tx({ date: '2026-03-15', type: '轉帳', srcAccount: 'BANK', srcSymbol: 'TWD', srcQty: 10000, dstAccount: 'CARD', dstSymbol: 'TWD', dstQty: 10000 })]);
  const s3 = FinCreditCard.summary(paid, 'CARD', 'TWD', 0, cardSettings, '2026-03-20');
  assert.equal(s3.statementAmountDue, 0, '結帳日之後才還款，重算到結帳日當天的餘額已含這筆還款，視為這期已繳清');
  assert.equal(s3.currentlyOwed, 3000);
  assert.equal(s3.overdue, false);
});

test('沒有設定額度（limit=0）：availableCredit 回傳 null，不誤報成 0 元可用', () => {
  const cardSettings = { statementDay: 1, dueDay: 15, limit: 0 };
  const s = FinCreditCard.summary([], 'CARD', 'TWD', 0, cardSettings, '2026-03-20');
  assert.equal(s.availableCredit, null);
  assert.equal(s.limit, null);
});

test('summary：傳入 groupAccountIds（同額度群組多張卡）時，本期消費／欠款／待繳／可用額度都是整組加總（比照台灣信用卡「合併帳單」的實務）', () => {
  const cardSettings = { statementDay: 5, dueDay: 20, limit: 100000 };
  const txs = [
    tx({ date: '2026-03-10', type: '支出', srcAccount: 'CARD_A', srcSymbol: 'TWD', srcQty: 3000 }),
    tx({ date: '2026-03-12', type: '支出', srcAccount: 'CARD_B', srcSymbol: 'TWD', srcQty: 5000 }),
  ];
  // 沒有 groupAccountIds（或陣列只有自己 1 個）：只看這張卡自己的交易
  const solo = FinCreditCard.summary(txs, 'CARD_A', 'TWD', 0, cardSettings, '2026-03-20');
  assert.equal(solo.currentSpend, 3000);
  assert.equal(solo.currentlyOwed, 3000);
  assert.equal(solo.availableCredit, 97000);
  assert.equal(solo.sharedLimit, false);

  // 傳入同群組兩張卡的 id：本期消費、欠款、可用額度都變成兩張卡加總
  const shared = FinCreditCard.summary(txs, 'CARD_A', 'TWD', 0, cardSettings, '2026-03-20', ['CARD_A', 'CARD_B']);
  assert.equal(shared.currentSpend, 3000 + 5000, '本期消費是整組加總，不是只看 CARD_A 自己');
  assert.equal(shared.currentlyOwed, 3000 + 5000, '目前總欠款是整組加總');
  assert.equal(shared.availableCredit, 100000 - 8000, '可用額度要扣掉整組加總的欠款');
  assert.equal(shared.sharedLimit, true);
  assert.equal(shared.groupSize, 2);

  // 還款轉進「群組內任一張卡」（不一定是查詢的這張），一樣算整組已經繳掉這期帳單
  const paid = txs.concat([tx({ date: '2026-03-25', type: '轉帳', srcAccount: 'BANK', srcSymbol: 'TWD', srcQty: 4000, dstAccount: 'CARD_B', dstSymbol: 'TWD', dstQty: 4000 })]);
  const sharedAfterPay = FinCreditCard.summary(paid, 'CARD_A', 'TWD', 0, cardSettings, '2026-03-26', ['CARD_A', 'CARD_B']);
  assert.equal(sharedAfterPay.currentlyOwed, 3000 + 5000 - 4000, '還進 CARD_B 的錢一樣要反映在整組的目前總欠款');
});

test('summary：group 內欠款加總超過總額度時，可用額度夾在 0，不會變負數', () => {
  const cardSettings = { statementDay: 5, dueDay: 20, limit: 50000 };
  const txs = [
    tx({ date: '2026-03-10', type: '支出', srcAccount: 'CARD_A', srcSymbol: 'TWD', srcQty: 30000 }),
    tx({ date: '2026-03-11', type: '支出', srcAccount: 'CARD_B', srcSymbol: 'TWD', srcQty: 40000 }),
  ];
  const s = FinCreditCard.summary(txs, 'CARD_A', 'TWD', 0, cardSettings, '2026-03-20', ['CARD_A', 'CARD_B']);
  assert.equal(s.availableCredit, 0);
});

// ---------- 分期（零利率） ----------
test('expandInstallment：3 萬分 6 期、第 1 期落在刷卡當期、之後每個結帳日一期；零頭放首期／末期', () => {
  const buy = tx({ id: 'T1', date: '2026-03-10', type: '支出', srcAccount: 'C1', srcSymbol: 'TWD', srcQty: 30001 });
  const s = FinCreditCard.expandInstallment({ id: 'I1', txId: 'T1', terms: 6, remainderOn: '首期' }, buy, 12, 0);
  assert.deepEqual(s.periods.map((p) => p.amount), [5001, 5000, 5000, 5000, 5000, 5000]);
  assert.deepEqual(s.periods.map((p) => p.closeDate), ['2026-03-12', '2026-04-12', '2026-05-12', '2026-06-12', '2026-07-12', '2026-08-12']);
  const s2 = FinCreditCard.expandInstallment({ id: 'I1', txId: 'T1', terms: 6, remainderOn: '末期' }, buy, 12, 0);
  assert.deepEqual(s2.periods.map((p) => p.amount), [5000, 5000, 5000, 5000, 5000, 5001]);
  // 結帳日當天刷：算當期；結帳日隔天刷：算下期
  const onClose = FinCreditCard.expandInstallment({ terms: 3 }, tx({ id: 'T2', date: '2026-03-12', type: '支出', srcAccount: 'C1', srcSymbol: 'TWD', srcQty: 3000 }), 12, 0);
  assert.equal(onClose.periods[0].closeDate, '2026-03-12');
  const afterClose = FinCreditCard.expandInstallment({ terms: 3 }, tx({ id: 'T3', date: '2026-03-13', type: '支出', srcAccount: 'C1', srcSymbol: 'TWD', srcQty: 3000 }), 12, 0);
  assert.equal(afterClose.periods[0].closeDate, '2026-04-12');
  // 結帳日 31 號遇到小月：夾到月底
  const eom = FinCreditCard.expandInstallment({ terms: 2 }, tx({ id: 'T4', date: '2026-01-31', type: '支出', srcAccount: 'C1', srcSymbol: 'TWD', srcQty: 2000 }), 31, 0);
  assert.deepEqual(eom.periods.map((p) => p.closeDate), ['2026-01-31', '2026-02-28']);
  // 提前清償：清償日所在週期之後的各期全部改到那一期
  const po = FinCreditCard.expandInstallment({ terms: 6, payoffDate: '2026-04-20' }, buy, 12, 0);
  assert.deepEqual(po.periods.map((p) => p.closeDate), ['2026-03-12', '2026-04-12', '2026-05-12', '2026-05-12', '2026-05-12', '2026-05-12']);
  // 作廢／不是支出：不成立
  assert.equal(FinCreditCard.expandInstallment({ terms: 6 }, Object.assign({}, buy, { status: '作廢' }), 12, 0), null);
});

test('summary 含分期：待繳只算已輪到的各期、本期消費只算當期一份、可用額度扣全額', () => {
  const cs = { statementDay: 12, dueDay: 28, limit: 100000 };
  const txs = [
    tx({ id: 'T1', date: '2026-02-20', type: '支出', srcAccount: 'C1', srcSymbol: 'TWD', srcQty: 30000 }), // 分 6 期：3/12 起每期 5,000
    tx({ id: 'T2', date: '2026-03-01', type: '支出', srcAccount: 'C1', srcSymbol: 'TWD', srcQty: 2000 }),  // 一般消費
    tx({ id: 'T3', date: '2026-03-20', type: '支出', srcAccount: 'C1', srcSymbol: 'TWD', srcQty: 800 }),   // 本期一般消費
  ];
  const sched = [FinCreditCard.expandInstallment({ id: 'I1', txId: 'T1', terms: 6 }, txs[0], 12, 0)];
  const s = FinCreditCard.summary(txs, 'C1', 'TWD', 0, cs, '2026-03-25', null, sched);
  assert.equal(s.statementAmountDue, 5000 + 2000, '3/12 這期帳單：分期第 1 期 5,000 ＋ 一般消費 2,000');
  assert.equal(s.currentSpend, 5000 + 800, '本期（3/13～4/12）：分期第 2 期 5,000 ＋ 一般 800');
  assert.equal(s.currentlyOwed, 30000 + 2000 + 800, '目前總欠款含分期全額');
  assert.equal(s.availableCredit, 100000 - 32800, '可用額度扣全額（跟銀行一致）');
  assert.equal(s.installmentRemaining, 20000, '之後各期（第 3～6 期）還沒出帳');
  assert.equal(s.installmentCount, 1);
  // 沒傳分期（舊呼叫方式）：行為不變，全額算進帳單
  const old = FinCreditCard.summary(txs, 'C1', 'TWD', 0, cs, '2026-03-25');
  assert.equal(old.statementAmountDue, 32000);
  // 繳了這期 7,000 之後待繳歸零，但欠款仍含未出帳分期
  const paid = txs.concat([tx({ id: 'T4', date: '2026-03-26', type: '轉帳', srcAccount: 'B1', srcSymbol: 'TWD', srcQty: 7000, dstAccount: 'C1', dstSymbol: 'TWD', dstQty: 7000 })]);
  const s2 = FinCreditCard.summary(paid, 'C1', 'TWD', 0, cs, '2026-03-27', null, sched);
  assert.equal(s2.statementAmountDue, 0);
  assert.equal(s2.currentlyOwed, 25800);
  // 下一期（4/12 結帳後）：待繳＝第 2 期 5,000 ＋ 800
  const s3 = FinCreditCard.summary(paid, 'C1', 'TWD', 0, cs, '2026-04-15', null, sched);
  assert.equal(s3.statementAmountDue, 5800);
  assert.equal(s3.installmentRemaining, 15000, '第 4～6 期');
});
