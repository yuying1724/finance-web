'use strict';
/** 拆帳：一次刷卡拆成多個分類（同群組的多筆支出）；總額要對；整組作廢／還原 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

test('拆帳：拆成多筆同群組支出，金額加總要等於總額；帳戶餘額扣總額；分類各自計入；整組作廢與還原', () => {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-10T18:00:00+08:00').getTime(); b.login();
  const card = b.call('upsertAccount', { account: { name: '好市多卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
  const cats = b.call('bootstrap').data.categories;
  const cat = (n) => cats.find((c) => c.name === n && c.type === '支出').id;
  const base = { type: '支出', date: '2026-10-10', srcAccount: card, srcSymbol: 'TWD', srcQty: 3500, categoryId: cat('生鮮雜貨'), merchant: '好市多', note: '週末採買' };
  // 加總不對
  let r = b.call('addTransaction', { tx: base, splits: [{ categoryId: cat('生鮮雜貨'), amount: 2300 }, { categoryId: cat('日用品'), amount: 1000 }] });
  assert.equal(r.error.code, 'VALIDATION'); assert.match(r.error.message, /要等於總額/);
  // 只有一行
  assert.equal(b.call('addTransaction', { tx: base, splits: [{ categoryId: cat('生鮮雜貨'), amount: 3500 }] }).error.code, 'VALIDATION');
  // 某行缺分類
  r = b.call('addTransaction', { tx: base, splits: [{ categoryId: '', amount: 2300 }, { categoryId: cat('日用品'), amount: 1200 }] });
  assert.equal(r.error.code, 'VALIDATION'); assert.match(r.error.message, /第 1 行/);
  // 正確
  r = b.call('addTransaction', { tx: base, splits: [{ categoryId: cat('生鮮雜貨'), amount: 2300 }, { categoryId: cat('日用品'), amount: 1200, note: '衛生紙' }], requestId: 'split-1' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.split.length, 2);
  const [a, c2] = r.data.split;
  assert.equal(a.groupId, a.id); assert.equal(c2.groupId, a.id);
  assert.deepEqual([a.merchant, c2.merchant, a.note, c2.note], ['好市多', '好市多', '週末採買', '衛生紙']);
  // 重送不重複
  assert.equal(b.call('addTransaction', { tx: base, splits: [{ categoryId: cat('生鮮雜貨'), amount: 2300 }, { categoryId: cat('日用品'), amount: 1200 }], requestId: 'split-1' }).data.split[0].id, a.id);
  const boot = b.call('bootstrap').data;
  assert.equal(boot.balances.find((x) => x.accountId === card).qty, -3500);
  assert.equal(boot.month.expense, 3500);
  const m = b.call('getMonthlyExpenses', { months: 1 }).data.months[0];
  assert.deepEqual(Object.fromEntries(m.byCategory.map((x) => [x.categoryId, x.amount])), { [cat('生鮮雜貨')]: 2300, [cat('日用品')]: 1200 });
  // 整組作廢
  r = b.call('voidTransaction', { id: a.id, wholeGroup: true, expectedUpdatedAt: a.updatedAt });
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.data.txs.length, 2);
  assert.equal((b.call('bootstrap').data.balances.find((x) => x.accountId === card) || { qty: 0 }).qty, 0);
  const c2v = r.data.txs.find((x) => x.id === c2.id);
  r = b.call('restoreTransaction', { id: c2.id, wholeGroup: true, expectedUpdatedAt: c2v.updatedAt });
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.data.txs.length, 2);
  // 單筆作廢（不帶 wholeGroup）只動一筆
  r = b.call('voidTransaction', { id: c2.id, expectedUpdatedAt: r.data.txs.find((x) => x.id === c2.id).updatedAt });
  assert.ok(r.ok); assert.equal(r.data.txs, undefined);
  assert.equal(b.call('bootstrap').data.balances.find((x) => x.accountId === card).qty, -2300);
  // 收入不能拆帳
  const bank = b.call('upsertAccount', { account: { name: '銀行', type: '銀行', defaultSymbol: 'TWD' } }).data.account.id;
  const inc = cats.find((x) => x.name === '薪資' && x.type === '收入' && x.parentId).id;
  assert.equal(b.call('addTransaction', { tx: { type: '收入', date: '2026-10-10', dstAccount: bank, dstSymbol: 'TWD', dstQty: 100, categoryId: inc }, splits: [{ categoryId: inc, amount: 50 }, { categoryId: inc, amount: 50 }] }).error.code, 'VALIDATION');
});

test('拆帳＋代墊：自己的算支出、幫別人付的轉到應收帳戶（沒有就自動建「代墊款」）；卡片帳單算全額；對方還錢從應收轉出', () => {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-10T18:00:00+08:00').getTime(); b.login();
  const card = b.call('upsertAccount', { account: { name: 'J卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
  assert.ok(b.call('upsertCardSettings', { card: { accountId: card, statementDay: 25, dueDay: 10, limit: 100000 } }).ok);
  const linePay = b.call('upsertAccount', { account: { name: 'LINE Pay', type: '數位錢包', defaultSymbol: 'TWD' } }).data.account.id;
  const cats = b.call('bootstrap').data.categories;
  const drink = cats.find((c) => c.name === '飲料點心' && c.type === '支出').id;
  const base = { type: '支出', date: '2026-10-10', srcAccount: card, srcSymbol: 'TWD', srcQty: 400, categoryId: drink, merchant: 'foodpanda' };
  // 全部都是代墊 → 請改記轉帳
  let r = b.call('addTransaction', { tx: base, splits: [{ kind: '代墊', amount: 200, dstAccount: '__new__' }, { kind: '代墊', amount: 200, dstAccount: '__new__' }] });
  assert.equal(r.error.code, 'VALIDATION'); assert.match(r.error.message, /轉帳/);
  // 代墊選到不是應收的帳戶
  r = b.call('addTransaction', { tx: base, splits: [{ categoryId: drink, amount: 80 }, { kind: '代墊', amount: 320, dstAccount: linePay }] });
  assert.equal(r.error.code, 'VALIDATION'); assert.match(r.error.message, /應收/);
  // 加總錯的時候不會先建帳戶
  r = b.call('addTransaction', { tx: base, splits: [{ categoryId: drink, amount: 80 }, { kind: '代墊', amount: 300, dstAccount: '__new__' }] });
  assert.equal(r.error.code, 'VALIDATION');
  assert.ok(!b.call('bootstrap').data.accounts.find((a) => a.name === '代墊款'), '驗證失敗不建帳戶');
  // 正確
  r = b.call('addTransaction', { tx: base, splits: [{ categoryId: drink, amount: 80 }, { kind: '代墊', amount: 320, dstAccount: '__new__', note: '小王 80、小李 120、阿明 120' }] });
  assert.ok(r.ok, JSON.stringify(r));
  const adv = r.data.createdAccount;
  assert.equal(adv.name, '代墊款'); assert.equal(adv.type, '應收');
  const [own, lent] = r.data.split;
  assert.deepEqual([own.type, own.srcQty, own.categoryId], ['支出', 80, drink]);
  assert.deepEqual([lent.type, lent.srcAccount, lent.dstAccount, lent.dstQty, lent.categoryId, lent.note, lent.merchant], ['轉帳', card, adv.id, 320, '', '小王 80、小李 120、阿明 120', 'foodpanda']);
  assert.equal(lent.groupId, own.id);
  let boot = b.call('bootstrap').data;
  assert.equal(boot.balances.find((x) => x.accountId === card).qty, -400, '卡片欠 400');
  assert.equal(boot.balances.find((x) => x.accountId === adv.id).qty, 320, '同事欠 320');
  assert.equal(boot.month.expense, 80, '支出只算自己的 80');
  const st = b.call('getCardStatement', { accountId: card }).data;
  assert.equal(st.currentSpend, 400, '帳單本期消費算全額');
  // 第二次代墊：沿用同一個帳戶，不再新建
  r = b.call('addTransaction', { tx: Object.assign({}, base, { srcQty: 150 }), splits: [{ categoryId: drink, amount: 50 }, { kind: '代墊', amount: 100, dstAccount: '__new__' }] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.createdAccount, null);
  assert.equal(r.data.split[1].dstAccount, adv.id);
  assert.equal(b.call('bootstrap').data.accounts.filter((a) => a.name === '代墊款').length, 1);
  let rf;
  // 自己取名的代墊帳戶（朋友）：另外建一個；名稱跟其他類型的帳戶重複會擋
  rf = b.call('addTransaction', { tx: Object.assign({}, base, { srcQty: 300 }), splits: [{ categoryId: drink, amount: 100 }, { kind: '代墊', amount: 200, dstAccount: '__new__', newAccountName: 'LINE Pay' }] });
  assert.equal(rf.error.code, 'VALIDATION'); assert.match(rf.error.message, /換個名稱/);
  rf = b.call('addTransaction', { tx: Object.assign({}, base, { srcQty: 300, date: '2026-10-09' }), splits: [{ categoryId: drink, amount: 100 }, { kind: '代墊', amount: 200, dstAccount: '__new__', newAccountName: '代墊-朋友' }] });
  assert.ok(rf.ok, JSON.stringify(rf));
  assert.equal(rf.data.createdAccount.name, '代墊-朋友');
  const friend = rf.data.createdAccount.id;
  assert.equal(b.call('bootstrap').data.balances.find((x) => x.accountId === friend).qty, 200);
  assert.equal(b.call('addTransaction', { tx: Object.assign({}, base, { srcQty: 300 }), splits: [{ categoryId: drink, amount: 100 }, { kind: '代墊', amount: 100, dstAccount: '__new__', newAccountName: 'A' }, { kind: '代墊', amount: 100, dstAccount: '__new__', newAccountName: 'B' }] }).error.code, 'VALIDATION', '一次只能新建一個');
  b.call('voidTransaction', { id: rf.data.split[0].id, wholeGroup: true, expectedUpdatedAt: rf.data.split[0].updatedAt });
  // 同事還錢：應收 → LINE Pay
  assert.ok(b.call('addTransaction', { tx: { type: '轉帳', date: '2026-10-11', srcAccount: adv.id, srcSymbol: 'TWD', srcQty: 120, dstAccount: linePay, dstSymbol: 'TWD', dstQty: 120, note: '小李還' } }).ok);
  b.mock.state.clock.now = new Date('2026-10-11T18:00:00+08:00').getTime(); b.login();
  boot = b.call('bootstrap').data;
  assert.equal(boot.balances.find((x) => x.accountId === adv.id).qty, 300);
  assert.equal(boot.month.expense, 130);
  assert.equal(boot.month.income, 0, '收回代墊不算收入');
  // 整組作廢：支出與代墊一起
  const g = r.data.split[0];
  const v = b.call('voidTransaction', { id: g.id, wholeGroup: true, expectedUpdatedAt: g.updatedAt });
  assert.ok(v.ok); assert.equal(v.data.txs.length, 2);
  assert.equal(b.call('bootstrap').data.balances.find((x) => x.accountId === adv.id).qty, 200);
});
