/**
 * 收支報表規則（設計文件 7.2）：
 *  - 收入 = 「收入」交易；支出 = 「支出」交易；退款抵銷同分類的支出
 *  - 轉帳、換匯、買入、賣出、股數調整、調整 都不算收入或支出
 * 第 1 批以「目前價格」換算外幣；歷史匯率會在報表批次加入。
 */
var FinReport = (function () {
  //#ifnode
  var FinMoney = require('./money.js');
  var FinValuation = require('./valuation.js');
  //#endif

  /** 交易金額（收入用目的端、支出用來源端）換算成基準幣別；查不到價格回傳 null */
  function baseAmount(sym, qty, ctx) {
    var up = FinValuation.unitPrice(sym, ctx.instruments, ctx.prices, ctx.base || 'TWD', 0);
    return up === null ? null : qty * up;
  }

  function monthSummary(txs, ctx, ym) {
    var base = ctx.base || 'TWD';
    var dec = ctx.instruments[base] ? ctx.instruments[base].decimals : 0;
    var income = 0, expense = 0, refund = 0, byCat = {}, missing = [];
    function miss(sym) { if (missing.indexOf(sym) < 0) missing.push(sym); }
    for (var i = 0; i < txs.length; i++) {
      var t = txs[i];
      if (t.status !== '有效' || t.date.slice(0, 7) !== ym) continue;
      if (t.type === '收入') {
        var a = baseAmount(t.dstSymbol, t.dstQty, ctx);
        if (a === null) { miss(t.dstSymbol); continue; }
        income += a; byCat[t.categoryId] = (byCat[t.categoryId] || 0) + a;
      } else if (t.type === '支出') {
        var b = baseAmount(t.srcSymbol, t.srcQty, ctx);
        if (b === null) { miss(t.srcSymbol); continue; }
        expense += b; byCat[t.categoryId] = (byCat[t.categoryId] || 0) + b;
      } else if (t.type === '退款') {
        var c = baseAmount(t.dstSymbol, t.dstQty, ctx);
        if (c === null) { miss(t.dstSymbol); continue; }
        refund += c; byCat[t.categoryId] = (byCat[t.categoryId] || 0) - c;
      }
    }
    var netExpense = expense - refund;
    var cats = Object.keys(byCat).map(function (id) {
      var cat = ctx.categories[id];
      return { categoryId: id, type: cat ? cat.type : '', amount: FinMoney.round(byCat[id], dec) };
    });
    return {
      ym: ym, base: base,
      income: FinMoney.round(income, dec), expense: FinMoney.round(netExpense, dec),
      net: FinMoney.round(income - netExpense, dec), byCategory: cats, missing: missing,
    };
  }

  return { monthSummary: monthSummary };
})();
//#ifnode
module.exports = FinReport;
//#endif
