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
//#ifnode
module.exports = FinSchema;
//#endif
