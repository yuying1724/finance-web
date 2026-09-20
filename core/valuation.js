/**
 * 估值：把（帳戶、標的、數量）換成基準幣別（預設 TWD）。
 * 標的價格以「計價幣別」表示（USD 的計價幣別是 TWD；VOO 的計價幣別是 USD），沿著計價幣別一路換算到基準幣別。
 */
var FinValuation = (function () {
  //#ifnode
  var FinMoney = require('./money.js');
  //#endif

  /** 1 單位標的 = 多少基準幣別；查不到價格回傳 null */
  function unitPrice(symbol, instruments, prices, base, depth) {
    if (symbol === base) return 1;
    depth = depth || 0;
    if (depth > 4) return null;
    var inst = instruments[symbol];
    if (!inst) return null;
    var p = Number(prices[symbol]);
    if (!(p > 0)) return null;
    var quote = inst.quote || base;
    if (quote === symbol) return null;
    var q = unitPrice(quote, instruments, prices, base, depth + 1);
    return q === null ? null : p * q;
  }

  /**
   * balanceList: [{accountId, symbol, qty}]
   * ctx: {instruments, prices, accounts(map), base}
   */
  function netWorth(balanceList, ctx) {
    var base = ctx.base || 'TWD';
    var baseDec = ctx.instruments[base] ? ctx.instruments[base].decimals : 0;
    var byAccount = {}, byType = {}, missing = [], rows = [];
    var assets = 0, liabilities = 0;
    for (var i = 0; i < balanceList.length; i++) {
      var b = balanceList[i];
      if (!b.qty) continue;
      var up = unitPrice(b.symbol, ctx.instruments, ctx.prices, base, 0);
      var value = up === null ? null : b.qty * up;
      if (value === null && missing.indexOf(b.symbol) < 0) missing.push(b.symbol);
      rows.push({ accountId: b.accountId, symbol: b.symbol, qty: b.qty, value: value });
      if (value === null) continue;
      byAccount[b.accountId] = (byAccount[b.accountId] || 0) + value;
    }
    var total = 0;
    Object.keys(byAccount).forEach(function (id) {
      var acc = ctx.accounts[id];
      var type = acc ? acc.type : '未知';
      var v = byAccount[id];
      byType[type] = (byType[type] || 0) + v;
      total += v;
      // 帳戶餘額為正算資產、為負算負債（信用卡欠款、貸款、應付、透支的存款都是負值）
      if (v < 0) liabilities += -v; else assets += v;
    });
    function r(x) { return FinMoney.round(x, baseDec); }
    Object.keys(byAccount).forEach(function (k) { byAccount[k] = r(byAccount[k]); });
    Object.keys(byType).forEach(function (k) { byType[k] = r(byType[k]); });
    return { base: base, total: r(total), assets: r(assets), liabilities: r(liabilities), byAccount: byAccount, byType: byType, missing: missing, rows: rows };
  }

  return { unitPrice: unitPrice, netWorth: netWorth };
})();
//#ifnode
module.exports = FinValuation;
//#endif
