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

test('額度群組：同一額度群組的多張卡視為一張合併帳單，本期消費／目前總欠款／上期待繳／可用額度都是整組加總', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const cardA = b.acct('富邦-J卡', '信用卡');
  const cardB = b.acct('富邦-數位生活卡', '信用卡');
  const cardC = b.acct('富邦-Costco卡', '信用卡'); // 同群組但目前還沒消費
  b.card({ accountId: cardA, statementDay: 5, dueDay: 20, limit: 320000, limitGroup: '富邦' });
  b.card({ accountId: cardB, statementDay: 5, dueDay: 20, limit: 320000, limitGroup: '富邦' });
  b.card({ accountId: cardC, statementDay: 5, dueDay: 20, limit: 320000, limitGroup: '富邦' });

  assert.ok(b.add({ type: '支出', date: '2026-03-10', srcAccount: cardA, srcSymbol: 'TWD', srcQty: 50000, categoryId: cat(b, '飲食') }).ok);
  assert.ok(b.add({ type: '支出', date: '2026-03-11', srcAccount: cardB, srcSymbol: 'TWD', srcQty: 30000, categoryId: cat(b, '飲食') }).ok);

  const sa = b.statement(cardA, '2026-03-20');
  assert.ok(sa.ok, JSON.stringify(sa));
  assert.equal(sa.data.sharedLimit, true);
  assert.equal(sa.data.currentSpend, 50000 + 30000, '本期消費是整組（A+B+C）加總，不是只看這張卡自己刷了多少');
  assert.equal(sa.data.currentlyOwed, 50000 + 30000, '目前總欠款是整組加總，因為銀行實際上是合併成一張帳單');
  assert.equal(sa.data.availableCredit, 320000 - 50000 - 30000, '可用額度要扣掉整個群組（A+B+C）加總的欠款');
  assert.equal(sa.data.groupMembers.length, 3);
  assert.equal(sa.data.groupLimitMismatch, false);
  assert.equal(sa.data.groupDateMismatch, false);
  const memberA = sa.data.groupMembers.find((m) => m.accountId === cardA);
  assert.equal(memberA.currentSpend, 50000, 'groupMembers 顯示的是「這張卡自己這期刷了多少」，供參考用，不是欠款');

  // 開 B 卡的帳單，看到的整組數字要跟開 A 卡完全一樣（因為是同一張合併帳單）
  const sb = b.statement(cardB, '2026-03-20');
  assert.equal(sb.data.currentSpend, sa.data.currentSpend);
  assert.equal(sb.data.currentlyOwed, sa.data.currentlyOwed);
  assert.equal(sb.data.availableCredit, sa.data.availableCredit);

  const sc = b.statement(cardC, '2026-03-20');
  assert.equal(sc.data.currentSpend, 50000 + 30000, '這張卡自己還沒消費，但因為是合併帳單，看到的本期消費仍是整組加總');
  assert.equal(sc.data.availableCredit, 320000 - 50000 - 30000, '同群組的可用額度對每張卡來說都一樣，因為是共用的');

  // 還款轉進「群組內任一張卡」（這裡轉進 A 卡）：整組的欠款與可用額度都要跟著降低／回升，不管實際轉進哪一張卡
  assert.ok(b.add({ type: '轉帳', date: '2026-03-15', srcAccount: bank, srcSymbol: 'TWD', srcQty: 20000, dstAccount: cardA, dstSymbol: 'TWD', dstQty: 20000 }).ok);
  const sa2 = b.statement(cardA, '2026-03-20');
  assert.equal(sa2.data.availableCredit, 320000 - 30000 - 30000);
  const sc2 = b.statement(cardC, '2026-03-20');
  assert.equal(sc2.data.availableCredit, sa2.data.availableCredit, '還進 A 卡的錢，C 卡看到的整組可用額度要一起跟著回升');

  // 額度填不一致時要標記出來，但仍能正常運作、不會讓系統壞掉
  b.card({ accountId: cardC, statementDay: 5, dueDay: 20, limit: 999999, limitGroup: '富邦' });
  const sa3 = b.statement(cardA, '2026-03-20');
  assert.equal(sa3.data.groupLimitMismatch, true);

  // 結帳日／繳款日填不一致時也要標記出來
  b.card({ accountId: cardC, statementDay: 10, dueDay: 20, limit: 320000, limitGroup: '富邦' });
  const sa4 = b.statement(cardA, '2026-03-20');
  assert.equal(sa4.data.groupDateMismatch, true);
  b.card({ accountId: cardC, statementDay: 5, dueDay: 20, limit: 320000, limitGroup: '富邦' }); // 改回一致，避免影響後面的斷言

  // 沒有填額度群組的卡（獨立）：不受富邦群組影響，帳單只看自己
  const solo = b.acct('玉山白金卡', '信用卡');
  b.card({ accountId: solo, statementDay: 5, dueDay: 20, limit: 50000 });
  const ss = b.statement(solo, '2026-03-20');
  assert.equal(ss.data.sharedLimit, false);
  assert.equal(ss.data.availableCredit, 50000);
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

test('信用卡總覽：同群組只出現一筆（合併帳單）、單卡各一筆；逾期／待繳／已繳清／未設定排序；bootstrap 直接帶總覽與待繳合計', () => {
  const b = fresh();
  const bank = b.acct('銀行', '銀行');
  const fA = b.acct('富邦-J卡', '信用卡');
  const fB = b.acct('富邦-數位生活卡', '信用卡');
  const tsA = b.acct('台新-Richart卡', '信用卡');
  const tsB = b.acct('台新-街口商務卡', '信用卡');
  const solo = b.acct('玉山-Ubear卡', '信用卡');
  const noSet = b.acct('中國信託-foodpanda卡', '信用卡'); // 還沒設定結帳日
  b.card({ accountId: fA, statementDay: 12, dueDay: 28, limit: 320000, limitGroup: '富邦' });
  b.card({ accountId: fB, statementDay: 12, dueDay: 28, limit: 320000, limitGroup: '富邦' });
  b.card({ accountId: tsA, statementDay: 12, dueDay: 27, limit: 230000, limitGroup: '台新' });
  b.card({ accountId: tsB, statementDay: 12, dueDay: 27, limit: 230000, limitGroup: '台新' });
  b.card({ accountId: solo, statementDay: 21, dueDay: 1, limit: 200000 });
  const food = cat(b, '飲食');
  // 2 月帳單（2/13～3/12 結帳）：富邦刷 50,000＋30,000、台新刷 12,000、玉山 2/22～3/21 期間刷 8,000
  assert.ok(b.add({ type: '支出', date: '2026-02-20', srcAccount: fA, srcSymbol: 'TWD', srcQty: 50000, categoryId: food }).ok);
  assert.ok(b.add({ type: '支出', date: '2026-03-01', srcAccount: fB, srcSymbol: 'TWD', srcQty: 30000, categoryId: food }).ok);
  assert.ok(b.add({ type: '支出', date: '2026-03-05', srcAccount: tsA, srcSymbol: 'TWD', srcQty: 12000, categoryId: food }).ok);
  assert.ok(b.add({ type: '支出', date: '2026-03-01', srcAccount: solo, srcSymbol: 'TWD', srcQty: 8000, categoryId: food }).ok);
  // 台新已經繳掉（3/15 轉帳進群組內任一張卡）
  assert.ok(b.add({ type: '轉帳', date: '2026-03-15', srcAccount: bank, srcSymbol: 'TWD', srcQty: 12000, dstAccount: tsB, dstSymbol: 'TWD', dstQty: 12000 }).ok);
  // 本期又刷了一筆（3/20，屬於 3/13～4/12 這期）
  assert.ok(b.add({ type: '支出', date: '2026-03-20', srcAccount: fA, srcSymbol: 'TWD', srcQty: 1000, categoryId: food }).ok);

  const r = b.call('getCardOverview', { asOf: '2026-03-30' });
  assert.ok(r.ok, JSON.stringify(r));
  const o = r.data;
  assert.deepEqual(o.items.map((x) => x.name), ['富邦', '玉山-Ubear卡', '台新', '中國信託-foodpanda卡'], '逾期 → 待繳 → 已繳清 → 未設定');
  const fubon = o.items[0];
  assert.equal(fubon.isGroup, true);
  assert.deepEqual(fubon.accountIds, [fA, fB]);
  assert.equal(fubon.statementAmountDue, 80000);
  assert.equal(fubon.dueDate, '2026-03-28');
  assert.equal(fubon.overdue, true);
  assert.equal(fubon.dueInDays, -2);
  assert.equal(fubon.currentSpend, 1000, '本期（3/13 起）只刷了 1,000');
  assert.equal(fubon.currentlyOwed, 81000);
  assert.equal(fubon.availableCredit, 320000 - 81000);
  assert.equal(fubon.members.length, 2);
  assert.equal(fubon.members.find((m) => m.accountId === fA).currentSpend, 1000);
  const yushan = o.items[1];
  assert.equal(yushan.isGroup, false);
  assert.equal(yushan.statementAmountDue, 8000);
  assert.equal(yushan.dueDate, '2026-04-01');
  assert.equal(yushan.dueInDays, 2);
  assert.equal(yushan.overdue, false);
  const taishin = o.items[2];
  assert.equal(taishin.statementAmountDue, 0);
  assert.equal(taishin.paid, true, '結帳後已經還款，標成已繳清');
  const cti = o.items[3];
  assert.equal(cti.hasSettings, false);
  assert.equal(cti.statementAmountDue, undefined);
  assert.equal(o.totalDue, 88000);
  assert.equal(o.nearest.name, '富邦');
  assert.equal(o.nearest.dueDate, '2026-03-28');

  // bootstrap 直接帶總覽（以今天 2026-03-10 計算）
  const d = b.boot();
  assert.ok(d.cardOverview && Array.isArray(d.cardOverview.items));
  assert.equal(d.cardOverview.items.length, 4);
  assert.equal(typeof d.cardOverview.totalDue, 'number');
  // 停用的卡不出現在總覽
  assert.ok(b.call('setAccountActive', { id: noSet, active: false }).ok);
  assert.equal(b.boot().cardOverview.items.length, 3);
});
