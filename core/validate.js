/**
 * 交易驗證與正規化。回傳 {ok, errors:[{field,message}], warnings:[string], tx}
 * ctx: {accounts, categories, instruments (皆為 map), transactions (map, 查關聯交易), prices, base, today, existing}
 */
var FinValidate = (function () {
  //#ifnode
  var FinMoney = require('./money.js');
  var FinDates = require('./dates.js');
  var FinSchema = require('./schema.js');
  var FinValuation = require('./valuation.js');
  //#endif

  var MAX_NOTE = 500;

  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  /** 使用者輸入的文字若以 = + - @ 開頭，在試算表可能被當成公式，前面補一個空白 */
  function safeText(s) { return /^[=+\-@]/.test(s) ? ' ' + s : s; }

  function validateTransaction(input, ctx) {
    var errors = [], warnings = [];
    var existing = ctx.existing || null;
    function err(field, message) { errors.push({ field: field, message: message }); }

    var t = {
      id: existing ? existing.id : '',
      type: str(input.type),
      date: str(input.date),
      settleDate: str(input.settleDate),
      srcAccount: str(input.srcAccount), srcSymbol: str(input.srcSymbol), srcQty: numOrNull(input.srcQty),
      dstAccount: str(input.dstAccount), dstSymbol: str(input.dstSymbol), dstQty: numOrNull(input.dstQty),
      categoryId: str(input.categoryId),
      amount: numOrNull(input.amount), fee: numOrNull(input.fee), tax: numOrNull(input.tax),
      relatedSymbol: str(input.relatedSymbol), groupId: str(input.groupId), relatedTxId: str(input.relatedTxId),
      recurringId: str(input.recurringId), note: safeText(str(input.note)),
      status: existing ? existing.status : '有效',
    };

    // ---- 類型 ----
    if (FinSchema.ENUMS.txTypes.indexOf(t.type) < 0) err('type', '請選擇交易類型');
    else if (FinSchema.ENABLED_TX_TYPES.indexOf(t.type) < 0 && !(existing && existing.type === t.type)) err('type', '「' + t.type + '」尚未開放（之後的版本會加入）');

    // ---- 日期 ----
    if (!FinDates.isValid(t.date)) err('date', '日期格式不正確');
    else {
      var y = +t.date.slice(0, 4);
      if (y < 2000 || y > 2100) err('date', '日期超出合理範圍');
      else if (ctx.today && t.date > ctx.today) warnings.push('這筆交易的日期在未來，今天之前不會計入餘額');
    }
    if (t.settleDate && !FinDates.isValid(t.settleDate)) err('settleDate', '交割日格式不正確');
    if (t.note.length > MAX_NOTE) err('note', '備註過長（上限 ' + MAX_NOTE + ' 字）');

    // ---- 每一端 ----
    function checkLeg(prefix, label, required) {
      var acct = t[prefix + 'Account'], sym = t[prefix + 'Symbol'], qty = t[prefix + 'Qty'];
      var any = acct || sym || (qty !== null);
      if (!any) { if (required) err(prefix + 'Account', '請選擇' + label + '帳戶'); return; }
      var a = ctx.accounts[acct];
      if (!acct || !a) { err(prefix + 'Account', '找不到' + label + '帳戶'); }
      else if (!a.active && !(existing && existing[prefix + 'Account'] === acct)) err(prefix + 'Account', label + '帳戶「' + a.name + '」已停用');
      var inst = ctx.instruments[sym];
      if (!sym || !inst) err(prefix + 'Symbol', '找不到' + label + '幣別／標的');
      else if (!inst.active && !(existing && existing[prefix + 'Symbol'] === sym)) err(prefix + 'Symbol', label + '幣別／標的「' + sym + '」已停用');
      if (qty === null) err(prefix + 'Qty', '請輸入' + label + '金額');
      else if (isNaN(qty)) err(prefix + 'Qty', label + '金額不是有效數字');
      else if (qty <= 0) err(prefix + 'Qty', label + '金額必須大於 0');
      else if (inst && !FinMoney.fitsDecimals(qty, inst.decimals)) {
        err(prefix + 'Qty', sym + ' 最多 ' + inst.decimals + ' 位小數');
      } else if (inst) {
        try { FinMoney.toUnits(qty, inst.decimals); } catch (e) { err(prefix + 'Qty', label + '金額過大'); }
      }
    }
    function mustEmpty(prefix, label) {
      if (t[prefix + 'Account'] || t[prefix + 'Symbol'] || t[prefix + 'Qty'] !== null) err(prefix + 'Account', t.type + '不需要填' + label);
    }

    var typeOk = FinSchema.ENUMS.txTypes.indexOf(t.type) >= 0;
    if (typeOk) {
      switch (t.type) {
        case '收入': case '退款':
          mustEmpty('src', '來源'); checkLeg('dst', '入帳', true); break;
        case '支出':
          mustEmpty('dst', '目的'); checkLeg('src', '付款', true); break;
        case '轉帳':
          checkLeg('src', '轉出', true); checkLeg('dst', '轉入', true);
          if (t.srcAccount && t.srcAccount === t.dstAccount) err('dstAccount', '轉出與轉入不能是同一個帳戶');
          if (t.srcSymbol !== t.dstSymbol) err('dstSymbol', '轉帳的幣別必須相同（不同幣別請用「換匯」）');
          else if (t.srcQty !== t.dstQty) err('dstQty', '轉帳的轉出與轉入金額必須相同');
          break;
        case '換匯':
          checkLeg('src', '賣出', true); checkLeg('dst', '買入', true);
          if (t.srcSymbol && t.srcSymbol === t.dstSymbol) err('dstSymbol', '換匯的兩邊幣別不能相同');
          ['src', 'dst'].forEach(function (p) {
            var inst = ctx.instruments[t[p + 'Symbol']];
            if (inst && inst.type !== '法幣') err(p + 'Symbol', '換匯只能用法幣');
          });
          break;
        case '調整':
          if ((t.srcAccount || t.srcSymbol || t.srcQty !== null) && (t.dstAccount || t.dstSymbol || t.dstQty !== null)) {
            err('srcAccount', '餘額調整只能填一邊（調少填來源、調多填目的）');
          } else if (!(t.srcAccount || t.srcSymbol || t.srcQty !== null) && !(t.dstAccount || t.dstSymbol || t.dstQty !== null)) {
            err('dstAccount', '請輸入調整的帳戶與金額');
          } else {
            if (t.srcAccount || t.srcSymbol || t.srcQty !== null) checkLeg('src', '調整', true); else checkLeg('dst', '調整', true);
          }
          break;
        default:
          break; // 尚未開放的類型：只在編輯既有資料時走到這裡，不重新驗證兩端
      }
    }

    // ---- 分類 ----
    var cats = ctx.categories;
    if (t.type === '收入' || t.type === '支出' || t.type === '退款') {
      var wantType = t.type === '收入' ? '收入' : '支出';
      var cat = cats[t.categoryId];
      if (!t.categoryId) err('categoryId', '請選擇分類');
      else if (!cat) err('categoryId', '找不到分類');
      else if (cat.type !== wantType) err('categoryId', t.type + '請選擇「' + wantType + '」分類');
      else if (!cat.active && !(existing && existing.categoryId === t.categoryId)) err('categoryId', '分類「' + cat.name + '」已停用');
    } else if (t.type === '調整') {
      var sys = Object.keys(cats).map(function (k) { return cats[k]; }).filter(function (c) { return c.type === '系統' && c.name === '餘額調整'; })[0];
      t.categoryId = sys ? sys.id : '';
    } else if (t.type === '轉帳' || t.type === '換匯') {
      t.categoryId = '';
    }

    // ---- 退款連回原消費 ----
    if (t.type === '退款' && t.relatedTxId) {
      var orig = ctx.transactions ? ctx.transactions[t.relatedTxId] : null;
      if (!orig) err('relatedTxId', '找不到要退款的原交易');
      else if (orig.type !== '支出') err('relatedTxId', '退款只能連回「支出」交易');
      else {
        if (orig.srcSymbol && t.dstSymbol && orig.srcSymbol !== t.dstSymbol) warnings.push('退款幣別與原消費不同');
        if (orig.srcSymbol === t.dstSymbol && t.dstQty !== null && t.dstQty > orig.srcQty) warnings.push('退款金額大於原消費金額');
      }
    } else if (t.type !== '退款') {
      t.relatedTxId = '';
    }

    // ---- 換匯匯率合理性（與市價差太多多半是輸入錯誤）----
    if (t.type === '換匯' && !errors.length && ctx.prices) {
      var base = ctx.base || 'TWD';
      var sv = FinValuation.unitPrice(t.srcSymbol, ctx.instruments, ctx.prices, base, 0);
      var dv = FinValuation.unitPrice(t.dstSymbol, ctx.instruments, ctx.prices, base, 0);
      if (sv && dv) {
        var ratio = (t.dstQty * dv) / (t.srcQty * sv);
        if (Math.abs(ratio - 1) > 0.03) {
          warnings.push('這筆換匯的匯率與目前市價相差約 ' + Math.round(Math.abs(ratio - 1) * 100) + '%，請確認金額');
        }
      }
    }

    // 未使用的欄位保持空白，避免髒資料
    ['srcQty', 'dstQty', 'amount', 'fee', 'tax'].forEach(function (k) { if (t[k] !== null && isNaN(t[k])) t[k] = null; });
    return { ok: errors.length === 0, errors: errors, warnings: warnings, tx: t };
  }

  return { validateTransaction: validateTransaction, safeText: safeText };
})();
//#ifnode
module.exports = FinValidate;
//#endif
