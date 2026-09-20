/**
 * 提醒信：內容組成（純函式、可測試）與實際寄送（呼叫 MailApp，隔開來以便測試不必真的寄信）。
 * 收件人固定是這個 Apps Script 的擁有者（Session.getEffectiveUser()），不需要另外設定信箱。
 */
var FinMail = (function () {
  // ---------- 內容組成（純函式）----------
  function fundingReminder(items) {
    // items: [{templateName, accountName, dueDate, amount, symbol}]
    var lines = items.map(function (it) {
      return '・' + it.templateName + '　' + it.accountName + '　預計 ' + it.amount + ' ' + it.symbol + '（' + it.dueDate + ' 扣款）';
    });
    return {
      subject: '［財務系統］資金備妥提醒（' + items.length + ' 筆）',
      body: '以下定期扣款即將到期，請在扣款日前備妥款項：\n\n' + lines.join('\n') + '\n\n（此信由財務系統排程自動寄出）',
    };
  }

  function manualOrderToday(item) {
    // item: {templateName, accountName, symbol, amount}
    return {
      subject: '［財務系統］今天該買 ' + item.symbol + ' 了',
      body: '定期範本「' + item.templateName + '」今天到期，請自行到券商下單：\n\n' +
        '標的：' + item.symbol + '\n預計金額：' + item.amount + '\n帳戶：' + item.accountName + '\n\n' +
        '買完之後，請到「財務管理」App 的「待確認」把實際成交結果填進去（成交日、股數、金額、手續費），交割日會依成交日自動算出。\n\n（此信由財務系統排程自動寄出）',
    };
  }

  function settlementReminder(items) {
    // items: [{accountName, settleDate, amount, symbol, side}]  side: '買入'扣款 / '賣出'入帳
    var lines = items.map(function (it) {
      return '・' + it.accountName + '　' + it.settleDate + ' ' + (it.side === '買入' ? '將扣款' : '將入帳') + ' ' + it.amount + ' ' + it.symbol;
    });
    return {
      subject: '［財務系統］交割款提醒（' + items.length + ' 筆）',
      body: '以下交易明天辦理交割，請留意帳戶款項：\n\n' + lines.join('\n') + '\n\n（此信由財務系統排程自動寄出）',
    };
  }

  function stalePending(items) {
    // items: [{templateName, plannedDate, days}]
    var lines = items.map(function (it) {
      return '・' + it.templateName + '　預定日 ' + it.plannedDate + '　已經待確認 ' + it.days + ' 天';
    });
    return {
      subject: '［財務系統］有 ' + items.length + ' 筆待確認放了好幾天了',
      body: '以下定期交易已經產生「待確認」一段時間，請記得到 App 確認或略過：\n\n' + lines.join('\n') + '\n\n（此信由財務系統排程自動寄出）',
    };
  }

  function cardDueReminder(items) {
    // items: [{accountName, dueDate, amount, symbol}]
    var lines = items.map(function (it) {
      return '・' + it.accountName + '　' + it.dueDate + ' 到期，待繳 ' + it.amount + ' ' + it.symbol;
    });
    return {
      subject: '［財務系統］信用卡繳款日將近（' + items.length + ' 筆）',
      body: '以下信用卡帳單即將到期：\n\n' + lines.join('\n') + '\n\n（此信由財務系統排程自動寄出）',
    };
  }

  // ---------- 實際寄送 ----------
  function send(subject, body) {
    try {
      var to = Session.getEffectiveUser().getEmail();
      if (!to) return false;
      MailApp.sendEmail(to, subject, body);
      return true;
    } catch (e) {
      try { Logger.log('寄信失敗：' + (e && e.message)); } catch (x) { /* ignore */ }
      return false;
    }
  }

  function sendIfAny(items, builder) {
    if (!items || !items.length) return false;
    var m = builder(items);
    return send(m.subject, m.body);
  }

  return {
    fundingReminder: fundingReminder, manualOrderToday: manualOrderToday, settlementReminder: settlementReminder,
    stalePending: stalePending, cardDueReminder: cardDueReminder, send: send, sendIfAny: sendIfAny,
  };
})();
//#ifnode
module.exports = FinMail;
//#endif
