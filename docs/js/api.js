import { prefs } from './store.js';

export class ApiError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details || null; }
}

let onAuthLost = () => {};
export function setAuthLostHandler(fn) { onAuthLost = fn; }

function parseExp(session) { const p = String(session || '').split('.'); return Number(p[2]) || 0; }
export function setSession(session, ttlMinutes) {
  if (!session) { prefs.session = null; return; }
  const prev = prefs.session || {};
  prefs.session = { session, exp: parseExp(session), ttl: ttlMinutes || prev.ttl || 60 };
}
export function hasValidSession() { const s = prefs.session; return !!(s && s.session && s.exp > Date.now()); }
export function clearSession() { prefs.session = null; }

/**
 * 這次的回應是不是 doGet 的「後端運作中」訊息，而不是這次操作的結果？
 * 代表這次 POST 在送到後端前被 Google 轉址成 GET（Chrome 同時登入多個 Google 帳號時偶爾會發生），
 * 後端根本沒有執行 doPost，所以可以安全地重送；寫入類的操作另外還有 requestId 防重複。
 * 新版後端：成功回應會帶 action（必須等於這次的 action）、doGet 回應帶 via:'GET'；舊版後端沒有這兩個欄位，就用內容判斷。
 */
export function isGetFallback(action, body) {
  if (!body || typeof body !== 'object' || !body.ok) return false;
  if (body.via === 'GET') return true;
  if (body.action) return body.action !== action;
  const d = body.data;
  return action !== 'ping' && !!d && typeof d === 'object' && d.name === 'finance-web' && typeof d.message === 'string' && !('accounts' in d);
}

const MAX_TRIES = 3;

/** 呼叫後端。Apps Script 網頁應用程式用 text/plain 送 JSON（避免瀏覽器的 CORS 預檢）。被轉址成 GET（操作沒有執行）時自動重送，最多 3 次。 */
export async function call(action, params = {}, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    const body = await callOnce(action, params, opts);
    if (!isGetFallback(action, body)) return unwrap(body);
    if (attempt >= MAX_TRIES) throw new ApiError('NOT_EXECUTED', '這次操作沒有送到後端（連線被 Google 轉址），資料沒有寫入，請再試一次。常發生的話，可以改用只登入一個 Google 帳號的瀏覽器視窗');
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
}

async function callOnce(action, params, opts) {
  const url = prefs.apiUrl;
  if (!url) throw new ApiError('NO_URL', '還沒有設定後端網址，請在登入畫面展開「連線設定」填寫');
  const sess = prefs.session;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 30000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, params, session: sess ? sess.session : undefined }),
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new ApiError('TIMEOUT', '連線逾時，請稍後再試');
    throw new ApiError('NETWORK', navigator.onLine === false ? '目前沒有網路連線' : '無法連到後端，請檢查網路或後端網址');
  } finally {
    clearTimeout(timer);
  }
  let body;
  try { body = await res.json(); } catch (e) { throw new ApiError('BAD_RESPONSE', '後端回應格式不正確（網址是否填成 Apps Script 的「網頁應用程式」網址？）'); }
  if (!body || typeof body !== 'object') throw new ApiError('BAD_RESPONSE', '後端回應格式不正確');
  return body;
}

function unwrap(body) {
  if (body.session) setSession(body.session);
  if (!body.ok) {
    const err = body.error || {};
    if (err.code === 'AUTH_REQUIRED') { clearSession(); onAuthLost(); }
    throw new ApiError(err.code || 'ERROR', err.message || '發生錯誤', err.details);
  }
  return body.data;
}

export const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now() + Math.random().toString(16).slice(2));
