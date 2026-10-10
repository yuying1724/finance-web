'use strict';
/** 商家管理：列出商家、隱藏／恢復建議、改名（合併）、清除（可移到備註） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

test('商家管理：隱藏只影響建議清單；改名會改所有交易並可合併；清除可把名稱移到備註', () => {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-10T18:00:00+08:00').getTime(); b.login();
  const card = b.call('upsertAccount', { account: { name: '卡', type: '信用卡', defaultSymbol: 'TWD' } }).data.account.id;
  const cats = b.call('bootstrap').data.categories;
  const cat = (n) => cats.find((c) => c.name === n && c.type === '支出').id;
  const add = (merchant, date, extra) => { const r = b.call('addTransaction', { tx: Object.assign({ type: '支出', date, srcAccount: card, srcSymbol: 'TWD', srcQty: 100, categoryId: cat('日用品'), merchant }, extra || {}) }); assert.ok(r.ok, JSON.stringify(r)); return r.data.tx; };
  add('COSTCO 好市多', '2026-10-10'); add('好市多', '2026-09-19'); add('好市多', '2026-09-01');
  add('電話費', '2026-10-05', { note: '9 月', categoryId: cat('網路電話') }); add('統康生活', '2026-10-01');
  let list = b.call('listMerchants').data.items;
  assert.deepEqual(list.map((x) => [x.name, x.count]), [['好市多', 2], ['COSTCO 好市多', 1], ['電話費', 1], ['統康生活', 1]]);
  assert.equal(list.find((x) => x.name === '好市多').lastDate, '2026-09-19');
  // 隱藏：建議清單不見，交易不動
  assert.ok(b.call('updateMerchant', { name: '統康生活', action: 'hide' }).ok);
  assert.ok(!b.call('bootstrap').data.merchants.includes('統康生活'));
  assert.equal(b.call('listMerchants').data.items.find((x) => x.name === '統康生活').hidden, true);
  assert.equal(b.call('listTransactions', { filters: { q: '統康生活' } }).data.items.length, 1);
  assert.ok(b.call('updateMerchant', { name: '統康生活', action: 'show' }).ok);
  assert.ok(b.call('bootstrap').data.merchants.includes('統康生活'));
  // 改名＝合併
  assert.equal(b.call('updateMerchant', { name: 'COSTCO 好市多', action: 'rename', newName: '' }).error.code, 'VALIDATION');
  let r = b.call('updateMerchant', { name: 'COSTCO 好市多', action: 'rename', newName: '好市多' });
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.data.changed, 1);
  list = b.call('listMerchants').data.items;
  assert.deepEqual(list.find((x) => x.name === '好市多').count, 3);
  assert.ok(!list.find((x) => x.name === 'COSTCO 好市多'));
  // 清除並移到備註
  r = b.call('updateMerchant', { name: '電話費', action: 'clear', moveToNote: true });
  assert.ok(r.ok); assert.equal(r.data.changed, 1);
  const t = b.call('listTransactions', { filters: { q: '電話費' } }).data.items[0];
  assert.deepEqual([t.merchant, t.note], ['', '電話費；9 月']);
  assert.ok(!b.call('bootstrap').data.merchants.includes('電話費'));
});
