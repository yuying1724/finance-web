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

  /** 某帳戶（或同額度群組多張卡，cardAccountIds 可傳陣列）、某標的，從交易列表算出「截至 asOfDate」的餘額（整數單位） */
  function balanceUnitsAsOf(txs, cardAccountIds, symbol, decimals, asOfDate) {
    var idSet = toIdSet(cardAccountIds);
    var units = 0;
    for (var i = 0; i < txs.length; i++) {
      var t = txs[i];
      if (t.status !== '有效' || t.date > asOfDate) continue;
      if (idSet[t.srcAccount] && t.srcSymbol === symbol && t.srcQty !== null && t.srcQty !== undefined && t.srcQty !== '') {
        units -= FinMoney.toUnits(t.srcQty, decimals);
      }
      if (idSet[t.dstAccount] && t.dstSymbol === symbol && t.dstQty !== null && t.dstQty !== undefined && t.dstQty !== '') {
        units += FinMoney.toUnits(t.dstQty, decimals);
      }
    }
    return units;
  }

  function toIdSet(cardAccountIds) {
    var ids = Array.isArray(cardAccountIds) ? cardAccountIds : [cardAccountIds];
    var set = {};
    ids.forEach(function (id) { set[id] = true; });
    return set;
  }

  /** 某區間內：以這張卡（或同額度群組多張卡，cardAccountIds 可傳陣列）為來源的「支出」總額，扣掉退回的「退款」（不含還款轉帳，還款不算這期的消費） */
  function periodSpend(txs, cardAccountIds, symbol, decimals, period, excludeTxIds) {
    var idSet = toIdSet(cardAccountIds);
    var spendUnits = 0, refundUnits = 0;
    for (var i = 0; i < txs.length; i++) {
      var t = txs[i];
      if (t.status !== '有效' || t.date < period.start || t.date > period.end) continue;
      if (excludeTxIds && excludeTxIds[t.id]) continue; // 分期的原始消費：本期消費只算當期那一份（另外加）
      if (t.type === '支出' && idSet[t.srcAccount] && t.srcSymbol === symbol && t.srcQty !== null) spendUnits += FinMoney.toUnits(t.srcQty, decimals);
      else if (t.type === '退款' && idSet[t.dstAccount] && t.dstSymbol === symbol && t.dstQty !== null) refundUnits += FinMoney.toUnits(t.dstQty, decimals);
    }
    return FinMoney.fromUnits(spendUnits - refundUnits, decimals);
  }

  // ---------- 分期（零利率） ----------
  /**
   * 把一筆分期展開成每期：{ accountId, symbol, txId, total, terms, periods: [{ n, amount, closeDate }] }
   * inst: 分期列 { id, txId, terms, remainderOn('首期'|'末期'), payoffDate }；tx: 對應的「支出」交易（金額、日期、卡片以它為準）
   * 第 1 期落在刷卡日所在週期的結帳日，之後每個結帳日一期；除不盡的零頭預設放第 1 期。
   * 提前清償：清償日所在週期之後的各期，全部改到清償日所在週期的結帳日。回傳 null 表示不成立（交易不存在／作廢／不是支出）。
   */
  function expandInstallment(inst, tx, statementDay, decimals) {
    if (!inst || !tx || tx.status !== '有效' || tx.type !== '支出' || !tx.srcAccount || !(Number(tx.srcQty) > 0)) return null;
    var terms = Math.max(1, Math.floor(Number(inst.terms) || 1));
    var totalUnits = FinMoney.toUnits(tx.srcQty, decimals);
    var base = Math.floor(totalUnits / terms), rem = totalUnits - base * terms;
    var close = periodContaining(statementDay, tx.date).end;
    var payoffClose = inst.payoffDate ? periodContaining(statementDay, inst.payoffDate < tx.date ? tx.date : inst.payoffDate).end : null;
    var periods = [];
    for (var n = 1; n <= terms; n++) {
      var u = base + ((inst.remainderOn === '末期' ? n === terms : n === 1) ? rem : 0);
      var cd = payoffClose && close > payoffClose ? payoffClose : close;
      periods.push({ n: n, amount: FinMoney.fromUnits(u, decimals), units: u, closeDate: cd });
      close = nextStatementEnd(statementDay, close);
    }
    return { id: inst.id, accountId: tx.srcAccount, symbol: tx.srcSymbol, txId: tx.id, total: FinMoney.fromUnits(totalUnits, decimals), terms: terms, periods: periods, paidOff: !!inst.payoffDate };
  }

  /** 截至某個結帳日（含）還沒出帳的分期金額（整數單位）：closeDate 晚於 date 的各期 */
  function unbilledUnitsAt(schedules, idSet, symbol, date) {
    var u = 0;
    (schedules || []).forEach(function (s) {
      if (!idSet[s.accountId] || s.symbol !== symbol) return;
      s.periods.forEach(function (p) { if (p.closeDate > date) u += p.units; });
    });
    return u;
  }

  /**
   * cardSettings: { statementDay, dueDay, limit }
   * txs: 全部交易（函式內部依日期與帳戶篩選）；symbol/decimals：這張卡記帳用的幣別與其小數位數
   * asOfDate: 'yyyy-MM-dd'，通常是今天
   * groupAccountIds（選填）：同一「額度群組」所有卡片的帳戶ID陣列（含 cardAccountId 自己），長度 > 1 才視為有群組。
   * 台灣的信用卡實務上，共用額度的多張卡通常是銀行合併成一張帳單寄出（同一結帳日／繳款日、一個總金額），
   * 所以傳入 groupAccountIds 時，本期消費／上期帳單待繳／目前總欠款／可用額度全部都是「整個群組加總」的結果，
   * 不是只看 cardAccountId 這張卡自己的交易；cardSettings（結帳日／繳款日／額度）則沿用呼叫端傳入的這一份
   * （假設同群組卡片的結帳日／繳款日／額度本來就該一致，呼叫端另外用 groupDateMismatch／groupLimitMismatch 標記不一致的情況）。
   * 沒有傳 groupAccountIds（或只有 1 個 id）時，行為等同單張卡，不受影響。
   */
  function summary(txs, cardAccountId, symbol, decimals, cardSettings, asOfDate, groupAccountIds, installmentSchedules) {
    var ids = (groupAccountIds && groupAccountIds.length > 1) ? groupAccountIds : [cardAccountId];
    var hasGroup = ids.length > 1;
    var idSetAll = toIdSet(ids);
    // 這張卡（或同群組）的分期：原始消費記全額（影響欠款、可用額度），但帳單只算已輪到的各期
    var sched = (installmentSchedules || []).filter(function (s) { return idSetAll[s.accountId] && s.symbol === symbol; });
    var instTxIds = {};
    sched.forEach(function (s) { instTxIds[s.txId] = true; });

    var current = periodContaining(cardSettings.statementDay, asOfDate);
    var currentSpend = periodSpend(txs, ids, symbol, decimals, { start: current.start, end: asOfDate }, instTxIds);
    var currentInstUnits = 0;
    sched.forEach(function (s) { s.periods.forEach(function (p) { if (p.closeDate === current.end) currentInstUnits += p.units; }); });
    if (currentInstUnits) currentSpend = FinMoney.fromUnits(FinMoney.toUnits(currentSpend, decimals) + currentInstUnits, decimals);
    var lastClosedEnd = prevStatementEnd(cardSettings.statementDay, current.end);
    var lastClosedStart = FinDates.addDays(prevStatementEnd(cardSettings.statementDay, lastClosedEnd), 1);
    var lastClosed = { start: lastClosedStart, end: lastClosedEnd };

    var dueDate = dueDateFor(cardSettings.dueDay, lastClosed.end);
    var balanceAtCloseUnits = balanceUnitsAsOf(txs, ids, symbol, decimals, lastClosed.end) + unbilledUnitsAt(sched, idSetAll, symbol, lastClosed.end);
    var debtAtCloseUnits = balanceAtCloseUnits < 0 ? -balanceAtCloseUnits : 0;
    // 結帳之後、今天之前，任何轉入這張卡（或同群組任一張卡）的金額（還款、退款…）都算已經繳掉這期帳單，扣掉之後才是這期還欠多少
    var idSet = toIdSet(ids);
    var creditsAfterCloseUnits = 0;
    for (var ci = 0; ci < txs.length; ci++) {
      var ct = txs[ci];
      if (ct.status !== '有效' || ct.date <= lastClosed.end || ct.date > asOfDate) continue;
      if (idSet[ct.dstAccount] && ct.dstSymbol === symbol && ct.dstQty !== null && ct.dstQty !== undefined && ct.dstQty !== '') {
        creditsAfterCloseUnits += FinMoney.toUnits(ct.dstQty, decimals);
      }
    }
    var statementDueUnits = Math.max(0, debtAtCloseUnits - creditsAfterCloseUnits);
    var statementAmountDue = FinMoney.fromUnits(statementDueUnits, decimals);

    var balanceTodayUnits = balanceUnitsAsOf(txs, ids, symbol, decimals, asOfDate);
    var currentlyOwed = balanceTodayUnits < 0 ? FinMoney.fromUnits(-balanceTodayUnits, decimals) : 0;

    var limit = Number(cardSettings.limit) || 0;
    var availableCredit = limit > 0 ? FinMoney.round(Math.max(0, limit - currentlyOwed), decimals) : null;

    return {
      currentPeriod: current, currentSpend: currentSpend,
      lastClosedPeriod: lastClosed, statementAmountDue: statementAmountDue, dueDate: dueDate,
      currentlyOwed: currentlyOwed, overdue: statementAmountDue > 0 && asOfDate > dueDate,
      limit: limit || null, availableCredit: availableCredit,
      sharedLimit: hasGroup, groupSize: hasGroup ? ids.length : null,
      // 分期：之後各期（不含本期）還沒出帳的金額；目前總欠款與可用額度已經含全額
      installmentRemaining: FinMoney.fromUnits(unbilledUnitsAt(sched, idSetAll, symbol, current.end), decimals),
      installmentCount: sched.filter(function (s) { return s.periods.some(function (p) { return p.closeDate >= current.end; }); }).length,
    };
  }

  return {
    periodContaining: periodContaining, dueDateFor: dueDateFor, periodSpend: periodSpend, expandInstallment: expandInstallment, unbilledUnitsAt: unbilledUnitsAt,
    balanceUnitsAsOf: balanceUnitsAsOf, summary: summary,
    prevStatementEnd: prevStatementEnd, nextStatementEnd: nextStatementEnd, statementDateIn: statementDateIn,
  };
})();
//#ifnode
module.exports = FinCreditCard;
//#endif
