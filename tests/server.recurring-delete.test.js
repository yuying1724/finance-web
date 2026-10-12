'use strict';
/** 刪除定期範本：只能刪已停用、沒產生過交易的；刪掉後其他範本不受影響 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

test('刪除定期範本：啟用中要先停用；產生過交易的不能刪；沒用過的停用範本可以刪，其他範本照舊', () => {
  const b = loadBackend().setup();
  b.mock.state.clock.now = new Date('2026-10-12T09:00:00+08:00').getTime(); b.login();
  const ok = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const bank = ok(b.call('upsertAccount', { account: { name: '銀行', type: '銀行', defaultSymbol: 'TWD' } })).account.id;
  const rent = b.call('bootstrap').data.categories.find((c) => c.name === '房租房貸').id;
  const mk = (name, startDate) => ok(b.call('upsertRecurring', { recurring: { name, freq: '每月', days: [5], holiday: '不調整', startDate, type: '支出', srcAccount: bank, srcSymbol: 'TWD', srcQty: 1000, categoryId: rent, mode: '自動入帳' } })).recurring;
  const used = mk('用過的', '2026-10-05');
  const unused = mk('房租-7月', '2027-07-05');
  const keep = mk('留著的', '2027-01-05');
  ok(b.call('runRecurringScheduler', {}));
  const rec = () => b.call('bootstrap').data.recurring;
  const cur = (id) => rec().find((r) => r.id === id);
  // 啟用中不能刪
  assert.equal(b.call('deleteRecurring', { id: unused.id, expectedUpdatedAt: cur(unused.id).updatedAt }).error.code, 'BAD_STATE');
  // 產生過交易的不能刪
  ok(b.call('setRecurringActive', { id: used.id, active: false }));
  assert.equal(b.call('deleteRecurring', { id: used.id, expectedUpdatedAt: cur(used.id).updatedAt }).error.code, 'BAD_STATE');
  // 沒用過的停用範本可以刪
  ok(b.call('setRecurringActive', { id: unused.id, active: false }));
  assert.equal(b.call('deleteRecurring', { id: unused.id, expectedUpdatedAt: 'old' }).error.code, 'CONFLICT');
  ok(b.call('deleteRecurring', { id: unused.id, expectedUpdatedAt: cur(unused.id).updatedAt }));
  assert.deepEqual(rec().map((r) => r.name).sort(), ['用過的', '留著的'].sort());
  assert.equal(cur(keep.id).srcQty, 1000);
  // 再新增一個，ID 不會跟現有的撞
  const n = mk('新的', '2027-02-05');
  assert.ok(![used.id, keep.id].includes(n.id));
  assert.equal(b.call('deleteRecurring', { id: unused.id }).error.code, 'NOT_FOUND');
});
