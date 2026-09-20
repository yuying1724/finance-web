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
