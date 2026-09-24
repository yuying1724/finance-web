import { state, notify, prefs } from './store.js';
import * as api from './api.js';

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
