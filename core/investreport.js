/**
 * 投資報表（投資頁「報表」分頁、首頁投資收益、交易頁月份統計共用）。
 *
 * 某段期間的投資損益 = 未實現損益的變化 + 已實現損益 + 股息
 *   ＝ 期末市值 − 期初市值 − 淨投入（買入 − 賣出入帳）＋ 股息（兩種算法結果相同）。
 * 期初＝期間開始「前一天收盤」的持倉市值；期末＝期間最後一天收盤（今天用目前價格）。
 * 歷史價格從「價格歷史」取「該日或之前最近一筆收盤價」；找不到就用目前價格並標記為估算。
 *
 * 投資紀錄的第一天（通常是舊部位一次補登的那天）視為「期初」：那天記的買入不算投入，
 * 期間最早只能從那天收盤開始算（之前的歷史還原不了）。之後才補登／開帳的部位（備註有「補登」「開帳」）、
 * 以及「股數調整」增減的股數，都以當天市值「轉入／轉出」，不算投入的錢，也不把補登前累積的漲跌算進來。
 *
 * 報酬率用「修正 Dietz 法」：損益 ÷（期初市值 + 期間每筆投入 × 留在期間內的天數比例），
 * 定期定額這種期間中一直投入的情況才不會被低估或高估。
 */
var FinInvestReport = (function () {
  //#ifnode
  var FinMoney = require('./money.js');
  var FinDates = require('./dates.js');
  var FinValuation = require('./valuation.js');
  var FinHoldings = require('./holdings.js');
  //#endif

  var INVEST_TYPES = ['買入', '賣出', '股息', '股數調整'];

  /** 舊部位補登／開帳的買入（備註寫「補登」或「開帳」）：不是期間內新投入的錢 */
  function isOpening(t) { return /補登|開帳/.test(String(t.note || '')); }

  function dayNum(str) { var p = FinDates.parse(str); return Date.UTC(p.y, p.m - 1, p.d) / 86400000; }

  /** 價格歷史 {'日期|代號': 收盤價} → 每個代號依日期排序，查「該日或之前最近一筆」 */
  function historyIndex(priceHistory) {
    var by = {};
    Object.keys(priceHistory || {}).forEach(function (k) {
      var i = k.indexOf('|'), d = k.slice(0, i), sym = k.slice(i + 1), v = Number(priceHistory[k]);
      if (!(v > 0) || !FinDates.isValid(d)) return;
      (by[sym] || (by[sym] = [])).push([d, v]);
    });
    Object.keys(by).forEach(function (s) { by[s].sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }); });
    return function closeOn(sym, date) {
      var list = by[sym];
      if (!list) return null;
      var lo = 0, hi = list.length - 1, ans = null;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (list[mid][0] <= date) { ans = list[mid][1]; lo = mid + 1; } else hi = mid - 1; }
      return ans;
    };
  }

  /**
   * txs：全部交易列；instruments：{代號: 標的}；
   * ctx：{ base, today, prices（目前價格 {代號: 價格}）, priceHistory（{'日期|代號': 收盤}）, from, to, names（選填 {代號: 名稱}） }
   */
  function build(txs, instruments, ctx) {
    var base = ctx.base || 'TWD';
    var dec = instruments[base] ? instruments[base].decimals : 0;
    var today = ctx.today;
    var prices = ctx.prices || {};
    var ph = ctx.priceHistory || {};
    var closeOn = historyIndex(ph);
    var valid = txs.filter(function (t) { return t.status === '有效' && INVEST_TYPES.indexOf(t.type) >= 0 && FinDates.isValid(t.date) && t.date <= today; });
    if (!valid.length) return { base: base, empty: true };
    var dataStart = valid.reduce(function (m, t) { return t.date < m ? t.date : m; }, valid[0].date);

    var missing = {}, estimated = false;
    var holdCache = {};
    function holdingsAt(date) {
      if (!holdCache[date]) holdCache[date] = FinHoldings.computeHoldings(txs, instruments, { base: base, asOf: date, prices: prices, priceHistory: ph });
      return holdCache[date];
    }
    /** 某天收盤的價格表（今天用目前價格）；沒有歷史價時退回目前價格並記為估算 */
    var priceCache = {};
    function priceOf(sym, date) {
      if (sym === base) return 1;
      if (date >= today) return Number(prices[sym]) > 0 ? Number(prices[sym]) : null;
      var k = sym + '|' + date;
      if (k in priceCache) return priceCache[k];
      var v = closeOn(sym, date);
      if (v === null && Number(prices[sym]) > 0) { v = Number(prices[sym]); estimated = true; missing[sym] = true; }
      priceCache[k] = v;
      return v;
    }
    function unitBase(sym, date, depth) {
      if (sym === base) return 1;
      depth = depth || 0;
      if (depth > 4) return null;
      var inst = instruments[sym]; if (!inst) return null;
      var p = priceOf(sym, date); if (!(p > 0)) return null;
      var q = inst.quote || base; if (q === sym) return null;
      var u = unitBase(q, date, depth + 1);
      return u === null ? null : p * u;
    }
    /** 某天收盤：依標的彙總 {代號: {qty, mv, cost}}；查不到價格的用成本當市值（不算損益） */
    var valCache = {};
    function valueAt(date) {
      if (valCache[date]) return valCache[date];
      var out = {};
      holdingsAt(date).positions.forEach(function (p) {
        var o = out[p.symbol] || (out[p.symbol] = { qty: 0, mv: 0, cost: 0 });
        var u = unitBase(p.symbol, date, 0);
        if (u === null) { missing[p.symbol] = true; u = p.qty ? p.costBase / p.qty : 0; }
        o.qty += p.qty; o.mv += p.qty * u; o.cost += p.costBase;
      });
      valCache[date] = out;
      return out;
    }
    function cashBase(sym, qty, date) {
      if (!qty) return 0;
      var u = unitBase(sym, date, 0);
      if (u === null) { missing[sym] = true; return 0; }
      return qty * u;
    }

    /** 股票數量在某天收盤的市值（基準幣別）；查不到價格回 0 並列入缺價格 */
    function marketValue(sym, qty, date) {
      var u = unitBase(sym, date, 0);
      if (u === null) { missing[sym] = true; return 0; }
      return qty * u;
    }

    /** 一段期間 [a, b]（含頭尾）；起點是 a 前一天收盤，若 a 是第一天就從那天收盤開始 */
    function period(a, b, perSymbol) {
      var v0 = a <= dataStart ? dataStart : FinDates.addDays(a, -1);
      var days = Math.max(0, dayNum(b) - dayNum(v0));
      var s0 = valueAt(v0), s1 = valueAt(b);
      var syms = {};
      function S(sym) { return syms[sym] || (syms[sym] = { symbol: sym, startValue: 0, endValue: 0, startCost: 0, endCost: 0, buys: 0, sells: 0, transfers: 0, inflow: 0, realized: 0, dividends: 0, weighted: 0, endQty: 0 }); }
      Object.keys(s0).forEach(function (k) { var x = S(k); x.startValue = s0[k].mv; x.startCost = s0[k].cost; });
      Object.keys(s1).forEach(function (k) { var x = S(k); x.endValue = s1[k].mv; x.endCost = s1[k].cost; x.endQty = s1[k].qty; });
      var w = function (d) { return days > 0 ? (dayNum(b) - dayNum(d)) / days : 0; };
      valid.forEach(function (t) {
        if (t.date <= v0 || t.date > b) return;
        if (t.type === '買入' && isOpening(t)) {
          // 舊部位補登／開帳：不是新投入的錢，當天以市值「轉入」，之前累積的漲跌不算在這段期間
          var o = S(t.dstSymbol), mvIn = marketValue(t.dstSymbol, t.dstQty, t.date);
          o.transfers += mvIn; o.inflow += mvIn; o.weighted += mvIn * w(t.date);
        } else if (t.type === '買入') { var x = S(t.dstSymbol), amt = cashBase(t.srcSymbol, t.srcQty, t.date); x.buys += amt; x.inflow += amt; x.weighted += amt * w(t.date); }
        else if (t.type === '賣出') { var y = S(t.srcSymbol), got = cashBase(t.dstSymbol, t.dstQty, t.date); y.sells += got; y.weighted -= got * w(t.date); }
        else if (t.type === '股數調整') {
          // 只改股數、沒有錢進出：增加的股數以當天市值「轉入」，減少的以當天市值「轉出」（例如賣出款項另外記在餘額調整）。
          // 期間內的漲跌算在未實現（已實現只算真的有「賣出」紀錄的，跟券商 app 對得起來）。拆股／併股不適用這個假設，目前沒有這種資料。
          if (t.dstAccount && t.dstSymbol && t.dstQty) {
            var ai = S(t.dstSymbol), v = marketValue(t.dstSymbol, t.dstQty, t.date);
            ai.transfers += v; ai.inflow += v; ai.weighted += v * w(t.date);
          } else if (t.srcAccount && t.srcSymbol && t.srcQty) {
            var ao = S(t.srcSymbol), vo = marketValue(t.srcSymbol, t.srcQty, t.date);
            ao.transfers -= vo; ao.weighted -= vo * w(t.date);
          }
        }
      });
      var hb = holdingsAt(b);
      hb.realized.forEach(function (r) { if (r.date > v0 && r.date <= b && r.realizedBase !== null) S(r.symbol).realized += r.realizedBase; });
      hb.dividends.forEach(function (d) {
        if (d.date <= v0 || d.date > b) return;
        S(d.relatedSymbol || d.symbol).dividends += cashBase(d.symbol, d.net, d.date);
      });
      var tot = { startValue: 0, endValue: 0, buys: 0, sells: 0, transfers: 0, realized: 0, dividends: 0, unrealizedChange: 0, weighted: 0 };
      var list = Object.keys(syms).map(function (k) {
        var x = syms[k];
        // 損益＝期末市值－期初市值－淨投入－補登／調整轉入＋股息；未實現變化＝損益－已實現－股息
        x.total = x.endValue - x.startValue - (x.buys - x.sells) - x.transfers + x.dividends;
        x.unrealizedChange = x.total - x.realized - x.dividends;
        // 單一標的的報酬率：損益 ÷（期初市值＋期間投入／轉入）。單一標的常常是期間中才買，用修正 Dietz 會把短期報酬放大，這裡用比較直覺的算法
        var denom = x.startValue + x.inflow;
        x.returnPct = denom > 0 ? x.total / denom : null;
        ['startValue', 'endValue', 'buys', 'sells', 'transfers', 'realized', 'dividends', 'unrealizedChange', 'weighted'].forEach(function (f) { tot[f] += x[f]; });
        return x;
      });
      var R = function (v) { return FinMoney.round(v, dec); };
      var total = tot.unrealizedChange + tot.realized + tot.dividends;
      var denomAll = tot.startValue + tot.weighted;
      var summary = {
        from: a, to: b, startDate: v0,
        startValue: R(tot.startValue), endValue: R(tot.endValue), buys: R(tot.buys), sells: R(tot.sells), netInvest: R(tot.buys - tot.sells), transfers: R(tot.transfers),
        realized: R(tot.realized), dividends: R(tot.dividends), unrealizedChange: R(tot.unrealizedChange), total: R(total),
        returnPct: denomAll > 0 ? Math.round(total / denomAll * 10000) / 10000 : null,
      };
      if (!perSymbol) return summary;
      summary.bySymbol = list.filter(function (x) {
        return Math.abs(x.startValue) > 0.5 || Math.abs(x.endValue) > 0.5 || x.buys || x.sells || x.transfers || x.dividends || x.realized;
      }).map(function (x) {
        return {
          symbol: x.symbol, name: (instruments[x.symbol] || {}).name || x.symbol, held: x.endQty > 0,
          startValue: R(x.startValue), endValue: R(x.endValue), buys: R(x.buys), sells: R(x.sells), netInvest: R(x.buys - x.sells), transfers: R(x.transfers),
          realized: R(x.realized), dividends: R(x.dividends), unrealizedChange: R(x.unrealizedChange), total: R(x.total),
          returnPct: x.returnPct === null ? null : Math.round(x.returnPct * 10000) / 10000,
        };
      }).sort(function (p, q) { return q.total - p.total; });
      return summary;
    }

    var from = FinDates.isValid(ctx.from) ? ctx.from : dataStart;
    var to = FinDates.isValid(ctx.to) && ctx.to < today ? ctx.to : today;
    if (from < dataStart) from = dataStart;
    if (from > to) from = to;
    var main = period(from, to, true);
    var bySymbol = main.bySymbol; delete main.bySymbol;
    if (ctx.noMonths) return { base: base, today: today, dataStart: dataStart, summary: main, bySymbol: bySymbol, estimated: estimated, missing: Object.keys(missing).sort() };

    // 每月一覽：從第一個月到今天（跟上面選的期間無關，點長條可以切到那個月）
    var months = [];
    for (var ym = FinDates.ymOf(dataStart); ym <= FinDates.ymOf(today); ym = FinDates.addMonths(ym, 1)) {
      var r = FinDates.monthRange(ym);
      var a = r.from < dataStart ? dataStart : r.from, b = r.to > today ? today : r.to;
      var m = period(a, b, false);
      m.ym = ym;
      months.push(m);
    }
    return {
      base: base, today: today, dataStart: dataStart, summary: main, bySymbol: bySymbol, months: months,
      estimated: estimated, missing: Object.keys(missing).sort(),
    };
  }

  return { build: build, INVEST_TYPES: INVEST_TYPES };
})();
//#ifnode
module.exports = FinInvestReport;
//#endif
