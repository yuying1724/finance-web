/** 初始資料（第一次「初始化」時寫入）。分類與設定都是預設值，之後可在系統裡自行調整。 */
var FinSeed = (function () {
  //#ifnode
  var FinSchema = require('./schema.js');
  //#endif

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
      };
    });
    var prices = CURRENCIES.filter(function (c) { return c[0] !== 'TWD'; }).map(function (c) {
      return { symbol: c[0], price: '=GOOGLEFINANCE("CURRENCY:' + c[3] + '")', lastValid: '', quote: 'TWD', updatedAt: '', status: '尚未更新' };
    });

    var options = {};
    FinSchema.OPTION_LISTS.forEach(function (l) { options[l.header] = l.enumKey ? FinSchema.ENUMS[l.enumKey].slice() : []; });

    return { settings: settings, categories: categories, instruments: instruments, prices: prices, options: options };
  }

  return { build: build };
})();
//#ifnode
module.exports = FinSeed;
//#endif
