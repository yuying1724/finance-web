/**
 * 定期交易（設計文件 db-design.md §7.5）：到期日推算、資金備妥提醒日、交割天數預設值、
 * 「交割日是自動算出還是手動改過」判斷、去重、定期不定額的建議金額。全部是純函式，不做任何 I/O。
 *
 * 名詞：
 *  - 「預定日」（planned）：範本設定的日期（例如每月 6 號），不受假日調整影響，是去重用的鍵。
 *  - 「到期日」（due）：依「假日處理」規則調整後、實際會執行／產生待確認的日子。
 *  - 「有交易」：休市日表的 trading 欄位，用在到期日的假日順延／提前判斷。
 *  - 「有辦理交割」：休市日表的 settling 欄位，用在資金備妥提醒與交割日推算；春節封關「僅辦理交割」的日子
 *    trading=false、settling=true，兩者在這種日子會給出不同答案（db-design 7.4／7.5 的重點）。
 */
var FinRecurring = (function () {
  //#ifnode
  var FinDates = require('./dates.js');
  //#endif

  var HOLIDAY_POLICIES = ['順延', '提前', '不調整'];

  function allTradingDay(d, markets, holidaySet) {
    for (var i = 0; i < markets.length; i++) if (!FinDates.isTradingDay(d, markets[i], holidaySet)) return false;
    return true;
  }
  function allSettleDay(d, markets, holidaySet) {
    for (var i = 0; i < markets.length; i++) if (!FinDates.isSettleDay(d, markets[i], holidaySet)) return false;
    return true;
  }

  // ---------- 到期日推算 ----------

  /** 範本「每月」頻率在某年某月的候選「預定日」（未經假日調整），31 號遇小月取月底 */
  function monthlyRawDates(days, year, month) {
    var last = FinDates.daysInMonth(year, month);
    var uniq = {};
    (days || []).forEach(function (dd) { uniq[Math.min(Math.max(1, Number(dd) || 1), 31)] = true; });
    return Object.keys(uniq).map(Number).sort(function (a, b) { return a - b; })
      .map(function (dd) { return FinDates.format(year, month, Math.min(dd, last)); });
  }

  /** 把「預定日」依假日處理政策調整成「到期日」：markets 全部都要「有交易」才算 */
  function adjustForHoliday(planned, holiday, markets, holidaySet) {
    var d = planned;
    if (holiday === '提前') {
      while (!allTradingDay(d, markets, holidaySet)) d = FinDates.addDays(d, -1);
      return d;
    }
    if (holiday === '不調整') return d;
    // 預設／'順延'：順延到下一個「有交易」的日子（元大台股定期定額的做法）
    while (!allTradingDay(d, markets, holidaySet)) d = FinDates.addDays(d, 1);
    return d;
  }

  /** 資金備妥提醒日 = 到期日之前第 remindDays 個「有辦理交割」的營業日（預設 1） */
  function fundingReminderDate(dueDate, remindDays, markets, holidaySet) {
    var n = remindDays === undefined || remindDays === null || remindDays === '' ? 1 : Math.max(0, Number(remindDays) || 0);
    var d = dueDate;
    for (var i = 0; i < n; i++) {
      d = FinDates.addDays(d, -1);
      while (!allSettleDay(d, markets, holidaySet)) d = FinDates.addDays(d, -1);
    }
    return d;
  }

  /**
   * 範本在 (fromExclusive, toInclusive] 區間內的所有「(預定日, 到期日)」，依頻率展開，
   * 並依範本的起始日／結束日裁切。用於排程「漏跑補跑」一次補齊多筆，以及查詢「即將到來」的到期日。
   */
  function occurrences(tpl, fromExclusive, toInclusive, markets, holidaySet) {
    var out = [];
    var lowerBound = tpl.startDate && tpl.startDate > fromExclusive ? FinDates.addDays(tpl.startDate, -1) : fromExclusive;
    function pushIfInRange(planned) {
      if (planned <= lowerBound) return;
      if (planned > toInclusive) return;
      if (tpl.endDate && planned > tpl.endDate) return;
      out.push({ planned: planned, due: adjustForHoliday(planned, tpl.holiday, markets, holidaySet) });
    }
    if (toInclusive < lowerBound) return out;
    var guard = 0;
    if (tpl.freq === '每月') {
      var ym = FinDates.ymOf(FinDates.addDays(lowerBound, 1));
      var endYm = FinDates.ymOf(toInclusive);
      while (ym <= endYm) {
        var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
        monthlyRawDates(tpl.days, y, m).forEach(pushIfInRange);
        ym = FinDates.addMonths(ym, 1);
        if (++guard > 2400) throw new Error('定期範圍推算超出範圍');
      }
    } else if (tpl.freq === '每週') {
      var d = FinDates.addDays(lowerBound, 1);
      var weekdays = (tpl.days || []).map(Number);
      while (d <= toInclusive) {
        if (weekdays.indexOf(FinDates.weekday(d)) >= 0) pushIfInRange(d);
        d = FinDates.addDays(d, 1);
        if (++guard > 3660) throw new Error('定期範圍推算超出範圍');
      }
    } else if (tpl.freq === '每季' || tpl.freq === '每年') {
      var step = tpl.freq === '每季' ? 3 : 12;
      var anchorYm = FinDates.ymOf(tpl.startDate || FinDates.addDays(lowerBound, 1));
      var startYm2 = FinDates.ymOf(FinDates.addDays(lowerBound, 1));
      var ym2 = anchorYm;
      while (ym2 < startYm2) ym2 = FinDates.addMonths(ym2, step);
      // 找不到明確頻率日時，用起始日的「幾號」當每次發生的日子
      var fallbackDay = tpl.startDate ? +tpl.startDate.slice(8, 10) : 1;
      var endYm2 = FinDates.ymOf(toInclusive);
      while (ym2 <= endYm2) {
        var y2 = +ym2.slice(0, 4), m2 = +ym2.slice(5, 7);
        monthlyRawDates(tpl.days && tpl.days.length ? tpl.days : [fallbackDay], y2, m2).forEach(pushIfInRange);
        ym2 = FinDates.addMonths(ym2, step);
        if (++guard > 800) throw new Error('定期範圍推算超出範圍');
      }
    }
    out.sort(function (a, b) { return a.planned < b.planned ? -1 : a.planned > b.planned ? 1 : 0; });
    return out;
  }

  // ---------- 交割天數與交割日 ----------

  /** 範本的交割天數：範本本身有填就優先；否則券商定期定額固定 0（扣款當天）、手動下單取證券帳戶設定的買入交割天數 */
  function defaultSettleDays(tpl, brokerBuySettleDays) {
    if (tpl.settleDays !== null && tpl.settleDays !== undefined && tpl.settleDays !== '') return Number(tpl.settleDays);
    if (tpl.mode === '券商定期定額') return 0;
    return brokerBuySettleDays === null || brokerBuySettleDays === undefined ? 2 : Number(brokerBuySettleDays);
  }

  function computeSettleDate(tradeDate, settleDays, markets, holidaySet) {
    return FinDates.addSettleDays(tradeDate, settleDays, markets, holidaySet);
  }

  /** 現有交割日是否等於「依舊成交日自動算出」的結果——是就代表當初是自動帶出的 */
  function wasSettleDateAuto(currentSettleDate, oldTradeDate, settleDays, markets, holidaySet) {
    if (!currentSettleDate) return true;
    return currentSettleDate === computeSettleDate(oldTradeDate, settleDays, markets, holidaySet);
  }

  /** 修改成交日時的交割日：自動帶出的就跟著重算，手動改過的維持不動（不需要額外欄位，見 db-design 7.5） */
  function recalcSettleDateOnTradeChange(opts) {
    var wasAuto = wasSettleDateAuto(opts.currentSettleDate, opts.oldTradeDate, opts.settleDays, opts.markets, opts.holidaySet);
    return wasAuto ? computeSettleDate(opts.newTradeDate, opts.settleDays, opts.markets, opts.holidaySet) : opts.currentSettleDate;
  }

  // ---------- 去重 ----------

  function dedupKey(recurringId, plannedDate) { return recurringId + '|' + plannedDate; }

  // ---------- 定期不定額的建議金額（選配功能，db-design 7.5「待你決定要不要做」）----------
  //
  // 設計決策（詳見 claude/進度與決策.md 第 4 批）：只用在「手動下單」模式的買入範本。
  // 基準價＝該持倉的平均成本（有部位時）或近 20 個交易日均價（沒有部位時，例如第一次買）；
  // 現價偏離基準 ±5% 時，用「預計金額」的 20% 當一級加碼／減碼（現價低就加碼、現價高就減碼），
  // 偏離在 ±5% 以內則維持原本的預計金額。這只是畫面上的提示，使用者確認時仍可自行輸入任何金額。
  var SUGGEST_THRESHOLD_PCT = 0.05;
  var SUGGEST_STEP_RATIO = 0.2;

  function suggestedAmount(baseAmount, referencePrice, currentPrice) {
    var base = Number(baseAmount) || 0;
    if (!(referencePrice > 0) || !(currentPrice > 0) || !(base > 0)) {
      return { amount: base, adjustment: 0, deviationPct: null, reason: '' };
    }
    var dev = (currentPrice - referencePrice) / referencePrice;
    var step = base * SUGGEST_STEP_RATIO;
    if (dev <= -SUGGEST_THRESHOLD_PCT) {
      return { amount: base + step, adjustment: step, deviationPct: dev, reason: '現價比基準低 ' + Math.round(Math.abs(dev) * 100) + '%，建議加碼' };
    }
    if (dev >= SUGGEST_THRESHOLD_PCT) {
      var amt = Math.max(base - step, 0);
      return { amount: amt, adjustment: amt - base, deviationPct: dev, reason: '現價比基準高 ' + Math.round(dev * 100) + '%，建議減碼' };
    }
    return { amount: base, adjustment: 0, deviationPct: dev, reason: '現價接近基準，維持預計金額' };
  }

  var api = {
    HOLIDAY_POLICIES: HOLIDAY_POLICIES,
    monthlyRawDates: monthlyRawDates, adjustForHoliday: adjustForHoliday, fundingReminderDate: fundingReminderDate,
    occurrences: occurrences, defaultSettleDays: defaultSettleDays, computeSettleDate: computeSettleDate,
    wasSettleDateAuto: wasSettleDateAuto, recalcSettleDateOnTradeChange: recalcSettleDateOnTradeChange,
    dedupKey: dedupKey, suggestedAmount: suggestedAmount,
    SUGGEST_THRESHOLD_PCT: SUGGEST_THRESHOLD_PCT, SUGGEST_STEP_RATIO: SUGGEST_STEP_RATIO,
  };
  return api;
})();
//#ifnode
module.exports = FinRecurring;
//#endif
