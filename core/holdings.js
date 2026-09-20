/**
 * 投資持倉／成本／損益（設計文件 db-design.md §7、§7.3）。平均成本法。
 * 每個持倉（帳戶 × 標的）同時記錄：qty（股數）、costNative（計價幣別成本，例如 VOO 記 USD）、costBase（基準幣別／台幣成本，取自實際進出的台幣）。
 * 買入：qty += 目的數量；costNative += 成交金額+手續費+稅款；costBase += 來源那筆現金換算成基準幣別的金額（來源本來就是 TWD 時直接用，否則用成交當日的歷史價格估算，並標記 estimated）。
 * 賣出：依「賣出股數 / 持有股數」比例扣除兩種成本；已實現損益 = 淨收入(成交金額-手續費-稅款/入帳金額) − 被扣除的成本。
 * 股息：目的標的若與持倉標的相同（配股）→ 只加股數、成本不變；否則是現金股息，只記录收入，不影響持倉成本。
 * 股數調整：只改股數（拆股／併股／標的更名），總成本不變。
 */
var FinHoldings = (function () {
  //#ifnode
  var FinValuation = require('./valuation.js');
  //#endif

  var HOLDING_TYPES = ['買入', '賣出', '股息', '股數調整'];

  function key(acct, sym) { return acct + '|' + sym; }

  /**
   * txs: 交易陣列（含所有類型，函式內部會篩選）
   * instruments: {symbol: {type, quote, decimals, ...}}
   * ctx: { base, asOf(選填，含當天), priceHistory(選填) {'yyyy-MM-dd|symbol': 該日收盤價（該標的計價幣別對基準幣別，僅用於非基準幣別現金直接購買外幣標的時估算台幣成本）}
   * }
   * 回傳 { positions: [{accountId,symbol,qty,costNative,costBase,estimated}], realized: [...], dividends: [...], issues: [...] }
   */
  function computeHoldings(txs, instruments, ctx) {
    ctx = ctx || {};
    var base = ctx.base || 'TWD';
    var asOf = ctx.asOf || null;
    var priceHistory = ctx.priceHistory || {};
    var pos = {}, realized = [], dividends = [], issues = [];

    function get(acct, sym) {
      var k = key(acct, sym);
      if (!pos[k]) pos[k] = { accountId: acct, symbol: sym, qty: 0, costNative: 0, costBase: 0, estimated: false };
      return pos[k];
    }

    /** 某個非基準幣別的現金標的，在某天值多少基準幣別；優先用當時的歷史收盤價，找不到就退回目前價格（並標記為估算） */
    function baseValueOfCash(sym, qty, date) {
      if (sym === base) return { value: qty, estimated: false };
      var hp = priceHistory[date + '|' + sym];
      if (hp && hp > 0) return { value: qty * hp, estimated: false };
      var up = FinValuation.unitPrice(sym, instruments, ctx.prices || {}, base, 0);
      if (up !== null) return { value: qty * up, estimated: true };
      return { value: null, estimated: true };
    }

    var relevant = txs.filter(function (t) {
      if (t.status !== '有效') return false;
      if (HOLDING_TYPES.indexOf(t.type) < 0) return false;
      if (asOf && t.date > asOf) return false;
      return true;
    }).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });

    relevant.forEach(function (t) {
      if (t.type === '買入') {
        var p = get(t.dstAccount, t.dstSymbol);
        p.qty += t.dstQty;
        p.costNative += (t.amount || 0) + (t.fee || 0) + (t.tax || 0);
        var bv = baseValueOfCash(t.srcSymbol, t.srcQty, t.date);
        if (bv.value === null) { issues.push({ txId: t.id, message: '找不到 ' + t.date + ' ' + t.srcSymbol + ' 的歷史價格，無法估算台幣成本' }); }
        else { p.costBase += bv.value; if (bv.estimated) p.estimated = true; }
      } else if (t.type === '賣出') {
        var p2 = get(t.srcAccount, t.srcSymbol);
        if (t.srcQty > p2.qty + 1e-9) { issues.push({ txId: t.id, message: '賣出數量超過持有量（' + t.srcSymbol + '）' }); }
        var frac = p2.qty > 0 ? Math.min(t.srcQty / p2.qty, 1) : 0;
        var rmNative = p2.costNative * frac, rmBase = p2.costBase * frac;
        var netNative = (t.amount || 0) - (t.fee || 0) - (t.tax || 0);
        var bv2 = baseValueOfCash(t.dstSymbol, t.dstQty, t.date);
        var realizedBase = bv2.value === null ? null : (bv2.value - rmBase);
        if (bv2.value === null) issues.push({ txId: t.id, message: '找不到 ' + t.date + ' ' + t.dstSymbol + ' 的歷史價格，無法估算已實現台幣損益' });
        realized.push({
          txId: t.id, date: t.date, accountId: t.srcAccount, symbol: t.srcSymbol, qty: t.srcQty,
          quote: (instruments[t.srcSymbol] || {}).quote || base,
          realizedNative: netNative - rmNative, realizedBase: realizedBase,
          removedNative: rmNative, removedBase: rmBase, estimated: bv2.estimated || p2.estimated,
        });
        p2.qty -= t.srcQty; p2.costNative -= rmNative; p2.costBase -= rmBase;
        if (Math.abs(p2.qty) < 1e-9) p2.qty = 0;
      } else if (t.type === '股息') {
        var isShareDividend = t.dstSymbol && instruments[t.dstSymbol] && instruments[t.dstSymbol].type !== '法幣';
        if (isShareDividend) {
          var p3 = get(t.dstAccount, t.dstSymbol);
          p3.qty += t.dstQty; // 配股：成本不變
        } else {
          dividends.push({
            txId: t.id, date: t.date, accountId: t.dstAccount, symbol: t.dstSymbol, relatedSymbol: t.relatedSymbol,
            gross: t.amount || 0, tax: t.tax || 0, fee: t.fee || 0, net: t.dstQty,
          });
        }
      } else if (t.type === '股數調整') {
        if (t.dstAccount && t.dstSymbol && t.dstQty !== null) {
          get(t.dstAccount, t.dstSymbol).qty += t.dstQty;
        } else if (t.srcAccount && t.srcSymbol && t.srcQty !== null) {
          var p4 = get(t.srcAccount, t.srcSymbol);
          p4.qty -= t.srcQty;
          if (Math.abs(p4.qty) < 1e-9) p4.qty = 0;
          if (p4.qty < 0) issues.push({ txId: t.id, message: '股數調整後變成負數（' + t.srcSymbol + '）' });
        }
      }
    });

    var positions = Object.keys(pos).map(function (k) { return pos[k]; }).filter(function (p) { return Math.abs(p.qty) > 1e-9 || Math.abs(p.costNative) > 1e-9; });
    positions.sort(function (a, b) { return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : (a.symbol < b.symbol ? -1 : 1); });
    return { positions: positions, realized: realized, dividends: dividends, issues: issues };
  }

  /**
   * 未實現損益。priceNative：標的現價（計價幣別）；fxNow：計價幣別 → 基準幣別 的匯率（1 單位計價幣別 = 多少基準幣別）。
   * 回傳 { mvNative, mvBase, totalBase, pricePl, fxPl, fxAvg }；fxPl 恆為 0（同幣別，例如台股對台幣）。
   */
  function unrealized(position, priceNative, fxNow) {
    var mvNative = position.qty * priceNative;
    var mvBase = mvNative * fxNow;
    var totalBase = mvBase - position.costBase;
    var fxAvg = position.costNative ? (position.costBase / position.costNative) : fxNow;
    var pricePl = (mvNative - position.costNative) * fxNow;
    var fxPl = position.costNative * (fxNow - fxAvg);
    return { mvNative: mvNative, mvBase: mvBase, totalBase: totalBase, pricePl: pricePl, fxPl: fxPl, fxAvg: fxAvg };
  }

  /** 一次算好所有持倉的現價市值與損益，需要 instruments/prices 來查現價與匯率 */
  function valuePositions(positions, instruments, prices, base) {
    return positions.map(function (p) {
      var inst = instruments[p.symbol];
      var quote = inst ? (inst.quote || base) : base;
      var priceNative = Number(prices[p.symbol]);
      var fxNow = quote === base ? 1 : FinValuation.unitPrice(quote, instruments, prices, base, 0);
      if (!(priceNative > 0) || fxNow === null) {
        return { accountId: p.accountId, symbol: p.symbol, qty: p.qty, costNative: p.costNative, costBase: p.costBase, estimated: p.estimated, missing: true };
      }
      var u = unrealized(p, priceNative, fxNow);
      return {
        accountId: p.accountId, symbol: p.symbol, qty: p.qty, costNative: p.costNative, costBase: p.costBase, estimated: p.estimated,
        quote: quote, priceNative: priceNative, fxNow: fxNow, mvNative: u.mvNative, mvBase: u.mvBase,
        totalBase: u.totalBase, pricePl: u.pricePl, fxPl: u.fxPl, fxAvg: u.fxAvg, missing: false,
      };
    });
  }

  return { computeHoldings: computeHoldings, unrealized: unrealized, valuePositions: valuePositions, HOLDING_TYPES: HOLDING_TYPES };
})();
//#ifnode
module.exports = FinHoldings;
//#endif
