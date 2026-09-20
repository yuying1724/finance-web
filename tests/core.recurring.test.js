'use strict';
/**
 * core/recurring.js 的純函式測試：直接翻譯 claude/verify_recurring.py（R1、R2、R3、R4、R5、R6、R7：到期日與資金備妥提醒日）
 * 與 claude/verify_recurring_modes.py（M1、M2、M3、M14、M15、M16、M16b：交割天數預設值與「自動／手動」交割日判斷）的情境與期望值。
 * 兩份 verify_*.py 裡涉及「排程＋帳本」的情境（R8~R17、M4~M13、M17、M18）改在 tests/server.recurring.test.js
 * 用真正的 API／排程走一次，是更貼近實際程式碼路徑的驗證方式，這裡不重複做一份 toy 帳本模擬。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const FinRecurring = require('../core/recurring.js');
const FinDates = require('../core/dates.js');

const TW = ['台灣'];

// ---- 對應 verify_recurring.py 的測試用假設日曆 ----
function buildHolidaySet() {
  const set = {};
  // 春節：2/16~2/20 無交易、無交割
  for (let d = 16; d <= 20; d++) set['台灣|2026-02-' + String(d).padStart(2, '0')] = { trading: false, settling: false };
  // 2/12、2/13：無交易，但辦理交割
  set['台灣|2026-02-12'] = { trading: false, settling: true };
  set['台灣|2026-02-13'] = { trading: false, settling: true };
  return set;
}
const HOL = buildHolidaySet();

test('R1 設定 6 號、當天週六 -> 順延到週一 6/8', () => {
  const planned = FinRecurring.monthlyRawDates([6], 2026, 6);
  assert.deepEqual(planned, ['2026-06-06']);
  const due = FinRecurring.adjustForHoliday(planned[0], '順延', TW, HOL);
  assert.equal(due, '2026-06-08');
});

test('R2 資金備妥提醒日 = 6/8 的前一營業日 = 週五 6/5', () => {
  assert.equal(FinRecurring.fundingReminderDate('2026-06-08', 1, TW, HOL), '2026-06-05');
});

test('R3 設定 2/12（無交易、僅辦交割）-> 順延到有交易的 2/23，而非停在 2/12', () => {
  const planned = FinRecurring.monthlyRawDates([12], 2026, 2);
  assert.deepEqual(planned, ['2026-02-12']);
  assert.equal(FinRecurring.adjustForHoliday(planned[0], '順延', TW, HOL), '2026-02-23');
});

test('R4 設定 2/16（春節休市）-> 順延到 2/23', () => {
  const planned = FinRecurring.monthlyRawDates([16], 2026, 2);
  assert.equal(FinRecurring.adjustForHoliday(planned[0], '順延', TW, HOL), '2026-02-23');
});

test('R5 春節後首個扣款日 2/23 的前一營業日 = 2/13（僅辦交割日算營業日）', () => {
  assert.equal(FinRecurring.fundingReminderDate('2026-02-23', 1, TW, HOL), '2026-02-13');
});

test('R6 每月多個日期（6、16、26）皆可產生', () => {
  assert.deepEqual(FinRecurring.monthlyRawDates([6, 16, 26], 2026, 3), ['2026-03-06', '2026-03-16', '2026-03-26']);
});

test('R7 設定 31 號、當月只有 28 天 -> 取月底 2/28（週六）再順延到 3/2', () => {
  const planned = FinRecurring.monthlyRawDates([31], 2026, 2);
  assert.deepEqual(planned, ['2026-02-28']);
  assert.equal(FinRecurring.adjustForHoliday(planned[0], '順延', TW, HOL), '2026-03-02');
});

test('假日處理「不調整」：即使遇假日也不順延', () => {
  assert.equal(FinRecurring.adjustForHoliday('2026-06-06', '不調整', TW, HOL), '2026-06-06');
});

test('假日處理「提前」：遇假日往前找有交易的日子', () => {
  // 2026-06-07 是週日 -> 提前到 6/5（週五）
  assert.equal(FinRecurring.adjustForHoliday('2026-06-07', '提前', TW, HOL), '2026-06-05');
});

test('occurrences：漏跑多個月一次補齊，且不含區間邊界之前已處理過的', () => {
  const tpl = { freq: '每月', days: [6], holiday: '順延', startDate: '2026-01-01', endDate: '' };
  const occ = FinRecurring.occurrences(tpl, '2026-05-31', '2026-07-31', TW, HOL);
  assert.deepEqual(occ.map((o) => o.planned), ['2026-06-06', '2026-07-06']);
  // 已經處理到 6/6 之後才問 -> 只剩 7/6
  const occ2 = FinRecurring.occurrences(tpl, '2026-06-06', '2026-07-31', TW, HOL);
  assert.deepEqual(occ2.map((o) => o.planned), ['2026-07-06']);
});

test('occurrences：起始日之前與結束日之後都不會產生', () => {
  const tpl = { freq: '每月', days: [6], holiday: '不調整', startDate: '2026-04-01', endDate: '2026-05-31' };
  const occ = FinRecurring.occurrences(tpl, '2026-01-01', '2026-12-31', TW, HOL);
  assert.deepEqual(occ.map((o) => o.planned), ['2026-04-06', '2026-05-06']);
});

test('occurrences：每週頻率（星期幾）', () => {
  const tpl = { freq: '每週', days: [1], holiday: '不調整', startDate: '2026-06-01', endDate: '' }; // 週一
  const occ = FinRecurring.occurrences(tpl, '2026-06-01', '2026-06-30', TW, HOL);
  occ.forEach((o) => assert.equal(FinDates.weekday(o.planned), 1));
  assert.ok(occ.length >= 4);
});

// ---------- 對應 verify_recurring_modes.py：交割天數與「自動／手動」交割日判斷 ----------
const TPL_BROKER = { mode: '券商定期定額', settleDays: null };
const TPL_MANUAL = { mode: '手動下單', settleDays: null };

test('M1 券商定期定額：交割天數預設 0', () => {
  assert.equal(FinRecurring.defaultSettleDays(TPL_BROKER, 2), 0);
});
test('M2 手動下單：交割天數預設 = 證券帳戶設定的買入交割天數（2）', () => {
  assert.equal(FinRecurring.defaultSettleDays(TPL_MANUAL, 2), 2);
});
test('M3 範本覆寫優先（例如手動下單但你的券商是 T+1）', () => {
  assert.equal(FinRecurring.defaultSettleDays({ mode: '手動下單', settleDays: 1 }, 2), 1);
});

test('M14/M15 自動帶出的交割日：修改成交日時跟著重算', () => {
  const wed = '2026-03-04';
  const auto = FinRecurring.computeSettleDate(wed, 2, TW, {});
  assert.equal(auto, '2026-03-06'); // 週五
  const recalced = FinRecurring.recalcSettleDateOnTradeChange({
    currentSettleDate: auto, oldTradeDate: wed, newTradeDate: '2026-03-05', settleDays: 2, markets: TW, holidaySet: {},
  });
  assert.equal(recalced, '2026-03-09'); // 週四 + 2 個營業日 = 週一
});

test('M16 手動改過的交割日：之後改成交日不會被覆蓋', () => {
  const wed = '2026-03-04';
  const manualSettle = '2026-03-10';
  const recalced = FinRecurring.recalcSettleDateOnTradeChange({
    currentSettleDate: manualSettle, oldTradeDate: wed, newTradeDate: '2026-03-05', settleDays: 2, markets: TW, holidaySet: {},
  });
  assert.equal(recalced, manualSettle, '手動改過的值（不等於自動算出的值）應該保留');
});

test('M16b 邊界：手填值恰好等於自動值時視為自動，改成交日後會重算（已知且可接受）', () => {
  const wed = '2026-03-04';
  const auto = FinRecurring.computeSettleDate(wed, 2, TW, {}); // 3/6
  const recalced = FinRecurring.recalcSettleDateOnTradeChange({
    currentSettleDate: auto, oldTradeDate: wed, newTradeDate: '2026-03-05', settleDays: 2, markets: TW, holidaySet: {},
  });
  assert.equal(recalced, '2026-03-09');
});

// ---------- 定期不定額的建議金額（選配功能，本批次的設計決策）----------
test('建議金額：現價低於基準 5% 以上時加碼（預計金額的 20%）', () => {
  const r = FinRecurring.suggestedAmount(20000, 100, 94); // 偏低 6%
  assert.equal(r.amount, 24000);
  assert.ok(r.adjustment > 0);
});
test('建議金額：現價高於基準 5% 以上時減碼', () => {
  const r = FinRecurring.suggestedAmount(20000, 100, 106);
  assert.equal(r.amount, 16000);
});
test('建議金額：偏離在 5% 以內時維持預計金額', () => {
  const r = FinRecurring.suggestedAmount(20000, 100, 102);
  assert.equal(r.amount, 20000);
  assert.equal(r.adjustment, 0);
});
test('建議金額：沒有基準價或現價時原樣回傳，不出錯', () => {
  const r = FinRecurring.suggestedAmount(20000, null, 100);
  assert.equal(r.amount, 20000);
});

// ---------- 5 位小數不失真（呼應 R17）----------
test('碎股 5 位小數累加不失真', () => {
  const FinMoney = require('../core/money.js');
  const a = FinMoney.toUnits('0.13456', 5);
  const b = FinMoney.toUnits('0.12987', 5);
  assert.equal(FinMoney.fromUnits(a + b, 5), 0.26443);
});
