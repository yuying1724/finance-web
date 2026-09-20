/**
 * 貸款攤還計算（設計文件 db-design.md §7、批次 3）。
 * 三種還款方式：本息平均攤還（等額本息）、本金平均攤還（等額本金）、只繳息（到期還本，中間只繳利息）。
 * 一律以整數最小單位計算利息與本金（避免浮點誤差），最後一期吸收所有捨入尾差，
 * 因此 schedule 最後一期的餘額保證剛好是 0，各期本金加總剛好等於貸款金額。
 */
var FinLoan = (function () {
  //#ifnode
  var FinMoney = require('./money.js');
  var FinDates = require('./dates.js');
  //#endif

  var METHODS = ['本息平均攤還', '本金平均攤還', '只繳息'];

  /** 第 period 期（1 起算）的還款日：起貸日所在月份 + period 個月，日數取「每月還款日」，當月不夠天數時取月底 */
  function paymentDateForPeriod(settings, period) {
    var startYm = FinDates.ymOf(settings.startDate);
    var ym = FinDates.addMonths(startYm, period);
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var day = Math.min(Number(settings.payDay) || 1, FinDates.daysInMonth(y, m));
    return FinDates.format(y, m, day);
  }

  /**
   * settings: { principal, rate(年利率，百分比數字，例如 2.5 代表 2.5%), terms(期數), startDate, payDay, method }
   * decimals: 該貸款幣別的小數位數（預設 0，例如 TWD）
   * 回傳 [{period, date, payment, principal, interest, balance}]（皆為自然單位數字）
   */
  function schedule(settings, decimals) {
    decimals = decimals === undefined || decimals === null ? 0 : decimals;
    var n = Math.max(1, Math.floor(Number(settings.terms) || 0));
    var method = settings.method;
    var rate = Number(settings.rate) || 0;
    var monthlyRate = rate / 100 / 12;
    var balanceUnits = FinMoney.toUnits(settings.principal, decimals);

    var levelPaymentUnits = 0; // 本息平均攤還：每期固定還款金額（最後一期仍可能因捨入微調）
    var levelPrincipalUnits = 0; // 本金平均攤還：每期固定本金（最後一期吸收尾差）
    if (method === '本息平均攤還') {
      var paymentNatural;
      if (monthlyRate === 0) paymentNatural = settings.principal / n;
      else paymentNatural = (settings.principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
      levelPaymentUnits = FinMoney.toUnits(paymentNatural, decimals);
    } else if (method === '本金平均攤還') {
      levelPrincipalUnits = Math.floor(balanceUnits / n);
    }

    var rows = [];
    for (var i = 1; i <= n; i++) {
      var isLast = i === n;
      var interestUnits = monthlyRate === 0 ? 0 : FinMoney.toUnits(FinMoney.fromUnits(balanceUnits, decimals) * monthlyRate, decimals);
      var principalUnits;
      if (method === '只繳息') {
        principalUnits = isLast ? balanceUnits : 0;
      } else if (method === '本金平均攤還') {
        principalUnits = isLast ? balanceUnits : levelPrincipalUnits;
      } else { // 本息平均攤還
        principalUnits = isLast ? balanceUnits : (levelPaymentUnits - interestUnits);
        if (principalUnits < 0) principalUnits = 0; // 極端輸入（利率過高）的保底，不應發生於合理資料
        if (principalUnits > balanceUnits) principalUnits = balanceUnits;
      }
      var paymentUnits = principalUnits + interestUnits;
      balanceUnits -= principalUnits;
      rows.push({
        period: i,
        date: paymentDateForPeriod(settings, i),
        payment: FinMoney.fromUnits(paymentUnits, decimals),
        principal: FinMoney.fromUnits(principalUnits, decimals),
        interest: FinMoney.fromUnits(interestUnits, decimals),
        balance: FinMoney.fromUnits(balanceUnits, decimals),
      });
    }
    return rows;
  }

  /** 依日期找「目前應繳（尚未繳清）」的那一期：第一期還款日 >= asOfDate 的那一列；全部都已過期就回傳 null（已繳清） */
  function findPeriod(sched, asOfDate) {
    for (var i = 0; i < sched.length; i++) if (sched[i].date >= asOfDate) return sched[i];
    return null;
  }

  /** 摘要：目前應繳期別、已繳期數、剩餘本金、下一次繳款日與金額 */
  function summarize(sched, asOfDate) {
    var current = findPeriod(sched, asOfDate);
    var paidCount = sched.filter(function (r) { return r.date < asOfDate; }).length;
    var totalInterest = sched.reduce(function (s, r) { return s + r.interest; }, 0);
    var last = sched[sched.length - 1];
    return {
      terms: sched.length, paidCount: paidCount, settled: current === null,
      currentPeriod: current, remainingBalance: current ? (current.balance + current.principal) : 0,
      totalInterest: totalInterest, finalDate: last ? last.date : null,
    };
  }

  return { METHODS: METHODS, schedule: schedule, findPeriod: findPeriod, summarize: summarize, paymentDateForPeriod: paymentDateForPeriod };
})();
//#ifnode
module.exports = FinLoan;
//#endif
