/* 自動產生自 core/dates.js，請勿直接編輯 */
/**
 * 日期工具：日期一律用 'yyyy-MM-dd' 文字，時間戳記用台灣時間（UTC+8，無日光節約）'yyyy-MM-dd HH:mm:ss'。
 * 不依賴 Date 的本地時區，Node 與 Apps Script 結果一致。
 */
var FinDates = (function () {
  var TZ_OFFSET_MS = 8 * 3600 * 1000;

  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function parse(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str === null || str === undefined ? '' : str).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  function isValid(str) { return parse(str) !== null; }
  function format(y, m, d) { return pad(y, 4) + '-' + pad(m) + '-' + pad(d); }

  function addDays(str, n) {
    var p = parse(str);
    if (!p) throw new Error('日期格式錯誤：' + str);
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  function weekday(str) { // 0=週日
    var p = parse(str);
    return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  }

  function ymOf(str) { return String(str).slice(0, 7); }
  function monthRange(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return { from: format(y, m, 1), to: format(y, m, daysInMonth(y, m)) };
  }
  function addMonths(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return pad(y, 4) + '-' + pad(m + 1);
  }

  /** 毫秒時間戳 → 台灣時間 'yyyy-MM-dd HH:mm:ss' */
  function timestamp(ms) {
    var t = new Date(ms + TZ_OFFSET_MS);
    return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) + ' ' +
      pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ':' + pad(t.getUTCSeconds());
  }
  function today(ms) { return timestamp(ms).slice(0, 10); }

  /** Sheet 讀到的日期儲存格可能是字串或 Date 物件（手動輸入時），統一成 'yyyy-MM-dd'；無法辨識回傳 null */
  function fromCell(v) {
    if (v === null || v === undefined || v === '') return '';
    if (Object.prototype.toString.call(v) === '[object Date]') {
      if (isNaN(v.getTime())) return null;
      return today(v.getTime());
    }
    var s = String(v).trim();
    if (isValid(s)) return s;
    var m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(s);
    if (m) { var f = format(+m[1], +m[2], +m[3]); return isValid(f) ? f : null; }
    return null;
  }


  /** 某市場在這天是否「辦理交割」的營業日：週六日一律不算；holidaySet 為 {'市場|日期': {trading,settling}} */
  function isSettleDay(str, market, holidaySet) {
    var wd = weekday(str);
    if (wd === 0 || wd === 6) return false;
    var h = holidaySet ? holidaySet[market + '|' + str] : null;
    if (h && h.settling === false) return false;
    return true;
  }

  /** 成交日後第 n 個營業日（依 markets 陣列全部都要是營業日才算，例如複委託用 ['台灣','美國']） */
  function addSettleDays(tradeDate, n, markets, holidaySet) {
    var d = tradeDate, count = 0, guard = 0;
    while (count < n) {
      d = addDays(d, 1);
      var ok = true;
      for (var i = 0; i < markets.length; i++) { if (!isSettleDay(d, markets[i], holidaySet)) { ok = false; break; } }
      if (ok) count++;
      if (++guard > 3650) throw new Error('交割日推算超出範圍');
    }
    return d;
  }

  /** 把「休市日」表的列轉成 isSettleDay/addSettleDays 用的查表：{'市場|日期': {trading, settling}} */
  function buildHolidaySet(rows) {
    var set = {};
    (rows || []).forEach(function (r) { set[r.market + '|' + r.date] = { trading: r.trading, settling: r.settling }; });
    return set;
  }

  var api = {
    parse: parse, isValid: isValid, format: format, addDays: addDays, weekday: weekday, ymOf: ymOf, monthRange: monthRange,
    addMonths: addMonths, timestamp: timestamp, today: today, fromCell: fromCell, daysInMonth: daysInMonth,
    isSettleDay: isSettleDay, addSettleDays: addSettleDays, buildHolidaySet: buildHolidaySet,
  };
  return api;
})();
