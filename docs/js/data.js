import { state, notify } from './store.js';
import * as api from './api.js';

/** 重新載入首頁資料（帳戶、餘額、淨值、本月收支…）並通知畫面更新 */
export async function refresh() {
  state.data = await api.call('bootstrap');
  notify();
}
