/**
 * 美股（NYSE／NASDAQ）休市日：依規則產生（設計文件 §5 休市日：美國「由程式依規則產生」）。
 * 包含：元旦、馬丁路德金日（1月第3個週一）、總統日（2月第3個週一）、耶穌受難日（復活節前的週五）、
 *       陣亡將士紀念日（5月最後一個週一）、六月節（6/19）、獨立紀念日（7/4）、勞動節（9月第1個週一）、
 *       感恩節（11月第4個週四）、聖誕節（12/25）。
 * 遇週六補放週五、遇週日補放週一（美股市場假日的一般補假規則）。
 */
var FinUsHolidays = (function () {
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fmt(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function dow(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); } // 0=日 1=一 ... 6=六

  /** 某月第 n 個星期 wd（0=日...6=六） */
  function nthWeekday(y, m, wd, n) {
    var d = 1, count = 0;
    while (true) {
      if (dow(y, m, d) === wd) { count++; if (count === n) return d; }
      d++;
    }
  }
  /** 某月最後一個星期 wd */
  function lastWeekday(y, m, wd) {
    var days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (var d = days; d >= 1; d--) if (dow(y, m, d) === wd) return d;
  }

  /** Anonymous Gregorian algorithm：計算某年復活節（公曆）的月/日 */
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return { m: month, d: day };
  }

  /** 遇週六補放週五、遇週日補放週一（不改變原始日期名稱，只有補假才另外標一列） */
  function observed(y, m, d) {
    var wd = dow(y, m, d);
    if (wd === 6) return { y: y, m: m, d: d - 1 };
    if (wd === 0) return { y: y, m: m, d: d + 1 };
    return { y: y, m: m, d: d };
  }

  /** 回傳某年美股休市日清單 [{date, name}]（yyyy-MM-dd） */
  function generate(year) {
    var out = [];
    function add(name, y, m, d) {
      var o = observed(y, m, d);
      out.push({ date: fmt(o.y, o.m, o.d), name: name + (o.d !== d || o.m !== m ? '（補假）' : '') });
    }
    add('元旦', year, 1, 1);
    add('馬丁路德金日', year, 1, nthWeekday(year, 1, 1, 3));
    add('總統日', year, 2, nthWeekday(year, 2, 1, 3));
    var e = easter(year);
    var goodFriday = new Date(Date.UTC(year, e.m - 1, e.d - 2));
    out.push({ date: fmt(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()), name: '耶穌受難日' });
    add('陣亡將士紀念日', year, 5, lastWeekday(year, 5, 1));
    add('六月節', year, 6, 19);
    add('獨立紀念日', year, 7, 4);
    add('勞動節', year, 9, nthWeekday(year, 9, 1, 1));
    var thanksgiving = nthWeekday(year, 11, 4, 4);
    out.push({ date: fmt(year, 11, thanksgiving), name: '感恩節' });
    add('聖誕節', year, 12, 25);
    out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return out;
  }

  return { generate: generate, easter: easter };
})();
//#ifnode
module.exports = FinUsHolidays;
//#endif
