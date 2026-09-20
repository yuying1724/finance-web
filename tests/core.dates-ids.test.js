'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/dates.js');
const Ids = require('../core/ids.js');

test('日期驗證：閏年、月底、格式', () => {
  assert.ok(D.isValid('2028-02-29'));
  assert.ok(!D.isValid('2026-02-29'));
  assert.ok(!D.isValid('2026-13-01'));
  assert.ok(!D.isValid('2026/03/01'));
  assert.ok(!D.isValid(''));
  assert.ok(!D.isValid(null));
});

test('日期加減與月份運算', () => {
  assert.equal(D.addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(D.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(D.addMonths('2026-11', 3), '2027-02');
  assert.equal(D.addMonths('2026-01', -1), '2025-12');
  assert.deepEqual(D.monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(D.weekday('2026-03-01'), 0);
});

test('時間戳記用台灣時間（UTC+8），與執行環境時區無關', () => {
  const ms = Date.UTC(2026, 2, 1, 16, 30, 5); // UTC 3/1 16:30:05 = 台灣 3/2 00:30:05
  assert.equal(D.timestamp(ms), '2026-03-02 00:30:05');
  assert.equal(D.today(ms), '2026-03-02');
});

test('Sheet 儲存格：字串、Date 物件、斜線格式都能正規化', () => {
  assert.equal(D.fromCell('2026-03-04'), '2026-03-04');
  assert.equal(D.fromCell('2026/3/4'), '2026-03-04');
  assert.equal(D.fromCell(''), '');
  assert.equal(D.fromCell(new Date(Date.UTC(2026, 2, 3, 16, 0, 0))), '2026-03-04'); // 台灣 3/4 00:00
  assert.equal(D.fromCell('not a date'), null);
});

test('ID：最大號 + 1，不受空缺與手動亂填影響', () => {
  assert.deepEqual(Ids.next([], 'T', 6, 1), ['T000001']);
  assert.deepEqual(Ids.next(['T000001', 'T000007', 'xx', '', 'A003'], 'T', 6, 2), ['T000008', 'T000009']);
  assert.deepEqual(Ids.next(['A001', 'A009'], 'A', 3, 1), ['A010']);
  assert.deepEqual(Ids.next(['T1000000'], 'T', 6, 1), ['T1000001']);
});
