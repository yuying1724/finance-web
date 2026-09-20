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

  var api = {
    parse: parse, isValid: isValid, format: format, addDays: addDays, weekday: weekday, ymOf: ymOf, monthRange: monthRange,
    addMonths: addMonths, timestamp: timestamp, today: today, fromCell: fromCell, daysInMonth: daysInMonth,
  };
  return api;
})();
