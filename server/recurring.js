/**
 * 定期交易排程：每天執行一次（與既有的每日排程共用同一個時間觸發器，見 server/main.js 的 dailyJob）。
 *  1. generateDue：把到期（含漏跑補跑）的定期交易，依執行方式寫成「有效」或「待確認」交易；同一（定期ID、預定日）只會產生一次。
 *  2. sendReminders：資金備妥提醒（券商定期定額／手動下單）、手動下單當天提醒、交割前備妥款項提醒、
 *     待確認放太久提醒、信用卡繳款日將近提醒。寄信失敗（例如還沒授權 script.send_mail）不會讓排程整個失敗。
 * 這裡直接沿用 FinApi.loadContext 讀主檔，避免重複一份載入邏輯。
 */
var FinRecurringJob = (function () {
  var STALE_PENDING_DAYS = 3; // 待確認放超過幾天寄信提醒一次（db-design 7.5「超過設定天數會寄信提醒」，天數未特別指定，取一個合理預設值）
  var CARD_REMIND_DAYS = 3; // 信用卡繳款日前幾天寄信提醒（db-design 沒有指定天數，取一個合理預設值）
  var LOOKAHEAD_DAYS = 14; // 往前看幾天找「即將到來」的到期日，用來判斷今天是不是資金備妥提醒日

  function ts(ms) { return FinDates.timestamp(ms); }
  function pub(row) { var o = {}; Object.keys(row).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = row[k]; }); return o; }

  function marketsFor(c, accountId) {
    var bs = c.brokerByAccount[accountId];
    return bs && bs.calendar === '台灣+美國' ? ['台灣', '美國'] : ['台灣'];
  }
  function buySettleDaysFor(c, accountId) {
    var bs = c.brokerByAccount[accountId];
    return bs && bs.buySettleDays !== null && bs.buySettleDays !== undefined ? bs.buySettleDays : 2;
  }
  function holidaySetOf(c) {
    if (!c.__holidaySet) c.__holidaySet = FinDates.buildHolidaySet(c.holidayRows);
    return c.__holidaySet;
  }
  function accountName(c, id) { var a = c.accounts[id]; return a ? a.name : id; }

  function alreadyGenerated(txRows, recurringId, plannedDate) {
    for (var i = 0; i < txRows.length; i++) {
      if (txRows[i].recurringId === recurringId && txRows[i].plannedDate === plannedDate) return true;
    }
    return false;
  }

  /** 一般（非貸款還款）範本：依到期日與執行方式產生一或多筆交易列（尚未寫入） */
  function buildOccurrenceRows(tpl, occ, c, env) {
    var now = ts(env.now);
    var isInvest = tpl.type === '買入' || tpl.type === '賣出';
    var status = tpl.mode === '自動入帳' ? '有效' : '待確認';
    var row = {
      date: occ.due, settleDate: '', type: tpl.type,
      srcAccount: tpl.srcAccount, srcSymbol: tpl.srcSymbol, srcQty: tpl.srcQty,
      dstAccount: tpl.dstAccount, dstSymbol: tpl.dstSymbol, dstQty: tpl.dstQty,
      categoryId: tpl.categoryId, amount: null, fee: null, tax: null,
      relatedSymbol: '', groupId: '', relatedTxId: '', recurringId: tpl.id, plannedDate: occ.planned,
      note: '定期：' + tpl.name, status: status, createdAt: now, updatedAt: now,
    };
    if (isInvest) {
      // 到期時股數／成交金額都還不知道（要等券商成交或你自己下單），只有「來源」的預計投入金額是已知的
      row.dstQty = tpl.type === '買入' ? null : tpl.dstQty; // 買入：股數未知；賣出模式較少見，維持範本預設股數
      if (tpl.mode === '券商定期定額') {
        row.settleDate = occ.due; // 交割天數 0：當天扣款
      } else {
        row.settleDate = ''; // 手動下單：交割日等實際成交日確定後才算
      }
      if (status === '有效') { // 自動入帳且是買入/賣出的極少見情境：沒有實際成交資料可用，直接用範本預設值
        row.amount = tpl.srcQty || 0;
        var markets = marketsFor(c, tpl.dstAccount || tpl.srcAccount);
        row.settleDate = FinRecurring.computeSettleDate(occ.due, FinRecurring.defaultSettleDays(tpl, buySettleDaysFor(c, tpl.dstAccount)), markets, holidaySetOf(c));
      }
    } else if (status === '有效') {
      row.settleDate = occ.due;
    }
    return [row];
  }

  /** 貸款還款範本：依攤還表算出這一期的本金／利息，產生同群組的「轉帳」（本金）＋「支出」（利息）——沿用批次 3 的邏輯 */
  function buildLoanRows(tpl, occ, c, env) {
    var loanAccountId = tpl.dstAccount || tpl.srcAccount;
    var acct = c.accounts[loanAccountId];
    var ls = c.loanByAccount[loanAccountId];
    if (!acct || acct.type !== '貸款' || !ls) return { rows: [], skipped: '找不到貸款帳戶或貸款設定（' + loanAccountId + '）' };
    var inst = c.instruments[acct.defaultSymbol];
    var decimals = inst ? inst.decimals : 0;
    var sched = FinLoan.schedule(ls, decimals);
    var period = FinLoan.findPeriod(sched, occ.due) || sched[sched.length - 1];
    if (!period) return { rows: [], skipped: '貸款已繳清' };
    var fromAccount = ls.payAccountId || tpl.srcAccount;
    var status = tpl.mode === '自動入帳' ? '有效' : '待確認';
    var now = ts(env.now);
    var rows = [];
    if (period.principal > 0) {
      rows.push({
        date: occ.due, settleDate: occ.due, type: '轉帳',
        srcAccount: fromAccount, srcSymbol: acct.defaultSymbol, srcQty: period.principal,
        dstAccount: loanAccountId, dstSymbol: acct.defaultSymbol, dstQty: period.principal,
        categoryId: '', amount: null, fee: null, tax: null, relatedSymbol: '', groupId: '', relatedTxId: '',
        recurringId: tpl.id, plannedDate: occ.planned, note: '定期：' + tpl.name + '（第 ' + period.period + ' 期本金）',
        status: status, createdAt: now, updatedAt: now,
      });
    }
    if (period.interest > 0) {
      var interestCat = c.categoryRows.filter(function (x) { return x.type === '支出' && x.name === '利息'; })[0];
      rows.push({
        date: occ.due, settleDate: occ.due, type: '支出',
        srcAccount: fromAccount, srcSymbol: acct.defaultSymbol, srcQty: period.interest,
        dstAccount: '', dstSymbol: '', dstQty: null,
        categoryId: interestCat ? interestCat.id : '', amount: null, fee: null, tax: null, relatedSymbol: '', groupId: '', relatedTxId: '',
        recurringId: tpl.id, plannedDate: occ.planned, note: '定期：' + tpl.name + '（第 ' + period.period + ' 期利息）',
        status: status, createdAt: now, updatedAt: now,
      });
    }
    return { rows: rows };
  }

  /** 產生所有到期（含漏跑補跑）的定期交易；回傳 {created:[...], skipped:[...]} */
  function generateDue(c, env) {
    var created = [], skipped = [];
    var templates = FinRepo.goodRows('recurring').filter(function (t) { return t.active; });
    templates.forEach(function (tpl) {
      var markets = tpl.type === '貸款還款' ? ['台灣'] : marketsFor(c, tpl.dstAccount || tpl.srcAccount);
      var days = String(tpl.days || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(Number);
      var fromExclusive = tpl.lastRun || FinDates.addDays(tpl.startDate, -1);
      var occ = FinRecurring.occurrences({ freq: tpl.freq, days: days, holiday: tpl.holiday, startDate: tpl.startDate, endDate: tpl.endDate },
        fromExclusive, c.today, markets, holidaySetOf(c));
      if (!occ.length) return;
      var maxPlanned = tpl.lastRun || '';
      occ.forEach(function (o) {
        if (o.planned > maxPlanned) maxPlanned = o.planned;
        if (alreadyGenerated(c.txRows, tpl.id, o.planned)) return; // 去重：同一（定期ID、預定日）不重複產生
        var built = tpl.type === '貸款還款' ? buildLoanRows(tpl, o, c, env) : { rows: buildOccurrenceRows(tpl, o, c, env) };
        if (built.skipped) { skipped.push({ recurringId: tpl.id, planned: o.planned, reason: built.skipped }); return; }
        if (!built.rows.length) return;
        var ids = FinRepo.nextIds('transactions', built.rows.length);
        var groupId = built.rows.length > 1 ? ids[0] : '';
        built.rows.forEach(function (r, i) { r.id = ids[i]; if (groupId) r.groupId = groupId; });
        FinRepo.append('transactions', built.rows);
        built.rows.forEach(function (r) {
          c.txRows.push(r); // 讓同一次排程執行內，後續的到期日去重判斷看得到剛剛產生的列
          FinRepo.audit('新增', 'transactions', r.id, '定期產生：' + tpl.name + '（' + r.date + '，' + r.status + '）', 'scheduler');
          created.push(r);
        });
        if (tpl.mode === '手動下單') {
          FinMail.sendIfAny([{ templateName: tpl.name, accountName: accountName(c, tpl.dstAccount || tpl.srcAccount), symbol: tpl.dstSymbol || tpl.srcSymbol, amount: tpl.srcQty }], FinMail.manualOrderToday);
        }
      });
      if (maxPlanned && maxPlanned !== tpl.lastRun) {
        var row = FinRepo.findById('recurring', tpl.id);
        if (row) FinRepo.updateRow('recurring', row._row, { lastRun: maxPlanned, updatedAt: ts(env.now) });
      }
    });
    return { created: created, skipped: skipped };
  }

  /** 資金備妥提醒（券商定期定額／手動下單）：往前看 LOOKAHEAD_DAYS 天內的到期日，今天剛好是提醒日就寄信 */
  function sendFundingReminders(c, env) {
    var items = [];
    var templates = FinRepo.goodRows('recurring').filter(function (t) { return t.active && (t.mode === '券商定期定額' || t.mode === '手動下單'); });
    templates.forEach(function (tpl) {
      var markets = marketsFor(c, tpl.dstAccount || tpl.srcAccount);
      var days = String(tpl.days || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(Number);
      var occ = FinRecurring.occurrences({ freq: tpl.freq, days: days, holiday: tpl.holiday, startDate: tpl.startDate, endDate: tpl.endDate },
        c.today, FinDates.addDays(c.today, LOOKAHEAD_DAYS), markets, holidaySetOf(c));
      occ.forEach(function (o) {
        var remindOn = FinRecurring.fundingReminderDate(o.due, tpl.remindDays, markets, holidaySetOf(c));
        if (remindOn === c.today) {
          items.push({ templateName: tpl.name, accountName: accountName(c, tpl.srcAccount), dueDate: o.due, amount: tpl.srcQty, symbol: tpl.srcSymbol });
        }
      });
    });
    FinMail.sendIfAny(items, FinMail.fundingReminder);
    return items.length;
  }

  /** 交割前備妥款項提醒：所有「有效」買入／賣出交易，交割日的前一個營業日剛好是今天 */
  function sendSettlementReminders(c, env) {
    var items = [];
    c.txRows.forEach(function (t) {
      if (t.status !== '有效' || (t.type !== '買入' && t.type !== '賣出') || !t.settleDate || t.settleDate <= c.today) return;
      var acctId = t.type === '買入' ? t.srcAccount : t.dstAccount;
      var markets = marketsFor(c, t.type === '買入' ? t.dstAccount : t.srcAccount);
      var remindOn = FinRecurring.fundingReminderDate(t.settleDate, 1, markets, holidaySetOf(c));
      if (remindOn === c.today) {
        var qty = t.type === '買入' ? t.srcQty : t.dstQty;
        var sym = t.type === '買入' ? t.srcSymbol : t.dstSymbol;
        items.push({ accountName: accountName(c, acctId), settleDate: t.settleDate, amount: qty, symbol: sym, side: t.type });
      }
    });
    FinMail.sendIfAny(items, FinMail.settlementReminder);
    return items.length;
  }

  /** 待確認放太久提醒 */
  function sendStalePendingReminders(c, env) {
    var tplById = {};
    FinRepo.goodRows('recurring').forEach(function (t) { tplById[t.id] = t; });
    var items = [];
    c.txRows.forEach(function (t) {
      if (t.status !== '待確認' || !t.recurringId) return;
      var createdDate = String(t.createdAt || '').slice(0, 10);
      if (!createdDate) return;
      var age = daysBetween(createdDate, c.today);
      if (age >= STALE_PENDING_DAYS) {
        var tpl = tplById[t.recurringId];
        items.push({ templateName: tpl ? tpl.name : t.recurringId, plannedDate: t.plannedDate || t.date, days: age });
      }
    });
    FinMail.sendIfAny(items, FinMail.stalePending);
    return items.length;
  }

  function daysBetween(a, b) {
    var pa = FinDates.parse(a), pb = FinDates.parse(b);
    if (!pa || !pb) return 0;
    var ta = Date.UTC(pa.y, pa.m - 1, pa.d), tb = Date.UTC(pb.y, pb.m - 1, pb.d);
    return Math.round((tb - ta) / 86400000);
  }

  /** 信用卡繳款日將近提醒。同一「額度群組」的卡片視為一張合併帳單，同一組只寄一封（合併帳號名稱、金額用整組加總），不會重複寄好幾封 */
  function sendCardDueReminders(c, env) {
    var items = [];
    var seenGroups = {};
    c.cardRows.forEach(function (cs) {
      var acct = c.accounts[cs.accountId];
      if (!acct || acct.type !== '信用卡') return;
      var siblings = cs.limitGroup ? c.cardRows.filter(function (r) {
        var a = c.accounts[r.accountId];
        return r.limitGroup === cs.limitGroup && a && a.type === '信用卡';
      }) : [cs];
      var ids = siblings.length > 1 ? siblings.map(function (r) { return r.accountId; }) : null;
      if (ids) {
        if (seenGroups[cs.limitGroup]) return; // 這個群組已經算過一次，避免同一張合併帳單被重複寄好幾封信
        seenGroups[cs.limitGroup] = true;
      }
      var inst = c.instruments[acct.defaultSymbol];
      var s = FinCreditCard.summary(c.txRows, cs.accountId, acct.defaultSymbol, inst ? inst.decimals : 0, cs, c.today, ids);
      if (!s.dueDate || s.statementAmountDue <= 0) return;
      if (daysBetween(c.today, s.dueDate) === CARD_REMIND_DAYS) {
        var name = ids ? siblings.map(function (r) { return (c.accounts[r.accountId] || {}).name || r.accountId; }).join('、') : acct.name;
        items.push({ accountName: name, dueDate: s.dueDate, amount: s.statementAmountDue, symbol: acct.defaultSymbol });
      }
    });
    FinMail.sendIfAny(items, FinMail.cardDueReminder);
    return items.length;
  }

  /** 每天排程的進入點：先產生到期交易，再寄各種提醒信。任何一種提醒信失敗都不影響其他步驟。 */
  function runDaily(now) {
    FinRepo.reset();
    var env = { now: now, device: 'scheduler' };
    var c = FinApi.loadContext(now);
    var gen = generateDue(c, env);
    var summary = { created: gen.created.length, skipped: gen.skipped.length };
    try { summary.fundingReminders = sendFundingReminders(c, env); } catch (e) { summary.fundingRemindersError = e.message; }
    try { summary.settlementReminders = sendSettlementReminders(c, env); } catch (e) { summary.settlementRemindersError = e.message; }
    try { summary.staleReminders = sendStalePendingReminders(c, env); } catch (e) { summary.staleRemindersError = e.message; }
    try { summary.cardReminders = sendCardDueReminders(c, env); } catch (e) { summary.cardRemindersError = e.message; }
    return summary;
  }

  return { runDaily: runDaily, generateDue: generateDue, sendFundingReminders: sendFundingReminders, sendSettlementReminders: sendSettlementReminders, sendStalePendingReminders: sendStalePendingReminders, sendCardDueReminders: sendCardDueReminders };
})();
