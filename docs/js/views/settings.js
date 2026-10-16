import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { prefs, state, notify, WEB_VERSION } from '../store.js';
import * as api from '../api.js';
import * as bio from '../biometric.js';
import { money } from '../fmt.js';
import { openSheet, toast, errorText, withBusy, confirmDialog } from '../ui.js';
import { lock } from '../app.js';
import { openMerchants } from './merchants.js';
import { openQuickManager } from './quicktx.js';

export function renderSettings(root) {
  const d = state.data;
  const seg = (options, current, onPick) => h('div', { class: 'seg' }, options.map(([v, t]) => h('button', { type: 'button', class: current === v ? 'on' : '', onclick: () => onPick(v) }, t)));

  const prices = Object.keys(d.prices).map((sym) => {
    const p = d.prices[sym];
    return h('li', null, h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, sym), h('div', { class: 's' }, p.updatedAt ? '更新於 ' + p.updatedAt : '尚未更新')),
      h('span', { class: 'badge' + (p.status === '正常' ? '' : ' warn') }, p.status), h('div', { class: 'amt', style: { minWidth: '70px' } }, p.price === null ? '—' : FinMoney.format(p.price, 4, { trim: true }))));
  });

  const issues = d.issues.items.map((i) => h('li', null, h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, `${i.table} 第 ${i.row} 列`), h('div', { class: 's', style: { whiteSpace: 'normal' } }, i.problems.join('；'))))))
    .concat(d.issues.ledger.map((i) => h('li', null, h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, i.txId || '交易'), h('div', { class: 's', style: { whiteSpace: 'normal' } }, i.message))))));

  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '設定')),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h2', null, '顯示'),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, '外觀'), seg([['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']], prefs.theme, (v) => { prefs.theme = v; notify(); })),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, '漲跌與收入的顏色'), seg([['tw', '紅漲綠跌（台灣）'], ['us', '綠漲紅跌']], prefs.updown, (v) => { prefs.updown = v; notify(); })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prefs.mask, onchange: (e) => { prefs.mask = e.target.checked; notify(); } }), '隱藏所有金額（只在這台裝置生效，首頁右上角的眼睛也能切換）')),
      h('div', { class: 'card' }, h('h2', null, '安全'),
        h('div', { class: 'row-flex wrap' },
          h('button', { class: 'btn btn-sm', onclick: openChangePin }, icon('lock'), '變更 PIN'),
          h('button', { class: 'btn btn-sm', onclick: () => lock('已鎖定', { autoBio: false }) }, icon('logout'), '鎖定並登出')),
        bioBlock(),
        h('div', { class: 'field', style: { marginTop: '12px' } }, h('span', { class: 'lbl' }, '這台裝置閒置多久要重新登入'), ttlSelect()),
        h('p', { class: 'muted small' }, '只在這台裝置生效；有在用就會一直延長。共用的電腦建議選短一點；手機有指紋鎖定，可以選長一點。'),
        h('p', { class: 'muted small', style: { marginBottom: 0 } }, `這台裝置：${d.device || '（未命名）'}。要新增或撤銷裝置，請在試算表的「財務系統」選單操作。`)),
      h('div', { class: 'card' }, h('h2', null, '資料'),
        h('div', { class: 'row-flex wrap' },
          d.sheetUrl ? h('a', { class: 'btn btn-sm', href: d.sheetUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), '開啟試算表') : null,
          h('button', { class: 'btn btn-sm', 'data-testid': 'open-merchants', onclick: openMerchants }, icon('receipt'), '商家管理'),
          h('button', { class: 'btn btn-sm', 'data-testid': 'open-quick', onclick: openQuickManager }, icon('stars'), '常用交易')),
        backupBlock(),
        h('h3', { style: { fontSize: '14px', margin: '14px 0 4px' } }, '匯率與價格'),
        prices.length ? h('ul', { class: 'list' }, prices) : h('div', { class: 'muted small' }, '沒有價格資料'),
        h('h3', { style: { fontSize: '14px', margin: '14px 0 4px' } }, '資料檢查'),
        issues.length ? h('ul', { class: 'list' }, issues) : h('div', { class: 'muted small' }, '沒有發現問題 ✓')),
      h('div', { class: 'card' }, h('h2', null, '關於'),
        h('dl', { class: 'kv' },
          h('dt', null, '版本'), h('dd', { 'data-testid': 'app-versions' }, `網頁 ${WEB_VERSION}／後端 ${d.version}`, WEB_VERSION !== d.version ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '版本不一致，請按下方「清除快取並重新載入」') : null),
          h('dt', null, '後端'), h('dd', { class: 'mono' }, prefs.apiUrl.replace(/^https?:\/\//, '').slice(0, 60) + (prefs.apiUrl.length > 68 ? '…' : ''))),
        h('button', { class: 'btn btn-sm', style: { marginTop: '12px' }, onclick: reloadApp }, icon('refresh'), '清除快取並重新載入'))));
}

// ---------- 這台裝置閒置多久要重新登入（每台裝置自己選；0＝跟隨試算表「設定」的閒置登出分鐘） ----------
const TTL_OPTIONS = [[0, '跟隨試算表設定'], [60, '1 小時'], [240, '4 小時'], [24 * 60, '1 天'], [7 * 24 * 60, '7 天'], [30 * 24 * 60, '30 天']];
function ttlSelect() {
  const cur = prefs.ttlMinutes;
  const s = prefs.session || {};
  const sel = h('select', { 'aria-label': '這台裝置閒置多久要重新登入', 'data-testid': 'ttl-select', onchange: () => setTtl(Number(sel.value)) },
    TTL_OPTIONS.map(([v, label]) => h('option', { value: String(v), selected: v === cur }, v === 0 && s.ttl ? `${label}（目前 ${s.ttl} 分鐘）` : label)));
  return sel;
}
export async function setTtl(minutes) {
  const prev = prefs.ttlMinutes;
  prefs.ttlMinutes = minutes;
  try {
    const r = await api.call('setSessionTtl', { ttlMinutes: minutes });
    api.setSession(r.session, r.ttlMinutes);
    const label = (TTL_OPTIONS.find(([v]) => v === minutes) || [0, minutes + ' 分鐘'])[1];
    toast(minutes ? `已設定：這台裝置閒置 ${label}才需要重新登入` : `已改回跟隨試算表設定（${r.ttlMinutes} 分鐘）`);
    notify();
  } catch (e) {
    prefs.ttlMinutes = prev;
    notify();
    if (e.code !== 'AUTH_REQUIRED') toast(errorText(e), { kind: 'bad' });
  }
}

// ---------- 指紋／臉部登入（只在這台裝置生效；PIN 用指紋驗證才拿得到的金鑰加密後存在瀏覽器裡） ----------
let bioAvail = null; // null = 還沒查
function bioBlock() {
  if (!bio.isSupported()) return null;
  if (bioAvail === null) { bioAvail = false; bio.isAvailable().then((ok) => { bioAvail = ok; notify(); }); }
  const rec = bio.record();
  if (rec) {
    const cur = bio.relockMinutes();
    const sel = h('select', { 'aria-label': '離開 App 多久後要重新驗證', 'data-testid': 'relock-select', onchange: () => {
      bio.setRelockMinutes(sel.value === 'off' ? null : Number(sel.value));
      toast(sel.value === 'off' ? '離開 App 不會再要求驗證（閒置太久仍會登出）' : `離開 App ${bio.RELOCK_OPTIONS.find(([v]) => String(v) === sel.value)[1]}後回來會再驗一次指紋`);
    } }, bio.RELOCK_OPTIONS.map(([v, label]) => h('option', { value: v === null ? 'off' : String(v), selected: v === cur }, v === 0 ? '立即（每次回來都驗）' : label)));
    return h('div', null,
      h('div', { class: 'bio-status', 'data-testid': 'bio-status' },
        icon('fingerprint'), h('span', { class: 'grow small' }, `指紋／臉部登入：已啟用（${rec.at}）`),
        h('button', { class: 'btn btn-sm', 'data-testid': 'bio-disable', onclick: async () => {
          if (!(await confirmDialog({ title: '停用指紋／臉部登入', message: '之後在這台裝置登入就要輸入 PIN。要停用嗎？', confirmText: '停用', danger: true }))) return;
          bio.disable(); toast('已停用指紋／臉部登入'); notify();
        } }, '停用')),
      h('div', { class: 'relock-row' },
        h('span', { class: 'grow small' }, '離開 App 多久後要重新驗證'), sel),
      h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, '切到別的 App 或關掉螢幕超過這段時間，回來時會先驗指紋（登入狀態還在，驗過就直接繼續）。只在這台裝置生效。'));
  }
  if (!bioAvail) return h('p', { class: 'muted small', style: { marginTop: '10px', marginBottom: 0 } }, '這台裝置沒有可用的指紋／臉部驗證，無法啟用指紋登入。');
  return h('div', { class: 'bio-status' },
    icon('fingerprint'), h('span', { class: 'grow small' }, '指紋／臉部登入：未啟用'),
    h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'bio-enable', onclick: openEnableBio }, '啟用'));
}

function openEnableBio() {
  const banner = h('div', { class: 'notice bad', role: 'alert', style: { display: 'none', marginBottom: '10px' } });
  const pinInput = h('input', { type: 'password', autocomplete: 'off', inputmode: 'numeric', 'aria-label': '目前的 PIN' });
  const go = h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'bio-enroll', onclick: async (e) => {
    banner.style.display = 'none';
    const pin = pinInput.value;
    if (!pin) { banner.style.display = ''; mount(banner, '請輸入目前的 PIN'); return; }
    await withBusy(e.currentTarget, async () => {
      try {
        const r = await api.call('login', { token: prefs.token, pin, ttlMinutes: prefs.ttlMinutes || undefined }); // 先確認 PIN 是對的，才拿去加密
        api.setSession(r.session, r.ttlMinutes);
      } catch (err) { banner.style.display = ''; mount(banner, err && err.code === 'AUTH_FAILED' ? 'PIN 不正確' : errorText(err)); return; }
      try { await bio.enroll(pin); }
      catch (err) { banner.style.display = ''; mount(banner, bio.friendly(err)); return; }
      sheet.close(); toast('已啟用，下次登入可以用指紋／臉部'); notify();
    });
  } }, '驗證並啟用');
  const sheet = openSheet({ title: '啟用指紋／臉部登入', body: h('div', null, banner,
    h('p', { class: 'muted small' }, '只在這台裝置生效。按「驗證並啟用」後手機會跳指紋／臉部驗證；PIN 會用驗證通過才拿得到的金鑰加密後存在這台裝置，沒有通過驗證解不開。之後登入時驗指紋就好，PIN 照舊可以用。'),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, '目前的 PIN'), pinInput)),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), go] });
}

// ---------- 備份（後端每週日清晨自動備份整份試算表到雲端硬碟；這裡顯示上次備份、可以手動備份） ----------
let backupState = { info: null, loading: false, loaded: false, error: null };
function backupBlock() {
  if (!backupState.loaded && !backupState.loading) {
    backupState.loading = true;
    api.call('getBackupStatus')
      .then((r) => { backupState = { info: r, loaded: true, loading: false, error: null }; notify(); })
      .catch((e) => { backupState = { info: null, loaded: true, loading: false, error: e }; notify(); });
  }
  const i = backupState.info, last = i && i.last;
  const desc = !backupState.loaded ? '載入中…'
    : backupState.error ? '備份狀態暫時讀不到：' + errorText(backupState.error)
      : last ? `上次備份：${last.at}（${last.reason || '自動'}）。${i.schedule}自動備份到雲端硬碟「${i.folderName}」資料夾，保留最近 ${i.keep} 份。`
        : `還沒有備份過。${i ? i.schedule : '每週'}會自動備份到雲端硬碟，也可以現在先備份一次。`;
  const btn = h('button', { class: 'btn btn-sm', 'data-testid': 'backup-now', onclick: async (e) => {
    await withBusy(e.currentTarget, async () => {
      try {
        const r = await api.call('backupNow');
        backupState.info = Object.assign({}, backupState.info || {}, { last: r.backup });
        toast('已備份：' + r.backup.name);
        notify();
      } catch (err) { toast(errorText(err), { kind: 'bad', ms: 8000 }); }
    });
  } }, '立即備份');
  return h('div', { 'data-testid': 'backup-block' },
    h('h3', { style: { fontSize: '14px', margin: '14px 0 4px' } }, '備份'),
    h('div', { class: 'muted small', style: { marginBottom: '8px' } }, desc),
    h('div', { class: 'row-flex wrap' }, btn,
      last && last.folderUrl ? h('a', { class: 'btn btn-sm', href: last.folderUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), '開啟備份資料夾') : null));
}

async function reloadApp() {
  try {
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    // 不解除 Service Worker：先叫它檢查新版，新版會用 no-cache 重新向伺服器要檔案（解除的話，瀏覽器自己的快取可能還是給舊檔）
    if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); }
  } catch (e) { /* 忽略 */ }
  location.reload();
}

function openChangePin() {
  const f = { oldPin: '', newPin: '', again: '' };
  const banner = h('div', { class: 'notice bad', role: 'alert', style: { display: 'none', marginBottom: '10px' } });
  const inp = (label, key) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type: 'password', autocomplete: 'off', oninput: (e) => { f[key] = e.target.value; } }));
  const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
    banner.style.display = 'none';
    if (f.newPin !== f.again) { banner.style.display = ''; mount(banner, '兩次輸入的新 PIN 不一致'); return; }
    await withBusy(e.currentTarget, async () => {
      try { await api.call('changePin', { oldPin: f.oldPin, newPin: f.newPin }); }
      catch (err) { banner.style.display = ''; mount(banner, errorText(err)); return; }
      sheet.close();
      if (!bio.isEnabled()) { toast('PIN 已變更'); return; }
      // 這台裝置有指紋登入：用新 PIN 重新加密（跳一次指紋）；失敗就停用，請使用者重新啟用
      try { await bio.reseal(f.newPin); toast('PIN 已變更，指紋登入已更新'); }
      catch (e2) { toast('PIN 已變更；指紋／臉部登入已停用，請到設定重新啟用'); }
      notify();
    });
  } }, '變更');
  const sheet = openSheet({ title: '變更 PIN', dismissable: false, body: h('div', null, banner, inp('目前的 PIN', 'oldPin'), inp('新的 PIN（至少 6 碼）', 'newPin'), inp('再輸入一次新的 PIN', 'again')),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, '取消'), save] });
}
