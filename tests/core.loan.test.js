'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const FinLoan = require('../core/loan.js');

test('本息平均攤還：各期本金加總等於貸款金額，最後一期餘額為 0', () => {
  const settings = { principal: 120000, rate: 12, terms: 12, startDate: '2026-01-15', payDay: 15, method: '本息平均攤還' };
  const sched = FinLoan.schedule(settings, 0);
  assert.equal(sched.length, 12);
  const sumPrincipal = sched.reduce((s, r) => s + r.principal, 0);
  assert.equal(sumPrincipal, 120000);
  assert.equal(sched[11].balance, 0);
  // 每期還款金額應該大致相同（本息平均攤還特徵），只有最後一期可能因為捨入微調
  const payments = new Set(sched.slice(0, 11).map((r) => r.payment));
  assert.ok(payments.size <= 2, '前 11 期還款金額應幾乎固定：' + JSON.stringify(sched.map((r) => r.payment)));
  // 隨著期數增加，利息遞減、本金遞增（等額本息的特徵）
  for (let i = 1; i < sched.length; i++) {
    assert.ok(sched[i].interest <= sched[i - 1].interest, `第 ${i + 1} 期利息應不高於前一期`);
    assert.ok(sched[i].principal >= sched[i - 1].principal, `第 ${i + 1} 期本金應不低於前一期`);
  }
  // 還款日：起貸日 2026-01-15，第 1 期 = 2026-02-15
  assert.equal(sched[0].date, '2026-02-15');
  assert.equal(sched[1].date, '2026-03-15');
});

test('本金平均攤還：每期本金固定，最後一期吸收除不盡的尾差；利息逐期遞減', () => {
  // 100000 / 3 期 = 33333.33...，每期本金取整數（TWD 0 位小數），最後一期補尾差
  const settings = { principal: 100000, rate: 6, terms: 3, startDate: '2026-01-01', payDay: 1, method: '本金平均攤還' };
  const sched = FinLoan.schedule(settings, 0);
  assert.equal(sched[0].principal, 33333);
  assert.equal(sched[1].principal, 33333);
  assert.equal(sched[2].principal, 100000 - 33333 - 33333); // 33334，吸收尾差
  assert.equal(sched.reduce((s, r) => s + r.principal, 0), 100000);
  assert.equal(sched[2].balance, 0);
  // 利息逐期遞減（本金餘額遞減）
  assert.ok(sched[0].interest > sched[1].interest);
  assert.ok(sched[1].interest > sched[2].interest);
  // 第 1 期利息 = 100000 * (6%/12) = 500
  assert.equal(sched[0].interest, 500);
});

test('只繳息：中間各期只還利息、本金為 0，最後一期一次還清全部本金；利息每期相同（餘額不變）', () => {
  const settings = { principal: 60000, rate: 6, terms: 4, startDate: '2026-01-01', payDay: 10, method: '只繳息' };
  const sched = FinLoan.schedule(settings, 0);
  for (let i = 0; i < 3; i++) {
    assert.equal(sched[i].principal, 0);
    assert.equal(sched[i].interest, 300); // 60000 * 0.5% = 300，餘額不變所以每期利息相同
    assert.equal(sched[i].balance, 60000);
  }
  assert.equal(sched[3].principal, 60000);
  assert.equal(sched[3].interest, 300);
  assert.equal(sched[3].balance, 0);
  assert.equal(sched[3].payment, 60300);
});

test('零利率：本息平均攤還等於本金平均攤還（每期還款=本金=principal/n），完全不影響本金總和', () => {
  const settings = { principal: 90000, rate: 0, terms: 9, startDate: '2026-01-01', payDay: 5, method: '本息平均攤還' };
  const sched = FinLoan.schedule(settings, 0);
  sched.forEach((r) => assert.equal(r.interest, 0));
  assert.equal(sched.reduce((s, r) => s + r.principal, 0), 90000);
  assert.equal(sched[0].payment, 10000);
});

test('還款日：payDay 超過當月天數時取月底（例如 2 月）；跨年正確', () => {
  const settings = { principal: 12000, rate: 0, terms: 14, startDate: '2025-12-31', payDay: 31, method: '本金平均攤還' };
  const sched = FinLoan.schedule(settings, 0);
  // 起貸日 2025-12-31，第 1 期 = 2026-01（+1 個月）31 號
  assert.equal(sched[0].date, '2026-01-31');
  // 第 2 期 = 2026-02，31 號超出天數，取月底 28 號（2026 非閏年）
  assert.equal(sched[1].date, '2026-02-28');
  assert.equal(sched[2].date, '2026-03-31');
});

test('閏年 2 月：payDay=29 只有閏年才有 29 號，非閏年取 28 號', () => {
  const settings = { principal: 5000, rate: 0, terms: 24, startDate: '2027-12-01', payDay: 29, method: '本金平均攤還' };
  const sched = FinLoan.schedule(settings, 0);
  // 第 1 期 = 2028-01（2028 是閏年，但 1 月不受影響）29 號存在
  assert.equal(sched[0].date, '2028-01-29');
  // 第 2 期 = 2028-02，2028 是閏年，2/29 存在
  assert.equal(sched[1].date, '2028-02-29');
  // 第 14 期 = 2029-02（非閏年），29 號不存在，取 28 號
  assert.equal(sched[13].date, '2029-02-28');
});

test('findPeriod / summarize：依日期找出目前應繳期別、已繳期數、剩餘本金；繳清後回傳 null', () => {
  const settings = { principal: 36000, rate: 0, terms: 3, startDate: '2026-01-01', payDay: 1, method: '本金平均攤還' };
  const sched = FinLoan.schedule(settings, 0);
  assert.deepEqual(sched.map((r) => r.date), ['2026-02-01', '2026-03-01', '2026-04-01']);

  const s1 = FinLoan.summarize(sched, '2026-01-15');
  assert.equal(s1.paidCount, 0);
  assert.equal(s1.currentPeriod.period, 1);
  assert.equal(s1.remainingBalance, 36000);
  assert.equal(s1.settled, false);

  const s2 = FinLoan.summarize(sched, '2026-02-15');
  assert.equal(s2.paidCount, 1);
  assert.equal(s2.currentPeriod.period, 2);
  assert.equal(s2.remainingBalance, 24000);

  const s3 = FinLoan.summarize(sched, '2026-05-01');
  assert.equal(s3.paidCount, 3);
  assert.equal(s3.settled, true);
  assert.equal(s3.currentPeriod, null);
  assert.equal(s3.remainingBalance, 0);
});

test('USD 貸款（2 位小數）：本息平均攤還一樣不出現浮點誤差，本金總和精確等於本金', () => {
  const settings = { principal: 10000, rate: 5, terms: 24, startDate: '2026-01-01', payDay: 1, method: '本息平均攤還' };
  const sched = FinLoan.schedule(settings, 2);
  const sum = sched.reduce((s, r) => s + r.principal, 0);
  assert.ok(Math.abs(sum - 10000) < 1e-9, 'sum=' + sum);
  assert.equal(sched[23].balance, 0);
});
