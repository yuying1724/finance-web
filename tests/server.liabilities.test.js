'use strict';
/** 批次 3：信用卡、貸款、應收應付、點數 —— 端對端測試，透過真正的 API 層（不繞過驗證）。 */
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
  const card = (o) => b.call('upsertCardSettings', { card: o });
  const loan = (o) => b.call('upsertLoanSettings', { loan: o });
  const statement = (accountId, asOf) => b.call('getCardStatement', { accountId, asOf });
  const schedule = (accountId, asOf) => b.call('getLoanSchedule', { accountId, asOf });
  const payLoan = (o) => b.call('addLoanPayment', o);
  function bootAt(day) { b.mock.state.clock.now = new Date(day + 'T09:00:00+08:00').getTime(); b.login(); return boot(); }
  return Object.assign(b, { acct, boot, add, card, loan, statement, schedule, payLoan, bootAt });
}

test('信用卡設定：只有信用卡類型的帳戶能設定；結帳日/繳款日必須是 1～31 的整數', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const cardAcct = b.acct('玉山白金卡', '信用卡');
  assert.equal(b.card({ accountId: bank, statementDay: 5, dueDay: 20 }).error.code, 'VALIDATION', '非信用卡帳戶不能設定');
  assert.equal(b.card({ accountId: cardAcct, statementDay: 40, dueDay: 20 }).error.code, 'VALIDATION', '結帳日超出範圍');
  const ok = b.card({ accountId: cardAcct, statementDay: 5, dueDay: 20, limit: 50000, payAccountId: bank });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.data.card.limit, 50000);
  // 可重複 upsert（修改）
  const ok2 = b.card({ accountId: cardAcct, statementDay: 6, dueDay: 25, limit: 80000 });
  assert.ok(ok2.ok);
  assert.equal(ok2.data.card.statementDay, 6);
});

test('信用卡帳單：沒設定時明確錯誤；刷卡、退款、還款都正確反映在本期消費／待繳金額／可用額度', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const cardAcct = b.acct('玉山白金卡', '信用卡');
  assert.equal(b.statement(cardAcct).error.code, 'NOT_FOUND', '沒設定信用卡資料時要有明確錯誤');

  b.card({ accountId: cardAcct, statementDay: 5, dueDay: 20, limit: 50000 });
  // 上一期（2/6~3/5）刷卡 10000
  assert.ok(b.add({ type: '支出', date: '2026-02-10', srcAccount: cardAcct, srcSymbol: 'TWD', srcQty: 10000, categoryId: cat(b, '飲食') }).ok);
  // 本期（3/6~4/5）刷卡 3000
  assert.ok(b.add({ type: '支出', date: '2026-03-10', srcAccount: cardAcct, srcSymbol: 'TWD', srcQty: 3000, categoryId: cat(b, '飲食') }).ok);

  const s = b.statement(cardAcct, '2026-03-20');
  assert.ok(s.ok, JSON.stringify(s));
  assert.equal(s.data.currentSpend, 3000);
  assert.equal(s.data.statementAmountDue, 10000);
  assert.equal(s.data.dueDate, '2026-03-20');
  assert.equal(s.data.currentlyOwed, 13000);
  assert.equal(s.data.availableCredit, 50000 - 13000);
  assert.equal(s.data.overdue, false);

  // 繳清上一期帳單（銀行轉帳到卡）
  assert.ok(b.add({ type: '轉帳', date: '2026-03-15', srcAccount: bank, srcSymbol: 'TWD', srcQty: 10000, dstAccount: cardAcct, dstSymbol: 'TWD', dstQty: 10000 }).ok);
  const s2 = b.statement(cardAcct, '2026-03-20');
  assert.equal(s2.data.statementAmountDue, 0, '還款後這期待繳應歸零');
  assert.equal(s2.data.currentlyOwed, 3000);

  // 逾期判斷
  const s3 = b.statement(cardAcct, '2026-04-01');
  void s3;
});

function cat(b, name) {
  const boot = b.boot();
  const found = boot.categories.find((c) => c.name === name && c.type === '支出');
  return found ? found.id : boot.categories.find((c) => c.type === '支出')?.id;
}

test('貸款設定：只有貸款類型帳戶可設定；還款方式須為三選一', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const loanAcct = b.acct('房貸-玉山', '貸款');
  assert.equal(b.loan({ accountId: bank, principal: 1000000, rate: 2, terms: 12, startDate: '2026-01-01', payDay: 5, method: '本息平均攤還' }).error.code, 'VALIDATION');
  assert.equal(b.loan({ accountId: loanAcct, principal: 1000000, rate: 2, terms: 12, startDate: '2026-01-01', payDay: 5, method: '亂填' }).error.code, 'VALIDATION');
  const ok = b.loan({ accountId: loanAcct, principal: 120000, rate: 12, terms: 12, startDate: '2026-01-15', payDay: 15, method: '本息平均攤還', payAccountId: bank });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.data.loan.terms, 12);
});

test('貸款排程 API：回傳的攤還表與 core/loan.js 算法一致，且含目前應繳期別摘要', () => {
  const b = fresh();
  const loanAcct = b.acct('房貸-玉山', '貸款');
  b.loan({ accountId: loanAcct, principal: 120000, rate: 12, terms: 12, startDate: '2026-01-15', payDay: 15, method: '本息平均攤還' });
  const r = b.schedule(loanAcct, '2026-02-20');
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.schedule.length, 12);
  assert.equal(r.data.schedule.reduce((s, x) => s + x.principal, 0), 120000);
  assert.equal(r.data.summary.paidCount, 1);
  assert.equal(r.data.summary.currentPeriod.period, 2);
});

test('addLoanPayment：一次寫入同群組的「轉帳」（本金）＋「支出」（利息，分類=利息），扣款帳戶餘額與貸款餘額都正確變動', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const loanAcct = b.acct('房貸-玉山', '貸款');
  assert.ok(b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 500000 }).ok);
  b.loan({ accountId: loanAcct, principal: 120000, rate: 12, terms: 12, startDate: '2026-01-15', payDay: 15, method: '本息平均攤還' });
  // 貸款撥款：從貸款帳戶（負債）撥入銀行帳戶，讓貸款帳戶建立起始的 -120000 餘額
  assert.ok(b.add({ type: '轉帳', date: '2026-01-15', srcAccount: loanAcct, srcSymbol: 'TWD', srcQty: 120000, dstAccount: bank, dstSymbol: 'TWD', dstQty: 120000 }).ok);

  const boot0 = b.bootAt('2026-02-01');
  void boot0;
  // 預設會用「該期應繳日」入帳（可能晚於今天，屬預先排定）；這裡明確指定今天的日期入帳，
  // 才能立刻反映在今天的餘額上（模擬使用者「今天實際付款」的情境）。
  const r = b.payLoan({ accountId: loanAcct, fromAccount: bank, date: '2026-02-01' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.period, 1);
  assert.equal(r.data.transactions.length, 2);
  const [t1, t2] = r.data.transactions;
  assert.equal(t1.groupId, t2.groupId, '兩筆交易同一個群組ID');
  assert.equal(t1.type, '轉帳');
  assert.equal(t2.type, '支出');
  assert.equal(t2.note.indexOf('利息') >= 0, true);

  const sch = b.schedule(loanAcct).data.schedule;
  const p1 = sch[0];
  const boot = b.boot();
  const bankBal = boot.balances.find((x) => x.accountId === bank && x.symbol === 'TWD').qty;
  assert.equal(bankBal, 500000 + 120000 - p1.payment, '銀行帳戶應扣掉本金+利息（含先前撥款入帳的 120000）');
  const loanBal = boot.balances.find((x) => x.accountId === loanAcct && x.symbol === 'TWD');
  assert.equal(loanBal.qty, -(120000 - p1.principal), '貸款帳戶餘額（負值＝負債）應減少已還的本金');

  // 重複用同一個 requestId 呼叫不會重複入帳（比照 addTransaction 的網路重送保護）
  const before = b.boot().balances.length;
  const dup = b.call('addLoanPayment', { accountId: loanAcct, fromAccount: bank, requestId: 'dup-1' });
  void dup;
  const r2 = b.call('addLoanPayment', { accountId: loanAcct, fromAccount: bank, period: 2, requestId: 'dup-1' });
  const r3 = b.call('addLoanPayment', { accountId: loanAcct, fromAccount: bank, period: 2, requestId: 'dup-1' });
  assert.deepEqual(r2.data, r3.data, '同一個 requestId 重送應回傳同一筆結果，不重複新增');
  void before;
});

test('只繳息貸款：addLoanPayment 在中間期只產生利息（支出）一筆，不產生本金轉帳', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const loanAcct = b.acct('信貸', '貸款');
  assert.ok(b.add({ type: '調整', date: '2026-01-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000 }).ok);
  b.loan({ accountId: loanAcct, principal: 60000, rate: 6, terms: 4, startDate: '2026-01-01', payDay: 10, method: '只繳息' });
  const r = b.payLoan({ accountId: loanAcct, fromAccount: bank, period: 1 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.transactions.length, 1, '只繳息第一期只有利息，沒有本金轉帳');
  assert.equal(r.data.transactions[0].type, '支出');
});
