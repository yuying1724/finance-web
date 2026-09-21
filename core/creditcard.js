/**
 * 信用卡帳單計算（設計文件 db-design.md §7：「依結帳日切分區間，累計該區間內以該卡為來源的支出，並扣掉退款與還款；
 * 繳款日前顯示待繳金額」）。假設一張信用卡只用一種幣別（帳戶的「預設幣別」）記帳。
 * 一律以整數最小單位計算，避免浮點誤差。
 */
var FinCreditCard = (function () {
  //#ifnode
  var FinMoney = require('./money.js');
  var FinDates = require('./dates.js');
  //#endif

  function clampDay(y, m, day) { return Math.min(Math.max(1, Number(day) || 1), FinDates.daysInMonth(y, m)); }

  /** 某个「結帳日」在某個 yyyy-MM 當月對應的實際日期（超過當月天數時取月底） */
  function statementDateIn(ym, statementDay) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return FinDates.format(y, m, clampDay(y, m, statementDay));
  }

  /** 給定某個結帳日 end，回傳「上一個」結帳日（end 所在月往前一個月的結帳日） */
  function prevStatementEnd(statementDay, end) {
    return statementDateIn(FinDates.addMonths(FinDates.ymOf(end), -1), statementDay);
  }
  /** 給定某個結帳日 end，回傳「下一個」結帳日 */
  function nextStatementEnd(statementDay, end) {
    return statementDateIn(FinDates.addMonths(FinDates.ymOf(end), 1), statementDay);
  }

  /** 含 refDate 的結帳區間 {start, end}：end 是這個週期的結帳日（含當天），start 是上一個結帳日隔天 */
  function periodContaining(statementDay, refDate) {
    var end = statementDateIn(FinDates.ymOf(refDate), statementDay);
    if (refDate > end) end = nextStatementEnd(statementDay, end);
    var start = FinDates.addDays(prevStatementEnd(statementDay, end), 1);
    return { start: start, end: end };
  }

  /** 繳款截止日：結帳日之後最近一個「繳款日」（同月來不及就順延到下個月） */
  function dueDateFor(dueDay, periodEnd) {
    var d = statementDateIn(FinDates.ymOf(periodEnd), dueDay);
    if (d <= periodEnd) d = statementDateIn(FinDates.addMonths(FinDates.ymOf(periodEnd), 1), dueDay);
    return d;
  }

  /** 某帳戶、某標的，從交易列表算出「截至 asOfDate」的餘額（整數單位）；只看兩端是這張卡本身的部分 */
  function balanceUnitsAsOf(txs, cardAccountId, symbol, decimals, asOfDate) {
    var units = 0;
    for (var i = 0; i < txs.length; i++) {
      var t = txs[i];
      if (t.status !== '有效' || t.date > asOfDate) continue;
      if (t.srcAccount === cardAccountId && t.srcSymbol === symbol && t.srcQty !== null && t.srcQty !== undefined && t.srcQty !== '') {
        units -= FinMoney.toUnits(t.srcQty, decimals);
      }
      if (t.dstAccount === cardAccountId && t.dstSymbol === symbol && t.dstQty !== null && t.dstQty !== undefined && t.dstQty !== '') {
        units += FinMoney.toUnits(t.dstQty, decimals);
      }
    }
    return units;
  }

  /** 某區間內：以該卡為來源的「支出」總額，扣掉退回這張卡的「退款」（不含還款轉帳，還款不算這期的消費） */
  function periodSpend(txs, cardAccountId, symbol, decimals, period) {
    var spendUnits = 0, refundUnits = 0;
    for (var i = 0; i < txs.length; i++) {
      var t = txs[i];
      if (t.status !== '有效' || t.date < period.start || t.date > period.end) continue;
      if (t.type === '支出' && t.srcAccount === cardAccountId && t.srcSymbol === symbol && t.srcQty !== null) spendUnits += FinMoney.toUnits(t.srcQty, decimals);
      else if (t.type === '退款' && t.dstAccount === cardAccountId && t.dstSymbol === symbol && t.dstQty !== null) refundUnits += FinMoney.toUnits(t.dstQty, decimals);
    }
    return FinMoney.fromUnits(spendUnits - refundUnits, decimals);
  }

  /**
   * cardSettings: { statementDay, dueDay, limit }
   * txs: 全部交易（函式內部依日期與帳戶篩選）；symbol/decimals：這張卡記帳用的幣別與其小數位數
   * asOfDate: 'yyyy-MM-dd'，通常是今天
   * group（選填）：{ limit, owed }，皆為「顯示單位」的數字（不是最小單位）。同一「額度群組」的好幾張卡共用一個額度時，
   * 呼叫端先算好這個群組每張卡各自的 currentlyOwed 並加總成 owed，limit 則是這個群組共用的總額度；
   * 傳入後「可用額度」會改成 group.limit − group.owed（而不是這張卡自己的 limit − currentlyOwed），
   * 但「本期消費」「上期帳單待繳」等其他欄位維持只看這張卡自己的交易，不受影響。
   */
  function summary(txs, cardAccountId, symbol, decimals, cardSettings, asOfDate, group) {
    var current = periodContaining(cardSettings.statementDay, asOfDate);
    var currentSpend = periodSpend(txs, cardAccountId, symbol, decimals, { start: current.start, end: asOfDate });
    var lastClosedEnd = prevStatementEnd(cardSettings.statementDay, current.end);
    var lastClosedStart = FinDates.addDays(prevStatementEnd(cardSettings.statementDay, lastClosedEnd), 1);
    var lastClosed = { start: lastClosedStart, end: lastClosedEnd };

    var dueDate = dueDateFor(cardSettings.dueDay, lastClosed.end);
    var balanceAtCloseUnits = balanceUnitsAsOf(txs, cardAccountId, symbol, decimals, lastClosed.end);
    var debtAtCloseUnits = balanceAtCloseUnits < 0 ? -balanceAtCloseUnits : 0;
    // 結帳之後、今天之前，任何轉入這張卡的金額（還款、退款…）都算已經繳掉這期帳單，扣掉之後才是這期還欠多少
    var creditsAfterCloseUnits = 0;
    for (var ci = 0; ci < txs.length; ci++) {
      var ct = txs[ci];
      if (ct.status !== '有效' || ct.date <= lastClosed.end || ct.date > asOfDate) continue;
      if (ct.dstAccount === cardAccountId && ct.dstSymbol === symbol && ct.dstQty !== null && ct.dstQty !== undefined && ct.dstQty !== '') {
        creditsAfterCloseUnits += FinMoney.toUnits(ct.dstQty, decimals);
      }
    }
    var statementDueUnits = Math.max(0, debtAtCloseUnits - creditsAfterCloseUnits);
    var statementAmountDue = FinMoney.fromUnits(statementDueUnits, decimals);

    var balanceTodayUnits = balanceUnitsAsOf(txs, cardAccountId, symbol, decimals, asOfDate);
    var currentlyOwed = balanceTodayUnits < 0 ? FinMoney.fromUnits(-balanceTodayUnits, decimals) : 0;

    var limit = Number(cardSettings.limit) || 0;
    var hasGroup = !!(group && Number(group.limit) > 0);
    var effLimit = hasGroup ? Number(group.limit) : limit;
    var effOwed = hasGroup ? Number(group.owed) || 0 : currentlyOwed;
    var availableCredit = effLimit > 0 ? FinMoney.round(Math.max(0, effLimit - effOwed), decimals) : null;

    return {
      currentPeriod: current, currentSpend: currentSpend,
      lastClosedPeriod: lastClosed, statementAmountDue: statementAmountDue, dueDate: dueDate,
      currentlyOwed: currentlyOwed, overdue: statementAmountDue > 0 && asOfDate > dueDate,
      limit: limit || null, availableCredit: availableCredit,
      sharedLimit: hasGroup, groupLimit: hasGroup ? effLimit : null, groupOwed: hasGroup ? effOwed : null,
    };
  }

  return {
    periodContaining: periodContaining, dueDateFor: dueDateFor, periodSpend: periodSpend,
    balanceUnitsAsOf: balanceUnitsAsOf, summary: summary,
    prevStatementEnd: prevStatementEnd, nextStatementEnd: nextStatementEnd, statementDateIn: statementDateIn,
  };
})();
//#ifnode
module.exports = FinCreditCard;
//#endif
