'use strict';
const FinSeed = require('../../core/seed.js');

const NOW = '2026-03-01 09:00:00';

/** 建立一組測試用的主檔（map 形式），與後端從 Sheet 讀出後的形狀相同 */
function masters() {
  const seed = FinSeed.build(NOW);
  const instruments = {};
  seed.instruments.forEach((i) => { instruments[i.symbol] = i; });
  instruments.BTC = { symbol: 'BTC', name: '比特幣', type: '加密', quote: 'USD', decimals: 8, active: true };
  instruments['0050'] = { symbol: '0050', name: '元大台灣50', type: 'ETF', quote: 'TWD', decimals: 0, active: true };
  const categories = {};
  seed.categories.forEach((c) => { categories[c.id] = c; });
  const mk = (id, name, type) => ({ id, name, type, institution: '', defaultSymbol: 'TWD', sort: 0, active: true, note: '' });
  const accounts = {
    A001: mk('A001', '玉山活存', '銀行'),
    A002: mk('A002', '現金', '現金'),
    A003: mk('A003', '信用卡', '信用卡'),
    A004: mk('A004', '美元帳戶', '銀行'),
    A005: mk('A005', '交易所', '加密交易所'),
    A006: Object.assign(mk('A006', '舊帳戶', '銀行'), { active: false }),
  };
  const prices = { USD: 32, JPY: 0.21, BTC: 60000 };
  const catByName = (name, type) => Object.values(categories).find((c) => c.name === name && (!type || c.type === type));
  return { instruments, categories, accounts, prices, base: 'TWD', catByName };
}

let seq = 0;
function tx(fields) {
  seq += 1;
  return Object.assign({
    id: 'T' + String(seq).padStart(6, '0'), date: '2026-03-02', settleDate: '', type: '', srcAccount: '', srcSymbol: '', srcQty: null,
    dstAccount: '', dstSymbol: '', dstQty: null, categoryId: '', amount: null, fee: null, tax: null, relatedSymbol: '', groupId: '',
    relatedTxId: '', recurringId: '', note: '', status: '有效', createdAt: NOW, updatedAt: NOW,
  }, fields);
}

module.exports = { masters, tx, NOW };
