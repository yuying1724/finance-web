/**
 * 台股／ETF 現金股息自動偵測：每天排程（dailyJob → FinRecurringJob.runDaily）呼叫一次。
 *  1. 抓證交所「除權除息預告表」與櫃買中心「除權除息預告」（免費、不用金鑰），只留下你有持有的台股／ETF。
 *     公告會在除息日前後從預告表消失，所以看到的公告先存在 ScriptProperties（DIV_SEEN），之後就算預告表拿掉了也還記得。
 *  2. 到了除息日（含當天）：用「除息日前一天」的持股股數 × 每股現金股利算出稅前股息，扣掉匯費與二代健保（單筆 ≥ 門檻才扣），
 *     產生一筆「待確認」的股息交易，日期＝預估發放日（除息日＋1 個月，公告不含發放日），計畫日期＝除息日。
 *     實際入帳後你只要到「待確認」確認（金額不同就改成實際收到的）。
 *  去重：同一標的、同一除息日只產生一次（不管之後是確認、略過還是作廢）；如果你已經自己記過這筆股息（除息日後 75 天內有同標的的股息），也不再產生。
 *  入帳帳戶：證券帳戶設定的「股息入帳帳戶」→ 沒填就用「預設交割帳戶」→ 都沒有就不產生（寫進 Logger）。
 *  費用（可在「設定」分頁加這幾個鍵覆寫）：股息匯費（預設 10）、二代健保費率（預設 0.0211）、二代健保門檻（預設 20000）。
 *  只處理現金股利；配股（股票股利）不會自動產生，仍請手動記「股數調整」。
 */
var FinDividends = (function () {
  var TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL';
  var TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost';
  var PROP_KEY = 'DIV_SEEN';
  var KEEP_DAYS = 45; // 除息日過了這麼多天的公告就從記憶中移除
  var LATE_DAYS = 20; // 除息日過了這麼多天還沒產生（例如剛上線、排程停了），就不再補產生
  var MANUAL_WINDOW = 75; // 除息日後幾天內已有手動記錄的同標的股息，就視為已記過
  var DEFAULTS = { fee: 10, nhiRate: 0.0211, nhiThreshold: 20000 };

  function ts(ms) { return FinDates.timestamp(ms); }

  /** 民國日期（1151008、115/10/08、115-10-08）→ 2026-10-08；看不懂回傳 '' */
  function rocToIso(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (/^(19|20)\d{6}$/.test(s)) { var ad = FinDates.format(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)); return FinDates.isValid(ad) ? ad : ''; } // 西元 yyyyMMdd
    var m = s.match(/^(\d{2,3})[\/\-.]?(\d{1,2})[\/\-.]?(\d{1,2})$/);
    if (!m) return '';
    if (s.indexOf('/') < 0 && s.indexOf('-') < 0 && s.indexOf('.') < 0) {
      // 純數字：最後 4 碼是月日
      if (s.length < 6) return '';
      m = [s, s.slice(0, s.length - 4), s.slice(-4, -2), s.slice(-2)];
    }
    var y = Number(m[1]) + 1911, mo = Number(m[2]), d = Number(m[3]);
    var iso = FinDates.format(y, mo, d);
    return FinDates.isValid(iso) ? iso : '';
  }
  function num(v) {
    var n = Number(String(v === undefined || v === null ? '' : v).replace(/,/g, '').trim());
    return isFinite(n) ? n : 0;
  }
  /** 公告裡的除權息類型是否含現金股利（息、權息、除息、除權息） */
  function hasCash(kind) { return String(kind || '').indexOf('息') >= 0; }

  function fetchJson(url) {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
    return JSON.parse(res.getContentText());
  }

  /** 解析兩個來源 → [{symbol, exDate, cash(每股現金股利，0＝還沒公告), name, source}]；單一來源失敗不影響另一個 */
  function fetchAnnouncements() {
    var out = [], errors = [];
    try {
      (fetchJson(TWSE_URL) || []).forEach(function (it) {
        if (!hasCash(it.Exdividend)) return;
        var exDate = rocToIso(it.Date), symbol = String(it.Code || '').trim();
        if (exDate && symbol) out.push({ symbol: symbol, exDate: exDate, cash: num(it.CashDividend), name: String(it.Name || '').trim(), source: '證交所' });
      });
    } catch (e) { errors.push('證交所：' + (e && e.message ? e.message : e)); }
    try {
      (fetchJson(TPEX_URL) || []).forEach(function (it) {
        if (!hasCash(it.ExRrightsExDividend)) return;
        var exDate = rocToIso(it.ExRrightsExDividendDate), symbol = String(it.SecuritiesCompanyCode || '').trim();
        if (exDate && symbol) out.push({ symbol: symbol, exDate: exDate, cash: num(it.CashDividend), name: String(it.CompanyName || '').trim(), source: '櫃買中心' });
      });
    } catch (e) { errors.push('櫃買中心：' + (e && e.message ? e.message : e)); }
    return { items: out, errors: errors };
  }

  function loadSeen() {
    try { var v = PropertiesService.getScriptProperties().getProperty(PROP_KEY); return v ? JSON.parse(v) || {} : {}; } catch (e) { return {}; }
  }
  function saveSeen(seen) {
    try { PropertiesService.getScriptProperties().setProperty(PROP_KEY, JSON.stringify(seen)); } catch (e) { try { Logger.log('股息公告暫存失敗：' + e.message); } catch (x) { /* ignore */ } }
  }

  /** 會發台幣現金股息的標的：台股／ETF、以台幣計價 */
  function isTwEquity(inst) { return !!inst && (inst.type === '台股' || inst.type === 'ETF') && (inst.quote || 'TWD') === 'TWD'; }

  /** 除息日前一天，各證券帳戶持有該標的的股數：[{accountId, qty}]（只列正數） */
  function holdersAsOf(c, symbol, asOf) {
    var inst = c.instruments[symbol];
    var txs = c.txRows.filter(function (t) { return t.srcSymbol === symbol || t.dstSymbol === symbol; });
    var bal = FinLedger.computeBalances(txs, c.instruments, { asOf: asOf }).units;
    var out = [];
    Object.keys(bal).forEach(function (k) {
      var parts = k.split('|');
      if (parts[1] !== symbol) return;
      var acct = c.accounts[parts[0]];
      if (!acct || acct.type !== '證券') return;
      var qty = FinMoney.fromUnits(bal[k], inst.decimals);
      if (qty > 0) out.push({ accountId: acct.id, qty: qty });
    });
    out.sort(function (a, b) { return b.qty - a.qty; });
    return out;
  }

  function settingNum(c, key, dflt) {
    var v = c.settings ? c.settings[key] : undefined;
    if (v === undefined || v === null || v === '') return dflt;
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : dflt;
  }

  /** 稅前 → {gross, fee, tax, net}（台幣，元以下捨去；二代健保四捨五入） */
  function estimate(c, shares, cashPerShare) {
    var gross = Math.floor(shares * cashPerShare + 1e-9);
    var fee = settingNum(c, '股息匯費', DEFAULTS.fee);
    var threshold = settingNum(c, '二代健保門檻', DEFAULTS.nhiThreshold);
    var rate = settingNum(c, '二代健保費率', DEFAULTS.nhiRate);
    var tax = gross >= threshold ? Math.round(gross * rate) : 0;
    if (fee >= gross) fee = 0; // 金額太小時不扣匯費（避免變成負數）
    return { gross: gross, fee: fee, tax: tax, net: gross - fee - tax };
  }

  function dividendAccountFor(c, brokerAccountId) {
    var bs = c.brokerByAccount[brokerAccountId] || {};
    var id = bs.dividendAccountId || bs.settleAccountId || '';
    return id && c.accounts[id] ? id : '';
  }

  /** 日期加 n 個月（月底自動調整，例如 1/31 → 2/28） */
  function addMonthsToDate(d, n) {
    var ym = FinDates.addMonths(FinDates.ymOf(d), n);
    var last = FinDates.monthRange(ym).to;
    var day = d.slice(8, 10);
    var cand = ym + '-' + day;
    return cand > last ? last : cand;
  }

  function alreadyRecorded(c, symbol, exDate) {
    var until = FinDates.addDays(exDate, MANUAL_WINDOW);
    return c.txRows.some(function (t) {
      if (t.type !== '股息' || t.relatedSymbol !== symbol) return false;
      if (t.plannedDate === exDate) return true; // 自動產生過（任何狀態）
      return t.status !== '作廢' && t.status !== '已略過' && t.date >= exDate && t.date <= until; // 你自己記過
    });
  }

  /**
   * 把公告併入記憶，並為到了除息日的持股產生待確認股息。
   * announcements 省略時自己去抓。回傳 {created:[交易], waiting:[...], skipped:[...], errors:[...]}
   */
  function run(c, env, announcements) {
    var fetched = announcements ? { items: announcements, errors: [] } : fetchAnnouncements();
    var seen = loadSeen();
    var today = c.today;
    // 1. 只記住你有建立標的的台股／ETF 公告（避免把全市場幾百筆都存起來）
    fetched.items.forEach(function (a) {
      if (!isTwEquity(c.instruments[a.symbol])) return;
      var key = a.symbol + '|' + a.exDate;
      var prev = seen[key];
      if (!prev || (a.cash > 0 && prev.cash !== a.cash)) seen[key] = { symbol: a.symbol, exDate: a.exDate, cash: a.cash > 0 ? a.cash : (prev ? prev.cash : 0), name: a.name, source: a.source };
    });
    // 2. 到了除息日就產生
    var created = [], waiting = [], skipped = [];
    var catRow = c.categoryRows.filter(function (x) { return x.type === '系統' && x.name === '股息'; })[0];
    var now = ts(env.now);
    Object.keys(seen).sort().forEach(function (key) {
      var a = seen[key];
      if (FinDates.addDays(a.exDate, KEEP_DAYS) < today) { delete seen[key]; return; }
      if (a.done) return;
      if (a.exDate > today) { waiting.push({ symbol: a.symbol, exDate: a.exDate, cash: a.cash }); return; }
      if (!(a.cash > 0)) { waiting.push({ symbol: a.symbol, exDate: a.exDate, cash: 0 }); return; } // 已除息但每股金額還沒公告：等下次
      if (FinDates.addDays(a.exDate, LATE_DAYS) < today) { a.done = true; skipped.push({ symbol: a.symbol, exDate: a.exDate, reason: '除息日已過太久' }); return; }
      if (alreadyRecorded(c, a.symbol, a.exDate)) { a.done = true; return; }
      var holders = holdersAsOf(c, a.symbol, FinDates.addDays(a.exDate, -1));
      if (!holders.length) { a.done = true; return; } // 除息日前沒有持股
      var shares = 0; holders.forEach(function (hh) { shares += hh.qty; });
      var dst = '';
      for (var i = 0; i < holders.length && !dst; i++) dst = dividendAccountFor(c, holders[i].accountId);
      if (!dst) { skipped.push({ symbol: a.symbol, exDate: a.exDate, reason: '證券帳戶沒有設定股息入帳帳戶或預設交割帳戶' }); return; }
      var e = estimate(c, shares, a.cash);
      if (!(e.net > 0)) { a.done = true; return; }
      var dstAcct = c.accounts[dst];
      var inst = c.instruments[a.symbol];
      var parts = ['稅前 ' + e.gross];
      if (e.fee) parts.push('匯費 ' + e.fee);
      if (e.tax) parts.push('二代健保 ' + e.tax);
      var row = {
        date: addMonthsToDate(a.exDate, 1), settleDate: '', type: '股息',
        srcAccount: '', srcSymbol: '', srcQty: null,
        dstAccount: dst, dstSymbol: (dstAcct && dstAcct.defaultSymbol) || 'TWD', dstQty: e.net,
        categoryId: catRow ? catRow.id : '', amount: e.gross, fee: e.fee, tax: e.tax,
        relatedSymbol: a.symbol, groupId: '', relatedTxId: '', recurringId: '', plannedDate: a.exDate,
        note: '自動股息：' + ((inst && inst.name) || a.name || a.symbol) + '　除息日 ' + a.exDate + '，每股 ' + a.cash + ' 元 × ' + shares + ' 股（' + parts.join('－') + '，發放日為預估，入帳後請確認金額）',
        status: '待確認', createdAt: now, updatedAt: now,
      };
      row.id = FinRepo.nextIds('transactions', 1)[0];
      FinRepo.append('transactions', [row]);
      c.txRows.push(row);
      FinRepo.audit('新增', 'transactions', row.id, '股息自動產生：' + a.symbol + '（除息日 ' + a.exDate + '，預估 ' + e.net + '）', env.device || 'scheduler');
      a.done = true;
      created.push(row);
    });
    saveSeen(seen);
    if (created.length) {
      FinMail.sendIfAny(created.map(function (r) {
        var inst = c.instruments[r.relatedSymbol];
        return { symbol: r.relatedSymbol, name: inst ? inst.name : '', exDate: r.plannedDate, payDate: r.date, net: r.dstQty, accountName: (c.accounts[r.dstAccount] || {}).name || r.dstAccount };
      }), FinMail.dividendDetected);
    }
    if (fetched.errors.length) { try { Logger.log('股息公告抓取失敗：' + fetched.errors.join('；')); } catch (x) { /* ignore */ } }
    return { created: created, waiting: waiting, skipped: skipped, errors: fetched.errors };
  }

  return { run: run, fetchAnnouncements: fetchAnnouncements, rocToIso: rocToIso, estimate: estimate, addMonthsToDate: addMonthsToDate, holdersAsOf: holdersAsOf, PROP_KEY: PROP_KEY };
})();
//#ifnode
module.exports = FinDividends;
//#endif
