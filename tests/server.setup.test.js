'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend.js');
const Schema = require('../core/schema.js');

test('打包後的 Code.gs 可以載入，且不含 Node 專用語法', () => {
  const b = loadBackend();
  assert.equal(typeof b.ctx.doPost, 'function');
  assert.equal(typeof b.ctx.doGet, 'function');
  assert.equal(typeof b.ctx.onOpen, 'function');
  const code = require('node:fs').readFileSync(require('node:path').join(__dirname, '../dist/Code.gs'), 'utf8');
  assert.ok(!/\brequire\(/.test(code), '不該有 require');
  assert.ok(!/module\.exports/.test(code), '不該有 module.exports');
  assert.ok(!/\?\.|\?\?/.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/'[^'\n]*'|"[^"\n]*"/g, '')), '避免使用 ?. 與 ??');
  assert.ok(!/\.(replaceAll|flat|flatMap|fromEntries|at)\(/.test(code), '避免 Apps Script 可能不支援的新語法');
});

test('初始化：建立 17 張資料表、表頭正確、寫入預設資料、刪除空白預設分頁', () => {
  const b = loadBackend();
  const report = b.ctx.FinSetup.initialize(b.ss);
  const names = b.ss.getSheets().map((s) => s.getName());
  assert.equal(names.length, 17);
  assert.ok(!names.includes('工作表1'));
  Schema.SHEET_ORDER.forEach((k) => {
    const name = k === 'options' ? '選項' : Schema.TABLES[k].sheet;
    assert.ok(names.includes(name), '缺少 ' + name);
    if (k !== 'options') {
      const header = b.ss.sheet(name).getRange(1, 1, 1, b.ss.sheet(name).getLastColumn()).getValues()[0];
      assert.deepEqual(header, Schema.headers(k));
    }
  });
  assert.equal(report.created.length, 17);
  assert.ok(b.ss.sheet('分類').getLastRow() > 50);
  assert.equal(b.ss.sheet('標的').getLastRow(), 10);
  assert.equal(b.ss.sheet('價格').getLastRow(), 9);
  assert.equal(b.state.props.SHEET_ID, 'SS_MAIN');
  assert.ok(b.state.props.HMAC_KEY.length >= 48);
});

test('價格表的現價是 GOOGLEFINANCE 公式；日期與備註欄位是純文字格式', () => {
  const b = loadBackend();
  b.ctx.FinSetup.initialize(b.ss);
  const f = b.ss.sheet('價格').getRange(2, 2, 1, 1).getFormulas()[0][0];
  assert.match(f, /^=GOOGLEFINANCE\("CURRENCY:USDTWD"\)$/);
  const tx = b.ss.sheet('交易');
  assert.equal(tx._cell(500, 2).fmt, '@'); // 日期
  assert.equal(tx._cell(500, 19).fmt, '@'); // 備註
  assert.equal(tx._cell(500, 7).fmt, ''); // 數量維持一般格式
});

test('初始化可重複執行：不重複寫入預設資料、不覆蓋已存在的資料', () => {
  const b = loadBackend();
  b.ctx.FinSetup.initialize(b.ss);
  b.ss.sheet('設定').poke(2, 2, 'USD'); // 使用者改了基準幣別
  const catRows = b.ss.sheet('分類').getLastRow();
  const r2 = b.ctx.FinSetup.initialize(b.ss);
  assert.equal(r2.created.length, 0);
  assert.equal(r2.seeded.length, 0);
  assert.equal(b.ss.sheet('分類').getLastRow(), catRows);
  assert.equal(b.ss.sheet('設定').getRange(2, 2).getValue(), 'USD');
});

test('修復：缺少欄位會補在最後面，且不動原有欄位與資料', () => {
  const b = loadBackend();
  b.ctx.FinSetup.initialize(b.ss);
  const sh = b.ss.sheet('帳戶');
  sh.poke(1, 5, ''); // 使用者不小心刪掉「預設幣別」表頭
  sh.poke(2, 2, 'X');
  const r = b.ctx.FinSetup.initialize(b.ss);
  assert.ok(r.repaired.some((s) => s.includes('帳戶') && s.includes('預設幣別')));
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  assert.ok(header.includes('預設幣別'));
  assert.equal(header.length, Schema.headers('accounts').length + 1); // 被清空的表頭格保留為空白欄，補上的欄位接在最後
  assert.equal(sh.getRange(2, 2).getValue(), 'X'); // 原本的資料沒被動到
});

test('欄位順序被使用者調換後仍能正確讀寫（以表頭文字對應）', () => {
  const b = loadBackend().setup();
  const sh = b.ss.sheet('帳戶');
  // 對調「名稱」與「機構」兩欄（含表頭）
  const h = sh.getRange(1, 1, 1, 10).getValues()[0];
  const iName = h.indexOf('名稱') + 1, iInst = h.indexOf('機構') + 1;
  sh.poke(1, iName, '機構'); sh.poke(1, iInst, '名稱');
  const r = b.call('upsertAccount', { account: { name: '玉山活存', institution: '玉山銀行', type: '銀行', defaultSymbol: 'TWD' } });
  assert.ok(r.ok, JSON.stringify(r));
  const boot = b.call('bootstrap');
  assert.equal(boot.data.accounts[0].name, '玉山活存');
  assert.equal(boot.data.accounts[0].institution, '玉山銀行');
});

test('選單：onOpen 建立「財務系統」選單', () => {
  const b = loadBackend();
  b.ctx.onOpen();
  const menu = b.state.ui.menus[0];
  assert.equal(menu.name, '財務系統');
  assert.ok(menu.items.length >= 6);
  menu.items.forEach(([, fn]) => assert.equal(typeof b.ctx[fn], 'function', fn + ' 必須是全域函式'));
});

test('第一次設定精靈：依序初始化、設 PIN、產生裝置授權碼、安裝排程', () => {
  const b = loadBackend();
  b.state.ui.queue('246810', '246810', '我的手機');
  b.ctx.menuFirstTimeSetup();
  assert.equal(b.ctx.FinAuth.hasPin(), true);
  const devs = b.ctx.FinAuth.listDevices();
  assert.equal(devs.length, 1);
  assert.equal(devs[0].name, '我的手機');
  assert.equal(b.state.triggers.length, 1);
  assert.equal(b.state.triggers[0].getHandlerFunction(), 'dailyJob');
  const tokenAlert = b.state.ui.log.find((l) => l.kind === 'alert' && l.title.includes('授權碼'));
  assert.match(tokenAlert.msg, /[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}/);
  // 拿畫面上顯示的授權碼實際登入
  const token = tokenAlert.msg.match(/[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}/)[0];
  assert.ok(b.post({ action: 'login', params: { token, pin: '246810' } }).ok);
});

test('設定 PIN：太短、全同字元、兩次不一致都會被擋（最多重試 3 次），之後可再試', () => {
  const b = loadBackend();
  b.ctx.FinSetup.initialize(b.ss);
  b.state.ui.queue('123', '111111', '135790', '135791'); // 三次都失敗
  b.ctx.menuSetPin();
  assert.equal(b.ctx.FinAuth.hasPin(), false);
  const titles = b.state.ui.log.filter((l) => l.kind === 'alert').map((l) => l.title);
  assert.equal(titles.filter((t) => t === 'PIN 不符合規則').length, 2);
  assert.ok(titles.includes('兩次輸入不一致'));
  b.state.ui.queue('135790', '135790');
  b.ctx.menuSetPin();
  assert.equal(b.ctx.FinAuth.checkPin('135790'), true);
  assert.equal(b.ctx.FinAuth.checkPin('135791'), false);
});

test('每日排程：重複安裝只會留下一個；dailyJob 更新價格', () => {
  const b = loadBackend().setup();
  b.ctx.FinSetup.installDailyTrigger();
  b.ctx.FinSetup.installDailyTrigger();
  assert.equal(b.state.triggers.length, 1);
  const price = b.ss.sheet('價格');
  price.formulaResults['2,2'] = 32.5; // USD 的現價公式算出 32.5
  price.formulaResults['3,2'] = '#N/A'; // JPY 公式出錯
  b.ctx.dailyJob();
  const rows = price.dump();
  assert.equal(rows[1][2], 32.5); assert.equal(rows[1][5], '正常');
  assert.equal(rows[2][2], ''); assert.equal(rows[2][5], '缺價格');
  price.formulaResults['3,2'] = 0.21; b.ctx.dailyJob();
  price.formulaResults['3,2'] = '#N/A'; b.ctx.dailyJob();
  assert.equal(price.dump()[2][2], 0.21); assert.equal(price.dump()[2][5], '沿用舊值'); // 出錯時保留上一次的有效值
});
