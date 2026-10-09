/* 自動產生自 core/money.js，請勿直接編輯 */
/**
 * 金額精度：Sheet 存自然單位（USD 100.25），計算時先轉成「整數最小單位」再加減，
 * 避免浮點誤差（0.1 + 0.2 = 0.3）。四捨五入一律「四捨五入到最近，正好一半時進位（遠離 0）」。
 */
var FinMoney = (function () {
  function toUnits(amount, decimals) {
    var n = Number(amount);
    if (amount === null || amount === '' || amount === undefined || !isFinite(n)) throw new Error('金額不是有效數字');
    var neg = n < 0;
    // 用字串移動小數點，避免 1.005 * 100 = 100.49999999999999 這類問題
    var s = Math.abs(n).toFixed(Math.max(decimals + 4, 10));
    var dot = s.indexOf('.');
    var ip = s.slice(0, dot);
    var fp = s.slice(dot + 1);
    var u = Number(ip + fp.slice(0, decimals));
    if (fp.charAt(decimals) >= '5') u += 1;
    if (!Number.isSafeInteger(u)) throw new Error('金額過大');
    return u === 0 ? 0 : (neg ? -u : u);
  }

  function fromUnits(units, decimals) {
    return units / Math.pow(10, decimals);
  }

  /** 金額的小數位數是否在標的允許範圍內（例如 TWD 不能有小數） */
  function fitsDecimals(amount, decimals) {
    var n = Number(amount);
    if (!isFinite(n)) return false;
    var s = Math.abs(n).toFixed(decimals + 4);
    var fp = s.slice(s.indexOf('.') + 1).slice(decimals);
    return /^0*$/.test(fp);
  }

  function round(amount, decimals) { return fromUnits(toUnits(amount, decimals), decimals); }

  function groupDigits(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * 帳單／分期／貸款用的位數：台幣、日圓、韓元的銀行帳單習慣以「整數元」計算，
   * 即使帳戶允許記到小數（例如電子支付餘額 537.75），分期每期金額與貸款利息仍算到整數元。
   */
  var WHOLE_CURRENCIES = { TWD: true, JPY: true, KRW: true };
  function billingDecimals(symbol, decimals) { return WHOLE_CURRENCIES[symbol] ? Math.min(0, decimals) : decimals; }

  /** 顯示用：千分位、固定小數位數。opts.sign 顯示正號；opts.trim 去掉多餘的尾端 0；opts.trimWhole 小數全是 0 時整段不顯示 */
  function format(amount, decimals, opts) {
    opts = opts || {};
    var n = Number(amount);
    if (!isFinite(n)) return '';
    var units = toUnits(n, decimals);
    var neg = units < 0;
    var s = (Math.abs(units) / Math.pow(10, decimals)).toFixed(decimals);
    var parts = s.split('.');
    var frac = parts[1] || '';
    if (opts.trim) frac = frac.replace(/0+$/, '');
    if (opts.trimWhole && /^0*$/.test(frac)) frac = ''; // 整數金額不顯示 .00（例如台幣 1,140；有角分時才顯示 537.75）
    var out = groupDigits(parts[0]) + (frac ? '.' + frac : '');
    if (neg) out = '-' + out;
    else if (opts.sign && units > 0) out = '+' + out;
    return out;
  }

  /** 換算：某標的數量 × 匯率（或價格）→ 另一個標的的自然單位數字（不四捨五入，彙總後再取整） */
  function mul(qty, rate) { return Number(qty) * Number(rate); }

  var api = { toUnits: toUnits, fromUnits: fromUnits, fitsDecimals: fitsDecimals, round: round, format: format, mul: mul, billingDecimals: billingDecimals };
  return api;
})();
