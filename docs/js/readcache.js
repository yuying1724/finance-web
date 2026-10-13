import { state, prefs } from './store.js';
import * as api from './api.js';

/**
 * 唯讀查詢的快取（投資報表、支出圖表、年度總覽、淨資產走勢、未來扣款日曆、信用卡帳單、貸款攤還表…）：
 * 開頁先畫上次的結果，背景再更新，跟首頁、持倉頁同一套做法，不用每次都等後端 2 秒。
 *
 *  - 記憶體＋ localStorage（fin.rc），綁定裝置身分（換授權碼就不沿用），每個 action 最多留 8 組參數的結果。
 *  - 首頁資料重新整理過（state.loadedAt 變了，例如剛記一筆交易）或超過 5 分鐘就視為「過期」：先畫舊的、背景重抓；沒過期就直接用，不打後端。
 *  - 同一組 action＋參數同時只會有一個請求。
 *
 * 用法：
 *   const r = cachedRead('getYearSummary', { year }, { onData: (data, meta) => draw(data), onError: (e) => ... });
 *   r.data 是立刻可用的（可能是 null）；r.stale 表示背景正在重抓；r.promise 是這次請求（沒重抓時是 resolved 的舊資料）。
 */
const LS_KEY = 'fin.rc';
const STALE_MS = 5 * 60 * 1000;
const MAX_PER_ACTION = 8;
const mem = new Map(); // key → { res, stamp, at }
const inflight = new Map(); // key → Promise
let loaded = false;

function deviceId() { const s = prefs.session; return s && s.session ? String(s.session).split('.')[0] : ''; }
function dataStamp() { return state.loadedAt ? new Date(state.loadedAt).getTime() : 0; }
function keyOf(action, params) { return action + '|' + JSON.stringify(params || {}); }

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (c && c.device === deviceId() && c.entries && typeof c.entries === 'object') {
      Object.entries(c.entries).forEach(([k, v]) => { if (v && v.res !== undefined) mem.set(k, v); });
    }
  } catch (e) { /* 忽略 */ }
}
function save() {
  // 每個 action 只留最近用到的幾組，避免 localStorage 越長越大
  const byAction = new Map();
  [...mem.entries()].sort((a, b) => b[1].at - a[1].at).forEach(([k, v]) => {
    const a = k.slice(0, k.indexOf('|'));
    const list = byAction.get(a) || [];
    if (list.length >= MAX_PER_ACTION) { mem.delete(k); return; }
    list.push(k); byAction.set(a, list);
  });
  try { localStorage.setItem(LS_KEY, JSON.stringify({ device: deviceId(), entries: Object.fromEntries(mem) })); } catch (e) { /* 空間不足就算了 */ }
}

export function clearReadCache() { mem.clear(); inflight.clear(); loaded = true; try { localStorage.removeItem(LS_KEY); } catch (e) { /* 忽略 */ } }

/** 把某個 action 的快取全部標成過期（例如按了「更新價格」之後） */
export function invalidateRead(action) {
  for (const [k, v] of mem) if (k.startsWith(action + '|')) v.stamp = null;
}

export function cachedRead(action, params = {}, opts = {}) {
  load();
  const key = keyOf(action, params);
  const hit = mem.get(key) || null;
  const stamp = dataStamp();
  const stale = !hit || hit.stamp !== stamp || Date.now() - hit.at > STALE_MS || opts.force;
  const data = hit ? hit.res : null;
  if (data !== null && opts.onData) opts.onData(data, { fromCache: true, stale });
  let promise;
  if (!stale) promise = Promise.resolve(data);
  else if (inflight.has(key)) promise = inflight.get(key);
  else {
    promise = api.call(action, params, opts.callOpts || {}).then((res) => {
      mem.set(key, { res, stamp, at: Date.now() });
      save();
      return res;
    }).finally(() => { inflight.delete(key); });
    inflight.set(key, promise);
  }
  if (stale) {
    promise.then((res) => { if (opts.onData) opts.onData(res, { fromCache: false, stale: false }); })
      .catch((e) => { if (opts.onError) opts.onError(e, { hadData: data !== null }); });
  }
  return { data, stale, promise };
}
