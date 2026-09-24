'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

function fresh() {
  const b = loadBackend().setup();
  const r = b.call('upsertAccount', { account: { name: '玉山活存', type: '銀行', defaultSymbol: 'TWD' } });
  b.bank = r.data.account.id;
  b.call('addTransaction', { tx: { type: '調整', date: '2026-03-01', dstAccount: b.bank, dstSymbol: 'TWD', dstQty: 1000 } });
  b.call('addTransaction', { tx: { type: '調整', date: '2026-03-02', dstAccount: b.bank, dstSymbol: 'TWD', dstQty: 2000 } });
  b.boot = () => b.call('bootstrap').data;
  return b;
}
// 交易表欄位：1 ID, 2 日期, 3 交割日, 4 類型, 5 來源帳戶, 6 來源標的, 7 來源數量, 8 目的帳戶, 9 目的標的, 10 目的數量 … 20 狀態

test('手動在 Sheet 輸入的真日期（Date 物件）也能正確讀取', () => {
  const b = fresh();
  b.ss.sheet('交易').poke(2, 2, new Date(Date.UTC(2026, 1, 27, 16, 0, 0))); // 台灣 2026-02-28 00:00
  assert.equal(b.call('listTransactions', { filters: { from: '2026-02-28', to: '2026-02-28' } }).data.total, 1);
});

test('某列數量被手動改成文字：該列被標記、排除，其他資料照常，並回報在問題清單', () => {
  const b = fresh();
  b.ss.sheet('交易').poke(2, 10, '一千');
  const d = b.boot();
  assert.equal(d.netWorth.total, 2000, '壞的那筆不計入，但不影響其他筆');
  assert.equal(d.issues.count, 1);
  assert.equal(d.issues.items[0].table, '交易');
  assert.equal(d.issues.items[0].row, 2);
  assert.match(d.issues.items[0].problems[0], /目的數量/);
  const t = b.call('listTransactions').data;
  assert.equal(t.total, 1);
  const edit = b.call('voidTransaction', { id: 'T000001', expectedUpdatedAt: 'x' });
  assert.equal(edit.error.code, 'DATA_BAD');
  // 使用者修好之後恢復正常
  b.ss.sheet('交易').poke(2, 10, 1000);
  assert.equal(b.boot().netWorth.total, 3000);
  assert.equal(b.boot().issues.count, 0);
});

test('中間有空白列、資料被排序過、ID 重複：都不會壞，重複的會被標記', () => {
  const b = fresh();
  const sh = b.ss.sheet('交易');
  // 在最後多插入一個空白列再新增：新資料接在最後一筆有內容的列後面
  b.call('addTransaction', { tx: { type: '調整', date: '2026-03-03', dstAccount: b.bank, dstSymbol: 'TWD', dstQty: 10 } });
  sh.rows[2] = undefined; // 把第 3 列（T000002）整列清空 → 留下空白列
  assert.equal(b.boot().netWorth.total, 1010);
  assert.equal(b.boot().issues.count, 0);
  // 複製一列造成重複 ID
  const row1 = sh.getRange(2, 1, 1, 22).getValues()[0];
  sh.getRange(3, 1, 1, 22).setValues([row1]);
  const d = b.boot();
  assert.equal(d.issues.count, 1);
  assert.match(d.issues.items[0].problems[0], /重複/);
  // 新 ID 仍然是最大號 + 1
  const r = b.call('addTransaction', { tx: { type: '調整', date: '2026-03-04', dstAccount: b.bank, dstSymbol: 'TWD', dstQty: 1 } });
  assert.equal(r.data.tx.id, 'T000004');
});

test('交易用到不存在的標的：列入問題清單（ledger），不讓系統壞掉', () => {
  const b = fresh();
  b.ss.sheet('交易').poke(2, 9, 'XYZ');
  const d = b.boot();
  assert.equal(d.issues.count, 1);
  assert.match(d.issues.ledger[0].message, /XYZ/);
  assert.equal(d.netWorth.total, 2000);
});

test('狀態欄位前後有空白、大小寫的數字文字，都能容忍', () => {
  const b = fresh();
  b.ss.sheet('交易').poke(2, 20, ' 有效 ');
  b.ss.sheet('交易').poke(2, 10, '1,000');
  assert.equal(b.boot().netWorth.total, 3000);
});

test('缺少表頭或整個分頁被刪掉：給明確、可操作的錯誤訊息', () => {
  const b = fresh();
  b.ss.sheet('交易').poke(1, 10, '');
  let r = b.call('bootstrap');
  assert.equal(r.error.code, 'SCHEMA');
  assert.match(r.error.message, /缺少欄位：目的數量/);
  assert.match(r.error.message, /修復/);
  b.ctx.FinSetup.initialize(b.ss); // 使用者照指示執行「初始化／修復資料表」
  r = b.call('bootstrap');
  assert.ok(r.ok, JSON.stringify(r));
  b.ss.deleteSheet(b.ss.sheet('分類'));
  r = b.call('bootstrap');
  assert.equal(r.error.code, 'SCHEMA');
  assert.match(r.error.message, /分類/);
});

test('設定表可調整閒置登出時間與鎖定次數', () => {
  const b = fresh();
  const sh = b.ss.sheet('設定');
  const rows = sh.dump();
  const rowOf = (k) => rows.findIndex((r) => r[0] === k) + 1;
  sh.poke(rowOf('閒置登出分鐘'), 2, '10');
  sh.poke(rowOf('失敗鎖定次數'), 2, '3');
  const r = b.login();
  assert.equal(r.data.ttlMinutes, 10);
  b.login(b.token, '000001'); b.login(b.token, '000001');
  assert.equal(b.login(b.token, '000001').error.code, 'LOCKED');
});

test('價格：手動改成數字就直接採用；公式出錯時沿用上次有效值', () => {
  const b = fresh();
  b.call('addTransaction', { tx: { type: '調整', date: '2026-03-01', dstAccount: b.bank, dstSymbol: 'USD', dstQty: 100 } });
  assert.deepEqual(b.boot().netWorth.missing, ['USD']);
  b.ss.sheet('價格').poke(2, 2, 30); // 直接填數字取代公式
  assert.equal(b.boot().netWorth.total, 3000 + 3000);
  b.ss.sheet('價格').poke(2, 3, 31); // 上次有效價
  b.ss.sheet('價格').poke(2, 2, '#N/A');
  const d = b.boot();
  assert.equal(d.prices.USD.status, '沿用舊值');
  assert.equal(d.netWorth.total, 3000 + 3100);
  assert.equal(d.issues.count, 0, '公式暫時算不出來不算資料問題');
});

test('刪掉最後幾筆後新增，ID 會接續最大號（可能重用已刪除的號碼，這是預期行為）', () => {
  const b = fresh();
  b.ss.sheet('交易').rows[2] = undefined;
  const r = b.call('addTransaction', { tx: { type: '調整', date: '2026-03-05', dstAccount: b.bank, dstSymbol: 'TWD', dstQty: 1 } });
  assert.equal(r.data.tx.id, 'T000002');
});

test('大量資料效能：2000 筆交易一次載入與計算在合理時間內', () => {
  const b = fresh();
  const sh = b.ss.sheet('交易');
  sh.maxRows = 3000;
  const rows = [];
  for (let i = 0; i < 2000; i++) {
    const r = new Array(22).fill('');
    r[0] = 'T' + String(i + 100).padStart(6, '0'); r[1] = '2026-03-02'; r[3] = '調整'; r[7] = b.bank; r[8] = 'TWD'; r[9] = 1; r[19] = '有效';
    rows.push(r);
  }
  sh.getRange(4, 1, 2000, 22).setValues(rows);
  const t0 = Date.now();
  const d = b.boot();
  const ms = Date.now() - t0;
  assert.equal(d.netWorth.total, 3000 + 2000);
  assert.ok(ms < 1500, `bootstrap 花了 ${ms}ms`);
});

test('價格：GOOGLEFINANCE 抓不到時，改用櫃買中心 OpenAPI 的收盤價；沒授權或抓不到才沿用舊值', () => {
  const b = fresh();
  const sh = b.ss.sheet('價格');
  const header = sh.dump()[0];
  const col = (name) => header.indexOf(name) + 1;
  // 加兩檔上櫃股票：一檔 API 查得到、一檔查不到
  const inst = (o) => { const r = b.call('upsertInstrument', { instrument: o }); assert.ok(r.ok, JSON.stringify(r)); };
  inst({ symbol: '4126', name: '太醫', type: '台股', quote: 'TWD', decimals: 2, priceSource: 'GOOGLEFINANCE', quoteCode: 'TPE:4126' });
  inst({ symbol: '9999', name: '查不到', type: '台股', quote: 'TWD', decimals: 2, priceSource: 'GOOGLEFINANCE', quoteCode: 'TPE:9999' });
  const rows = sh.dump();
  const rowOf = (sym) => rows.findIndex((r) => r[col('標的代號') - 1] === sym) + 1;
  sh.poke(rowOf('4126'), col('現價'), '#N/A'); sh.poke(rowOf('4126'), col('上次有效價'), 75.1);
  sh.poke(rowOf('9999'), col('現價'), '#N/A'); sh.poke(rowOf('9999'), col('上次有效價'), 10);

  // 1. 尚未授權 external_request：UrlFetchApp 丟例外 → 靜默退回沿用舊值，其他標的照常更新
  b.ctx.FinJobs.refreshPrices();
  assert.equal(b.state.urlFetch.calls.length, 1, '整個 refreshPrices 只該呼叫一次 TPEx API');
  let d = b.boot();
  assert.equal(d.prices['4126'].status, '沿用舊值');
  assert.equal(d.prices['4126'].price, 75.1);
  assert.ok(b.state.logs.some((l) => /TPEx 收盤價抓取失敗/.test(l)));

  // 2. 授權後：API 查得到的用收盤價當「正常」，查不到的仍沿用舊值
  b.state.urlFetch.handler = (url) => { assert.match(url, /tpex\.org\.tw/); return { body: [{ SecuritiesCompanyCode: '4126', Close: '78.30' }, { SecuritiesCompanyCode: '6763', Close: '60' }] }; };
  b.ctx.FinJobs.refreshPrices();
  d = b.boot();
  assert.equal(d.prices['4126'].status, '正常');
  assert.equal(d.prices['4126'].price, 78.3);
  assert.equal(d.prices['9999'].status, '沿用舊值');
  assert.equal(d.prices['9999'].price, 10);
});
