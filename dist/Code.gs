/**
 * 財務管理系統 — Apps Script 後端（自動產生，請勿直接編輯）
 * 由 tools/build-gas.js 從 core/ 與 server/ 合併而成。
 */

// ==================== core/schema.js ====================
/**
 * 資料表結構：程式內用英文 key，Sheet 表頭用中文（依表頭文字對應，欄位順序可被你手動調整）。
 * 欄位型別：text 文字、num 數字、date 日期（yyyy-MM-dd 文字）、ts 時間戳記文字、bool 是／否
 */
var FinSchema = (function () {
  var ENUMS = {
    accountTypes: ['銀行', '數位錢包', '現金', '證券', '加密交易所', '信用卡', '貸款', '應收', '應付', '點數'],
    txTypes: ['收入', '支出', '轉帳', '換匯', '買入', '賣出', '股息', '股數調整', '退款', '調整'],
    instrumentTypes: ['法幣', '台股', '美股', 'ETF', '加密', '點數'],
    txStatus: ['有效', '作廢', '待確認', '已略過'],
    categoryTypes: ['收入', '支出', '系統'],
    recurFreq: ['每週', '每月', '每季', '每年'],
    recurMode: ['自動入帳', '提醒確認', '券商定期定額', '手動下單'],
    priceSources: ['GOOGLEFINANCE', 'CoinGecko', '固定值', '手動'],
  };
  // 第 1 批已開放的交易類型；其餘類型在後續批次啟用
  var ENABLED_TX_TYPES = ['收入', '支出', '轉帳', '換匯', '買入', '賣出', '股息', '股數調整', '退款', '調整'];
  var LIABILITY_TYPES = ['信用卡', '貸款', '應付'];

  function c(key, header, type, tolerant) { return { key: key, header: header, type: type || 'text', tolerant: !!tolerant }; }

  var TABLES = {
    settings: { sheet: '設定', idKey: 'key', cols: [c('key', '鍵'), c('value', '值'), c('note', '說明')] },
    auditLog: {
      sheet: '異動紀錄', idKey: null,
      cols: [c('at', '時間', 'ts'), c('action', '動作'), c('table', '資料表'), c('refId', '資料ID'), c('summary', '摘要'), c('device', '裝置')],
    },
    accounts: {
      sheet: '帳戶', idKey: 'id', idPrefix: 'A', idWidth: 3,
      cols: [c('id', '帳戶ID'), c('name', '名稱'), c('institution', '機構'), c('type', '類型'), c('defaultSymbol', '預設幣別'),
        c('sort', '排序', 'num'), c('active', '啟用', 'bool'), c('note', '備註'), c('createdAt', '建立時間', 'ts'), c('updatedAt', '更新時間', 'ts')],
    },
    cardSettings: {
      sheet: '信用卡設定', idKey: 'accountId',
      cols: [c('accountId', '帳戶ID'), c('limit', '額度', 'num'), c('statementDay', '結帳日', 'num'), c('dueDay', '繳款日', 'num'),
        c('expiry', '到期年月'), c('payAccountId', '預設繳款帳戶ID'), c('note', '備註')],
    },
    loanSettings: {
      sheet: '貸款設定', idKey: 'accountId',
      cols: [c('accountId', '帳戶ID'), c('principal', '貸款金額', 'num'), c('rate', '年利率', 'num'), c('terms', '期數', 'num'),
        c('startDate', '起貸日', 'date'), c('payDay', '每月還款日', 'num'), c('method', '還款方式'), c('payAccountId', '預設扣款帳戶ID')],
    },
    brokerSettings: {
      sheet: '證券帳戶設定', idKey: 'accountId',
      cols: [c('accountId', '帳戶ID'), c('market', '市場'), c('feeRate', '手續費率', 'num'), c('feeDiscount', '手續費折扣', 'num'),
        c('feeCurrency', '手續費幣別'), c('minFee', '最低手續費', 'num'), c('oddLotMinFee', '零股最低手續費', 'num'),
        c('sipFixedFee', '定期定額固定手續費', 'num'), c('sipFeeRate', '定期定額手續費率', 'num'), c('sipFeeCap', '定期定額每筆上限', 'num'),
        c('sipMinAmount', '定期定額最低單筆投入', 'num'), c('taxRateStock', '證交稅率(股票)', 'num'), c('taxRateEtf', '證交稅率(ETF)', 'num'),
        c('buySettleDays', '買入交割天數', 'num'), c('sellSettleDays', '賣出交割天數', 'num'), c('calendar', '交割日曆'),
        c('settleAccountId', '預設交割帳戶ID'), c('note', '備註')],
    },
    categories: {
      sheet: '分類', idKey: 'id', idPrefix: 'C', idWidth: 3,
      cols: [c('id', '分類ID'), c('type', '類型'), c('parentId', '上層分類ID'), c('name', '名稱'), c('icon', '圖示'), c('color', '顏色'),
        c('sort', '排序', 'num'), c('active', '啟用', 'bool'), c('createdAt', '建立時間', 'ts'), c('updatedAt', '更新時間', 'ts')],
    },
    instruments: {
      sheet: '標的', idKey: 'symbol',
      cols: [c('symbol', '標的代號'), c('name', '名稱'), c('type', '類型'), c('quote', '計價幣別'), c('decimals', '小數位數', 'num'),
        c('priceSource', '價格來源'), c('quoteCode', '行情代碼'), c('active', '啟用', 'bool'), c('note', '備註'),
        c('createdAt', '建立時間', 'ts'), c('updatedAt', '更新時間', 'ts')],
    },
    transactions: {
      sheet: '交易', idKey: 'id', idPrefix: 'T', idWidth: 6,
      cols: [c('id', '交易ID'), c('date', '日期', 'date'), c('settleDate', '交割日', 'date'), c('type', '類型'),
        c('srcAccount', '來源帳戶'), c('srcSymbol', '來源標的'), c('srcQty', '來源數量', 'num'),
        c('dstAccount', '目的帳戶'), c('dstSymbol', '目的標的'), c('dstQty', '目的數量', 'num'),
        c('categoryId', '分類ID'), c('amount', '成交金額', 'num'), c('fee', '手續費', 'num'), c('tax', '稅款', 'num'),
        c('relatedSymbol', '關聯標的'), c('groupId', '群組ID'), c('relatedTxId', '關聯交易ID'), c('recurringId', '定期ID'),
        c('note', '備註'), c('status', '狀態'), c('createdAt', '建立時間', 'ts'), c('updatedAt', '更新時間', 'ts')],
    },
    txTags: { sheet: '交易標籤', idKey: null, cols: [c('txId', '交易ID'), c('tag', '標籤')] },
    recurring: {
      sheet: '定期', idKey: 'id', idPrefix: 'R', idWidth: 3,
      cols: [c('id', '定期ID'), c('name', '名稱'), c('freq', '頻率'), c('days', '執行日'), c('holiday', '假日處理'),
        c('startDate', '起始日', 'date'), c('endDate', '結束日', 'date'), c('type', '類型'),
        c('srcAccount', '來源帳戶'), c('srcSymbol', '來源標的'), c('srcQty', '來源數量', 'num'),
        c('dstAccount', '目的帳戶'), c('dstSymbol', '目的標的'), c('dstQty', '目的數量', 'num'),
        c('categoryId', '分類ID'), c('mode', '執行方式'), c('remindDays', '資金備妥提醒', 'num'), c('settleDays', '交割天數', 'num'),
        c('active', '啟用', 'bool'), c('lastRun', '上次執行日', 'date'), c('note', '備註'),
        c('createdAt', '建立時間', 'ts'), c('updatedAt', '更新時間', 'ts')],
    },
    prices: {
      sheet: '價格', idKey: 'symbol',
      cols: [c('symbol', '標的代號'), c('price', '現價', 'num', true), c('lastValid', '上次有效價', 'num'), c('quote', '計價幣別'),
        c('updatedAt', '更新時間', 'ts'), c('status', '狀態')],
    },
    priceHistory: { sheet: '價格歷史', idKey: null, cols: [c('date', '日期', 'date'), c('symbol', '標的代號'), c('close', '收盤價', 'num')] },
    holidays: {
      sheet: '休市日', idKey: null,
      cols: [c('market', '市場'), c('date', '日期', 'date'), c('name', '名稱'), c('trading', '有交易', 'bool'), c('settling', '有辦理交割', 'bool'), c('source', '來源')],
    },
    snapshots: {
      sheet: '快照', idKey: null,
      cols: [c('date', '日期', 'date'), c('cash', '現金存款', 'num'), c('fxCash', '外幣現金', 'num'), c('stocks', '股票與ETF', 'num'),
        c('crypto', '加密', 'num'), c('receivable', '應收', 'num'), c('cardDebt', '信用卡負債', 'num'), c('loanDebt', '貸款負債', 'num'),
        c('payable', '應付', 'num'), c('assets', '總資產', 'num'), c('liabilities', '總負債', 'num'), c('netWorth', '淨資產', 'num')],
    },
  };

  // 「選項」是橫向表：每一欄是一份清單
  var OPTION_LISTS = [
    { header: '帳戶類型', enumKey: 'accountTypes' }, { header: '交易類型', enumKey: 'txTypes' },
    { header: '標的類型', enumKey: 'instrumentTypes' }, { header: '定期頻率', enumKey: 'recurFreq' },
    { header: '定期執行方式', enumKey: 'recurMode' }, { header: '價格來源', enumKey: 'priceSources' },
    { header: '交易狀態', enumKey: 'txStatus' }, { header: '標籤', enumKey: null },
  ];
  var OPTIONS_SHEET = '選項';

  // 建立 Sheet 的順序（也是分頁順序）
  var SHEET_ORDER = ['settings', 'options', 'auditLog', 'accounts', 'cardSettings', 'loanSettings', 'brokerSettings', 'categories',
    'instruments', 'transactions', 'txTags', 'recurring', 'prices', 'priceHistory', 'holidays', 'snapshots'];

  function headers(tableKey) { return TABLES[tableKey].cols.map(function (col) { return col.header; }); }
  function colOf(tableKey, key) {
    var cols = TABLES[tableKey].cols;
    for (var i = 0; i < cols.length; i++) if (cols[i].key === key) return cols[i];
    return null;
  }

  var api = {
    ENUMS: ENUMS, ENABLED_TX_TYPES: ENABLED_TX_TYPES, LIABILITY_TYPES: LIABILITY_TYPES, TABLES: TABLES,
    OPTION_LISTS: OPTION_LISTS, OPTIONS_SHEET: OPTIONS_SHEET, SHEET_ORDER: SHEET_ORDER, headers: headers, colOf: colOf,
    DB_VERSION: 1,
    APP_VERSION: '0.3.0',
  };
  return api;
})();

// ==================== core/money.js ====================
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

  /** 顯示用：千分位、固定小數位數。opts.sign 顯示正號；opts.trim 去掉多餘的尾端 0（保留至少 minDecimals 位） */
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
    var out = groupDigits(parts[0]) + (frac ? '.' + frac : '');
    if (neg) out = '-' + out;
    else if (opts.sign && units > 0) out = '+' + out;
    return out;
  }

  /** 換算：某標的數量 × 匯率（或價格）→ 另一個標的的自然單位數字（不四捨五入，彙總後再取整） */
  function mul(qty, rate) { return Number(qty) * Number(rate); }

  var api = { toUnits: toUnits, fromUnits: fromUnits, fitsDecimals: fitsDecimals, round: round, format: format, mul: mul };
  return api;
})();

// ==================== core/dates.js ====================
/**
 * 日期工具：日期一律用 'yyyy-MM-dd' 文字，時間戳記用台灣時間（UTC+8，無日光節約）'yyyy-MM-dd HH:mm:ss'。
 * 不依賴 Date 的本地時區，Node 與 Apps Script 結果一致。
 */
var FinDates = (function () {
  var TZ_OFFSET_MS = 8 * 3600 * 1000;

  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function parse(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str === null || str === undefined ? '' : str).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  function isValid(str) { return parse(str) !== null; }
  function format(y, m, d) { return pad(y, 4) + '-' + pad(m) + '-' + pad(d); }

  function addDays(str, n) {
    var p = parse(str);
    if (!p) throw new Error('日期格式錯誤：' + str);
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  function weekday(str) { // 0=週日
    var p = parse(str);
    return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  }

  function ymOf(str) { return String(str).slice(0, 7); }
  function monthRange(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return { from: format(y, m, 1), to: format(y, m, daysInMonth(y, m)) };
  }
  function addMonths(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return pad(y, 4) + '-' + pad(m + 1);
  }

  /** 毫秒時間戳 → 台灣時間 'yyyy-MM-dd HH:mm:ss' */
  function timestamp(ms) {
    var t = new Date(ms + TZ_OFFSET_MS);
    return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) + ' ' +
      pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ':' + pad(t.getUTCSeconds());
  }
  function today(ms) { return timestamp(ms).slice(0, 10); }

  /** Sheet 讀到的日期儲存格可能是字串或 Date 物件（手動輸入時），統一成 'yyyy-MM-dd'；無法辨識回傳 null */
  function fromCell(v) {
    if (v === null || v === undefined || v === '') return '';
    if (Object.prototype.toString.call(v) === '[object Date]') {
      if (isNaN(v.getTime())) return null;
      return today(v.getTime());
    }
    var s = String(v).trim();
    if (isValid(s)) return s;
    var m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(s);
    if (m) { var f = format(+m[1], +m[2], +m[3]); return isValid(f) ? f : null; }
    return null;
  }


  /** 某市場在這天是否「辦理交割」的營業日：週六日一律不算；holidaySet 為 {'市場|日期': {trading,settling}} */
  function isSettleDay(str, market, holidaySet) {
    var wd = weekday(str);
    if (wd === 0 || wd === 6) return false;
    var h = holidaySet ? holidaySet[market + '|' + str] : null;
    if (h && h.settling === false) return false;
    return true;
  }

  /** 成交日後第 n 個營業日（依 markets 陣列全部都要是營業日才算，例如複委託用 ['台灣','美國']） */
  function addSettleDays(tradeDate, n, markets, holidaySet) {
    var d = tradeDate, count = 0, guard = 0;
    while (count < n) {
      d = addDays(d, 1);
      var ok = true;
      for (var i = 0; i < markets.length; i++) { if (!isSettleDay(d, markets[i], holidaySet)) { ok = false; break; } }
      if (ok) count++;
      if (++guard > 3650) throw new Error('交割日推算超出範圍');
    }
    return d;
  }

  /** 把「休市日」表的列轉成 isSettleDay/addSettleDays 用的查表：{'市場|日期': {trading, settling}} */
  function buildHolidaySet(rows) {
    var set = {};
    (rows || []).forEach(function (r) { set[r.market + '|' + r.date] = { trading: r.trading, settling: r.settling }; });
    return set;
  }

  var api = {
    parse: parse, isValid: isValid, format: format, addDays: addDays, weekday: weekday, ymOf: ymOf, monthRange: monthRange,
    addMonths: addMonths, timestamp: timestamp, today: today, fromCell: fromCell, daysInMonth: daysInMonth,
    isSettleDay: isSettleDay, addSettleDays: addSettleDays, buildHolidaySet: buildHolidaySet,
  };
  return api;
})();

// ==================== core/ids.js ====================
/** ID 產生：前綴 + 補零流水號（T000001、A001）。以「目前最大號 + 1」計算，手動改過 Sheet 也不會撞號。 */
var FinIds = (function () {
  function parseSeq(id, prefix) {
    var s = String(id === null || id === undefined ? '' : id);
    if (s.indexOf(prefix) !== 0) return 0;
    var rest = s.slice(prefix.length);
    return /^\d+$/.test(rest) ? parseInt(rest, 10) : 0;
  }
  function pad(n, width) { var s = String(n); while (s.length < width) s = '0' + s; return s; }

  /** 回傳 count 個新 ID */
  function next(existingIds, prefix, width, count) {
    var max = 0;
    for (var i = 0; i < existingIds.length; i++) {
      var n = parseSeq(existingIds[i], prefix);
      if (n > max) max = n;
    }
    var out = [];
    for (var k = 1; k <= (count || 1); k++) out.push(prefix + pad(max + k, width));
    return out;
  }
  return { next: next, parseSeq: parseSeq };
})();

// ==================== core/us-holidays.js ====================
/**
 * 美股（NYSE／NASDAQ）休市日：依規則產生（設計文件 §5 休市日：美國「由程式依規則產生」）。
 * 包含：元旦、馬丁路德金日（1月第3個週一）、總統日（2月第3個週一）、耶穌受難日（復活節前的週五）、
 *       陣亡將士紀念日（5月最後一個週一）、六月節（6/19）、獨立紀念日（7/4）、勞動節（9月第1個週一）、
 *       感恩節（11月第4個週四）、聖誕節（12/25）。
 * 遇週六補放週五、遇週日補放週一（美股市場假日的一般補假規則）。
 */
var FinUsHolidays = (function () {
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fmt(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function dow(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); } // 0=日 1=一 ... 6=六

  /** 某月第 n 個星期 wd（0=日...6=六） */
  function nthWeekday(y, m, wd, n) {
    var d = 1, count = 0;
    while (true) {
      if (dow(y, m, d) === wd) { count++; if (count === n) return d; }
      d++;
    }
  }
  /** 某月最後一個星期 wd */
  function lastWeekday(y, m, wd) {
    var days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (var d = days; d >= 1; d--) if (dow(y, m, d) === wd) return d;
  }

  /** Anonymous Gregorian algorithm：計算某年復活節（公曆）的月/日 */
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31);
    var day = ((h + l - 7 * m + 114) % 31) + 1;
    return { m: month, d: day };
  }

  /** 遇週六補放週五、遇週日補放週一（不改變原始日期名稱，只有補假才另外標一列） */
  function observed(y, m, d) {
    var wd = dow(y, m, d);
    if (wd === 6) return { y: y, m: m, d: d - 1 };
    if (wd === 0) return { y: y, m: m, d: d + 1 };
    return { y: y, m: m, d: d };
  }

  /** 回傳某年美股休市日清單 [{date, name}]（yyyy-MM-dd） */
  function generate(year) {
    var out = [];
    function add(name, y, m, d) {
      var o = observed(y, m, d);
      out.push({ date: fmt(o.y, o.m, o.d), name: name + (o.d !== d || o.m !== m ? '（補假）' : '') });
    }
    add('元旦', year, 1, 1);
    add('馬丁路德金日', year, 1, nthWeekday(year, 1, 1, 3));
    add('總統日', year, 2, nthWeekday(year, 2, 1, 3));
    var e = easter(year);
    var goodFriday = new Date(Date.UTC(year, e.m - 1, e.d - 2));
    out.push({ date: fmt(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()), name: '耶穌受難日' });
    add('陣亡將士紀念日', year, 5, lastWeekday(year, 5, 1));
    add('六月節', year, 6, 19);
    add('獨立紀念日', year, 7, 4);
    add('勞動節', year, 9, nthWeekday(year, 9, 1, 1));
    var thanksgiving = nthWeekday(year, 11, 4, 4);
    out.push({ date: fmt(year, 11, thanksgiving), name: '感恩節' });
    add('聖誕節', year, 12, 25);
    out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return out;
  }

  return { generate: generate, easter: easter };
})();

// ==================== core/valuation.js ====================
/**
 * 估值：把（帳戶、標的、數量）換成基準幣別（預設 TWD）。
 * 標的價格以「計價幣別」表示（USD 的計價幣別是 TWD；VOO 的計價幣別是 USD），沿著計價幣別一路換算到基準幣別。
 */
var FinValuation = (function () {

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

// ==================== core/ledger.js ====================
/**
 * 兩端分錄式帳本：每筆交易有「來源」與「目的」兩端（帳戶、標的、數量），任一端可為空。
 * 餘額 = Σ目的 − Σ來源，全部用整數最小單位計算。只有狀態為「有效」的交易計入。
 * 每一端算入的日期：現金（法幣）用交割日（沒填就用日期），其他標的（股票等）用日期（成交日）。
 */
var FinLedger = (function () {

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
      if (f.accountId && t.srcAccount !== f.accountId && t.dstAccount !== f.accountId) return false;
      if (f.categoryId) {
        var cat = categories[t.categoryId];
        if (t.categoryId !== f.categoryId && !(cat && cat.parentId === f.categoryId)) return false;
      }
      if (q) {
        var hay = [t.note, t.id, (categories[t.categoryId] || {}).name,
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

// ==================== core/holdings.js ====================
/**
 * 投資持倉／成本／損益（設計文件 db-design.md §7、§7.3）。平均成本法。
 * 每個持倉（帳戶 × 標的）同時記錄：qty（股數）、costNative（計價幣別成本，例如 VOO 記 USD）、costBase（基準幣別／台幣成本，取自實際進出的台幣）。
 * 買入：qty += 目的數量；costNative += 成交金額+手續費+稅款；costBase += 來源那筆現金換算成基準幣別的金額（來源本來就是 TWD 時直接用，否則用成交當日的歷史價格估算，並標記 estimated）。
 * 賣出：依「賣出股數 / 持有股數」比例扣除兩種成本；已實現損益 = 淨收入(成交金額-手續費-稅款/入帳金額) − 被扣除的成本。
 * 股息：目的標的若與持倉標的相同（配股）→ 只加股數、成本不變；否則是現金股息，只記录收入，不影響持倉成本。
 * 股數調整：只改股數（拆股／併股／標的更名），總成本不變。
 */
var FinHoldings = (function () {

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

// ==================== core/loan.js ====================
/**
 * 貸款攤還計算（設計文件 db-design.md §7、批次 3）。
 * 三種還款方式：本息平均攤還（等額本息）、本金平均攤還（等額本金）、只繳息（到期還本，中間只繳利息）。
 * 一律以整數最小單位計算利息與本金（避免浮點誤差），最後一期吸收所有捨入尾差，
 * 因此 schedule 最後一期的餘額保證剛好是 0，各期本金加總剛好等於貸款金額。
 */
var FinLoan = (function () {

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

// ==================== core/creditcard.js ====================
/**
 * 信用卡帳單計算（設計文件 db-design.md §7：「依結帳日切分區間，累計該區間內以該卡為來源的支出，並扣掉退款與還款；
 * 繳款日前顯示待繳金額」）。假設一張信用卡只用一種幣別（帳戶的「預設幣別」）記帳。
 * 一律以整數最小單位計算，避免浮點誤差。
 */
var FinCreditCard = (function () {

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
   */
  function summary(txs, cardAccountId, symbol, decimals, cardSettings, asOfDate) {
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
    var availableCredit = limit > 0 ? FinMoney.round(Math.max(0, limit - currentlyOwed), decimals) : null;

    return {
      currentPeriod: current, currentSpend: currentSpend,
      lastClosedPeriod: lastClosed, statementAmountDue: statementAmountDue, dueDate: dueDate,
      currentlyOwed: currentlyOwed, overdue: statementAmountDue > 0 && asOfDate > dueDate,
      limit: limit || null, availableCredit: availableCredit,
    };
  }

  return {
    periodContaining: periodContaining, dueDateFor: dueDateFor, periodSpend: periodSpend,
    balanceUnitsAsOf: balanceUnitsAsOf, summary: summary,
    prevStatementEnd: prevStatementEnd, nextStatementEnd: nextStatementEnd, statementDateIn: statementDateIn,
  };
})();

// ==================== core/validate.js ====================
/**
 * 交易驗證與正規化。回傳 {ok, errors:[{field,message}], warnings:[string], tx}
 * ctx: {accounts, categories, instruments (皆為 map), transactions (map, 查關聯交易), prices, base, today, existing}
 */
var FinValidate = (function () {

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
    function checkLeg(prefix, label, required, instKind) {
      var acct = t[prefix + 'Account'], sym = t[prefix + 'Symbol'], qty = t[prefix + 'Qty'];
      var any = acct || sym || (qty !== null);
      if (!any) { if (required) err(prefix + 'Account', '請選擇' + label + '帳戶'); return; }
      var a = ctx.accounts[acct];
      if (!acct || !a) { err(prefix + 'Account', '找不到' + label + '帳戶'); }
      else if (!a.active && !(existing && existing[prefix + 'Account'] === acct)) err(prefix + 'Account', label + '帳戶「' + a.name + '」已停用');
      var inst = ctx.instruments[sym];
      if (!sym || !inst) err(prefix + 'Symbol', '找不到' + label + '幣別／標的');
      else if (!inst.active && !(existing && existing[prefix + 'Symbol'] === sym)) err(prefix + 'Symbol', label + '幣別／標的「' + sym + '」已停用');
      else if (instKind === 'cash' && inst.type !== '法幣') err(prefix + 'Symbol', label + '請選擇現金（法幣）');
      else if (instKind === 'invest' && inst.type === '法幣') err(prefix + 'Symbol', label + '請選擇股票／ETF／加密貨幣等投資標的，不能是現金');
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
    function checkMoney(field, label, required) {
      var v = t[field];
      if (v === null) { if (required) err(field, '請輸入' + label); return; }
      if (isNaN(v)) { err(field, label + '不是有效數字'); return; }
      if (v < 0) err(field, label + '不能是負數');
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
        case '買入':
          checkLeg('src', '付款', true, 'cash'); checkLeg('dst', '投資', true, 'invest');
          checkMoney('amount', '成交金額', true); checkMoney('fee', '手續費', false); checkMoney('tax', '稅款', false);
          break;
        case '賣出':
          checkLeg('src', '賣出', true, 'invest'); checkLeg('dst', '收款', true, 'cash');
          checkMoney('amount', '成交金額', true); checkMoney('fee', '手續費', false); checkMoney('tax', '稅款', false);
          break;
        case '股息':
          mustEmpty('src', '來源'); checkLeg('dst', '入帳', true);
          checkMoney('amount', '稅前股息', false); checkMoney('fee', '手續費', false); checkMoney('tax', '稅款／預扣稅', false);
          if (!t.relatedSymbol) err('relatedSymbol', '請選擇這筆股息屬於哪個標的');
          else if (!ctx.instruments[t.relatedSymbol]) err('relatedSymbol', '找不到關聯標的');
          break;
        case '股數調整':
          if ((t.srcAccount || t.srcSymbol || t.srcQty !== null) && (t.dstAccount || t.dstSymbol || t.dstQty !== null)) {
            err('srcAccount', '股數調整只能填一邊（減少填來源、增加填目的）');
          } else if (!(t.srcAccount || t.srcSymbol || t.srcQty !== null) && !(t.dstAccount || t.dstSymbol || t.dstQty !== null)) {
            err('dstAccount', '請輸入股數調整的帳戶與股數');
          } else if (t.srcAccount || t.srcSymbol || t.srcQty !== null) {
            checkLeg('src', '調整', true, 'invest');
          } else {
            checkLeg('dst', '調整', true, 'invest');
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
    } else if (t.type === '股息') {
      var sysDiv = Object.keys(cats).map(function (k) { return cats[k]; }).filter(function (c) { return c.type === '系統' && c.name === '股息'; })[0];
      t.categoryId = sysDiv ? sysDiv.id : '';
    } else if (t.type === '轉帳' || t.type === '換匯' || t.type === '買入' || t.type === '賣出' || t.type === '股數調整') {
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
    if (t.type !== '股息') t.relatedSymbol = '';

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

    // ---- 複委託「隱含匯率」合理性：實付/實收台幣 vs（成交金額+手續費+稅款）換算出的匯率，與市價差太多多半是輸入錯誤（暫定 3%）----
    if ((t.type === '買入' || t.type === '賣出') && !errors.length && ctx.prices) {
      var baseC = ctx.base || 'TWD';
      var dstInst = t.type === '買入' ? ctx.instruments[t.dstSymbol] : null;
      var cashSym = t.type === '買入' ? t.srcSymbol : t.dstSymbol;
      var cashQty = t.type === '買入' ? t.srcQty : t.dstQty;
      var quoteSym = t.type === '買入' ? (dstInst ? dstInst.quote : null) : (ctx.instruments[t.srcSymbol] ? ctx.instruments[t.srcSymbol].quote : null);
      if (quoteSym && cashSym !== quoteSym) {
        var gross = (t.amount || 0) + (t.fee || 0) + (t.tax || 0);
        if (gross > 0 && cashQty > 0) {
          var implied = cashQty / gross;
          var marketFx = FinValuation.unitPrice(quoteSym, ctx.instruments, ctx.prices, cashSym, 0);
          if (marketFx && Math.abs(implied - marketFx) / marketFx > 0.03) {
            warnings.push('隱含匯率約 ' + implied.toFixed(4) + '，與目前市價匯率 ' + marketFx.toFixed(4) + ' 相差超過 3%，請確認金額是否輸入正確');
          }
        }
      }
    }

    // 未使用的欄位保持空白，避免髒資料
    ['srcQty', 'dstQty', 'amount', 'fee', 'tax'].forEach(function (k) { if (t[k] !== null && isNaN(t[k])) t[k] = null; });
    return { ok: errors.length === 0, errors: errors, warnings: warnings, tx: t };
  }

  return { validateTransaction: validateTransaction, safeText: safeText };
})();

// ==================== core/report.js ====================
/**
 * 收支報表規則（設計文件 7.2）：
 *  - 收入 = 「收入」交易；支出 = 「支出」交易；退款抵銷同分類的支出
 *  - 轉帳、換匯、買入、賣出、股數調整、調整 都不算收入或支出
 * 第 1 批以「目前價格」換算外幣；歷史匯率會在報表批次加入。
 */
var FinReport = (function () {

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

// ==================== core/seed.js ====================
/** 初始資料（第一次「初始化」時寫入）。分類與設定都是預設值，之後可在系統裡自行調整。 */
var FinSeed = (function () {

  var EXPENSE = [
    ['cup', '飲食', '#d99a6c', ['早餐', '午餐', '晚餐', '飲料點心', '聚餐', '生鮮雜貨']],
    ['car', '交通', '#7fa0b8', ['大眾運輸', '計程車', '油資', '停車費', '高鐵台鐵', '保養維修']],
    ['home', '居住', '#b89f7a', ['房租房貸', '水電瓦斯', '管理費', '網路電話', '家具家電', '修繕']],
    ['bag', '購物', '#c98fa5', ['衣物鞋包', '日用品', '3C 電子', '美妝保養']],
    ['controller', '娛樂', '#9b8fc9', ['旅遊', '電影演出', '遊戲訂閱', '運動健身']],
    ['capsule', '醫療保健', '#8fbf97', ['門診', '藥品', '保健食品', '保險費']],
    ['book', '學習', '#6fa8a0', ['書籍', '課程']],
    ['gift', '人情', '#d98a86', ['禮金', '禮物', '孝親']],
    ['card', '金融費用', '#a3a3a3', ['手續費', '利息', '年費']],
    ['receipt', '稅費', '#8f8f7a', ['所得稅', '房屋稅', '牌照燃料稅']],
    ['dots', '其他支出', '#b3a58c', []],
  ];
  var INCOME = [
    ['briefcase', '薪資', '#7fa887', ['薪資', '獎金', '加班費']],
    ['bank', '利息收入', '#8fac97', []],
    ['stars', '其他收入', '#dba86a', ['禮金收入', '退稅', '二手轉售']],
  ];
  var SYSTEM = [['sliders', '餘額調整', '#b3a58c'], ['coin', '股息', '#8fac97']];

  var CURRENCIES = [
    ['TWD', '新台幣', 0, 'TWD'], ['USD', '美元', 2, 'USDTWD'], ['JPY', '日圓', 0, 'JPYTWD'], ['EUR', '歐元', 2, 'EURTWD'],
    ['CNY', '人民幣', 2, 'CNYTWD'], ['HKD', '港幣', 2, 'HKDTWD'], ['KRW', '韓元', 0, 'KRWTWD'],
    ['GBP', '英鎊', 2, 'GBPTWD'], ['AUD', '澳幣', 2, 'AUDTWD'],
  ];

  // 台灣證券市場 2026 年休市日（對照 twse.com.tw 開休市公告、元大證券春節交易公告核對，之後年度需自行更新或改為排程匯入，見 db-design.md §9）
  var TW_HOLIDAYS_2026 = [
    ['2026-01-01', '元旦', false],
    ['2026-02-12', '農曆春節（僅辦理結算交割作業）', true],
    ['2026-02-13', '農曆春節（僅辦理結算交割作業）', true],
    ['2026-02-16', '農曆春節', false], ['2026-02-17', '農曆春節', false], ['2026-02-18', '農曆春節', false],
    ['2026-02-19', '農曆春節', false], ['2026-02-20', '農曆春節', false],
    ['2026-02-27', '和平紀念日補假', false],
    ['2026-04-03', '兒童節補假', false],
    ['2026-04-06', '民族掃墓節（清明）補假', false],
    ['2026-05-01', '勞動節', false],
    ['2026-06-19', '端午節', false],
    ['2026-09-25', '中秋節', false],
    ['2026-09-28', '教師節', false],
    ['2026-10-09', '國慶日補假', false],
    ['2026-10-26', '台灣光復節補假', false],
    ['2026-12-25', '行憲紀念日', false],
    ['2027-01-01', '元旦（跨年安全邊界）', false],
  ];

  function build(nowStr) {
    var settings = [
      { key: '基準幣別', value: 'TWD', note: '所有金額換算與淨值使用的幣別（第 1 版固定為 TWD）' },
      { key: '資料庫版本', value: String(FinSchema.DB_VERSION), note: '程式用，請勿修改' },
      { key: '成本計算法', value: '平均成本', note: '投資成本計算方式' },
      { key: '月結起始日', value: '1', note: '每月統計從幾號開始' },
      { key: '閒置登出分鐘', value: '60', note: '超過這段時間沒操作就要重新輸入 PIN' },
      { key: '失敗鎖定次數', value: '5', note: 'PIN 連續輸錯幾次就暫時鎖定' },
      { key: '鎖定分鐘', value: '15', note: '鎖定持續多久' },
      { key: '時區', value: 'Asia/Taipei', note: '' },
    ];

    var categories = [], n = 0;
    function id() { n += 1; return 'C' + (n < 10 ? '00' : n < 100 ? '0' : '') + n; }
    function addGroup(type, list) {
      list.forEach(function (g, gi) {
        var pid = id();
        categories.push({ id: pid, type: type, parentId: '', name: g[1], icon: g[0], color: g[2], sort: (gi + 1) * 10, active: true, createdAt: nowStr, updatedAt: nowStr });
        g[3].forEach(function (name, ci) {
          categories.push({ id: id(), type: type, parentId: pid, name: name, icon: '', color: g[2], sort: (ci + 1) * 10, active: true, createdAt: nowStr, updatedAt: nowStr });
        });
      });
    }
    addGroup('支出', EXPENSE);
    addGroup('收入', INCOME);
    SYSTEM.forEach(function (s, i) {
      categories.push({ id: id(), type: '系統', parentId: '', name: s[1], icon: s[0], color: s[2], sort: 900 + i, active: true, createdAt: nowStr, updatedAt: nowStr });
    });

    var instruments = CURRENCIES.map(function (c) {
      var isBase = c[0] === 'TWD';
      return {
        symbol: c[0], name: c[1], type: '法幣', quote: 'TWD', decimals: c[2],
        priceSource: isBase ? '固定值' : 'GOOGLEFINANCE', quoteCode: isBase ? '' : 'CURRENCY:' + c[3], active: true, note: '',
        createdAt: nowStr, updatedAt: nowStr,
      };
    });
    var prices = CURRENCIES.filter(function (c) { return c[0] !== 'TWD'; }).map(function (c) {
      return { symbol: c[0], price: '=GOOGLEFINANCE("CURRENCY:' + c[3] + '")', lastValid: '', quote: 'TWD', updatedAt: '', status: '尚未更新' };
    });

    var options = {};
    FinSchema.OPTION_LISTS.forEach(function (l) { options[l.header] = l.enumKey ? FinSchema.ENUMS[l.enumKey].slice() : []; });

    var holidays = TW_HOLIDAYS_2026.map(function (r) {
      return { market: '台灣', date: r[0], name: r[1], trading: false, settling: r[2], source: '手動' };
    });
    var year = +String(nowStr).slice(0, 4) || 2026;
    [year, year + 1].forEach(function (y) {
      FinUsHolidays.generate(y).forEach(function (r) {
        holidays.push({ market: '美國', date: r.date, name: r.name, trading: false, settling: false, source: '程式產生' });
      });
    });
    holidays.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    return { settings: settings, categories: categories, instruments: instruments, prices: prices, options: options, holidays: holidays };
  }

  return { build: build };
})();

// ==================== server/repo.js ====================
/**
 * Sheet 存取層：依 core/schema.js 的欄位定義讀寫，表頭以「中文文字」對應（欄位順序可被手動調整）。
 * 讀取時容忍手動編輯：空白列略過；欄位值不合法的列標記為 _bad 並回報，不讓整個系統壞掉。
 */
var FinClock = { now: function () { return Date.now(); } };

function FinFail(code, message, extra) {
  var e = new Error(message);
  e.finCode = code;
  e.extra = extra || null;
  return e;
}

var FinRepo = (function () {
  var cache = {};
  var ssCache = null;

  function props() { return PropertiesService.getScriptProperties(); }

  function reset() { cache = {}; ssCache = null; }
  function invalidate() { cache = {}; }

  function spreadsheet() {
    if (ssCache) return ssCache;
    var id = props().getProperty('SHEET_ID');
    if (!id) throw FinFail('NOT_INITIALIZED', '尚未初始化：請在試算表的「財務系統」選單執行「第一次設定」');
    ssCache = SpreadsheetApp.openById(id);
    return ssCache;
  }

  function sheetOf(tableKey) {
    var def = FinSchema.TABLES[tableKey];
    var sheet = spreadsheet().getSheetByName(def.sheet);
    if (!sheet) throw FinFail('SCHEMA', '找不到分頁「' + def.sheet + '」，請在「財務系統」選單重新執行「初始化／修復資料表」');
    return sheet;
  }

  // ---------- 欄位值解析 ----------
  function parseCell(v, type) {
    if (type === 'num') {
      if (v === '' || v === null || v === undefined) return { v: null };
      if (typeof v === 'number') return isFinite(v) ? { v: v } : { err: '不是有效數字' };
      var s = String(v).replace(/[,\s]/g, '');
      var n = Number(s);
      return s !== '' && isFinite(n) ? { v: n } : { err: '不是有效數字：「' + String(v) + '」' };
    }
    if (type === 'date') {
      var d = FinDates.fromCell(v);
      return d === null ? { err: '日期格式不正確：「' + String(v) + '」' } : { v: d };
    }
    if (type === 'ts') {
      if (v === null || v === undefined) return { v: '' };
      if (Object.prototype.toString.call(v) === '[object Date]') return { v: isNaN(v.getTime()) ? '' : FinDates.timestamp(v.getTime()) };
      return { v: String(v).trim() };
    }
    if (type === 'bool') {
      if (v === '' || v === null || v === undefined) return { v: true };
      if (typeof v === 'boolean') return { v: v };
      var t = String(v).trim().toUpperCase();
      return { v: !(t === 'FALSE' || t === '否' || t === 'N' || t === 'NO' || t === '0' || t === '停用') };
    }
    if (v === null || v === undefined) return { v: '' };
    if (Object.prototype.toString.call(v) === '[object Date]') return { v: isNaN(v.getTime()) ? '' : FinDates.today(v.getTime()) };
    return { v: String(v).trim() };
  }

  function encodeCell(v, type, allowFormula) {
    if (type === 'num') {
      if (allowFormula && typeof v === 'string' && v.charAt(0) === '=') return v;
      return (v === null || v === undefined || v === '') ? '' : Number(v);
    }
    if (type === 'bool') return v === false ? false : (v === true || v === undefined || v === null || v === '') ? true : !!v;
    return v === null || v === undefined ? '' : String(v);
  }

  function isBlankRow(row) {
    for (var i = 0; i < row.length; i++) if (row[i] !== '' && row[i] !== null && row[i] !== undefined) return false;
    return true;
  }

  function headerIndex(tableKey, headerRow) {
    var def = FinSchema.TABLES[tableKey];
    var header = headerRow.map(function (h) { return String(h === null || h === undefined ? '' : h).trim(); });
    var idx = {}, missing = [];
    def.cols.forEach(function (col) {
      var i = header.indexOf(col.header);
      idx[col.key] = i;
      if (i < 0) missing.push(col.header);
    });
    return { idx: idx, missing: missing, width: header.length };
  }

  // ---------- 讀取 ----------
  function readTable(tableKey) {
    if (cache[tableKey]) return cache[tableKey];
    var def = FinSchema.TABLES[tableKey];
    var sheet = sheetOf(tableKey);
    var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) throw FinFail('SCHEMA', '分頁「' + def.sheet + '」沒有表頭，請重新執行初始化');
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var h = headerIndex(tableKey, values[0]);
    if (h.missing.length) throw FinFail('SCHEMA', '分頁「' + def.sheet + '」缺少欄位：' + h.missing.join('、') + '。請執行「初始化／修復資料表」');
    var rows = [], bad = [], seen = {};
    for (var r = 1; r < values.length; r++) {
      var raw = values[r];
      if (isBlankRow(raw)) continue;
      var obj = { _row: r + 1 };
      var problems = [];
      def.cols.forEach(function (col) {
        var p = parseCell(raw[h.idx[col.key]], col.type);
        if (p.err) {
          // 公式欄位（例如現價）算出 #N/A 是正常狀況，視為「沒有價格」，不算資料錯誤
          if (!col.tolerant) problems.push(col.header + '：' + p.err);
          obj[col.key] = col.type === 'num' ? null : '';
        }
        else obj[col.key] = p.v;
      });
      if (def.idKey) {
        var id = obj[def.idKey];
        if (!id) problems.push(FinSchema.colOf(tableKey, def.idKey).header + '是空的');
        else if (seen[id]) problems.push('重複的 ' + FinSchema.colOf(tableKey, def.idKey).header + '：' + id + '（第 ' + seen[id] + ' 列已使用）');
        else seen[id] = r + 1;
      }
      if (problems.length) {
        obj._bad = problems;
        bad.push({ table: def.sheet, row: r + 1, id: def.idKey ? obj[def.idKey] : '', problems: problems });
      }
      rows.push(obj);
    }
    var result = { rows: rows, bad: bad };
    cache[tableKey] = result;
    return result;
  }

  /** 略過有問題（_bad）的列 */
  function goodRows(tableKey) {
    return readTable(tableKey).rows.filter(function (r) { return !r._bad; });
  }

  function findById(tableKey, id) {
    var def = FinSchema.TABLES[tableKey];
    var rows = readTable(tableKey).rows;
    for (var i = 0; i < rows.length; i++) if (rows[i][def.idKey] === id) return rows[i];
    return null;
  }

  function allIds(tableKey) {
    var def = FinSchema.TABLES[tableKey];
    return readTable(tableKey).rows.map(function (r) { return r[def.idKey]; });
  }

  function nextIds(tableKey, count) {
    var def = FinSchema.TABLES[tableKey];
    return FinIds.next(allIds(tableKey), def.idPrefix, def.idWidth, count || 1);
  }

  // ---------- 選項、設定 ----------
  function readOptions() {
    var out = {};
    var sheet = spreadsheet().getSheetByName(FinSchema.OPTIONS_SHEET);
    var cols = {};
    if (sheet && sheet.getLastRow() >= 1 && sheet.getLastColumn() >= 1) {
      var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
      for (var c = 0; c < values[0].length; c++) {
        var name = String(values[0][c] || '').trim();
        if (!name) continue;
        cols[name] = [];
        for (var r = 1; r < values.length; r++) {
          var v = String(values[r][c] === null || values[r][c] === undefined ? '' : values[r][c]).trim();
          if (v) cols[name].push(v);
        }
      }
    }
    FinSchema.OPTION_LISTS.forEach(function (l) {
      var list = cols[l.header] || [];
      if (l.enumKey) {
        var canon = FinSchema.ENUMS[l.enumKey];
        var filtered = list.filter(function (v) { return canon.indexOf(v) >= 0; });
        out[l.header] = filtered.length ? filtered : canon.slice();
      } else {
        out[l.header] = list;
      }
    });
    return out;
  }

  function getSettings() {
    var map = {};
    goodRows('settings').forEach(function (r) { map[r.key] = r.value; });
    return map;
  }

  // ---------- 寫入 ----------
  function textColumnRuns(tableKey, idx) {
    var def = FinSchema.TABLES[tableKey];
    var cols = [];
    def.cols.forEach(function (col) {
      if ((col.type === 'text' || col.type === 'date' || col.type === 'ts') && idx[col.key] >= 0) cols.push(idx[col.key] + 1);
    });
    cols.sort(function (a, b) { return a - b; });
    var runs = [];
    cols.forEach(function (c) {
      var last = runs[runs.length - 1];
      if (last && last.end + 1 === c) last.end = c; else runs.push({ start: c, end: c });
    });
    return runs;
  }

  /** 把文字型欄位（含日期、時間戳記）設成純文字格式，避免 Sheets 自動把 '2026-03-04' 轉成日期、把 '=…' 當公式 */
  function applyTextFormats(sheet, tableKey, idx, startRow, numRows) {
    textColumnRuns(tableKey, idx).forEach(function (run) {
      sheet.getRange(startRow, run.start, numRows, run.end - run.start + 1).setNumberFormat('@');
    });
  }

  function ensureCapacity(sheet, tableKey, idx, lastNeeded) {
    var max = sheet.getMaxRows();
    if (lastNeeded > max) {
      var add = Math.max(lastNeeded - max, 200);
      sheet.insertRowsAfter(max, add);
      applyTextFormats(sheet, tableKey, idx, max + 1, add);
    }
  }

  function append(tableKey, objs, opts) {
    if (!objs.length) return [];
    var allowFormula = !!(opts && opts.allowFormulas);
    var def = FinSchema.TABLES[tableKey];
    var sheet = sheetOf(tableKey);
    var width = sheet.getLastColumn();
    var h = headerIndex(tableKey, sheet.getRange(1, 1, 1, width).getValues()[0]);
    if (h.missing.length) throw FinFail('SCHEMA', '分頁「' + def.sheet + '」缺少欄位：' + h.missing.join('、'));
    var start = Math.max(sheet.getLastRow(), 1) + 1;
    ensureCapacity(sheet, tableKey, h.idx, start + objs.length - 1);
    var rows = objs.map(function (o) {
      var row = [];
      for (var i = 0; i < h.width; i++) row.push('');
      def.cols.forEach(function (col) { row[h.idx[col.key]] = encodeCell(o[col.key], col.type, allowFormula); });
      return row;
    });
    sheet.getRange(start, 1, rows.length, h.width).setValues(rows);
    invalidate();
    return objs.map(function (o, i) { return start + i; });
  }

  /** 只更新 patch 裡有的欄位（保留其他欄位與你自己加的欄位） */
  function updateRow(tableKey, rowNumber, patch) {
    var def = FinSchema.TABLES[tableKey];
    var sheet = sheetOf(tableKey);
    var h = headerIndex(tableKey, sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
    var keys = Object.keys(patch).filter(function (k) { return h.idx[k] !== undefined && h.idx[k] >= 0; });
    if (!keys.length) return;
    var min = 1e9, max = -1;
    keys.forEach(function (k) { if (h.idx[k] < min) min = h.idx[k]; if (h.idx[k] > max) max = h.idx[k]; });
    var range = sheet.getRange(rowNumber, min + 1, 1, max - min + 1);
    var cur = range.getValues()[0];
    keys.forEach(function (k) { cur[h.idx[k] - min] = encodeCell(patch[k], FinSchema.colOf(tableKey, k).type); });
    range.setValues([cur]);
    invalidate();
  }

  /** 單一儲存格寫入（用於不能覆蓋公式的欄位，例如價格表的「現價」旁邊的欄位） */
  function setCells(tableKey, rowNumber, patch) {
    var sheet = sheetOf(tableKey);
    var h = headerIndex(tableKey, sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
    Object.keys(patch).forEach(function (k) {
      if (h.idx[k] === undefined || h.idx[k] < 0) return;
      sheet.getRange(rowNumber, h.idx[k] + 1).setValue(encodeCell(patch[k], FinSchema.colOf(tableKey, k).type));
    });
    invalidate();
  }

  function withLock(fn) {
    var lock = LockService.getScriptLock();
    try { lock.waitLock(20000); } catch (e) { throw FinFail('BUSY', '系統忙碌中，請稍後再試'); }
    try {
      invalidate();
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  function audit(action, tableKey, refId, summary, device) {
    try {
      append('auditLog', [{ at: FinDates.timestamp(FinClock.now()), action: action, table: FinSchema.TABLES[tableKey].sheet, refId: refId || '', summary: summary || '', device: device || '' }]);
    } catch (e) {
      // 稽核紀錄失敗不應讓主要操作失敗
    }
  }

  function sheetUrl() { try { return spreadsheet().getUrl(); } catch (e) { return ''; } }

  return {
    reset: reset, invalidate: invalidate, spreadsheet: spreadsheet, sheetOf: sheetOf, readTable: readTable, goodRows: goodRows,
    findById: findById, allIds: allIds, nextIds: nextIds, readOptions: readOptions, getSettings: getSettings, append: append,
    updateRow: updateRow, setCells: setCells, withLock: withLock, audit: audit, headerIndex: headerIndex,
    applyTextFormats: applyTextFormats, sheetUrl: sheetUrl, encodeCell: encodeCell, parseCell: parseCell,
  };
})();

// ==================== server/auth.js ====================
/**
 * 登入與工作階段：
 *  - 裝置授權碼（每台裝置一組，可個別撤銷）+ PIN，兩者都只存「加鹽雜湊」在 Script Properties
 *  - 授權碼正確但 PIN 錯誤才計入失敗次數（5 次鎖定 15 分鐘）。授權碼錯誤不計次，
 *    這樣不知道授權碼的人無法靠亂試把你鎖在門外。
 *  - 工作階段碼 = 裝置ID.發出時間.到期時間.效期.HMAC簽章；每次請求後若剩餘不到一半效期就自動續期
 */
var FinAuth = (function () {
  var DEVICES_KEY = 'DEVICES', PIN_KEY = 'PIN', HMAC_KEY = 'HMAC_KEY';
  var TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 I O 0 1
  var MIN_PIN_LENGTH = 6;

  function props() { return PropertiesService.getScriptProperties(); }

  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] & 0xff; // Apps Script 回傳有號位元組
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }
  function sha256Hex(str) { return toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str)); }
  function hmacHex(message, key) { return toHex(Utilities.computeHmacSha256Signature(message, key)); }

  function constEq(a, b) {
    a = String(a); b = String(b);
    var diff = a.length === b.length ? 0 : 1;
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  }

  function randomHex(n) {
    var out = '';
    while (out.length < n) out += Utilities.getUuid().replace(/-/g, '');
    return out.slice(0, n);
  }

  function generateToken() {
    var hex = randomHex(64), chars = '';
    for (var i = 0; i < 20; i++) chars += TOKEN_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) & 31);
    return chars.replace(/(.{5})(?=.)/g, '$1-'); // XXXXX-XXXXX-XXXXX-XXXXX
  }
  function normalizeToken(t) { return String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  function loadDevices() {
    var raw = props().getProperty(DEVICES_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch (e) { return []; }
  }
  function saveDevices(list) { props().setProperty(DEVICES_KEY, JSON.stringify(list)); }

  function hmacKey() {
    var k = props().getProperty(HMAC_KEY);
    if (!k) throw FinFail('NOT_INITIALIZED', '尚未初始化：請執行「第一次設定」');
    return k;
  }

  // ---------- 設定（選單使用） ----------
  function addDevice(name) {
    name = String(name || '').trim().slice(0, 30) || '未命名裝置';
    var list = loadDevices();
    var max = 0;
    list.forEach(function (d) { var n = parseInt(String(d.id).slice(1), 10); if (n > max) max = n; });
    var token = generateToken();
    var salt = randomHex(16);
    var dev = { id: 'D' + (max + 1), name: name, salt: salt, hash: sha256Hex(salt + ':' + normalizeToken(token)), createdAt: FinDates.timestamp(FinClock.now()) };
    list.push(dev);
    saveDevices(list);
    return { id: dev.id, name: dev.name, token: token };
  }
  function listDevices() {
    return loadDevices().map(function (d) { return { id: d.id, name: d.name, createdAt: d.createdAt }; });
  }
  function revokeDevice(id) {
    var list = loadDevices();
    var next = list.filter(function (d) { return d.id !== id; });
    if (next.length === list.length) return false;
    saveDevices(next);
    return true;
  }
  function pinPolicyError(pin) {
    pin = String(pin || '');
    if (pin.length < MIN_PIN_LENGTH) return 'PIN 至少要 ' + MIN_PIN_LENGTH + ' 碼';
    if (/^(.)\1+$/.test(pin)) return 'PIN 不能全部是同一個字元';
    return '';
  }
  function setPin(pin) {
    var bad = pinPolicyError(pin);
    if (bad) throw FinFail('WEAK_PIN', bad);
    var salt = randomHex(16);
    props().setProperty(PIN_KEY, JSON.stringify({ salt: salt, hash: sha256Hex(salt + ':' + String(pin)) }));
  }
  function hasPin() { return !!props().getProperty(PIN_KEY); }
  function checkPin(pin) {
    var raw = props().getProperty(PIN_KEY);
    if (!raw) return false;
    var rec = JSON.parse(raw);
    return constEq(sha256Hex(rec.salt + ':' + String(pin === null || pin === undefined ? '' : pin)), rec.hash);
  }
  function signOutAll() { props().setProperty(HMAC_KEY, randomHex(48)); }

  // ---------- 登入 ----------
  function numSetting(settings, key, def, min, max) {
    var n = Number(settings && settings[key]);
    if (!isFinite(n) || n <= 0) n = def;
    return Math.min(max, Math.max(min, n));
  }

  function issueSession(device, ttlMs, nowMs) {
    var payload = [device.id, nowMs, nowMs + ttlMs, ttlMs].join('.');
    return payload + '.' + hmacHex(payload, hmacKey());
  }

  function login(token, pin, settings) {
    var now = FinClock.now();
    var tok = normalizeToken(token);
    var match = null;
    loadDevices().forEach(function (d) {
      if (constEq(sha256Hex(d.salt + ':' + tok), d.hash)) match = d;
    });
    if (!match) {
      Utilities.sleep(700); // 拖慢亂猜
      throw FinFail('AUTH_FAILED', '授權碼或 PIN 錯誤');
    }
    var cache = CacheService.getScriptCache();
    var maxFails = numSetting(settings, '失敗鎖定次數', 5, 3, 20);
    var lockSec = numSetting(settings, '鎖定分鐘', 15, 1, 360) * 60;
    var lockKey = 'lock:' + match.id, failKey = 'fail:' + match.id;
    var until = Number(cache.get(lockKey) || 0);
    if (until > now) {
      var wait = Math.ceil((until - now) / 60000);
      throw FinFail('LOCKED', '嘗試次數過多，請 ' + wait + ' 分鐘後再試', { retryAfterSec: Math.ceil((until - now) / 1000) });
    }
    if (!hasPin()) throw FinFail('NOT_INITIALIZED', 'PIN 尚未設定：請在試算表選單執行「設定或變更 PIN」');
    if (!checkPin(pin)) {
      var fails = Number(cache.get(failKey) || 0) + 1;
      if (fails >= maxFails) {
        cache.put(lockKey, String(now + lockSec * 1000), lockSec);
        cache.remove(failKey);
        throw FinFail('LOCKED', '輸入錯誤次數過多，已鎖定 ' + Math.round(lockSec / 60) + ' 分鐘', { retryAfterSec: lockSec });
      }
      cache.put(failKey, String(fails), lockSec);
      throw FinFail('AUTH_FAILED', '授權碼或 PIN 錯誤（還可以再試 ' + (maxFails - fails) + ' 次）', { remaining: maxFails - fails });
    }
    cache.remove(failKey);
    var ttlMs = numSetting(settings, '閒置登出分鐘', 60, 5, 720) * 60000;
    return { session: issueSession(match, ttlMs, now), device: { id: match.id, name: match.name }, ttlMinutes: Math.round(ttlMs / 60000) };
  }

  /** 驗證工作階段碼，回傳 {deviceId, deviceName, ttlMs, expMs}；失敗丟出 AUTH_REQUIRED */
  function verifySession(session, nowMs) {
    var fail = function () { return FinFail('AUTH_REQUIRED', '登入已過期，請重新登入'); };
    if (!session || typeof session !== 'string') throw fail();
    var parts = session.split('.');
    if (parts.length !== 5) throw fail();
    var payload = parts.slice(0, 4).join('.');
    var key;
    try { key = hmacKey(); } catch (e) { throw fail(); }
    if (!constEq(hmacHex(payload, key), parts[4])) throw fail();
    var exp = Number(parts[2]), ttl = Number(parts[3]);
    if (!(exp > nowMs)) throw fail();
    var dev = null;
    loadDevices().forEach(function (d) { if (d.id === parts[0]) dev = d; });
    if (!dev) throw fail(); // 裝置已被撤銷
    return { deviceId: dev.id, deviceName: dev.name, ttlMs: ttl, expMs: exp };
  }

  /** 剩餘不到一半效期就換發新的（滑動視窗） */
  function refreshIfNeeded(sess, nowMs) {
    if (sess.expMs - nowMs >= sess.ttlMs / 2) return null;
    return issueSession({ id: sess.deviceId }, sess.ttlMs, nowMs);
  }

  return {
    addDevice: addDevice, listDevices: listDevices, revokeDevice: revokeDevice, setPin: setPin, hasPin: hasPin, checkPin: checkPin,
    pinPolicyError: pinPolicyError, signOutAll: signOutAll, login: login, verifySession: verifySession, refreshIfNeeded: refreshIfNeeded,
    randomHex: randomHex, generateToken: generateToken, constEq: constEq, MIN_PIN_LENGTH: MIN_PIN_LENGTH,
  };
})();

// ==================== server/api.js ====================
/**
 * API：所有請求走 POST { action, params, session }；回應 { ok, data, session? } 或 { ok:false, error:{code,message,details?} }。
 * 除了 login / ping，其他操作都要有效的工作階段碼。寫入操作一律加鎖，並記錄到「異動紀錄」。
 */
var FinApi = (function () {
  var MAX_PAGE = 500;

  function ts(ms) { return FinDates.timestamp(ms); }
  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  function pub(row) {
    var o = {};
    Object.keys(row).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = row[k]; });
    return o;
  }
  function mapBy(rows, key) {
    var m = {};
    rows.forEach(function (r) { m[r[key]] = r; });
    return m;
  }
  function bySort(a, b) {
    var sa = a.sort === null ? 1e9 : a.sort, sb = b.sort === null ? 1e9 : b.sort;
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  // ---------- 載入主檔與交易 ----------
  function loadContext(now) {
    var settings = FinRepo.getSettings();
    var instrumentRows = FinRepo.goodRows('instruments');
    var instruments = mapBy(instrumentRows, 'symbol');
    var accountRows = FinRepo.goodRows('accounts').sort(bySort);
    var categoryRows = FinRepo.goodRows('categories').sort(bySort);
    var txAll = FinRepo.readTable('transactions');
    var txRows = txAll.rows.filter(function (r) { return !r._bad; });
    var prices = {}, priceInfo = {};
    FinRepo.goodRows('prices').forEach(function (r) {
      var p = r.price > 0 ? r.price : (r.lastValid > 0 ? r.lastValid : null);
      if (p !== null) prices[r.symbol] = p;
      priceInfo[r.symbol] = { price: p, status: r.price > 0 ? '正常' : (r.lastValid > 0 ? '沿用舊值' : '缺價格'), updatedAt: r.updatedAt };
    });
    var base = settings['基準幣別'] || 'TWD';
    var brokerRows = FinRepo.goodRows('brokerSettings');
    var holidayRows = FinRepo.goodRows('holidays');
    var cardRows = FinRepo.goodRows('cardSettings');
    var loanRows = FinRepo.goodRows('loanSettings');
    return {
      now: now, today: FinDates.today(now), base: base, settings: settings, instruments: instruments, instrumentRows: instrumentRows,
      accountRows: accountRows, accounts: mapBy(accountRows, 'id'), categoryRows: categoryRows, categories: mapBy(categoryRows, 'id'),
      txRows: txRows, txById: mapBy(txRows, 'id'), prices: prices, priceInfo: priceInfo,
      brokerRows: brokerRows, brokerByAccount: mapBy(brokerRows, 'accountId'), holidayRows: holidayRows,
      cardRows: cardRows, cardByAccount: mapBy(cardRows, 'accountId'), loanRows: loanRows, loanByAccount: mapBy(loanRows, 'accountId'),
      bad: [].concat(FinRepo.readTable('accounts').bad, FinRepo.readTable('categories').bad, FinRepo.readTable('instruments').bad,
        txAll.bad, FinRepo.readTable('prices').bad, FinRepo.readTable('brokerSettings').bad, FinRepo.readTable('holidays').bad,
        FinRepo.readTable('cardSettings').bad, FinRepo.readTable('loanSettings').bad),
    };
  }

  function validationCtx(c, existing) {
    return { accounts: c.accounts, categories: c.categories, instruments: c.instruments, transactions: c.txById, prices: c.prices, base: c.base, today: c.today, existing: existing || null };
  }

  function computeAll(c) {
    var bal = FinLedger.computeBalances(c.txRows, c.instruments, { asOf: c.today });
    var list = FinLedger.balanceList(bal.units, c.instruments);
    var nw = FinValuation.netWorth(list, { instruments: c.instruments, prices: c.prices, accounts: c.accounts, base: c.base });
    var pending = FinLedger.pendingSettlement(c.txRows, c.instruments, c.today);
    return { balances: list, netWorth: nw, ledgerIssues: bal.issues, pending: pending };
  }

  function failValidation(res) {
    var first = res.errors.length ? res.errors[0].message : '資料不正確';
    return FinFail('VALIDATION', first, { errors: res.errors, warnings: res.warnings });
  }

  function summarizeTx(t) {
    var leg = t.srcAccount ? (t.srcAccount + ' ' + t.srcQty + ' ' + t.srcSymbol) : '';
    var leg2 = t.dstAccount ? (t.dstAccount + ' ' + t.dstQty + ' ' + t.dstSymbol) : '';
    return t.date + ' ' + t.type + ' ' + [leg && ('付 ' + leg), leg2 && ('收 ' + leg2)].filter(Boolean).join('，') + (t.note ? '（' + t.note + '）' : '');
  }

  function checkExpected(row, expected) {
    if (expected === undefined || expected === null) throw FinFail('BAD_REQUEST', '缺少 expectedUpdatedAt（為避免覆蓋別台裝置的修改，更新時必須帶入）');
    if (String(expected) !== String(row.updatedAt)) {
      throw FinFail('CONFLICT', '這筆資料剛剛在別處被修改過，請重新整理後再操作', { current: pub(row) });
    }
  }

  var cacheGet = function (k) { return CacheService.getScriptCache().get(k); };
  var cachePut = function (k, v, sec) { CacheService.getScriptCache().put(k, v, sec); };

  // ---------- handlers ----------
  var H = {};

  H.ping = { auth: false, fn: function () { return { name: 'finance-web', version: FinSchema.APP_VERSION }; } };

  H.login = {
    auth: false,
    fn: function (p) {
      var settings = {};
      try { settings = FinRepo.getSettings(); } catch (e) { settings = {}; }
      var r = FinAuth.login(p.token, p.pin, settings);
      return r;
    },
  };

  H.bootstrap = {
    fn: function (p, env) {
      var c = loadContext(env.now);
      var calc = computeAll(c);
      var month = FinReport.monthSummary(c.txRows, { instruments: c.instruments, prices: c.prices, base: c.base, categories: c.categories }, FinDates.ymOf(c.today));
      var recent = FinLedger.filterTransactions(c.txRows, {}, { accounts: c.accounts, categories: c.categories }).slice(0, 8).map(pub);
      var nw = calc.netWorth;
      return {
        version: FinSchema.APP_VERSION, today: c.today, base: c.base, sheetUrl: FinRepo.sheetUrl(), device: env.device,
        options: FinRepo.readOptions(),
        accounts: c.accountRows.map(pub), categories: c.categoryRows.map(pub),
        instruments: Object.keys(c.instruments).map(function (k) { return pub(c.instruments[k]); }),
        brokerSettings: c.brokerRows.map(pub), holidays: c.holidayRows.map(pub),
        cardSettings: c.cardRows.map(pub), loanSettings: c.loanRows.map(pub),
        prices: c.priceInfo,
        balances: calc.balances.map(function (b) { return { accountId: b.accountId, symbol: b.symbol, qty: b.qty }; }),
        pending: calc.pending,
        netWorth: { base: nw.base, total: nw.total, assets: nw.assets, liabilities: nw.liabilities, byAccount: nw.byAccount, byType: nw.byType, missing: nw.missing },
        month: month, recent: recent,
        issues: { count: c.bad.length + calc.ledgerIssues.length, items: c.bad.slice(0, 20), ledger: calc.ledgerIssues.slice(0, 20) },
        enabledTxTypes: FinSchema.ENABLED_TX_TYPES,
      };
    },
  };

  H.listTransactions = {
    fn: function (p, env) {
      var c = loadContext(env.now);
      var f = p.filters || {};
      var filters = {
        from: FinDates.isValid(f.from) ? f.from : '', to: FinDates.isValid(f.to) ? f.to : '', type: str(f.type), accountId: str(f.accountId),
        categoryId: str(f.categoryId), q: str(f.q).slice(0, 60), status: str(f.status), includeVoid: !!f.includeVoid,
      };
      var all = FinLedger.filterTransactions(c.txRows, filters, { accounts: c.accounts, categories: c.categories });
      var limit = Math.min(MAX_PAGE, Math.max(1, Number(p.limit) || 50));
      var offset = Math.max(0, Number(p.offset) || 0);
      return { items: all.slice(offset, offset + limit).map(pub), total: all.length };
    },
  };

  H.monthSummary = {
    fn: function (p, env) {
      var ym = str(p.ym);
      if (!/^\d{4}-\d{2}$/.test(ym)) throw FinFail('BAD_REQUEST', '月份格式應為 yyyy-MM');
      var c = loadContext(env.now);
      return FinReport.monthSummary(c.txRows, { instruments: c.instruments, prices: c.prices, base: c.base, categories: c.categories }, ym);
    },
  };

  H.addTransaction = {
    fn: function (p, env) {
      if (!p.tx || typeof p.tx !== 'object') throw FinFail('BAD_REQUEST', '缺少交易資料');
      var requestId = str(p.requestId).slice(0, 64);
      return FinRepo.withLock(function () {
        if (requestId) {
          var prev = cacheGet('req:' + requestId);
          if (prev) return JSON.parse(prev); // 網路重送：回傳第一次的結果，不重複新增
        }
        var c = loadContext(env.now);
        var res = FinValidate.validateTransaction(p.tx, validationCtx(c, null));
        if (!res.ok) throw failValidation(res);
        var t = res.tx;
        t.id = FinRepo.nextIds('transactions', 1)[0];
        t.createdAt = ts(env.now); t.updatedAt = t.createdAt;
        FinRepo.append('transactions', [t]);
        FinRepo.audit('新增', 'transactions', t.id, summarizeTx(t), env.device);
        var out = { tx: pub(t), warnings: res.warnings };
        if (requestId) cachePut('req:' + requestId, JSON.stringify(out), 600);
        return out;
      });
    },
  };

  function loadTxForWrite(c, id) {
    var row = FinRepo.findById('transactions', id);
    if (!row) throw FinFail('NOT_FOUND', '找不到交易 ' + id);
    if (row._bad) throw FinFail('DATA_BAD', '這筆交易的資料有問題（' + row._bad.join('；') + '），請直接在試算表修正');
    return row;
  }

  H.updateTransaction = {
    fn: function (p, env) {
      if (!p.tx || typeof p.tx !== 'object') throw FinFail('BAD_REQUEST', '缺少交易資料');
      return FinRepo.withLock(function () {
        var c = loadContext(env.now);
        var row = loadTxForWrite(c, str(p.id));
        if (row.status === '作廢') throw FinFail('VOIDED', '已作廢的交易不能編輯，請先還原');
        checkExpected(row, p.expectedUpdatedAt);
        var existing = pub(row);
        var res = FinValidate.validateTransaction(p.tx, validationCtx(c, existing));
        if (!res.ok) throw failValidation(res);
        var t = res.tx;
        t.updatedAt = ts(env.now);
        var patch = {};
        FinSchema.TABLES.transactions.cols.forEach(function (col) {
          if (col.key === 'id' || col.key === 'createdAt' || col.key === 'status') return;
          patch[col.key] = t[col.key];
        });
        FinRepo.updateRow('transactions', row._row, patch);
        t.id = existing.id; t.createdAt = existing.createdAt; t.status = existing.status;
        FinRepo.audit('修改', 'transactions', t.id, '改為：' + summarizeTx(t), env.device);
        return { tx: pub(t), warnings: res.warnings };
      });
    },
  };

  function setStatus(from, to, action) {
    return {
      fn: function (p, env) {
        return FinRepo.withLock(function () {
          var c = loadContext(env.now);
          var row = loadTxForWrite(c, str(p.id));
          if (from.indexOf(row.status) < 0) throw FinFail('BAD_STATE', '這筆交易目前的狀態是「' + row.status + '」，不能' + action);
          checkExpected(row, p.expectedUpdatedAt);
          var now = ts(env.now);
          FinRepo.updateRow('transactions', row._row, { status: to, updatedAt: now });
          FinRepo.audit(action, 'transactions', row.id, summarizeTx(row), env.device);
          var out = pub(row); out.status = to; out.updatedAt = now;
          return { tx: out };
        });
      },
    };
  }
  H.voidTransaction = setStatus(['有效', '待確認'], '作廢', '作廢');
  H.restoreTransaction = setStatus(['作廢'], '有效', '還原');

  // ---------- 帳戶 ----------
  function validateAccountInput(a, c, isNew, existing) {
    var errors = [];
    var name = str(a.name);
    if (!name) errors.push({ field: 'name', message: '請輸入帳戶名稱' });
    else if (name.length > 40) errors.push({ field: 'name', message: '帳戶名稱最多 40 字' });
    else {
      var dup = c.accountRows.some(function (x) { return x.id !== (existing ? existing.id : '') && x.name.toLowerCase() === name.toLowerCase(); });
      if (dup) errors.push({ field: 'name', message: '已經有同名的帳戶「' + name + '」' });
    }
    var type = str(a.type);
    if (FinSchema.ENUMS.accountTypes.indexOf(type) < 0) errors.push({ field: 'type', message: '請選擇帳戶類型' });
    var sym = str(a.defaultSymbol) || 'TWD';
    var inst = c.instruments[sym];
    if (!inst || (!inst.active && !(existing && existing.defaultSymbol === sym))) errors.push({ field: 'defaultSymbol', message: '找不到預設幣別「' + sym + '」' });
    var institution = str(a.institution), note = str(a.note);
    if (institution.length > 40) errors.push({ field: 'institution', message: '機構最多 40 字' });
    if (note.length > 200) errors.push({ field: 'note', message: '備註最多 200 字' });
    var sort = a.sort === undefined || a.sort === null || a.sort === '' ? null : Number(a.sort);
    if (sort !== null && !isFinite(sort)) errors.push({ field: 'sort', message: '排序必須是數字' });
    return { errors: errors, value: { name: name, type: type, defaultSymbol: sym, institution: FinValidate.safeText(institution), note: FinValidate.safeText(note), sort: sort } };
  }

  H.upsertAccount = {
    fn: function (p, env) {
      var a = p.account;
      if (!a || typeof a !== 'object') throw FinFail('BAD_REQUEST', '缺少帳戶資料');
      return FinRepo.withLock(function () {
        var c = loadContext(env.now);
        var existing = a.id ? FinRepo.findById('accounts', str(a.id)) : null;
        if (a.id && !existing) throw FinFail('NOT_FOUND', '找不到帳戶 ' + a.id);
        if (existing && existing._bad) throw FinFail('DATA_BAD', '這個帳戶的資料有問題，請直接在試算表修正');
        if (existing) checkExpected(existing, p.expectedUpdatedAt);
        var r = validateAccountInput(a, c, !existing, existing);
        if (r.errors.length) throw FinFail('VALIDATION', r.errors[0].message, { errors: r.errors, warnings: [] });
        var now = ts(env.now), v = r.value, out;
        if (existing) {
          var patch = { name: v.name, type: v.type, defaultSymbol: v.defaultSymbol, institution: v.institution, note: v.note, updatedAt: now };
          if (v.sort !== null) patch.sort = v.sort;
          FinRepo.updateRow('accounts', existing._row, patch);
          out = pub(existing); Object.keys(patch).forEach(function (k) { out[k] = patch[k]; });
          FinRepo.audit('修改', 'accounts', out.id, out.name, env.device);
        } else {
          var maxSort = 0;
          c.accountRows.forEach(function (x) { if (x.sort !== null && x.sort > maxSort) maxSort = x.sort; });
          out = { id: FinRepo.nextIds('accounts', 1)[0], name: v.name, institution: v.institution, type: v.type, defaultSymbol: v.defaultSymbol,
            sort: v.sort !== null ? v.sort : maxSort + 10, active: true, note: v.note, createdAt: now, updatedAt: now };
          FinRepo.append('accounts', [out]);
          FinRepo.audit('新增', 'accounts', out.id, out.name, env.device);
        }
        return { account: out };
      });
    },
  };

  H.setAccountActive = {
    fn: function (p, env) {
      return FinRepo.withLock(function () {
        var c = loadContext(env.now);
        var row = FinRepo.findById('accounts', str(p.id));
        if (!row) throw FinFail('NOT_FOUND', '找不到帳戶');
        var active = !!p.active, warnings = [];
        if (!active) {
          var nonzero = computeAll(c).balances.filter(function (b) { return b.accountId === row.id; });
          if (nonzero.length) warnings.push('這個帳戶還有餘額，停用後仍會計入淨值；建議先把餘額轉出或調整為 0');
        }
        var now = ts(env.now);
        FinRepo.updateRow('accounts', row._row, { active: active, updatedAt: now });
        FinRepo.audit(active ? '啟用' : '停用', 'accounts', row.id, row.name, env.device);
        var out = pub(row); out.active = active; out.updatedAt = now;
        return { account: out, warnings: warnings };
      });
    },
  };

  // ---------- 分類 ----------
  H.upsertCategory = {
    fn: function (p, env) {
      var g = p.category;
      if (!g || typeof g !== 'object') throw FinFail('BAD_REQUEST', '缺少分類資料');
      return FinRepo.withLock(function () {
        var c = loadContext(env.now);
        var existing = g.id ? FinRepo.findById('categories', str(g.id)) : null;
        if (g.id && !existing) throw FinFail('NOT_FOUND', '找不到分類 ' + g.id);
        if (existing && existing._bad) throw FinFail('DATA_BAD', '這個分類的資料有問題，請直接在試算表修正');
        if (existing) checkExpected(existing, p.expectedUpdatedAt);
        var errors = [];
        var name = str(g.name), type = existing ? existing.type : str(g.type), parentId = str(g.parentId), icon = str(g.icon), color = str(g.color);
        if (existing && existing.type === '系統') errors.push({ field: 'name', message: '系統分類不能修改' });
        if (existing && g.type && str(g.type) !== existing.type) errors.push({ field: 'type', message: '分類建立後不能改「收入／支出」類型，請新增一個分類' });
        if (type !== '收入' && type !== '支出' && !(existing && existing.type === '系統')) errors.push({ field: 'type', message: '請選擇「收入」或「支出」' });
        if (!name) errors.push({ field: 'name', message: '請輸入分類名稱' });
        else if (name.length > 30) errors.push({ field: 'name', message: '分類名稱最多 30 字' });
        if (icon.length > 8) errors.push({ field: 'icon', message: '圖示請用 1 個 emoji' });
        if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) errors.push({ field: 'color', message: '顏色格式應為 #RRGGBB' });
        if (parentId) {
          var parent = c.categories[parentId];
          if (!parent) errors.push({ field: 'parentId', message: '找不到上層分類' });
          else if (parent.parentId) errors.push({ field: 'parentId', message: '分類最多兩層' });
          else if (parent.type !== type) errors.push({ field: 'parentId', message: '上層分類的類型必須相同' });
          else if (existing && existing.id === parentId) errors.push({ field: 'parentId', message: '不能把自己當上層' });
          if (existing && c.categoryRows.some(function (x) { return x.parentId === existing.id; })) errors.push({ field: 'parentId', message: '這個分類底下還有子分類，不能再放到別的分類底下' });
        }
        if (name && !errors.length) {
          var dup = c.categoryRows.some(function (x) { return x.id !== (existing ? existing.id : '') && x.type === type && x.parentId === parentId && x.name === name; });
          if (dup) errors.push({ field: 'name', message: '同一層已經有「' + name + '」' });
        }
        var sort = g.sort === undefined || g.sort === null || g.sort === '' ? null : Number(g.sort);
        if (sort !== null && !isFinite(sort)) errors.push({ field: 'sort', message: '排序必須是數字' });
        if (errors.length) throw FinFail('VALIDATION', errors[0].message, { errors: errors, warnings: [] });

        var now = ts(env.now), out;
        if (existing) {
          var patch = { name: FinValidate.safeText(name), parentId: parentId, icon: icon, color: color || existing.color, updatedAt: now };
          if (sort !== null) patch.sort = sort;
          FinRepo.updateRow('categories', existing._row, patch);
          out = pub(existing); Object.keys(patch).forEach(function (k) { out[k] = patch[k]; });
          FinRepo.audit('修改', 'categories', out.id, out.name, env.device);
        } else {
          var maxSort = 0;
          c.categoryRows.forEach(function (x) { if (x.type === type && x.parentId === parentId && x.sort !== null && x.sort < 900 && x.sort > maxSort) maxSort = x.sort; });
          out = { id: FinRepo.nextIds('categories', 1)[0], type: type, parentId: parentId, name: FinValidate.safeText(name), icon: icon, color: color || '#b3a58c',
            sort: sort !== null ? sort : maxSort + 10, active: true, createdAt: now, updatedAt: now };
          FinRepo.append('categories', [out]);
          FinRepo.audit('新增', 'categories', out.id, out.name, env.device);
        }
        return { category: out };
      });
    },
  };

  H.setCategoryActive = {
    fn: function (p, env) {
      return FinRepo.withLock(function () {
        loadContext(env.now);
        var row = FinRepo.findById('categories', str(p.id));
        if (!row) throw FinFail('NOT_FOUND', '找不到分類');
        if (row.type === '系統') throw FinFail('VALIDATION', '系統分類不能停用');
        var active = !!p.active, now = ts(env.now);
        FinRepo.updateRow('categories', row._row, { active: active, updatedAt: now });
        FinRepo.audit(active ? '啟用' : '停用', 'categories', row.id, row.name, env.device);
        var out = pub(row); out.active = active; out.updatedAt = now;
        return { category: out };
      });
    },
  };

  // ---------- 標的（股票／ETF／加密貨幣／貨幣） ----------
  function validateInstrumentInput(a, c, existing) {
    var errors = [];
    var symbol = str(a.symbol).toUpperCase();
    if (!symbol) errors.push({ field: 'symbol', message: '請輸入標的代號' });
    else if (symbol.length > 20) errors.push({ field: 'symbol', message: '標的代號最多 20 字' });
    else if (!existing && c.instruments[symbol]) errors.push({ field: 'symbol', message: '已經有這個標的代號' });
    else if (existing && existing.symbol !== symbol) errors.push({ field: 'symbol', message: '標的代號建立後不能修改' });
    var name = str(a.name);
    if (!name) errors.push({ field: 'name', message: '請輸入標的名稱' });
    else if (name.length > 60) errors.push({ field: 'name', message: '標的名稱最多 60 字' });
    var type = str(a.type);
    if (FinSchema.ENUMS.instrumentTypes.indexOf(type) < 0) errors.push({ field: 'type', message: '請選擇標的類型' });
    var quote = str(a.quote) || 'TWD';
    var quoteInst = c.instruments[quote];
    if (type !== '法幣') {
      if (!quoteInst || quoteInst.type !== '法幣') errors.push({ field: 'quote', message: '計價幣別必須是已存在的法幣標的' });
    } else if (quote !== symbol) {
      errors.push({ field: 'quote', message: '法幣的計價幣別必須是自己' });
    }
    var decimals = a.decimals === undefined || a.decimals === null || a.decimals === '' ? 0 : Number(a.decimals);
    if (!isFinite(decimals) || decimals < 0 || decimals > 8 || Math.floor(decimals) !== decimals) errors.push({ field: 'decimals', message: '小數位數必須是 0～8 的整數' });
    var priceSource = str(a.priceSource) || '手動';
    if (FinSchema.ENUMS.priceSources.indexOf(priceSource) < 0) errors.push({ field: 'priceSource', message: '請選擇價格來源' });
    var quoteCode = str(a.quoteCode), note = str(a.note);
    if (quoteCode.length > 60) errors.push({ field: 'quoteCode', message: '行情代碼最多 60 字' });
    if (note.length > 200) errors.push({ field: 'note', message: '備註最多 200 字' });
    return { errors: errors, value: { symbol: symbol, name: FinValidate.safeText(name), type: type, quote: quote, decimals: decimals, priceSource: priceSource, quoteCode: quoteCode, note: FinValidate.safeText(note) } };
  }

  H.upsertInstrument = {
    fn: function (p, env) {
      var a = p.instrument;
      if (!a || typeof a !== 'object') throw FinFail('BAD_REQUEST', '缺少標的資料');
      var isNew = a.isNew !== false; // 標的以代號本身當主鍵，不是自動編號，一律靠前端明確標示是新增還是編輯
      return FinRepo.withLock(function () {
        var c = loadContext(env.now);
        var symbolIn = str(a.symbol).toUpperCase();
        var existing = symbolIn ? FinRepo.findById('instruments', symbolIn) : null;
        if (!isNew) {
          if (!existing) throw FinFail('NOT_FOUND', '找不到標的 ' + symbolIn);
          if (existing._bad) throw FinFail('DATA_BAD', '這個標的的資料有問題，請直接在試算表修正');
          checkExpected(existing, p.expectedUpdatedAt);
        }
        var r = validateInstrumentInput(a, c, isNew ? null : existing);
        if (r.errors.length) throw FinFail('VALIDATION', r.errors[0].message, { errors: r.errors, warnings: [] });
        var now = ts(env.now), v = r.value, out;
        if (!isNew) {
          var patch = { name: v.name, type: v.type, quote: v.quote, decimals: v.decimals, priceSource: v.priceSource, quoteCode: v.quoteCode, note: v.note, updatedAt: now };
          FinRepo.updateRow('instruments', existing._row, patch);
          out = pub(existing); Object.keys(patch).forEach(function (k) { out[k] = patch[k]; });
          FinRepo.audit('修改', 'instruments', out.symbol, out.name, env.device);
        } else {
          out = { symbol: v.symbol, name: v.name, type: v.type, quote: v.quote, decimals: v.decimals, priceSource: v.priceSource, quoteCode: v.quoteCode, active: true, note: v.note, createdAt: now, updatedAt: now };
          FinRepo.append('instruments', [out]);
          FinRepo.audit('新增', 'instruments', out.symbol, out.name, env.device);
          // 新標的沒有現價，先補一列「價格」，避免持倉估值找不到資料
          try {
            if (!FinRepo.findById('prices', out.symbol)) {
              FinRepo.append('prices', [{ symbol: out.symbol, price: '', lastValid: '', quote: out.quote, updatedAt: '', status: '尚未更新' }]);
            }
          } catch (e) { /* 價格表若不存在不影響標的新增 */ }
        }
        return { instrument: out };
      });
    },
  };

  H.setInstrumentActive = {
    fn: function (p, env) {
      return FinRepo.withLock(function () {
        loadContext(env.now);
        var row = FinRepo.findById('instruments', str(p.symbol).toUpperCase());
        if (!row) throw FinFail('NOT_FOUND', '找不到標的');
        var active = !!p.active, now = ts(env.now);
        FinRepo.updateRow('instruments', row._row, { active: active, updatedAt: now });
        FinRepo.audit(active ? '啟用' : '停用', 'instruments', row.symbol, row.name, env.device);
        var out = pub(row); out.active = active; out.updatedAt = now;
        return { instrument: out };
      });
    },
  };

  // ---------- 證券帳戶設定 ----------
  function validateBrokerInput(a, c) {
    var errors = [];
    var accountId = str(a.accountId);
    var acct = c.accounts[accountId];
    if (!acct) errors.push({ field: 'accountId', message: '找不到帳戶' });
    else if (acct.type !== '證券' && acct.type !== '加密交易所') errors.push({ field: 'accountId', message: '只有「證券」或「加密交易所」類型的帳戶能設定券商資料' });
    var market = str(a.market);
    if (market && ['台股', '複委託'].indexOf(market) < 0) errors.push({ field: 'market', message: '市場請選擇「台股」或「複委託」' });
    var calendar = str(a.calendar) || (market === '複委託' ? '台灣+美國' : '台灣');
    if (['台灣', '台灣+美國'].indexOf(calendar) < 0) errors.push({ field: 'calendar', message: '交割日曆請選擇「台灣」或「台灣+美國」' });
    function num(field, label, def) {
      var v = a[field];
      if (v === undefined || v === null || v === '') return def;
      var n = Number(v);
      if (!isFinite(n) || n < 0) { errors.push({ field: field, message: label + '必須是不小於 0 的數字' }); return def; }
      return n;
    }
    var value = {
      accountId: accountId, market: market, feeRate: num('feeRate', '手續費率', 0), feeDiscount: num('feeDiscount', '手續費折扣', 1),
      feeCurrency: str(a.feeCurrency) || (market === '複委託' ? 'USD' : 'TWD'), minFee: num('minFee', '最低手續費', 0), oddLotMinFee: num('oddLotMinFee', '零股最低手續費', 0),
      sipFixedFee: num('sipFixedFee', '定期定額固定手續費', 0), sipFeeRate: num('sipFeeRate', '定期定額手續費率', 0), sipFeeCap: num('sipFeeCap', '定期定額每筆上限', 0),
      sipMinAmount: num('sipMinAmount', '定期定額最低單筆投入', 0), taxRateStock: num('taxRateStock', '證交稅率(股票)', market === '複委託' ? 0 : 0.003),
      taxRateEtf: num('taxRateEtf', '證交稅率(ETF)', market === '複委託' ? 0 : 0.001), buySettleDays: num('buySettleDays', '買入交割天數', market === '複委託' ? 1 : 2),
      sellSettleDays: num('sellSettleDays', '賣出交割天數', 2), calendar: calendar, settleAccountId: str(a.settleAccountId), note: FinValidate.safeText(str(a.note)),
    };
    if (value.settleAccountId && !c.accounts[value.settleAccountId]) errors.push({ field: 'settleAccountId', message: '找不到預設交割帳戶' });
    return { errors: errors, value: value };
  }

  H.upsertBrokerSettings = {
    fn: function (p, env) {
      var a = p.broker;
      if (!a || typeof a !== 'object') throw FinFail('BAD_REQUEST', '缺少證券帳戶設定資料');
      return FinRepo.withLock(function () {
        var c = loadContext(env.now);
        var r = validateBrokerInput(a, c);
        if (r.errors.length) throw FinFail('VALIDATION', r.errors[0].message, { errors: r.errors, warnings: [] });
        var v = r.value, existing = FinRepo.findById('brokerSettings', v.accountId), out;
        if (existing) {
          FinRepo.updateRow('brokerSettings', existing._row, v);
          out = v;
        } else {
          FinRepo.append('brokerSettings', [v]);
          out = v;
        }
        FinRepo.audit(existing ? '修改' : '新增', 'brokerSettings', v.accountId, (c.accounts[v.accountId] || {}).name || v.accountId, env.device);
        return { broker: out };
      });
    },
  };

  // ---------- 信用卡設定與帳單 ----------
  function validateCardSettingsInput(a, c) {
    var errors = [];
    var accountId = str(a.accountId);
    var acct = c.accounts[accountId];
    if (!acct) errors.push({ field: 'accountId', message: '找不到帳戶' });
    else if (acct.type !== '信用卡') errors.push({ field: 'accountId', message: '只有「信用卡」類型的帳戶能設定信用卡資料' });
    function dayField(field, label) {
      var v = a[field];
      var n = v === undefined || v === null || v === '' ? NaN : Number(v);
      if (!isFinite(n) || n < 1 || n > 31 || Math.floor(n) !== n) { errors.push({ field: field, message: label + '請輸入 1～31 的整數' }); return 1; }
      return n;
    }
    var statementDay = dayField('statementDay', '結帳日');
    var dueDay = dayField('dueDay', '繳款日');
    var limitVal = a.limit === undefined || a.limit === null || a.limit === '' ? 0 : Number(a.limit);
    if (!isFinite(limitVal) || limitVal < 0) { errors.push({ field: 'limit', message: '額度必須是不小於 0 的數字' }); limitVal = 0; }
    var payAccountId = str(a.payAccountId);
    if (payAccountId && !c.accounts[payAccountId]) errors.push({ field: 'payAccountId', message: '找不到預設繳款帳戶' });
    var value = { accountId: accountId, limit: limitVal, statementDay: statementDay, dueDay: dueDay, expiry: str(a.expiry), payAccountId: payAccountId, note: FinValidate.safeText(str(a.note)) };
    return { errors: errors, value: value };
  }

  H.upsertCardSettings = {
    fn: function (p, env) {
      var a = p.card;
      if (!a || typeof a !== 'object') throw FinFail('BAD_REQUEST', '缺少信用卡設定資料');
      return FinRepo.withLock(function () {
        var c = loadContext(env.now);
        var r = validateCardSettingsInput(a, c);
        if (r.errors.length) throw FinFail('VALIDATION', r.errors[0].message, { errors: r.errors, warnings: [] });
        var v = r.value, existing = FinRepo.findById('cardSettings', v.accountId), out;
        if (existing) { FinRepo.updateRow('cardSettings', existing._row, v); out = v; } else { FinRepo.append('cardSettings', [v]); out = v; }
        FinRepo.audit(existing ? '修改' : '新增', 'cardSettings', v.accountId, (c.accounts[v.accountId] || {}).name || v.accountId, env.device);
        return { card: out };
      });
    },
  };

  H.getCardStatement = {
    fn: function (p, env) {
      var c = loadContext(env.now);
      var accountId = str(p.accountId);
      var acct = c.accounts[accountId];
      if (!acct || acct.type !== '信用卡') throw FinFail('NOT_FOUND', '找不到信用卡帳戶');
      var cs = c.cardByAccount[accountId];
      if (!cs) throw FinFail('NOT_FOUND', '這個帳戶還沒有信用卡設定，請先設定結帳日與繳款日');
      var symbol = acct.defaultSymbol;
      var inst = c.instruments[symbol];
      if (!inst) throw FinFail('DATA_BAD', '找不到幣別 ' + symbol);
      var asOf = FinDates.isValid(str(p.asOf)) ? str(p.asOf) : c.today;
      var s = FinCreditCard.summary(c.txRows, accountId, symbol, inst.decimals, cs, asOf);
      var out = { accountId: accountId, symbol: symbol, cardSettings: pub(cs) };
      Object.keys(s).forEach(function (k) { out[k] = s[k]; });
      return out;
    },
  };

  // ---------- 貸款設定與還款 ----------
  function validateLoanSettingsInput(a, c) {
    var errors = [];
    var accountId = str(a.accountId);
    var acct = c.accounts[accountId];
    if (!acct) errors.push({ field: 'accountId', message: '找不到帳戶' });
    else if (acct.type !== '貸款') errors.push({ field: 'accountId', message: '只有「貸款」類型的帳戶能設定貸款資料' });
    var principal = Number(a.principal);
    if (!isFinite(principal) || principal <= 0) errors.push({ field: 'principal', message: '貸款金額必須大於 0' });
    var rate = a.rate === undefined || a.rate === null || a.rate === '' ? 0 : Number(a.rate);
    if (!isFinite(rate) || rate < 0) errors.push({ field: 'rate', message: '年利率必須是不小於 0 的數字' });
    var terms = Number(a.terms);
    if (!isFinite(terms) || terms < 1 || Math.floor(terms) !== terms) errors.push({ field: 'terms', message: '期數必須是大於 0 的整數' });
    var startDate = str(a.startDate);
    if (!FinDates.isValid(startDate)) errors.push({ field: 'startDate', message: '起貸日格式不正確' });
    var payDay = Number(a.payDay);
    if (!isFinite(payDay) || payDay < 1 || payDay > 31 || Math.floor(payDay) !== payDay) errors.push({ field: 'payDay', message: '每月還款日請輸入 1～31 的整數' });
    var method = str(a.method);
    if (FinLoan.METHODS.indexOf(method) < 0) errors.push({ field: 'method', message: '還款方式請選擇：' + FinLoan.METHODS.join('、') });
    var payAccountId = str(a.payAccountId);
    if (payAccountId && !c.accounts[payAccountId]) errors.push({ field: 'payAccountId', message: '找不到預設扣款帳戶' });
    var value = { accountId: accountId, principal: principal, rate: rate, terms: terms, startDate: startDate, payDay: payDay, method: method, payAccountId: payAccountId };
    return { errors: errors, value: value };
  }

  H.upsertLoanSettings = {
    fn: function (p, env) {
      var a = p.loan;
      if (!a || typeof a !== 'object') throw FinFail('BAD_REQUEST', '缺少貸款設定資料');
      return FinRepo.withLock(function () {
        var c = loadContext(env.now);
        var r = validateLoanSettingsInput(a, c);
        if (r.errors.length) throw FinFail('VALIDATION', r.errors[0].message, { errors: r.errors, warnings: [] });
        var v = r.value, existing = FinRepo.findById('loanSettings', v.accountId), out;
        if (existing) { FinRepo.updateRow('loanSettings', existing._row, v); out = v; } else { FinRepo.append('loanSettings', [v]); out = v; }
        FinRepo.audit(existing ? '修改' : '新增', 'loanSettings', v.accountId, (c.accounts[v.accountId] || {}).name || v.accountId, env.device);
        return { loan: out };
      });
    },
  };

  H.getLoanSchedule = {
    fn: function (p, env) {
      var c = loadContext(env.now);
      var accountId = str(p.accountId);
      var acct = c.accounts[accountId];
      if (!acct || acct.type !== '貸款') throw FinFail('NOT_FOUND', '找不到貸款帳戶');
      var ls = c.loanByAccount[accountId];
      if (!ls) throw FinFail('NOT_FOUND', '這個帳戶還沒有貸款設定');
      var symbol = acct.defaultSymbol;
      var inst = c.instruments[symbol];
      if (!inst) throw FinFail('DATA_BAD', '找不到幣別 ' + symbol);
      var sched = FinLoan.schedule(ls, inst.decimals);
      var asOf = FinDates.isValid(str(p.asOf)) ? str(p.asOf) : c.today;
      var sum = FinLoan.summarize(sched, asOf);
      return { accountId: accountId, symbol: symbol, loanSettings: pub(ls), schedule: sched, summary: sum };
    },
  };

  /** 記一筆貸款還款：依攤還表算出這一期的本金／利息，寫成同一個群組 ID 的「轉帳」（本金）＋「支出」（利息，分類=利息）兩筆交易，一次鎖定寫入 */
  H.addLoanPayment = {
    fn: function (p, env) {
      var accountId = str(p.accountId), fromAccount = str(p.fromAccount);
      if (!accountId || !fromAccount) throw FinFail('BAD_REQUEST', '缺少貸款帳戶或扣款帳戶');
      var requestId = str(p.requestId).slice(0, 64);
      return FinRepo.withLock(function () {
        if (requestId) { var prevR = cacheGet('req:' + requestId); if (prevR) return JSON.parse(prevR); }
        var c = loadContext(env.now);
        var acct = c.accounts[accountId];
        if (!acct || acct.type !== '貸款') throw FinFail('NOT_FOUND', '找不到貸款帳戶');
        var ls = c.loanByAccount[accountId];
        if (!ls) throw FinFail('NOT_FOUND', '這個帳戶還沒有貸款設定');
        if (!c.accounts[fromAccount]) throw FinFail('VALIDATION', '找不到扣款帳戶');
        var symbol = acct.defaultSymbol;
        var inst = c.instruments[symbol];
        if (!inst) throw FinFail('DATA_BAD', '找不到幣別 ' + symbol);
        var sched = FinLoan.schedule(ls, inst.decimals);
        var row = p.period ? sched[Number(p.period) - 1] : FinLoan.findPeriod(sched, c.today);
        if (!row) throw FinFail('VALIDATION', '找不到這一期的還款資料（貸款可能已繳清，或期別超出範圍）');
        var date = FinDates.isValid(str(p.date)) ? str(p.date) : row.date;
        var legs = [];
        if (row.principal > 0) {
          var r1 = FinValidate.validateTransaction({ type: '轉帳', date: date, srcAccount: fromAccount, srcSymbol: symbol, srcQty: row.principal, dstAccount: accountId, dstSymbol: symbol, dstQty: row.principal, note: '貸款還款：第 ' + row.period + ' 期本金' }, validationCtx(c, null));
          if (!r1.ok) throw failValidation(r1);
          legs.push(r1.tx);
        }
        if (row.interest > 0) {
          var interestCat = c.categoryRows.filter(function (x) { return x.type === '支出' && x.name === '利息'; })[0];
          if (!interestCat) throw FinFail('VALIDATION', '找不到「利息」分類，請先在分類設定新增名為「利息」的支出分類');
          var r2 = FinValidate.validateTransaction({ type: '支出', date: date, srcAccount: fromAccount, srcSymbol: symbol, srcQty: row.interest, categoryId: interestCat.id, note: '貸款還款：第 ' + row.period + ' 期利息' }, validationCtx(c, null));
          if (!r2.ok) throw failValidation(r2);
          legs.push(r2.tx);
        }
        if (!legs.length) throw FinFail('VALIDATION', '這一期本金與利息都是 0，不需要記錄');
        var ids = FinRepo.nextIds('transactions', legs.length);
        var groupId = ids[0];
        var now = ts(env.now);
        legs.forEach(function (t, i) { t.id = ids[i]; t.groupId = groupId; t.createdAt = now; t.updatedAt = now; });
        FinRepo.append('transactions', legs);
        legs.forEach(function (t) { FinRepo.audit('新增', 'transactions', t.id, summarizeTx(t), env.device); });
        var out = { groupId: groupId, period: row.period, transactions: legs.map(pub) };
        if (requestId) cachePut('req:' + requestId, JSON.stringify(out), 600);
        return out;
      });
    },
  };

  // ---------- 持倉／投資損益 ----------
  H.getHoldings = {
    fn: function (p, env) {
      var c = loadContext(env.now);
      var asOf = FinDates.isValid(str(p.asOf)) ? str(p.asOf) : c.today;
      var priceHistoryRows = FinRepo.goodRows('priceHistory');
      var priceHistory = {};
      priceHistoryRows.forEach(function (r) { priceHistory[r.date + '|' + r.symbol] = r.close; });
      var h = FinHoldings.computeHoldings(c.txRows, c.instruments, { base: c.base, asOf: asOf, prices: c.prices, priceHistory: priceHistory });
      var valued = FinHoldings.valuePositions(h.positions, c.instruments, c.prices, c.base);
      return { asOf: asOf, positions: valued, realized: h.realized, dividends: h.dividends, issues: h.issues };
    },
  };

  H.changePin = {
    fn: function (p, env) {
      if (!FinAuth.checkPin(p.oldPin)) throw FinFail('AUTH_FAILED', '目前的 PIN 不正確');
      FinAuth.setPin(p.newPin);
      FinRepo.audit('修改', 'settings', '', '變更 PIN', env.device);
      return { changed: true };
    },
  };

  // ---------- 進入點 ----------
  function errorResponse(e) {
    if (e && e.finCode) {
      var err = { code: e.finCode, message: e.message };
      if (e.extra) err.details = e.extra;
      return { ok: false, error: err };
    }
    try { Logger.log('INTERNAL ERROR: ' + (e && e.stack ? e.stack : e)); } catch (x) { /* ignore */ }
    return { ok: false, error: { code: 'INTERNAL', message: '系統發生錯誤，請稍後再試' } };
  }

  function handle(body) {
    FinRepo.reset();
    var now = FinClock.now();
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw FinFail('BAD_REQUEST', '請求格式錯誤');
      var h = Object.prototype.hasOwnProperty.call(H, body.action) ? H[body.action] : null;
      if (!h) throw FinFail('BAD_ACTION', '不支援的操作');
      var sess = null;
      if (h.auth !== false) sess = FinAuth.verifySession(body.session, now);
      var env = { device: sess ? sess.deviceName : '', session: sess, now: now };
      var data = h.fn(body.params && typeof body.params === 'object' ? body.params : {}, env);
      var out = { ok: true, data: data };
      if (sess) { var ns = FinAuth.refreshIfNeeded(sess, now); if (ns) out.session = ns; }
      return out;
    } catch (e) {
      return errorResponse(e);
    }
  }

  return { handle: handle, actions: Object.keys(H) };
})();

// ==================== server/setup.js ====================
/**
 * 初始化與維運：建立／修復 16 張資料表、寫入預設資料、排程工作。
 * 全部可重複執行（idempotent）：已存在的分頁與資料不會被覆蓋。
 */
var FinSetup = (function () {
  var HEADER_BG = '#efe3c8';

  function ensureSheet(ss, tableKey, report) {
    var isOptions = tableKey === 'options';
    var name = isOptions ? FinSchema.OPTIONS_SHEET : FinSchema.TABLES[tableKey].sheet;
    var headers = isOptions ? FinSchema.OPTION_LISTS.map(function (l) { return l.header; }) : FinSchema.headers(tableKey);
    var sheet = ss.getSheetByName(name);
    var created = false;
    if (!sheet) { sheet = ss.insertSheet(name, ss.getSheets().length); created = true; report.created.push(name); }

    var lastCol = sheet.getLastColumn();
    var existing = [];
    if (sheet.getLastRow() >= 1 && lastCol >= 1) existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      var startCol = existing.filter(function (h) { return h !== ''; }).length ? lastCol + 1 : 1;
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground(HEADER_BG);
      if (!created) report.repaired.push(name + '（補上欄位：' + missing.join('、') + '）');
    }
    sheet.setFrozenRows(1);

    // 文字型欄位設為純文字格式（避免日期被自動轉換、備註被當成公式）
    var finalHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var maxRows = sheet.getMaxRows();
    if (isOptions) {
      sheet.getRange(1, 1, maxRows, sheet.getLastColumn()).setNumberFormat('@');
    } else {
      var h = FinRepo.headerIndex(tableKey, finalHeader);
      FinRepo.applyTextFormats(sheet, tableKey, h.idx, 2, Math.max(1, maxRows - 1));
    }
    return { sheet: sheet, created: created };
  }

  function hasData(sheet) { return sheet.getLastRow() > 1; }

  function seedIfEmpty(ss, report, nowStr) {
    var seed = FinSeed.build(nowStr);
    var plan = [['settings', seed.settings, {}], ['categories', seed.categories, {}], ['instruments', seed.instruments, {}], ['prices', seed.prices, { allowFormulas: true }], ['holidays', seed.holidays, {}]];
    plan.forEach(function (p) {
      var sheet = ss.getSheetByName(FinSchema.TABLES[p[0]].sheet);
      if (hasData(sheet)) return;
      FinRepo.append(p[0], p[1], p[2]);
      report.seeded.push(FinSchema.TABLES[p[0]].sheet + '：' + p[1].length + ' 筆');
    });
    var opt = ss.getSheetByName(FinSchema.OPTIONS_SHEET);
    if (!hasData(opt)) {
      var cols = FinSchema.OPTION_LISTS.map(function (l) { return seed.options[l.header]; });
      var rows = 0;
      cols.forEach(function (c) { if (c.length > rows) rows = c.length; });
      if (rows) {
        var matrix = [];
        for (var r = 0; r < rows; r++) matrix.push(cols.map(function (c) { return c[r] === undefined ? '' : c[r]; }));
        opt.getRange(2, 1, rows, cols.length).setValues(matrix);
        report.seeded.push('選項：' + cols.length + ' 份清單');
      }
    }
  }

  /** 建立或修復所有資料表。ss 省略時使用目前開啟的試算表（在 Apps Script 編輯器從試算表選單執行）。 */
  function initialize(ss) {
    ss = ss || SpreadsheetApp.getActiveSpreadsheet();
    var props = PropertiesService.getScriptProperties();
    props.setProperty('SHEET_ID', ss.getId());
    if (!props.getProperty('HMAC_KEY')) props.setProperty('HMAC_KEY', FinAuth.randomHex(48));
    FinRepo.reset();
    var report = { created: [], repaired: [], seeded: [] };
    var wasBlank = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0;
    var blankName = wasBlank ? ss.getSheets()[0].getName() : '';
    FinSchema.SHEET_ORDER.forEach(function (key) { ensureSheet(ss, key, report); });
    if (wasBlank) {
      var blank = ss.getSheetByName(blankName);
      if (blank && FinSchema.SHEET_ORDER.every(function (k) { return (k === 'options' ? FinSchema.OPTIONS_SHEET : FinSchema.TABLES[k].sheet) !== blankName; })) ss.deleteSheet(blank);
    }
    FinRepo.reset();
    seedIfEmpty(ss, report, FinDates.timestamp(FinClock.now()));
    FinRepo.reset();
    return report;
  }

  function installDailyTrigger() {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'dailyJob') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(7).create();
  }

  /** 檢查目前狀態，回傳給選單顯示 */
  function status() {
    var props = PropertiesService.getScriptProperties();
    var out = { initialized: !!props.getProperty('SHEET_ID'), pin: FinAuth.hasPin(), devices: FinAuth.listDevices(), triggers: 0, problems: [] };
    out.triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'dailyJob'; }).length;
    if (out.initialized) {
      try {
        FinRepo.reset();
        ['accounts', 'categories', 'instruments', 'transactions', 'prices', 'settings'].forEach(function (k) {
          FinRepo.readTable(k).bad.forEach(function (b) { out.problems.push(b.table + ' 第 ' + b.row + ' 列：' + b.problems.join('；')); });
        });
      } catch (e) { out.problems.push(e.message); }
    }
    return out;
  }

  return { initialize: initialize, installDailyTrigger: installDailyTrigger, status: status };
})();

/** 排程工作 */
var FinJobs = (function () {
  /** 把「現價」公式算出來的有效數字存進「上次有效價」；公式出錯就沿用舊值並標記狀態 */
  function refreshPrices() {
    FinRepo.reset();
    var now = FinDates.timestamp(FinClock.now());
    var changed = 0;
    FinRepo.readTable('prices').rows.forEach(function (r) {
      if (r._bad) return;
      if (r.price > 0) {
        FinRepo.setCells('prices', r._row, { lastValid: r.price, updatedAt: now, status: '正常' });
        changed++;
      } else if (r.lastValid > 0) {
        FinRepo.setCells('prices', r._row, { status: '沿用舊值' });
      } else {
        FinRepo.setCells('prices', r._row, { status: '缺價格' });
      }
    });
    return changed;
  }
  return { refreshPrices: refreshPrices };
})();

// ==================== server/main.js ====================
/**
 * Apps Script 進入點：網頁應用程式（doGet / doPost）、試算表選單、排程。
 * 選單函式必須是全域函式，所以放在這裡；實際邏輯在 FinSetup / FinAuth / FinApi。
 */
var MAX_BODY_BYTES = 200000;

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonOut_({ ok: true, data: { name: 'finance-web', version: FinSchema.APP_VERSION, message: '後端運作中。請用網頁版登入使用。' } });
}

function doPost(e) {
  var body = null;
  try {
    var raw = e && e.postData ? e.postData.contents : '';
    if (raw && raw.length > MAX_BODY_BYTES) return jsonOut_({ ok: false, error: { code: 'BAD_REQUEST', message: '請求太大' } });
    body = JSON.parse(raw || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: { code: 'BAD_REQUEST', message: '請求格式錯誤' } });
  }
  return jsonOut_(FinApi.handle(body));
}

function dailyJob() {
  FinJobs.refreshPrices();
}

// ---------- 試算表選單 ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('財務系統')
    .addItem('第一次設定（建議從這裡開始）', 'menuFirstTimeSetup')
    .addSeparator()
    .addItem('初始化／修復資料表', 'menuInitialize')
    .addItem('設定或變更 PIN', 'menuSetPin')
    .addItem('新增裝置授權碼', 'menuAddDevice')
    .addItem('查看或撤銷裝置', 'menuManageDevices')
    .addItem('登出所有裝置', 'menuSignOutAll')
    .addItem('安裝每日排程（更新匯率）', 'menuInstallTriggers')
    .addItem('檢查目前狀態', 'menuStatus')
    .addToUi();
}

function ui_() { return SpreadsheetApp.getUi(); }
function alert_(title, msg) { var u = ui_(); u.alert(title, msg, u.ButtonSet.OK); }

/** 顯示輸入框；按取消回傳 null */
function ask_(title, msg) {
  var u = ui_();
  var res = u.prompt(title, msg, u.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== u.Button.OK) return null;
  return String(res.getResponseText());
}

function menuInitialize() {
  var r = FinSetup.initialize();
  var lines = [];
  if (r.created.length) lines.push('新建分頁：' + r.created.join('、'));
  if (r.repaired.length) lines.push('修復：' + r.repaired.join('；'));
  if (r.seeded.length) lines.push('寫入預設資料：' + r.seeded.join('；'));
  if (!lines.length) lines.push('所有資料表都已就緒，沒有需要修改的地方。');
  alert_('初始化完成', lines.join('\n'));
}

function askNewPin_() {
  for (var tries = 0; tries < 3; tries++) {
    var pin = ask_('設定 PIN', '請輸入新的 PIN（至少 ' + FinAuth.MIN_PIN_LENGTH + ' 碼，建議用數字；輸入時畫面看得到，請留意旁邊有沒有人）：');
    if (pin === null) return false;
    var bad = FinAuth.pinPolicyError(pin);
    if (bad) { alert_('PIN 不符合規則', bad); continue; }
    var again = ask_('確認 PIN', '請再輸入一次：');
    if (again === null) return false;
    if (again !== pin) { alert_('兩次輸入不一致', '請重新設定。'); continue; }
    FinAuth.setPin(pin);
    return true;
  }
  return false;
}

function menuSetPin() {
  if (!PropertiesService.getScriptProperties().getProperty('SHEET_ID')) { alert_('尚未初始化', '請先執行「第一次設定」。'); return; }
  if (askNewPin_()) alert_('完成', 'PIN 已設定。');
}

function addDeviceFlow_() {
  var name = ask_('新增裝置授權碼', '幫這台裝置取個名字（例如：我的手機、家裡電腦）：');
  if (name === null) return null;
  var d = FinAuth.addDevice(name);
  alert_('裝置授權碼（只會顯示這一次）',
    '裝置：' + d.name + '\n\n授權碼：\n' + d.token + '\n\n請立刻抄下或貼到那台裝置的登入畫面。關掉這個視窗後就看不到了；' +
    '如果忘記，可以在選單「查看或撤銷裝置」撤銷後重新新增。');
  return d;
}
function menuAddDevice() {
  if (!PropertiesService.getScriptProperties().getProperty('SHEET_ID')) { alert_('尚未初始化', '請先執行「第一次設定」。'); return; }
  addDeviceFlow_();
}

function menuManageDevices() {
  var list = FinAuth.listDevices();
  if (!list.length) { alert_('裝置', '目前沒有任何裝置授權碼。'); return; }
  var text = list.map(function (d) { return d.id + '：' + d.name + '（' + d.createdAt + '）'; }).join('\n');
  var id = ask_('查看或撤銷裝置', text + '\n\n要撤銷哪一台？請輸入代號（例如 D1）；不撤銷請按取消：');
  if (id === null || !String(id).trim()) return;
  if (FinAuth.revokeDevice(String(id).trim().toUpperCase())) alert_('已撤銷', '該裝置的授權碼與登入狀態已失效。');
  else alert_('找不到', '沒有代號為「' + id + '」的裝置。');
}

function menuSignOutAll() {
  FinAuth.signOutAll();
  alert_('已登出所有裝置', '所有裝置都需要重新輸入 PIN。');
}

function menuInstallTriggers() {
  FinSetup.installDailyTrigger();
  alert_('已安裝', '每天早上 7 點會自動更新匯率。第一次安裝時 Google 可能會要求你授權，請按允許。');
}

function menuStatus() {
  var s = FinSetup.status();
  var lines = [
    '已初始化：' + (s.initialized ? '是' : '否'),
    'PIN：' + (s.pin ? '已設定' : '尚未設定'),
    '裝置：' + (s.devices.length ? s.devices.map(function (d) { return d.name; }).join('、') : '無'),
    '每日排程：' + (s.triggers ? '已安裝' : '尚未安裝'),
  ];
  lines.push(s.problems.length ? '資料問題（' + s.problems.length + '）：\n' + s.problems.slice(0, 15).join('\n') : '資料檢查：沒有發現問題');
  alert_('目前狀態', lines.join('\n'));
}

function menuFirstTimeSetup() {
  var u = ui_();
  var go = u.alert('第一次設定', '接下來會依序：\n1. 建立所有資料表並放入預設分類與匯率\n2. 設定 PIN\n3. 產生第一組裝置授權碼\n4. 安裝每日更新匯率的排程\n\n要開始嗎？', u.ButtonSet.OK_CANCEL);
  if (go !== u.Button.OK) return;
  var report = FinSetup.initialize();
  if (!FinAuth.hasPin() && !askNewPin_()) { alert_('尚未完成', '資料表已建立，但 PIN 還沒設定。之後可從選單「設定或變更 PIN」繼續。'); return; }
  var device = FinAuth.listDevices().length ? null : addDeviceFlow_();
  try { FinSetup.installDailyTrigger(); } catch (e) { alert_('排程未安裝', '需要授權才能安裝排程，之後可從選單「安裝每日排程」再試一次。'); }
  alert_('設定完成',
    '資料表已就緒' + (report.created.length ? '（新建 ' + report.created.length + ' 個分頁）' : '') + '。\n\n' +
    '最後一步：在 Apps Script 編輯器按「部署」→「新增部署作業」→ 類型選「網頁應用程式」→ 執行身分「我」、存取權「所有人」，' +
    '把產生的網址貼到網站的登入畫面。' + (device ? '\n\n授權碼你已經看過了；如果沒抄到，請用選單重新新增。' : ''));
}
