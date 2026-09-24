/**
 * 兩端分錄式帳本：每筆交易有「來源」與「目的」兩端（帳戶、標的、數量），任一端可為空。
 * 餘額 = Σ目的 − Σ來源，全部用整數最小單位計算。只有狀態為「有效」的交易計入。
 * 每一端算入的日期：現金（法幣）用交割日（沒填就用日期），其他標的（股票等）用日期（成交日）。
 */
var FinLedger = (function () {
  //#ifnode
  var FinMoney = require('./money.js');
  //#endif

  function legDate(tx, inst) {
    return inst && inst.type === '法幣' ? (tx.settleDate || tx.date) : tx.date;
  }

  /** 回傳 {units: {'帳戶|標的': 整數單位}, issues: [...]}；asOf 含當天，省略代表全部 */
  function computeBalances(txs, instruments, opts) {
    opts = opts || {};
    var asOf = opts.asOf || null;
    var units = {}, issues = [];
    function apply(tx, acct, sym, qty, sign) {
      if (!acct || !sym || qty === null || qty === undefined || qty === '') return;
      var inst = instruments[sym];
      if (!inst) { issues.push({ txId: tx.id, message: '找不到標的：' + sym }); return; }
      if (asOf && legDate(tx, inst) > asOf) return;
      var key = acct + '|' + sym;
      try {
        units[key] = (units[key] || 0) + sign * FinMoney.toUnits(qty, inst.decimals);
      } catch (e) {
        issues.push({ txId: tx.id, message: '數量無法計算：' + e.message });
      }
    }
    for (var i = 0; i < txs.length; i++) {
      var tx = txs[i];
      if (tx.status !== '有效') continue;
      apply(tx, tx.srcAccount, tx.srcSymbol, tx.srcQty, -1);
      apply(tx, tx.dstAccount, tx.dstSymbol, tx.dstQty, +1);
    }
    return { units: units, issues: issues };
  }

  /** 整數單位 → [{accountId, symbol, qty(自然單位), units}]，排除 0 */
  function balanceList(units, instruments) {
    var out = [];
    Object.keys(units).forEach(function (key) {
      if (!units[key]) return;
      var p = key.split('|');
      var inst = instruments[p[1]];
      out.push({ accountId: p[0], symbol: p[1], units: units[key], qty: FinMoney.fromUnits(units[key], inst ? inst.decimals : 0) });
    });
    out.sort(function (a, b) { return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : a.symbol < b.symbol ? -1 : 1; });
    return out;
  }

  /** 對帳用：輸入實際餘額，算出要補的差額。回傳 {side:'dst'|'src'|null, qty} */
  function adjustmentFor(currentUnits, targetAmount, decimals) {
    var target = FinMoney.toUnits(targetAmount, decimals);
    var diff = target - (currentUnits || 0);
    if (diff === 0) return { side: null, qty: 0 };
    return { side: diff > 0 ? 'dst' : 'src', qty: FinMoney.fromUnits(Math.abs(diff), decimals) };
  }

  /** 交易清單篩選 + 排序（日期新到舊，同日依 ID 新到舊） */
  function filterTransactions(txs, f, lookups) {
    f = f || {}; lookups = lookups || {};
    var accounts = lookups.accounts || {}, categories = lookups.categories || {};
    var q = f.q ? String(f.q).trim().toLowerCase() : '';
    var out = txs.filter(function (t) {
      if (f.status ? t.status !== f.status : false) return false;
      if (!f.status && !f.includeVoid && t.status !== '有效' && t.status !== '待確認') return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.type && t.type !== f.type) return false;
      if (f.tag && (',' + (t.tags || '') + ',').indexOf(',' + f.tag + ',') < 0) return false;
      if (f.merchant && t.merchant !== f.merchant) return false;
      if (f.accountId && t.srcAccount !== f.accountId && t.dstAccount !== f.accountId) return false;
      if (f.categoryId) {
        var cat = categories[t.categoryId];
        if (t.categoryId !== f.categoryId && !(cat && cat.parentId === f.categoryId)) return false;
      }
      if (q) {
        var hay = [t.note, t.id, t.merchant, t.tags, (categories[t.categoryId] || {}).name,
          (accounts[t.srcAccount] || {}).name, (accounts[t.dstAccount] || {}).name].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    return out;
  }

  /** 待交割款（設計文件 7.4）：成交日 <= asOf < 現金腿的交割日，這段期間的現金還沒真的進出，回傳 [{accountId,symbol,qty}]（買入為負待付、賣出為正待收） */
  function pendingSettlement(txs, instruments, asOf) {
    var out = {};
    function apply(tx, acct, sym, qty, sign) {
      if (!acct || !sym || qty === null || qty === undefined || qty === '') return;
      var inst = instruments[sym];
      if (!inst || inst.type !== '法幣') return;
      var ld = legDate(tx, inst);
      if (tx.date <= asOf && ld > asOf) {
        var key = acct + '|' + sym;
        out[key] = (out[key] || 0) + sign * qty;
      }
    }
    for (var i = 0; i < txs.length; i++) {
      var tx = txs[i];
      if (tx.status !== '有效') continue;
      apply(tx, tx.srcAccount, tx.srcSymbol, tx.srcQty, -1);
      apply(tx, tx.dstAccount, tx.dstSymbol, tx.dstQty, +1);
    }
    var list = [];
    Object.keys(out).forEach(function (k) {
      if (!out[k]) return;
      var p = k.split('|');
      list.push({ accountId: p[0], symbol: p[1], qty: out[k] });
    });
    list.sort(function (a, b) { return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : (a.symbol < b.symbol ? -1 : 1); });
    return list;
  }

  return { computeBalances: computeBalances, balanceList: balanceList, adjustmentFor: adjustmentFor, filterTransactions: filterTransactions, legDate: legDate, pendingSettlement: pendingSettlement };
})();
//#ifnode
module.exports = FinLedger;
//#endif
