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
