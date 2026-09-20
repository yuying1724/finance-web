/**
 * Apps Script 進入點：網頁應用程式（doGet / doPost）、試算表選單、排程。
 * 選單函式必須是全域函式，所以放在這裡；實際邏輯在 FinSetup / FinAuth / FinApi。
 */
var MAX_BODY_BYTES = 200000;

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonOut_({ ok: true, data: { name: 'finance-web', version: FinSchema.APP_VERSION, message: '後端運作中。請用網頁版登入使用。' } });
}

function doPost(e) {
  var body = null;
  try {
    var raw = e && e.postData ? e.postData.contents : '';
    if (raw && raw.length > MAX_BODY_BYTES) return jsonOut_({ ok: false, error: { code: 'BAD_REQUEST', message: '請求太大' } });
    body = JSON.parse(raw || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: { code: 'BAD_REQUEST', message: '請求格式錯誤' } });
  }
  return jsonOut_(FinApi.handle(body));
}

function dailyJob() {
  FinJobs.refreshPrices();
}

// ---------- 試算表選單 ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('財務系統')
    .addItem('第一次設定（建議從這裡開始）', 'menuFirstTimeSetup')
    .addSeparator()
    .addItem('初始化／修復資料表', 'menuInitialize')
    .addItem('設定或變更 PIN', 'menuSetPin')
    .addItem('新增裝置授權碼', 'menuAddDevice')
    .addItem('查看或撤銷裝置', 'menuManageDevices')
    .addItem('登出所有裝置', 'menuSignOutAll')
    .addItem('安裝每日排程（更新匯率）', 'menuInstallTriggers')
    .addItem('檢查目前狀態', 'menuStatus')
    .addToUi();
}

function ui_() { return SpreadsheetApp.getUi(); }
function alert_(title, msg) { var u = ui_(); u.alert(title, msg, u.ButtonSet.OK); }

/** 顯示輸入框；按取消回傳 null */
function ask_(title, msg) {
  var u = ui_();
  var res = u.prompt(title, msg, u.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== u.Button.OK) return null;
  return String(res.getResponseText());
}

function menuInitialize() {
  var r = FinSetup.initialize();
  var lines = [];
  if (r.created.length) lines.push('新建分頁：' + r.created.join('、'));
  if (r.repaired.length) lines.push('修復：' + r.repaired.join('；'));
  if (r.seeded.length) lines.push('寫入預設資料：' + r.seeded.join('；'));
  if (!lines.length) lines.push('所有資料表都已就緒，沒有需要修改的地方。');
  alert_('初始化完成', lines.join('\n'));
}

function askNewPin_() {
  for (var tries = 0; tries < 3; tries++) {
    var pin = ask_('設定 PIN', '請輸入新的 PIN（至少 ' + FinAuth.MIN_PIN_LENGTH + ' 碼，建議用數字；輸入時畫面看得到，請留意旁邊有沒有人）：');
    if (pin === null) return false;
    var bad = FinAuth.pinPolicyError(pin);
    if (bad) { alert_('PIN 不符合規則', bad); continue; }
    var again = ask_('確認 PIN', '請再輸入一次：');
    if (again === null) return false;
    if (again !== pin) { alert_('兩次輸入不一致', '請重新設定。'); continue; }
    FinAuth.setPin(pin);
    return true;
  }
  return false;
}

function menuSetPin() {
  if (!PropertiesService.getScriptProperties().getProperty('SHEET_ID')) { alert_('尚未初始化', '請先執行「第一次設定」。'); return; }
  if (askNewPin_()) alert_('完成', 'PIN 已設定。');
}

function addDeviceFlow_() {
  var name = ask_('新增裝置授權碼', '幫這台裝置取個名字（例如：我的手機、家裡電腦）：');
  if (name === null) return null;
  var d = FinAuth.addDevice(name);
  alert_('裝置授權碼（只會顯示這一次）',
    '裝置：' + d.name + '\n\n授權碼：\n' + d.token + '\n\n請立刻抄下或貼到那台裝置的登入畫面。關掉這個視窗後就看不到了；' +
    '如果忘記，可以在選單「查看或撤銷裝置」撤銷後重新新增。');
  return d;
}
function menuAddDevice() {
  if (!PropertiesService.getScriptProperties().getProperty('SHEET_ID')) { alert_('尚未初始化', '請先執行「第一次設定」。'); return; }
  addDeviceFlow_();
}

function menuManageDevices() {
  var list = FinAuth.listDevices();
  if (!list.length) { alert_('裝置', '目前沒有任何裝置授權碼。'); return; }
  var text = list.map(function (d) { return d.id + '：' + d.name + '（' + d.createdAt + '）'; }).join('\n');
  var id = ask_('查看或撤銷裝置', text + '\n\n要撤銷哪一台？請輸入代號（例如 D1）；不撤銷請按取消：');
  if (id === null || !String(id).trim()) return;
  if (FinAuth.revokeDevice(String(id).trim().toUpperCase())) alert_('已撤銷', '該裝置的授權碼與登入狀態已失效。');
  else alert_('找不到', '沒有代號為「' + id + '」的裝置。');
}

function menuSignOutAll() {
  FinAuth.signOutAll();
  alert_('已登出所有裝置', '所有裝置都需要重新輸入 PIN。');
}

function menuInstallTriggers() {
  FinSetup.installDailyTrigger();
  alert_('已安裝', '每天早上 7 點會自動更新匯率。第一次安裝時 Google 可能會要求你授權，請按允許。');
}

function menuStatus() {
  var s = FinSetup.status();
  var lines = [
    '已初始化：' + (s.initialized ? '是' : '否'),
    'PIN：' + (s.pin ? '已設定' : '尚未設定'),
    '裝置：' + (s.devices.length ? s.devices.map(function (d) { return d.name; }).join('、') : '無'),
    '每日排程：' + (s.triggers ? '已安裝' : '尚未安裝'),
  ];
  lines.push(s.problems.length ? '資料問題（' + s.problems.length + '）：\n' + s.problems.slice(0, 15).join('\n') : '資料檢查：沒有發現問題');
  alert_('目前狀態', lines.join('\n'));
}

function menuFirstTimeSetup() {
  var u = ui_();
  var go = u.alert('第一次設定', '接下來會依序：\n1. 建立所有資料表並放入預設分類與匯率\n2. 設定 PIN\n3. 產生第一組裝置授權碼\n4. 安裝每日更新匯率的排程\n\n要開始嗎？', u.ButtonSet.OK_CANCEL);
  if (go !== u.Button.OK) return;
  var report = FinSetup.initialize();
  if (!FinAuth.hasPin() && !askNewPin_()) { alert_('尚未完成', '資料表已建立，但 PIN 還沒設定。之後可從選單「設定或變更 PIN」繼續。'); return; }
  var device = FinAuth.listDevices().length ? null : addDeviceFlow_();
  try { FinSetup.installDailyTrigger(); } catch (e) { alert_('排程未安裝', '需要授權才能安裝排程，之後可從選單「安裝每日排程」再試一次。'); }
  alert_('設定完成',
    '資料表已就緒' + (report.created.length ? '（新建 ' + report.created.length + ' 個分頁）' : '') + '。\n\n' +
    '最後一步：在 Apps Script 編輯器按「部署」→「新增部署作業」→ 類型選「網頁應用程式」→ 執行身分「我」、存取權「所有人」，' +
    '把產生的網址貼到網站的登入畫面。' + (device ? '\n\n授權碼你已經看過了；如果沒抄到，請用選單重新新增。' : ''));
}
