'use strict';
/** 定期「每N天」：固定每 N 天（例如 App 每 31 天扣款）與「從實際付款日起算」（例如捷運月票晚幾天才買） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');
const FinRecurring = require('../core/recurring.js');

function at(b, day, hour = 7) { b.mock.state.clock.now = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime(); if (b.token) b.login(); }
function run(b, day) { at(b, day); return b.ctx.FinRecurringJob.runDaily(b.mock.state.clock.now); }

function fresh(day) {
  const b = loadBackend().setup();
  at(b, day, 9);
  const acct = (name, type) => { const r = b.call('upsertAccount', { account: { name, type, defaultSymbol: 'TWD', institution: name } }); assert.ok(r.ok, JSON.stringify(r)); return r.data.account.id; };
  const cat = (n) => b.call('bootstrap').data.categories.find((c) => c.name === n && c.type === '支出').id;
  const txOf = (rid) => b.call('listTransactions', { filters: { includeVoid: true }, limit: 200 }).data.items.filter((t) => t.recurringId === rid).sort((x, y) => (x.plannedDate < y.plannedDate ? -1 : 1));
  return Object.assign(b, { acct, cat, txOf });
}

test('core：每N天的到期日不管大小月；從實際日期起算依最近一筆的狀態決定下一次', () => {
  const occ = FinRecurring.occurrences({ freq: '每N天', days: [31], holiday: '不調整', startDate: '2026-11-08' }, '2026-10-31', '2027-03-31', ['台灣'], {});
  assert.deepEqual(occ.map((o) => o.planned), ['2026-11-08', '2026-12-09', '2027-01-09', '2027-02-09', '2027-03-12']);
  // 區間從中間開始也算得對（不會從起始日重算錯位）
  const mid = FinRecurring.occurrences({ freq: '每N天', days: [31], holiday: '不調整', startDate: '2026-11-08' }, '2027-01-01', '2027-02-28', ['台灣'], {});
  assert.deepEqual(mid.map((o) => o.planned), ['2027-01-09', '2027-02-09']);
  const tpl = { id: 'R1', freq: '每N天', days: '30', anchor: '實際日期', startDate: '2026-10-12' };
  assert.deepEqual(FinRecurring.actualAnchoredNext(tpl, []), { planned: '2026-10-12' });
  const pend = { recurringId: 'R1', plannedDate: '2026-10-12', date: '2026-10-14', status: '待確認', createdAt: '2026-10-12 07:00:00' };
  assert.ok(FinRecurring.actualAnchoredNext(tpl, [pend]).pending);
  assert.deepEqual(FinRecurring.actualAnchoredNext(tpl, [Object.assign({}, pend, { status: '有效', date: '2026-10-16' })]), { planned: '2026-11-15' });
  assert.deepEqual(FinRecurring.actualAnchoredNext(tpl, [Object.assign({}, pend, { status: '已略過', updatedAt: '2026-10-20 08:00:00' })]), { planned: '2026-11-19' });
  assert.deepEqual(FinRecurring.actualAnchoredNext(tpl, [Object.assign({}, pend, { status: '作廢' })]), { planned: '2026-10-12' }, '作廢的不算');
});

test('每 31 天自動入帳：11/8 → 12/9 → 1/9，大小月都對', () => {
  const b = fresh('2026-11-01');
  const card = b.acct('富邦-J卡', '信用卡');
  const r = b.call('upsertRecurring', { recurring: { name: '艾蜜莉APP', freq: '每N天', days: [31], holiday: '不調整', startDate: '2026-11-08', type: '支出', srcAccount: card, srcSymbol: 'TWD', srcQty: 199, categoryId: b.cat('其他支出'), mode: '自動入帳' } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.recurring.anchor, '固定');
  assert.equal(b.call('upsertRecurring', { recurring: { name: 'x', freq: '每N天', days: [31, 1], holiday: '不調整', startDate: '2026-11-08', type: '支出', srcAccount: card, srcSymbol: 'TWD', srcQty: 1, categoryId: b.cat('其他支出'), mode: '自動入帳' } }).error.code, 'VALIDATION', '每N天只能填一個數字');
  const rid = r.data.recurring.id;
  run(b, '2026-11-08');
  run(b, '2027-01-10');
  assert.deepEqual(b.txOf(rid).map((t) => [t.date, t.status, t.srcQty]), [['2026-11-08', '有效', 199], ['2026-12-09', '有效', 199], ['2027-01-09', '有效', 199]]);
  // 首頁「即將到來」：下一次 2/9
  const up = b.call('bootstrap').data.upcoming.items.filter((x) => x.recurringId === rid);
  assert.deepEqual(up.map((x) => x.date), ['2027-02-09']);
});

test('從實際付款日起算（捷運月票）：到期產生待確認、可延後；確認填實際日期後下一次從那天算 30 天；略過就從略過那天算', () => {
  const b = fresh('2026-10-10');
  const bank = b.acct('富邦-綜存', '銀行');
  const bad = b.call('upsertRecurring', { recurring: { name: '捷運月票', freq: '每N天', days: [30], holiday: '不調整', startDate: '2026-10-12', type: '支出', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1200, categoryId: b.cat('大眾運輸'), mode: '自動入帳', anchor: '實際日期' } });
  assert.equal(bad.error.code, 'VALIDATION', '從實際日期起算一定要提醒確認');
  const r = b.call('upsertRecurring', { recurring: { name: '捷運月票', freq: '每N天', days: [30], holiday: '不調整', startDate: '2026-10-12', type: '支出', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1200, categoryId: b.cat('大眾運輸'), mode: '提醒確認', anchor: '實際日期' } });
  assert.ok(r.ok, JSON.stringify(r));
  const rid = r.data.recurring.id;
  run(b, '2026-10-12');
  let list = b.txOf(rid);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, '待確認');
  // 待確認清單帶出起算方式，延後到 10/14
  const p = b.call('bootstrap').data.pendingConfirmations.find((t) => t.recurringId === rid);
  assert.equal(p.anchor, '實際日期');
  assert.equal(p.intervalDays, 30);
  assert.ok(b.call('postponePending', { id: p.id, date: '2026-10-14' }).ok);
  // 還沒確認前，排程不會再多產生；放了 3 天以上也不寄「待確認放太久」（從延後後的日期算）
  b.state.mail.length = 0;
  run(b, '2026-10-15');
  assert.equal(b.txOf(rid).length, 1);
  assert.ok(!b.state.mail.find((m) => /待確認放了好幾天/.test(m.subject)));
  // 10/16 才買：確認時填 10/16 → 下一次 11/15
  assert.ok(b.call('confirmPending', { id: p.id, trade: { date: '2026-10-16', srcQty: 1200 } }).ok);
  const cf = b.call('getCashflow', { days: 90 }).data.items.filter((x) => x.recurringId === rid);
  assert.deepEqual(cf.map((x) => [x.date, x.amount, x.estimated]), [['2026-11-15', 1200, true], ['2026-12-15', 1200, true]], '扣款日曆從實際日期往後每 30 天預估');
  run(b, '2026-11-14');
  assert.equal(b.txOf(rid).length, 1);
  run(b, '2026-11-15');
  list = b.txOf(rid);
  assert.deepEqual(list.map((t) => [t.plannedDate, t.status]), [['2026-10-12', '有效'], ['2026-11-15', '待確認']]);
  // 這次不買：11/20 按略過 → 下一次 12/20
  at(b, '2026-11-20', 9);
  assert.ok(b.call('skipPending', { id: list[1].id }).ok);
  run(b, '2026-12-19');
  assert.equal(b.txOf(rid).length, 2);
  run(b, '2026-12-20');
  list = b.txOf(rid);
  assert.deepEqual(list.map((t) => [t.plannedDate, t.status]), [['2026-10-12', '有效'], ['2026-11-15', '已略過'], ['2026-12-20', '待確認']]);
  // 一般的提醒確認也可以延後（例如保險費晚幾天才扣）；不能延到今天以前
  const r2 = b.call('upsertRecurring', { recurring: { name: '電話費', freq: '每月', days: [20], holiday: '不調整', startDate: '2026-12-20', type: '支出', srcAccount: bank, srcSymbol: 'TWD', srcQty: 500, categoryId: b.cat('大眾運輸'), mode: '提醒確認' } });
  assert.ok(r2.ok);
  run(b, '2026-12-20');
  const p2 = b.txOf(r2.data.recurring.id)[0];
  assert.equal(b.call('postponePending', { id: p2.id, date: '2026-12-01' }).error.code, 'VALIDATION');
  assert.ok(b.call('postponePending', { id: p2.id, date: '2026-12-25' }).ok);
  assert.equal(b.txOf(r2.data.recurring.id)[0].date, '2026-12-25');
  // 延後後從新的日期算「待確認放太久」：12/27 還不寄、12/28 才寄
  b.state.mail.length = 0;
  run(b, '2026-12-27');
  assert.ok(!b.state.mail.find((m) => /待確認放了好幾天/.test(m.subject) && /電話費/.test(m.body || m.htmlBody || '')));
  b.state.mail.length = 0;
  run(b, '2026-12-28');
  assert.ok(b.state.mail.find((m) => /待確認放了好幾天/.test(m.subject)));
});

test('確認待確認的支出時可以換付款帳戶（幣別要一樣、不能選貸款）', () => {
  const b = fresh('2026-10-10');
  const card = b.acct('富邦-J卡', '信用卡');
  const other = b.acct('永豐卡', '信用卡');
  const loan = b.acct('信貸', '貸款');
  const r = b.call('upsertRecurring', { recurring: { name: '捷運月票', freq: '每N天', days: [30], holiday: '不調整', startDate: '2026-10-16', type: '支出', srcAccount: card, srcSymbol: 'TWD', srcQty: 399, categoryId: b.cat('大眾運輸'), mode: '提醒確認', anchor: '實際日期' } });
  assert.ok(r.ok, JSON.stringify(r));
  run(b, '2026-10-16');
  const p = b.txOf(r.data.recurring.id)[0];
  assert.equal(b.call('confirmPending', { id: p.id, trade: { date: '2026-10-17', srcQty: 399, srcAccount: loan } }).error.code, 'VALIDATION');
  assert.ok(b.call('confirmPending', { id: p.id, trade: { date: '2026-10-17', srcQty: 399, srcAccount: other } }).ok);
  const t = b.txOf(r.data.recurring.id)[0];
  assert.deepEqual([t.status, t.date, t.srcAccount, t.srcQty], ['有效', '2026-10-17', other, 399]);
});
