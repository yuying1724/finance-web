// 狀態與偏好設定。localStorage 可能被封鎖（隱私模式），所以每次存取都包 try/catch，失敗就退回記憶體。
const mem = {};
function get(key) { try { const v = localStorage.getItem(key); return v === null ? (mem[key] ?? null) : v; } catch (e) { return mem[key] ?? null; } }
function set(key, value) {
  mem[key] = value;
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* 忽略 */ }
}

export const prefs = {
  get token() { return get('fin.token'); }, set token(v) { set('fin.token', v); },
  get apiUrl() { return get('fin.apiUrl') || (window.FIN_CONFIG && window.FIN_CONFIG.apiUrl) || ''; }, set apiUrl(v) { set('fin.apiUrl', v); },
  get theme() { return get('fin.theme') || 'light'; },
  set theme(v) { set('fin.theme', v === 'auto' ? null : v); applyTheme(); },
  get updown() { return get('fin.updown') || 'tw'; },
  set updown(v) { set('fin.updown', v === 'tw' ? null : v); applyTheme(); },
  get mask() { return get('fin.mask') === '1'; }, set mask(v) { set('fin.mask', v ? '1' : null); },
  get session() { try { return JSON.parse(get('fin.session') || 'null'); } catch (e) { return null; } },
  set session(v) { set('fin.session', v ? JSON.stringify(v) : null); },
};

export function applyTheme() {
  const root = document.documentElement;
  if (prefs.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prefs.theme);
  if (prefs.updown === 'us') root.setAttribute('data-updown', 'us'); else root.removeAttribute('data-updown');
}

// 全域狀態（首頁資料 = bootstrap 的回應）
export const state = { data: null, loadedAt: null, refreshing: false, listeners: new Set() };
export function subscribe(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
export function notify() { state.listeners.forEach((fn) => fn()); }

export function accountById(id) { return state.data && state.data.accounts.find((a) => a.id === id); }
export function categoryById(id) { return state.data && state.data.categories.find((c) => c.id === id); }
export function instrumentBySymbol(s) { return state.data && state.data.instruments.find((i) => i.symbol === s); }
export function balanceOf(accountId, symbol) {
  const b = state.data && state.data.balances.find((x) => x.accountId === accountId && x.symbol === symbol);
  return b ? b.qty : 0;
}
export function brokerSettingsOf(accountId) { return state.data && state.data.brokerSettings.find((x) => x.accountId === accountId); }
export function cardSettingsOf(accountId) { return state.data && state.data.cardSettings.find((x) => x.accountId === accountId); }
export function loanSettingsOf(accountId) { return state.data && state.data.loanSettings.find((x) => x.accountId === accountId); }
export function holidaySet() {
  const d = state.data;
  if (!d) return {};
  if (!d.__holidaySet) d.__holidaySet = FinDates.buildHolidaySet(d.holidays);
  return d.__holidaySet;
}
/** 預設交割日：依證券帳戶設定（買/賣交割天數、交割日曆）與休市日資料推算；查不到設定時退回台股 T+2（單一台灣日曆） */
export function suggestSettleDate(accountId, tradeDate, side) {
  const bs = brokerSettingsOf(accountId);
  const n = side === 'buy' ? (bs ? bs.buySettleDays : 2) : (bs ? bs.sellSettleDays : 2);
  const markets = bs && bs.calendar === '台灣+美國' ? ['台灣', '美國'] : ['台灣'];
  try { return FinDates.addSettleDays(tradeDate, n, markets, holidaySet()); } catch (e) { return tradeDate; }
}
