'use strict';
/** 信用卡對帳模式：某一期的明細（合併帳單含同群組各卡、分期只算當期）、勾選與銀行金額存起來、移到下期 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

test('信用卡對帳：列出上期明細與合計、勾選與銀行金額會存、差額；移到下期後兩期都正確', () => {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-15T09:00:00+08:00').getTime(); b.login();
  const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const acct = (name, type) => ok(b.call('upsertAccount', { account: { name, type, defaultSymbol: 'TWD', institution: name } })).account.id;
  const bank = acct('銀行', '銀行'), A = acct('富邦-J卡', '信用卡'), B = acct('富邦-Costco卡', '信用卡'), C = acct('玉山卡', '信用卡');
  for (const id of [A, B]) ok(b.call('upsertCardSettings', { card: { accountId: id, statementDay: 12, dueDay: 28, limit: 100000, limitGroup: '富邦' } }));
  ok(b.call('upsertCardSettings', { card: { accountId: C, statementDay: 12, dueDay: 28, limit: 100000 } }));
  const food = b.call('bootstrap').data.categories.find((c) => c.name === '午餐' && c.type === '支出').id;
  const add = (tx) => ok(b.call('addTransaction', { tx })).tx.id;
  const spend = (acc, date, amt, extra = {}) => add(Object.assign({ type: '支出', date, srcAccount: acc, srcSymbol: 'TWD', srcQty: amt, categoryId: food }, extra));
  add({ type: '調整', date: '2026-08-01', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100000 });
  const t1 = spend(A, '2026-09-20', 1000, { merchant: 'Costco' });
  spend(B, '2026-10-05', 500);
  add({ type: '退款', date: '2026-10-01', dstAccount: A, dstSymbol: 'TWD', dstQty: 200, categoryId: food });
  const near = spend(A, '2026-10-12', 300, { merchant: '全家' });
  spend(A, '2026-10-13', 999);
  spend(C, '2026-09-25', 700);
  add({ type: '轉帳', date: '2026-10-02', srcAccount: bank, srcSymbol: 'TWD', srcQty: 800, dstAccount: A, dstSymbol: 'TWD', dstQty: 800 });
  const inst = ok(b.call('addInstallment', { tx: { type: '支出', date: '2026-08-20', srcAccount: A, srcSymbol: 'TWD', srcQty: 1200, categoryId: food, merchant: 'Apple' }, terms: 3, remainderOn: '首期', requestId: 'i1' })).installment;

  // 預設看上一期（9/13～10/12，已結帳）；從群組裡任一張卡打開都一樣
  const r = ok(b.call('getCardRecon', { accountId: B }));
  assert.deepEqual(r.period, { start: '2026-09-13', end: '2026-10-12' });
  assert.equal(r.isGroup, true); assert.equal(r.name, '富邦'); assert.equal(r.dueDate, '2026-10-28');
  assert.equal(r.current, false);
  assert.deepEqual(r.lines.map((l) => [l.label, l.amount, l.kind]), [
    ['Costco', 1000, 'spend'], ['午餐', -200, 'refund'], ['午餐', 500, 'spend'], ['Apple', 400, 'installment'], ['全家', 300, 'spend'],
  ]);
  assert.equal(r.lines.find((l) => l.kind === 'installment').key, inst.id + '#2');
  assert.equal(r.total, 2000);
  assert.deepEqual(r.payments.map((x) => x.amount), [800], '繳款另外列，不算消費');
  assert.equal(r.bankAmount, null); assert.equal(r.diff, null);
  assert.equal(r.periods[0].current, true); assert.equal(r.periods[1].end, '2026-10-12');

  // 勾兩筆、填銀行金額
  let s = ok(b.call('setCardRecon', { accountId: A, closeDate: '2026-10-12', check: [t1, inst.id + '#2'] }));
  assert.equal(s.checkedCount, 2); assert.equal(s.checkedTotal, 1400);
  s = ok(b.call('setCardRecon', { accountId: A, closeDate: '2026-10-12', bankAmount: 1700 }));
  assert.equal(s.bankAmount, 1700); assert.equal(s.diff, -300);
  // 重新讀還在；單卡 C 不受影響
  assert.equal(ok(b.call('getCardRecon', { accountId: A, closeDate: '2026-10-01' })).checkedCount, 2, '給期間內任一天也行');
  assert.equal(ok(b.call('getCardRecon', { accountId: C })).total, 700);
  assert.equal(ok(b.call('getCardRecon', { accountId: C })).bankAmount, null);

  // 銀行把 10/12 全家那筆列到下期 → 移到下期
  const nearLine = r.lines.find((l) => l.txId === near);
  assert.equal(nearLine.movable, true);
  b.mock.state.clock.now += 60000;
  const mv = ok(b.call('moveCardTx', { txId: near, settleDate: '2026-10-13', expectedUpdatedAt: nearLine.updatedAt }));
  assert.equal(mv.settleDate, '2026-10-13');
  s = ok(b.call('getCardRecon', { accountId: A }));
  assert.equal(s.total, 1700); assert.equal(s.diff, 0, '對上了');
  const next = ok(b.call('getCardRecon', { accountId: A, closeDate: '2026-11-12' }));
  assert.equal(next.current, true);
  assert.deepEqual(next.lines.map((l) => l.amount).sort((x, y) => x - y), [300, 400, 999]);
  assert.equal(next.total, 999 + 300 + 400, '下期：999、移過來的 300、分期第 3 期 400');
  // 舊的 updatedAt 再改一次會被擋
  assert.equal(b.call('moveCardTx', { txId: near, settleDate: '', expectedUpdatedAt: nearLine.updatedAt }).error.code, 'CONFLICT');
  assert.equal(b.call('moveCardTx', { txId: near, settleDate: '2026-10-01', expectedUpdatedAt: mv.updatedAt }).error.code, 'VALIDATION', '不能早於消費日');
  // 取消勾選；作廢的交易會從紀錄清掉
  s = ok(b.call('setCardRecon', { accountId: A, closeDate: '2026-10-12', uncheck: [inst.id + '#2'] }));
  assert.equal(s.checkedCount, 1);
  const row = b.call('listTransactions', { filters: { accountId: A } }).data.items.find((t) => t.id === t1);
  ok(b.call('voidTransaction', { id: t1, expectedUpdatedAt: row.updatedAt }));
  ok(b.call('setCardRecon', { accountId: A, closeDate: '2026-10-12', check: [] }));
  const saved = JSON.parse(b.call('bootstrap').data ? b.ctx.FinRepo.getSettings().cardRecon : '{}');
  assert.ok(!saved.c[t1], '作廢的交易不再留在勾選紀錄');
  // 不是信用卡
  assert.equal(b.call('getCardRecon', { accountId: bank }).error.code, 'NOT_FOUND');
});
