import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state, accountById } from '../store.js';
import { money, catIconStyle } from '../fmt.js';
import { errorText, loading } from '../ui.js';
import { cachedRead } from '../readcache.js';

/**
 * 年度總覽（交易 › 圖表 › 年度）：
 *  - 上面：這一年的支出、收入、結餘，和去年比（今年的話比「去年同期」＝去年 1 月到同一個月）
 *  - 每月支出長條圖（實心＝今年，橫線＝去年同一個月），點長條回到那個月的月圖表
 *  - 大分類排行：今年多少、占比、比去年同期多／少；點一下展開細項
 *  - 收入來源、今年最大筆的支出（房租、保險、年費這種一年一次的）
 * 資料來自後端 getYearSummary（支出＝支出扣掉退款，分期依每期金額算在出帳月份；轉帳、投資買賣、繳卡費都不算）。
 */
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs) { const el = document.createElementNS(SVG, tag); Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v))); return el; }
const W0 = (n) => money(n, state.data.base, { whole: true });
function catById(id) { return (state.data.categories || []).find((c) => c.id === id) || null; }
function parentOf(id) { const c = catById(id); return c ? (c.parentId || c.id) : ''; }
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

/** 把幾個月的分類金額加起來，依大分類分組：[{id, amount, children: Map(id → amount)}] */
function groupCats(months, key = 'byCategory') {
  const map = new Map();
  months.forEach((m) => (m[key] || []).forEach((x) => {
    const pid = parentOf(x.categoryId);
    if (!map.has(pid)) map.set(pid, { id: pid, amount: 0, children: new Map() });
    const g = map.get(pid);
    g.amount += x.amount;
    if (x.categoryId !== pid) g.children.set(x.categoryId, (g.children.get(x.categoryId) || 0) + x.amount);
  }));
  return map;
}

/** 比較文字：「比去年同期多 NT$1,200（+8%）」；去年是 0 就說還沒記帳 */
function diffText(cur, prev, label, more = '多', less = '少') {
  if (!(Math.abs(prev) > 0.004)) return `${label}沒有資料`;
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return `跟${label}一樣`;
  const pct = Math.round((d / Math.abs(prev)) * 100);
  return `比${label}${d > 0 ? more : less} ${W0(Math.abs(d))}（${d > 0 ? '+' : ''}${pct}%）`;
}

function yearChart(cur, prev, data, onPick) {
  const W = 320, H = 150, PL = 4, PR = 4, PT = 20, PB = 18;
  const vals = cur.map((m) => Math.max(0, m.expense)), pvals = prev.map((m) => Math.max(0, m.expense));
  const max = niceMax(Math.max(...vals, ...pvals));
  const slot = (W - PL - PR) / 12, bw = Math.min(slot - 4, 18);
  const y = (v) => PT + (1 - v / max) * (H - PT - PB);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sp-chart', role: 'img', 'aria-label': `${data.year} 年每月支出長條圖，橫線是 ${data.year - 1} 年同一個月` });
  svg.appendChild(s('line', { x1: PL, x2: W - PR, y1: H - PB, y2: H - PB, class: 'nw-axis' }));
  const tip = h('div', { class: 'muted small sp-tip', 'aria-live': 'polite' });
  const defaultTip = `實心長條＝${data.year} 年，橫線＝${data.year - 1} 年同一個月；點長條看那個月`;
  tip.textContent = defaultTip;
  cur.forEach((m, i) => {
    const v = vals[i], pv = pvals[i];
    const cx = PL + i * slot + slot / 2, x0 = cx - bw / 2, bottom = H - PB;
    const future = i + 1 > data.cutoffMonth;
    if (v > 0) {
      const top = y(v), r = Math.min(3, bw / 2, bottom - top);
      const d = `M${x0},${bottom} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x0 + bw - r},${top} Q${x0 + bw},${top} ${x0 + bw},${top + r} L${x0 + bw},${bottom} Z`;
      svg.appendChild(s('path', { d, class: 'sp-bar on' }));
    }
    if (pv > 0) svg.appendChild(s('line', { x1: cx - slot / 2 + 2, x2: cx + slot / 2 - 2, y1: y(pv), y2: y(pv), class: 'yr-prev' }));
    const tick = s('text', { x: cx, y: H - 5, class: 'nw-tick', 'text-anchor': 'middle', opacity: future ? 0.5 : 1 });
    tick.textContent = String(i + 1);
    svg.appendChild(tick);
    const hit = s('rect', { x: PL + i * slot, y: 0, width: slot, height: H, fill: 'transparent', 'data-ym': m.ym, class: 'sp-hit' });
    hit.addEventListener('click', () => onPick(m.ym));
    hit.addEventListener('pointerenter', () => { tip.textContent = `${i + 1} 月　${data.year}：${W0(v)}　${data.year - 1}：${pv > 0 ? W0(pv) : '—'}`; });
    svg.appendChild(hit);
  });
  svg.addEventListener('pointerleave', () => { tip.textContent = defaultTip; });
  return h('div', null, svg, tip);
}

function itemRow(x) {
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const c = catById(x.categoryId);
  const title = x.merchant || x.note || (c || {}).name || '未分類';
  const acct = (accountById(x.account) || {}).name || '';
  const sub = [c && title !== c.name ? c.name : '', x.kind === '分期' ? `分期 第 ${x.n}/${x.terms} 期` : '', acct].filter(Boolean).join(' · ');
  return h('li', { 'data-testid': 'yr-top-item' }, h('div', { class: 'item' },
    h('div', { class: 'muted small', style: { minWidth: '38px' } }, md(x.kind === '分期' ? x.closeDate : x.date)),
    h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 't', style: { fontWeight: 500 } }, title), sub ? h('div', { class: 's' }, sub) : null),
    h('div', { class: 'amt small' }, W0(x.amount))));
}

const YUI = { year: 0, open: '', showIncome: false };

/**
 * 畫進 body。opts.header：最上面那排（6 個月／12 個月／年度切換）；opts.onPickMonth(ym)：點長條回月圖表
 */
export function renderYear(body, opts = {}) {
  const thisYear = Number(state.data.today.slice(0, 4));
  if (!YUI.year) YUI.year = thisYear;
  const want = YUI.year;
  // 本機快取先畫；資料版本變了或超過 5 分鐘才背景重抓，抓回來再畫一次
  const r = cachedRead('getYearSummary', { year: want }, {
    onData: (d, meta) => { if (meta.fromCache) return; if (body.isConnected && YUI.year === want) renderYear(body, opts); },
    onError: (e, meta) => { if (!meta.hadData && body.isConnected) mount(body, opts.header || null, h('div', { class: 'notice bad' }, errorText(e))); },
  });
  const data = r.data;
  if (!data) { mount(body, opts.header || null, loading()); return; }
  const startYear = Number((data.startYm || data.today).slice(0, 4));
  const cut = data.cutoffMonth;
  const isThis = data.year === thisYear;
  const cur = data.months, prev = data.prevMonths;
  const curP = cur.slice(0, cut), prevP = prev.slice(0, cut); // 比較用：今年只比到這個月
  const label = isThis ? `去年同期（1～${cut} 月）` : `${data.year - 1} 年`;
  // 今年只算到這個月（之後月份的分期還沒到，不算進來）
  const curUse = isThis ? curP : cur;
  const exp = sum(curUse, (m) => m.expense), inc = sum(curUse, (m) => m.income);
  const expP = exp, incP = inc;
  const pExp = sum(prevP, (m) => m.expense), pInc = sum(prevP, (m) => m.income);
  // 月平均：有記帳的月份（開始記帳以後、到這個月為止）
  const counted = cur.filter((m, i) => i < cut && m.ym >= data.startYm).length;
  const avg = counted ? expP / counted : 0;

  const setYear = (y) => { YUI.year = y; YUI.open = ''; renderYear(body, opts); };
  const nav = h('div', { class: 'row-flex', style: { justifyContent: 'center', alignItems: 'center', gap: '14px', margin: '8px 0 4px' } },
    h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': '前一年', 'data-testid': 'yr-prev', disabled: data.year <= Math.min(startYear, thisYear), onclick: () => setYear(data.year - 1) }, icon('left')),
    h('div', { style: { fontSize: '17px', fontWeight: 650 }, 'data-testid': 'yr-title' }, `${data.year} 年`),
    h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': '後一年', 'data-testid': 'yr-next', disabled: data.year >= thisYear, onclick: () => setYear(data.year + 1) }, icon('right')));

  const tile = (title, value, sub, testid, cls) => h('div', { class: 'yr-tile', 'data-testid': testid },
    h('div', { class: 'muted small' }, title), h('div', { class: 'yr-num ' + (cls || '') }, value), sub ? h('div', { class: 'muted small' }, sub) : null);
  const tiles = h('div', { class: 'yr-tiles' },
    tile(isThis ? `支出（1～${cut} 月）` : '支出', W0(exp), diffText(expP, pExp, label), 'yr-expense'),
    tile(isThis ? `收入（1～${cut} 月）` : '收入', W0(inc), diffText(incP, pInc, label), 'yr-income', 'amt-pos'),
    tile('結餘（收入－支出）', W0(inc - exp), avg > 0 ? `支出平均每月 ${W0(avg)}` : null, 'yr-net', inc - exp < 0 ? 'amt-due' : ''));

  const chart = yearChart(cur, prev, data, (ym) => { if (opts.onPickMonth) opts.onPickMonth(ym); });

  // 大分類排行
  const g = groupCats(curUse), gp = groupCats(prevP), gpc = groupCats(curP);
  const groups = [...g.values()].filter((x) => Math.abs(x.amount) > 0.004).sort((a, b) => b.amount - a.amount);
  const maxG = groups.length ? Math.max(...groups.map((x) => x.amount)) : 1;
  const hasPrev = Math.abs(pExp) > 0.004;
  const vs = (now, before) => {
    if (!hasPrev) return null;
    const d = now - before;
    if (Math.abs(d) < 0.5) return h('span', { class: 'muted small' }, '持平');
    return h('span', { class: 'small ' + (d > 0 ? 'amt-due' : 'amt-pos') }, `${d > 0 ? '+' : '-'}${W0(Math.abs(d))}`);
  };
  const rows = groups.map((x) => {
    const c = catById(x.id);
    const name = c ? c.name : '未分類';
    const pct = exp > 0 ? Math.round((x.amount / exp) * 1000) / 10 : 0;
    const open = YUI.open === x.id;
    const before = (gp.get(x.id) || { amount: 0 }).amount, nowP = (gpc.get(x.id) || { amount: 0 }).amount;
    const row = h('button', { type: 'button', class: 'item sp-row' + (open ? ' on' : ''), 'data-testid': 'yr-cat', 'data-cat': name, onclick: () => { YUI.open = open ? '' : x.id; renderYear(body, opts); } },
      h('div', { class: 'ico', style: catIconStyle(c ? c.color : '') }, icon((c && c.icon) || 'dots')),
      h('div', { class: 'grow' },
        h('div', { class: 't' }, name, x.children.size ? h('span', { class: 'muted small', style: { marginLeft: '6px', fontWeight: 400 } }, open ? '▾' : '▸') : null),
        h('div', { class: 'sp-meter' }, h('div', { class: 'sp-meter-fill', style: { width: `${Math.max(2, Math.round((x.amount / maxG) * 100))}%` } }))),
      h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amt' }, W0(x.amount)),
        h('div', { class: 'muted small' }, `${pct}%`, hasPrev ? '　' : '', vs(nowP, before))));
    let kids = null;
    if (open && x.children.size) {
      const direct = x.amount - sum([...x.children.values()]);
      const list = [...x.children.entries()].map(([id, amt]) => ({ id, amt })).sort((a, b) => b.amt - a.amt);
      if (Math.abs(direct) > 0.004) list.push({ id: x.id, amt: direct, direct: true });
      const gpk = gp.get(x.id), gck = gpc.get(x.id);
      kids = h('ul', { class: 'list sp-kids' }, list.map((k) => {
        const b = k.direct ? (gpk ? gpk.amount - sum([...gpk.children.values()]) : 0) : (gpk ? gpk.children.get(k.id) || 0 : 0);
        const n = k.direct ? (gck ? gck.amount - sum([...gck.children.values()]) : 0) : (gck ? gck.children.get(k.id) || 0 : 0);
        return h('li', { 'data-testid': 'yr-kid' }, h('div', { class: 'item' },
          h('div', { class: 'grow s', style: { color: 'var(--text)' } }, k.direct ? '（沒有細項）' : (catById(k.id) || {}).name || '未分類'),
          h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amt small' }, W0(k.amt)), hasPrev ? h('div', null, vs(n, b)) : null)));
      }));
    }
    return h('li', null, row, kids);
  });

  // 收入來源
  const ig = [...groupCats(curUse, 'incomeByCategory').values()].filter((x) => Math.abs(x.amount) > 0.004).sort((a, b) => b.amount - a.amount);
  const incomeBox = ig.length ? h('div', { style: { marginTop: '14px' } },
    h('button', { type: 'button', class: 'link-btn', 'data-testid': 'yr-income-toggle', onclick: () => { YUI.showIncome = !YUI.showIncome; renderYear(body, opts); } },
      `收入來源（${ig.length} 類）${YUI.showIncome ? ' ▾' : ' ▸'}`),
    YUI.showIncome ? h('ul', { class: 'list', 'data-testid': 'yr-income-list' }, ig.map((x) => {
      const c = catById(x.id);
      return h('li', null, h('div', { class: 'item' }, h('div', { class: 'ico', style: catIconStyle(c ? c.color : '') }, icon((c && c.icon) || 'cash')),
        h('div', { class: 'grow t' }, c ? c.name : '未分類'), h('div', { class: 'amt amt-pos' }, W0(x.amount))));
    })) : null) : null;

  const top = data.topItems || [];
  const topBox = top.length ? h('div', { style: { marginTop: '14px' } },
    h('h3', { style: { fontSize: '14px', margin: '0 0 4px' } }, `${data.year} 年最大筆的支出`),
    h('div', { class: 'muted small', style: { marginBottom: '4px' } }, '房租、保險、年費這種一年一次的大筆支出，平常看月份不容易注意到'),
    h('ul', { class: 'list sp-items', 'data-testid': 'yr-top' }, top.map(itemRow))) : null;

  const missing = [...new Set(curUse.flatMap((m) => m.missing || []))];
  const startNote = data.startYm && data.startYm.slice(0, 4) >= String(data.year) ? `從 ${data.startYm.slice(0, 4)}/${Number(data.startYm.slice(5, 7))} 月（開始記帳）起算。` : '';

  mount(body, opts.header || null, nav, tiles, chart,
    h('h3', { style: { fontSize: '14px', margin: '10px 0 4px' } }, '各分類', hasPrev ? h('span', { class: 'muted small', style: { fontWeight: 400, marginLeft: '6px' } }, `右下角是比${label}多（紅）或少（綠）`) : null),
    groups.length ? h('ul', { class: 'list', 'data-testid': 'yr-cats' }, rows) : h('div', { class: 'muted', style: { padding: '8px 0' } }, '這一年沒有支出'),
    incomeBox, topBox,
    missing.length ? h('div', { class: 'muted small' }, `有外幣交易查不到匯率，沒算進去：${missing.join('、')}`) : null,
    h('div', { class: 'muted small', style: { marginTop: '8px' } }, `支出＝支出交易扣掉退款，轉帳、投資買賣、繳卡費都不算；分期付款依每期金額算在出帳的月份。${isThis ? '今年跟去年比的時候，只比 1 月到這個月。' : ''}${startNote}`));
}
