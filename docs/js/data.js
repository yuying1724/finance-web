import { state, notify, prefs } from './store.js';
import * as api from './api.js';
import { toast, errorText } from './ui.js';

// ---------- 本機快取（開頁/解鎖先畫上次的資料，背景再更新，避免空白等待） ----------
// 存在 localStorage 的 fin.cache：{ device, loadedAt, data }。device 取自工作階段碼（裝置ID.發出時間…的裝置ID），
// 換了裝置授權碼（不同裝置身分）就不會誤用別台裝置留下的舊快取。鎖定／閒置後重新輸入 PIN 仍會用快取，才有「秒開」的效果。
const CACHE_KEY = 'fin.cache';
function sessionDevice() { const s = prefs.session; return s && s.session ? String(s.session).split('.')[0] : ''; }
export function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c || !c.data || c.device !== sessionDevice()) return null;
    return { data: c.data, loadedAt: new Date(c.loadedAt) };
  } catch (e) { return null; }
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ device: sessionDevice(), loadedAt: state.loadedAt, data: state.data })); } catch (e) { /* 空間不足或被封鎖就算了，不影響功能 */ }
}
export function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* 忽略 */ } }

/** 重新載入首頁資料（帳戶、餘額、淨值、本月收支…）並通知畫面更新 */
export async function refresh() {
  state.refreshing = true;
  notify();
  try {
    state.data = await api.call('bootstrap');
    state.loadedAt = new Date();
    saveCache();
  } finally {
    state.refreshing = false;
    notify();
  }
}

// ---------- 樂觀更新（按下儲存立刻關視窗、畫面立刻反應，背景送出；失敗自動還原） ----------
/**
 * 寫入並在背景重新整理。opts.optimistic：先改本機 state.data 並立刻重畫的函式，回傳「還原函式」；
 * 成功 → 回傳後端結果（並在背景 refresh() 換成正式資料）；失敗 → 還原、提示（連線類錯誤可「重試」），回傳 null。
 * opts.onResult(result)：後端回應後、背景 refresh 之前先把正式資料（例如正式 ID）合併進本機。
 */
export async function write(action, params, opts = {}) {
  let undo = null;
  if (opts.optimistic) {
    try { undo = opts.optimistic() || null; } catch (e) { console.error(e); undo = null; }
    notify();
  }
  if (opts.toast) toast(opts.toast, opts.toastOpts || {});
  try {
    const result = await api.call(action, params);
    if (opts.onResult) { try { opts.onResult(result); } catch (e) { console.error(e); } notify(); }
    refresh().catch((e) => { if (e.code !== 'AUTH_REQUIRED') console.error(e); });
    return result || {};
  } catch (e) {
    if (undo) { try { undo(); } catch (e2) { console.error(e2); } notify(); }
    if (e.code === 'AUTH_REQUIRED') return null;
    if (e.code === 'CONFLICT') refresh().catch(() => { /* 忽略 */ });
    const retryable = !!opts.retry && ['NETWORK', 'TIMEOUT', 'BUSY'].includes(e.code);
    toast((opts.failPrefix === undefined ? '儲存失敗，已還原：' : opts.failPrefix) + errorText(e),
      { kind: 'bad', ms: retryable ? 10000 : undefined, action: retryable ? { label: '重試', fn: opts.retry } : undefined });
    if (opts.onError) opts.onError(e);
    return null;
  }
}

/** 修改（id 找得到）或新增（先用暫時 ID 放進清單）一筆本機資料，回傳 { row, undo } */
export function upsertLocal(listKey, idField, id, fields) {
  const list = state.data[listKey] || (state.data[listKey] = []);
  const row = id ? list.find((r) => r[idField] === id) : null;
  if (row) {
    const snap = Object.assign({}, row);
    Object.assign(row, fields);
    return { row, undo: () => { Object.keys(row).forEach((k) => delete row[k]); Object.assign(row, snap); } };
  }
  const fresh = Object.assign({ [idField]: 'tmp-' + Date.now().toString(36), __pending: true }, fields);
  list.push(fresh);
  return { row: fresh, undo: () => { const i = list.indexOf(fresh); if (i >= 0) list.splice(i, 1); } };
}

/**
 * 樂觀新增／修改一筆主檔（帳戶、分類、標的、定期範本、券商／信用卡／貸款設定…）。
 * spec = { list, idField, id?（修改時）, fields（要先寫進本機的欄位）, resultKey?（後端回應裡正式資料的欄位名，例如 'account'）, toast }
 */
export function saveRow(action, params, spec) {
  let created = null;
  return write(action, params, {
    toast: spec.toast,
    optimistic: () => {
      const { row, undo } = upsertLocal(spec.list, spec.idField, spec.id, spec.fields);
      if (!spec.id) created = row;
      return undo;
    },
    onResult: (r) => {
      const official = spec.resultKey ? r && r[spec.resultKey] : null;
      if (official) {
        const target = created || (state.data[spec.list] || []).find((x) => x[spec.idField] === spec.id);
        if (target) { Object.assign(target, official); delete target.__pending; }
      }
    },
    retry: () => saveRow(action, params, spec),
  });
}

/** 樂觀切換啟用／停用之類的單一欄位：spec = { list, idField, id, patch, toast } */
export function patchRow(action, params, spec) {
  return write(action, params, {
    toast: spec.toast,
    optimistic: () => upsertLocal(spec.list, spec.idField, spec.id, spec.patch).undo,
    retry: () => patchRow(action, params, spec),
    failPrefix: '操作失敗，已還原：',
  });
}

// ---------- 交易的樂觀更新：首頁最近交易、帳戶餘額、淨值、本月收支先在本機算一版 ----------
function bumpBalance(accountId, symbol, delta) {
  const d = state.data;
  let b = d.balances.find((x) => x.accountId === accountId && x.symbol === symbol);
  if (!b) { b = { accountId, symbol, qty: 0 }; d.balances.push(b); }
  b.qty += delta;
}
/**
 * 把一筆交易的影響先套到本機資料（next=新內容，prev=修改前的內容，作廢時 next 的 status 是「作廢」）。
 * 淨值與本月收支只在兩端都是基準幣別時才本機估算，其他情況（買賣股票、換匯…）等背景 refresh。回傳還原函式。
 */
export function applyTxLocal(next, prev) {
  const d = state.data;
  if (!d) return () => {};
  const snap = { recent: d.recent.slice(), balances: d.balances.map((b) => Object.assign({}, b)), netWorth: Object.assign({}, d.netWorth), month: d.month ? Object.assign({}, d.month) : d.month };
  const ym = String(d.today || '').slice(0, 7);
  const apply = (t, sign) => {
    if (!t || t.status !== '有效') return;
    if (t.srcAccount && t.srcSymbol && t.srcQty) bumpBalance(t.srcAccount, t.srcSymbol, -sign * t.srcQty);
    if (t.dstAccount && t.dstSymbol && t.dstQty) bumpBalance(t.dstAccount, t.dstSymbol, sign * t.dstQty);
    const baseOnly = (!t.srcSymbol || t.srcSymbol === d.base) && (!t.dstSymbol || t.dstSymbol === d.base);
    if (!baseOnly) return;
    const out = t.srcAccount ? (t.srcQty || 0) : 0, inn = t.dstAccount ? (t.dstQty || 0) : 0;
    d.netWorth.total += sign * (inn - out);
    if (d.month && String(t.date).slice(0, 7) === ym) {
      if (t.type === '收入') { d.month.income += sign * inn; d.month.net += sign * inn; }
      else if (t.type === '支出') { d.month.expense += sign * out; d.month.net -= sign * out; }
      else if (t.type === '退款') { d.month.expense -= sign * inn; d.month.net += sign * inn; }
    }
  };
  apply(prev, -1);
  apply(next, +1);
  const id = (next && next.id) || (prev && prev.id);
  d.recent = d.recent.filter((t) => t.id !== id);
  if (next && next.status !== '作廢') {
    d.recent.push(next);
    d.recent.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1)));
    d.recent = d.recent.slice(0, 8);
  }
  return () => { Object.assign(d, snap); };
}

// ---------- 表單存檔後：把後端回傳的正式資料先合併進本機，背景再重新整理（不用等整包 bootstrap 才關視窗） ----------
/** 後端回傳的正式資料合併進本機清單（找得到就覆蓋、找不到就新增）並立刻重畫 */
export function mergeRow(listKey, idField, row) {
  if (!state.data || !row) return;
  const list = state.data[listKey] || (state.data[listKey] = []);
  const cur = list.find((r) => r[idField] === row[idField]);
  if (cur) Object.assign(cur, row); else list.push(row);
  notify();
}
/** 背景重新整理：不擋畫面，失敗只記在 console（登入過期另由 authLost 處理） */
export function refreshInBackground() {
  return refresh().catch((e) => { if (e.code !== 'AUTH_REQUIRED') console.error(e); });
}
