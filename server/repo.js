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
