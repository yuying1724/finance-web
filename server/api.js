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
