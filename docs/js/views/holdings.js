import { h, mount, clear } from '../dom.js';
import { icon } from '../icons.js';
import { state, prefs, instrumentBySymbol, accountById } from '../store.js';
import * as api from '../api.js';
import { money, amountClass, shares } from '../fmt.js';
import { openSheet, errorText, toast } from '../ui.js';
import { refreshInBackground } from '../data.js';

const S = { seq: 0 };

function qty(n) { return shares(n); }
function plMoney(n, symbol) { return money(n, symbol, { sign: true, noMask: true }); }
function plClass(n) { return amountClass(n > 0 ? 'pos' : n < 0 ? 'neg' : 'mute'); }
// 主要損益：扣掉預估賣出手續費＋證交稅（跟券商 app 一致）；舊版後端沒有 netPl 時退回帳面損益
const netOf = (p) => (p.netPl === undefined || p.netPl === null ? p.totalBase : p.netPl);
const pct = (r) => String(Number((r * 100).toFixed(4))) + '%';

function positionItem(p) {
  const inst = instrumentBySymbol(p.symbol);
  const acct = accountById(p.accountId);
  const title = `${p.symbol}　${inst ? inst.name : ''}`;
  const sub = `${acct ? acct.name : p.accountId} · 持有 ${qty(p.qty, p.symbol)}`;
  if (p.missing) {
    return h('button', { class: 'item', onclick: () => openDetail(p) },
      h('div', { class: 'grow' }, h('div', { class: 't' }, title), h('div', { class: 's' }, sub + ' · 成本 ' + money(p.costBase, state.data.base))),
      h('span', { class: 'badge warn' }, '缺價格'));
  }
  return h('button', { class: 'item', onclick: () => openDetail(p) },
    h('div', { class: 'grow' }, h('div', { class: 't' }, title), h('div', { class: 's' }, sub + ` · 市值 ${money(p.mvBase, state.data.base)}`)),
    h('div', { style: { textAlign: 'right' } },
      h('div', { class: plClass(netOf(p)), 'data-testid': 'pos-pl' }, plMoney(netOf(p), state.data.base)),
      p.sellCost > 0 ? h('div', { class: 'muted small', 'data-testid': 'pos-pl-gross' }, '未扣費用 ' + plMoney(p.totalBase, state.data.base)) : null));
}

function positionDetail(p) {
  const inst = instrumentBySymbol(p.symbol);
  const acct = accountById(p.accountId);
  const quoteSym = p.quote || (inst && inst.quote) || state.data.base;
  const rows = [['帳戶', acct ? acct.name : p.accountId], ['持有股數', qty(p.qty, p.symbol)],
    ['平均成本', money(p.costNative, quoteSym, { noMask: true }) + (p.estimated ? '（部分估算）' : '')]];
  if (!p.missing) {
    rows.push(['現價', money(p.priceNative, quoteSym, { noMask: true })]);
    rows.push(['市值', `${money(p.mvNative, quoteSym, { noMask: true })}　≈ ${money(p.mvBase, state.data.base, { noMask: true })}`]);
    // 台幣計價的標的「股價損益」就等於帳面損益，不重複列
    if (quoteSym !== state.data.base) {
      rows.push(['損益（股價）', plMoney(p.pricePl, state.data.base)]);
      rows.push(['損益（匯率）', plMoney(p.fxPl, state.data.base)]);
    }
    if (p.sellCost > 0) {
      rows.push(['帳面損益（未扣費用）', plMoney(p.totalBase, state.data.base)]);
      rows.push(['預估賣出費用', `${money(-p.sellCost, state.data.base, { sign: true, noMask: true })}（手續費 ${pct(p.sellFeeRate)} ${money(p.sellFee, state.data.base, { noMask: true })}＋證交稅 ${pct(p.sellTaxRate)} ${money(p.sellTax, state.data.base, { noMask: true })}）`]);
      rows.push(['損益（扣除賣出費用）', plMoney(netOf(p), state.data.base)]);
    } else {
      rows.push(['總損益', plMoney(p.totalBase, state.data.base)]);
    }
  } else {
    rows.push(['市值', '缺價格，無法估算']);
  }
  return h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

function openDetail(p) {
  const inst = instrumentBySymbol(p.symbol);
  openSheet({ title: `${p.symbol}　${inst ? inst.name : ''}`, body: positionDetail(p) });
}

function realizedRow(r) {
  const acct = accountById(r.accountId);
  return h('li', null, h('div', { class: 'item' },
    h('div', { class: 'grow' }, h('div', { class: 't' }, `${r.date}　${r.symbol}　賣出 ${qty(r.qty, r.symbol)}`), h('div', { class: 's' }, acct ? acct.name : r.accountId)),
    h('div', { class: plClass(r.realizedBase === null ? r.realizedNative : r.realizedBase) },
      r.realizedBase === null ? plMoney(r.realizedNative, r.quote) + '（估算）' : plMoney(r.realizedBase, state.data.base))));
}

function dividendRow(dv) {
  const acct = accountById(dv.accountId);
  return h('li', null, h('div', { class: 'item' },
    h('div', { class: 'grow' }, h('div', { class: 't' }, `${dv.date}　${dv.relatedSymbol || dv.symbol}　股息`), h('div', { class: 's' }, acct ? acct.name : dv.accountId)),
    h('div', { class: amountClass('pos') }, '+' + money(dv.net, dv.symbol, { noMask: true }))));
}

// ---------- 持倉資料快取（開頁先畫上次的結果，背景再更新；避免每次重畫都重新等後端） ----------
// 記憶體快取＋ localStorage（fin.holdings，綁定裝置身分，換授權碼就不沿用）。
// 首頁資料重新整理過（state.loadedAt 變了，例如剛記一筆交易）或超過 5 分鐘才重新抓；同時間只會有一個請求。
const HCACHE_KEY = 'fin.holdings';
const STALE_MS = 5 * 60 * 1000;
const C = { res: null, stamp: null, at: 0, inflight: null };
function deviceId() { const s = prefs.session; return s && s.session ? String(s.session).split('.')[0] : ''; }
function dataStamp() { return state.loadedAt ? new Date(state.loadedAt).getTime() : 0; }
function loadHoldingsCache() {
  if (C.res) return;
  try {
    const c = JSON.parse(localStorage.getItem(HCACHE_KEY) || 'null');
    if (c && c.device === deviceId() && c.res && Array.isArray(c.res.positions)) { C.res = c.res; C.at = c.at || 0; C.stamp = null; }
  } catch (e) { /* 忽略 */ }
}
function saveHoldingsCache() {
  try { localStorage.setItem(HCACHE_KEY, JSON.stringify({ device: deviceId(), at: C.at, res: C.res })); } catch (e) { /* 空間不足就算了 */ }
}
export function clearHoldingsCache() { C.res = null; C.stamp = null; C.at = 0; try { localStorage.removeItem(HCACHE_KEY); } catch (e) { /* 忽略 */ } }
function isStale() { return !C.res || C.stamp !== dataStamp() || Date.now() - C.at > STALE_MS; }
function fetchHoldings() {
  if (C.inflight) return C.inflight;
  const stamp = dataStamp();
  C.inflight = api.call('getHoldings', {}).then((res) => {
    C.res = res; C.stamp = stamp; C.at = Date.now(); saveHoldingsCache();
    return res;
  }).finally(() => { C.inflight = null; });
  return C.inflight;
}

function drawHoldings(listBox, res) {
  clear(listBox);
  if (!res.positions.length) {
    listBox.appendChild(h('div', { class: 'empty' }, h('div', { class: 'big' }, icon('graphUp')), '目前沒有投資部位。用右下角「＋」記一筆「買入」開始。'));
  } else {
    const totalBase = res.positions.reduce((s, p) => s + (p.missing ? 0 : p.totalBase), 0);
    const netTotal = res.positions.reduce((s, p) => s + (p.missing ? 0 : netOf(p)), 0);
    const mvBase = res.positions.reduce((s, p) => s + (p.missing ? 0 : p.mvBase), 0);
    const hasCost = res.positions.some((p) => p.sellCost > 0);
    listBox.appendChild(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, '總市值'), h('div', { class: 'v' }, money(mvBase, state.data.base))),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, '未實現損益'), h('div', { class: 'v ' + (netTotal >= 0 ? 'amt-pos' : 'amt-neg'), 'data-testid': 'pl-total' }, plMoney(netTotal, state.data.base)),
        hasCost ? h('div', { class: 'muted small' }, '未扣賣出費用 ' + plMoney(totalBase, state.data.base)) : null)));
    if (hasCost) listBox.appendChild(h('p', { class: 'muted small', style: { margin: '4px 2px 0' } }, '台股損益已先扣掉預估賣出手續費 0.1425% 與證交稅（股票 0.3%、ETF 0.1%），跟券商 app 一致；美股（複委託）不扣。'));
    listBox.appendChild(h('div', { class: 'day-head' }, h('span', null, '持倉')));
    listBox.appendChild(h('ul', { class: 'list' }, res.positions.map((p) => h('li', null, positionItem(p)))));
  }
  if (res.realized.length) {
    listBox.appendChild(h('div', { class: 'day-head', style: { marginTop: '14px' } }, h('span', null, '已實現損益（最近）')));
    listBox.appendChild(h('ul', { class: 'list' }, res.realized.slice().reverse().slice(0, 20).map((r) => realizedRow(r))));
  }
  if (res.dividends.length) {
    listBox.appendChild(h('div', { class: 'day-head', style: { marginTop: '14px' } }, h('span', null, '股息（最近）')));
    listBox.appendChild(h('ul', { class: 'list' }, res.dividends.slice().reverse().slice(0, 20).map((dv) => dividendRow(dv))));
  }
  if (res.issues.length) {
    listBox.appendChild(h('div', { class: 'notice bad', style: { marginTop: '14px' } }, res.issues.map((i) => i.message).join('；')));
  }
}

/** 只畫「持倉」分頁的內容（不含頁首與分頁切換，那些由 invest.js 統一處理） */
export function renderHoldingsBody(root) {
  const listBox = h('div', { class: 'card' });
  const status = h('span', { class: 'muted small', 'data-testid': 'holdings-status' });
  // 手動更新價格：不用等早上 7 點／傍晚 6 點的排程
  const btn = h('button', { class: 'btn btn-sm', 'data-testid': 'refresh-prices', onclick: async () => {
    btn.disabled = true; btn.textContent = '更新中…';
    try {
      const r = await api.call('refreshPrices', {}, { timeoutMs: 90000 });
      if (r.skipped) toast(`剛更新過，請 ${r.waitSeconds} 秒後再試`);
      else { toast(`價格已更新（${r.changed} 檔）`); C.at = 0; refreshInBackground(); renderHoldingsBody(root); return; }
    } catch (e) { toast(errorText(e), { kind: 'bad' }); }
    btn.disabled = false; btn.textContent = '更新價格';
  } }, '更新價格');
  mount(root, h('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', margin: '0 0 8px' } }, status, btn), listBox);

  const my = ++S.seq;
  loadHoldingsCache();
  if (C.res) drawHoldings(listBox, C.res);
  else mount(listBox, h('div', { class: 'empty' }, '載入中…'));
  if (!isStale()) return;
  if (C.res) status.textContent = '更新中…';
  fetchHoldings().then((res) => {
    if (my !== S.seq) return;
    status.textContent = '';
    drawHoldings(listBox, res);
  }).catch((e) => {
    if (my !== S.seq) return;
    status.textContent = '';
    if (C.res) toast('持倉更新失敗：' + errorText(e), { kind: 'bad' });
    else mount(listBox, h('div', { class: 'notice bad' }, errorText(e)));
  });
}
