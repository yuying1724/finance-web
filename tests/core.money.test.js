'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../core/money.js');

test('台幣整數、美金 2 位、比特幣 8 位都能精確轉換', () => {
  assert.equal(M.toUnits(1234, 0), 1234);
  assert.equal(M.toUnits(100.25, 2), 10025);
  assert.equal(M.toUnits(0.00000001, 8), 1);
  assert.equal(M.toUnits(0.12345678, 8), 12345678);
});

test('BTC 0.1 + 0.2 用整數單位加總剛好是 0.3', () => {
  const sum = M.toUnits(0.1, 8) + M.toUnits(0.2, 8);
  assert.equal(sum, M.toUnits(0.3, 8));
  assert.equal(M.fromUnits(sum, 8), 0.3);
  assert.notEqual(0.1 + 0.2, 0.3); // 對照：浮點直接加會出錯
});

test('四捨五入：正好一半進位（遠離 0），且 1.005 這類浮點陷阱正確', () => {
  assert.equal(M.toUnits(1.005, 2), 101);
  assert.equal(M.toUnits(2.5, 0), 3);
  assert.equal(M.toUnits(-2.5, 0), -3);
  assert.equal(M.toUnits(0.285, 2), 29);
  assert.equal(M.toUnits(-0.0001, 2), 0);
  assert.ok(Object.is(M.toUnits(-0.0001, 2), 0)); // 不會出現 -0
});

test('小數位數檢查：台幣不能有小數、美金不能超過 2 位', () => {
  assert.equal(M.fitsDecimals(100, 0), true);
  assert.equal(M.fitsDecimals(100.5, 0), false);
  assert.equal(M.fitsDecimals(100.25, 2), true);
  assert.equal(M.fitsDecimals(100.255, 2), false);
  assert.equal(M.fitsDecimals(0.1 + 0.2, 2), true); // 浮點雜訊不算超位
  assert.equal(M.fitsDecimals(0.12345678, 8), true);
  assert.equal(M.fitsDecimals(0.123456789, 8), false);
});

test('無效輸入會丟出錯誤', () => {
  assert.throws(() => M.toUnits('abc', 0));
  assert.throws(() => M.toUnits('', 0));
  assert.throws(() => M.toUnits(null, 0));
  assert.throws(() => M.toUnits(Infinity, 0));
  assert.throws(() => M.toUnits(1e20, 2));
});

test('顯示格式：千分位、固定小數、正負號', () => {
  assert.equal(M.format(1234567, 0), '1,234,567');
  assert.equal(M.format(-1234.5, 2), '-1,234.50');
  assert.equal(M.format(12.3, 2, { sign: true }), '+12.30');
  assert.equal(M.format(0.5, 8, { trim: true }), '0.5');
  assert.equal(M.format(1000, 2, { trim: true }), '1,000');
  assert.equal(M.format(-0.4, 0), '0');
});
