'use strict';
/**
 * 後端「一次預載所有分頁」（Sheets 進階服務 Values.batchGet）：
 *  - 有 Sheets 服務時，一次請求只呼叫一次 batchGet、完全不再逐張 getValues
 *  - 預載路徑跟原本逐張讀取的結果必須逐欄一致（含手動輸入的日期格）
 *  - 沒有 Sheets 服務、或 API 失敗，自動退回逐張讀取
 *  - 寫入後下一次請求讀得到新資料（預載不會殘留舊資料）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');

function fresh() {
  const b = loadBackend().setup();
  const acct = (name, type, sym = 'TWD') => {
    const r = b.call('upsertAccount', { account: { name, type, defaultSymbol: sym, institution: name } });
    assert.ok(r.ok, JSON.stringify(r));
    return r.data.account.id;
  };
  const boot = () => { const r = b.call('bootstrap'); assert.ok(r.ok, JSON.stringify(r)); return r.data; };
  const cat = (name, type) => boot().categories.find((c) => c.name === name && (!type || c.type === type)).id;
  return Object.assign(b, { acct, boot, cat });
}

/** 準備一組有帳戶、交易、價格的資料 */
function seedData(b) {
  const a1 = b.acct('玉山活存', '銀行');
  const a2 = b.acct('現金', '現金');
  const income = b.cat('薪資', '收入');
  const food = b.cat('午餐', '支出');
  const r1 = b.call('addTransaction', { tx: { date: '2026-03-01', type: '收入', dstAccount: a1, dstSymbol: 'TWD', dstQty: 50000, categoryId: income, note: '三月薪水' } });
  assert.ok(r1.ok, JSON.stringify(r1));
  const r2 = b.call('addTransaction', { tx: { date: '2026-03-03', type: '支出', srcAccount: a1, srcSymbol: 'TWD', srcQty: 1200, categoryId: food, note: '午餐' } });
  assert.ok(r2.ok, JSON.stringify(r2));
  const r3 = b.call('addTransaction', { tx: { date: '2026-03-05', type: '轉帳', srcAccount: a1, srcSymbol: 'TWD', srcQty: 3000, dstAccount: a2, dstSymbol: 'TWD', dstQty: 3000 } });
  assert.ok(r3.ok, JSON.stringify(r3));
  return { a1, a2, txIds: [r1.data.tx.id, r2.data.tx.id, r3.data.tx.id] };
}

test('bootstrap 有 Sheets 服務時只呼叫一次 batchGet，完全不再逐張 getValues；結果跟逐張讀取一模一樣', () => {
  const b = fresh();
  seedData(b);
  const before = { api: b.state.sheetsApiCalls, reads: b.ss.reads };
  const viaPreload = b.boot();
  assert.equal(b.state.sheetsApiCalls - before.api, 1, '一次 bootstrap 只該呼叫一次 batchGet');
  assert.equal(b.ss.reads - before.reads, 0, '預載後不該再有任何 getValues');

  b.ctx.Sheets = undefined; // 模擬沒加 Sheets 進階服務
  const before2 = { api: b.state.sheetsApiCalls, reads: b.ss.reads };
  const viaSheets = b.boot();
  assert.equal(b.state.sheetsApiCalls - before2.api, 0);
  assert.ok(b.ss.reads - before2.reads >= 10, '逐張讀取路徑應該讀了 10 張以上的分頁');
  assert.deepEqual(viaPreload, viaSheets);
  assert.equal(viaPreload.recent.length, 3);
  assert.equal(viaPreload.netWorth.total, 48800);
});

test('Sheets API 呼叫失敗時自動退回逐張讀取，功能不受影響', () => {
  const b = fresh();
  seedData(b);
  b.state.sheetsApiFail = true;
  const d = b.boot();
  assert.equal(d.netWorth.total, 48800);
  assert.ok(b.state.logs.some((l) => /預載分頁失敗/.test(l)), '應該留下一筆退回逐張讀取的記錄');
  b.state.sheetsApiFail = false;
  const d2 = b.boot();
  assert.deepEqual(d, d2);
});

test('寫入後下一次請求讀得到新資料：預載不會殘留上一次的內容', () => {
  const b = fresh();
  const { a1, a2 } = seedData(b);
  const d1 = b.boot();
  const food = d1.categories.find((c) => c.name === '午餐' && c.type === '支出').id;
  const add = b.call('addTransaction', { tx: { date: '2026-03-06', type: '支出', srcAccount: a2, srcSymbol: 'TWD', srcQty: 500, categoryId: food, note: '晚餐' } });
  assert.ok(add.ok, JSON.stringify(add));
  const d2 = b.boot();
  assert.equal(d2.netWorth.total, d1.netWorth.total - 500);
  assert.ok(d2.recent.some((t) => t.id === add.data.tx.id));
  const list = b.call('listTransactions', { filters: { accountId: a2 } });
  assert.ok(list.ok);
  assert.equal(list.data.total, 2);
  // 同一次請求內先寫再讀：修改交易時後端會先讀（預載）→ 寫入 → 回傳，回傳值必須是新的
  const upd = b.call('updateTransaction', { id: add.data.tx.id, expectedUpdatedAt: add.data.tx.updatedAt, tx: { date: '2026-03-06', type: '支出', srcAccount: a2, srcSymbol: 'TWD', srcQty: 700, categoryId: food, note: '晚餐（改）' } });
  assert.ok(upd.ok, JSON.stringify(upd));
  assert.equal(upd.data.tx.srcQty, 700);
  assert.equal(b.boot().netWorth.total, d1.netWorth.total - 700);
  assert.equal(a1, 'A001');
});

test('手動輸入成「日期格」的欄位：預載（API 輸出的日期字串）與逐張讀取（Date 物件）都解析成同一個 yyyy-MM-dd', () => {
  const b = fresh();
  const { txIds } = seedData(b);
  const sheet = b.ss.sheet('交易');
  const header = sheet.dump()[0];
  const dateCol = header.indexOf('日期') + 1;
  const idCol = header.indexOf('交易ID') + 1;
  const rows = sheet.dump();
  const rowNo = rows.findIndex((r) => r[idCol - 1] === txIds[1]) + 1;
  assert.ok(rowNo > 1);
  // 模擬使用者直接在試算表把日期打成真正的日期格（含時間）
  sheet.poke(rowNo, dateCol, new Date(Date.UTC(2026, 2, 4, 15, 30, 0) - 8 * 3600 * 1000)); // 台灣時間 2026-03-04 15:30
  const viaPreload = b.call('listTransactions', { filters: {} });
  assert.ok(viaPreload.ok);
  b.ctx.Sheets = undefined;
  const viaSheets = b.call('listTransactions', { filters: {} });
  assert.ok(viaSheets.ok);
  const p = viaPreload.data.items.find((t) => t.id === txIds[1]);
  const s = viaSheets.data.items.find((t) => t.id === txIds[1]);
  assert.equal(p.date, '2026-03-04');
  assert.deepEqual(viaPreload.data, viaSheets.data);
  assert.equal(s.date, '2026-03-04');
});

test('預載清單涵蓋 loadContext 會讀的每一張分頁（新增分頁時要一起加進 PRELOAD_TABLES）', () => {
  const b = fresh();
  const list = b.ctx.FinRepo.PRELOAD_TABLES;
  ['settings', 'accounts', 'categories', 'instruments', 'transactions', 'prices', 'brokerSettings', 'holidays', 'cardSettings', 'loanSettings', 'recurring']
    .forEach((k) => assert.ok(list.includes(k), '缺少 ' + k));
  list.forEach((k) => assert.ok(b.ctx.FinSchema.TABLES[k], '未知的資料表 ' + k));
});
