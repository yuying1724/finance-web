/**
 * 資料保全與趨勢：
 *  1. 備份：把整份試算表複製一份到雲端硬碟「財務管理系統備份」資料夾，只保留最近 8 份（較舊的移到垃圾桶，30 天內還救得回來）。
 *     每週日清晨排程自動執行，也可以從網頁「設定」或試算表選單手動執行。需要 appsscript.json 的 drive 授權範圍。
 *  2. 淨資產快照：每天記一筆（資產、負債、淨值與各類別），寫在「快照」分頁，給首頁的淨資產走勢圖用。
 *     同一天重複執行只會更新當天那一列（早上排程記一次、傍晚收盤後價格更新再覆寫一次）。
 */
var FinMaint = (function () {
  var BACKUP_FOLDER = '財務管理系統備份';
  var BACKUP_PREFIX = '財務管理系統備份 ';
  var KEEP = 8;
  var PROP_LAST = 'BACKUP_LAST';
  var PROP_FOLDER = 'BACKUP_FOLDER_ID';

  function props() { return PropertiesService.getScriptProperties(); }

  function folder_() {
    var p = props(), id = p.getProperty(PROP_FOLDER);
    if (id) {
      try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* 資料夾被刪掉了：重新找或建立 */ }
    }
    var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
    p.setProperty(PROP_FOLDER, folder.getId());
    return folder;
  }

  /** 立即備份一份；回傳 {at, name, url, folderUrl, kept, trashed, reason} */
  function backup(nowMs, reason) {
    var id = props().getProperty('SHEET_ID');
    if (!id) throw FinFail('NOT_READY', '系統尚未初始化');
    var folder = folder_();
    var stamp = Utilities.formatDate(new Date(nowMs), 'Asia/Taipei', 'yyyy-MM-dd HHmm');
    var copy = DriveApp.getFileById(id).makeCopy(BACKUP_PREFIX + stamp, folder);
    // 只保留最近 KEEP 份（檔名的日期時間可以直接排序，新的在前）
    var files = [], it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (String(f.getName()).indexOf(BACKUP_PREFIX) === 0 && !f.isTrashed()) files.push(f);
    }
    files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : a.getName() > b.getName() ? -1 : 0; });
    var trashed = 0;
    files.slice(KEEP).forEach(function (f) { f.setTrashed(true); trashed++; });
    var info = { at: FinDates.timestamp(nowMs), name: copy.getName(), url: copy.getUrl(), folderUrl: folder.getUrl(),
      kept: Math.min(files.length, KEEP), trashed: trashed, reason: reason || '' };
    props().setProperty(PROP_LAST, JSON.stringify(info));
    return info;
  }

  function lastBackup() {
    try { return JSON.parse(props().getProperty(PROP_LAST) || 'null'); } catch (e) { return null; }
  }

  // ---------- 淨資產快照 ----------
  var SNAP_KEYS = ['cash', 'fxCash', 'stocks', 'crypto', 'receivable', 'cardDebt', 'loanDebt', 'payable', 'assets', 'liabilities', 'netWorth'];

  /** 依目前的餘額與價格算出一列快照（金額四捨五入到整數元） */
  function snapshotOf(c) {
    var nw = FinApi.computeAll(c).netWorth;
    var s = { cash: 0, fxCash: 0, stocks: 0, crypto: 0, receivable: 0, cardDebt: 0, loanDebt: 0, payable: 0 };
    nw.rows.forEach(function (r) {
      if (r.value === null || r.value === undefined) return;
      var acct = c.accounts[r.accountId], at = acct ? acct.type : '', v = r.value;
      if (at === '信用卡') { if (v < 0) s.cardDebt += -v; else s.cash += v; return; }
      if (at === '貸款') { if (v < 0) s.loanDebt += -v; else s.cash += v; return; }
      if (at === '應收' || at === '應付') { if (v < 0) s.payable += -v; else s.receivable += v; return; }
      var inst = c.instruments[r.symbol], it = inst ? inst.type : '';
      if (it === '法幣') { if (r.symbol === c.base) s.cash += v; else s.fxCash += v; }
      else if (it === '加密') s.crypto += v;
      else s.stocks += v;
    });
    s.assets = nw.assets; s.liabilities = nw.liabilities; s.netWorth = nw.total;
    var out = { date: c.today };
    SNAP_KEYS.forEach(function (k) { out[k] = Math.round(Number(s[k]) || 0); });
    return out;
  }

  /** 記下（或更新）今天的快照 */
  function snapshot(nowMs) {
    FinRepo.reset();
    var c = FinApi.loadContext(nowMs);
    var row = snapshotOf(c);
    var existing = FinRepo.goodRows('snapshots').filter(function (r) { return r.date === row.date; })[0];
    if (existing) FinRepo.updateRow('snapshots', existing._row, row);
    else FinRepo.append('snapshots', [row]);
    return row;
  }

  /** 走勢資料：已記錄的每日快照（不含今天）＋今天的即時數字 */
  function history(c) {
    var rows = FinRepo.goodRows('snapshots').filter(function (r) { return r.date && r.date < c.today; })
      .map(function (r) { var o = { date: r.date }; SNAP_KEYS.forEach(function (k) { o[k] = Number(r[k]) || 0; }); return o; });
    // 同一天如果有重複列（手動改試算表造成），以最後一列為準
    var byDate = {};
    rows.forEach(function (r) { byDate[r.date] = r; });
    var list = Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
    list.push(Object.assign(snapshotOf(c), { live: true }));
    return list;
  }

  return { backup: backup, lastBackup: lastBackup, snapshot: snapshot, snapshotOf: snapshotOf, history: history, KEEP: KEEP, BACKUP_FOLDER: BACKUP_FOLDER };
})();
