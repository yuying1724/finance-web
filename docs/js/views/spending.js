import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import * as api from '../api.js';
import { money, catIconStyle } from '../fmt.js';
import { openSheet, errorText } from '../ui.js';

/**
 * 每月支出圖表（首頁「本月」卡 → 支出圖表）：
 *  - 上半部：最近 6／12 個月每月支出的長條圖（單一數列、同一個顏色），點長條切換下面看的月份，虛線是期間平均
 *  - 下半部：選定月份的大分類排行（金額、占比、細條），點大分類展開細項，同時上面的圖改成只看這個分類的每月金額
 * 資料來自後端 getMonthlyExpenses（支出加總、退款抵銷，轉帳／買賣／調整不算；分期依每期金額算在出帳月份），只顯示開始記帳以後的月份；
 * 圖下面列出每個月的合計，點一下換月份。
 */
const RANGES = [[6, '6 個月'], [12, '12 個月']];
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs) { const el = document.createElementNS(SVG, tag); Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v))); return el; }
const monthNum = (ym) => Number(ym.slice(5, 7));
const ymLabel = (ym) => `${ym.slice(0, 4)} 年 ${monthNum(ym)} 月`;

function catById(id) { return (state.data.categories || []).find((c) => c.id === id) || null; }
/** 分類 → 大分類 ID（沒有上層就是自己；找不到分類算「未分類」） */
function parentOf(id) {
  const c = catById(id);
  if (!c) return '';
  return c.parentId || c.id;
}

/** 一個月的大分類合計：[{id, amount, children:[{id, amount}]}]，金額大到小 */
function groupMonth(month) {
  const map = new Map();
  (month ? month.byCategory : []).forEach((x) => {
    const pid = parentOf(x.categoryId);
    if (!map.has(pid)) map.set(pid, { id: pid, amount: 0, children: [] });
    const g = map.get(pid);
    g.amount += x.amount;
    if (x.categoryId !== pid) g.children.push({ id: x.categoryId, amount: x.amount });
  });
  const out = [...map.values()].filter((g) => Math.abs(g.amount) > 0.004);
  out.forEach((g) => g.children.sort((a, b) => b.amount - a.amount));
  out.sort((a, b) => b.amount - a.amount);
  return out;
}

function valueOf(month, filter) {
  if (!filter) return month.expense;
  return month.byCategory.reduce((sum, x) => sum + (parentOf(x.categoryId) === filter ? x.amount : 0), 0);
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** 上方長條圖 */
function barChart(months, ui, base, onPick) {
  const W = 320, H = 150, PL = 4, PR = 4, PT = 20, PB = 18;
  const vals = months.map((m) => Math.max(0, valueOf(m, ui.filter)));
  const max = niceMax(Math.max(...vals));
  const n = months.length, slot = (W - PL - PR) / n, gap = 2, bw = Math.max(4, Math.min(slot - gap, 44)); // 月份少時長條不會變得超寬
  const y = (v) => PT + (1 - v / max) * (H - PT - PB);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sp-chart', role: 'img', 'aria-label': `每月支出長條圖，${ymLabel(months[0].ym)} 到 ${ymLabel(months[n - 1].ym)}` });
  svg.appendChild(s('line', { x1: PL, x2: W - PR, y1: H - PB, y2: H - PB, class: 'nw-axis' }));
  // 平均（虛線＋右側標籤）
  const avg = vals.reduce((a, b) => a + b, 0) / n;
  if (avg > 0) {
    svg.appendChild(s('line', { x1: PL, x2: W - PR, y1: y(avg), y2: y(avg), class: 'sp-avg' }));
  }
  months.forEach((m, i) => {
    const v = vals[i];
    const x0 = PL + i * slot + (slot - bw) / 2;
    const top = y(v), bottom = H - PB;
    const on = m.ym === ui.ym;
    if (v > 0) {
      const r = Math.min(4, bw / 2, bottom - top);
      // 上方兩角 4px 圓角、底部平貼基線
      const d = `M${x0},${bottom} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x0 + bw - r},${top} Q${x0 + bw},${top} ${x0 + bw},${top + r} L${x0 + bw},${bottom} Z`;
      svg.appendChild(s('path', { d, class: 'sp-bar' + (on ? ' on' : '') }));
    }
    const tick = s('text', { x: x0 + bw / 2, y: H - 5, class: 'nw-tick' + (on ? ' sp-tick-on' : ''), 'text-anchor': 'middle' });
    tick.textContent = monthNum(m.ym) === 1 || i === 0 ? `${m.ym.slice(2, 4)}/${monthNum(m.ym)}` : `${monthNum(m.ym)}月`;
    svg.appendChild(tick);
    if (on && v > 0) {
      const lbl = s('text', { x: Math.min(Math.max(x0 + bw / 2, 24), W - 24), y: Math.max(top - 5, 10), class: 'sp-val', 'text-anchor': 'middle' });
      lbl.textContent = money(v, base, { whole: true });
      svg.appendChild(lbl);
    }
    // 點擊區：整個欄位的高度，比長條大
    const hit = s('rect', { x: PL + i * slot, y: 0, width: slot, height: H, fill: 'transparent', 'data-ym': m.ym, class: 'sp-hit' });
    hit.addEventListener('click', () => onPick(m.ym));
    hit.addEventListener('pointerenter', () => { ui.tip.textContent = `${ymLabel(m.ym)}　${ui.filter ? (catById(ui.filter) || {}).name + ' ' : '支出 '}${money(v, base, { whole: true })}`; });
    svg.appendChild(hit);
  });
  svg.addEventListener('pointerleave', () => { ui.tip.textContent = ui.defaultTip; });
  return { svg, avg };
}

export function openSpending() {
  const base = state.data.base;
  const ui = { range: 6, ym: '', filter: '', open: '', data: null, error: null, tip: h('div', { class: 'muted small sp-tip', 'aria-live': 'polite' }), defaultTip: '' };
  const body = h('div', { 'data-testid': 'spending' }, h('div', { class: 'muted' }, '載入中…'));

  function draw() {
    if (ui.error) { mount(body, h('div', { class: 'notice bad' }, errorText(ui.error))); return; }
    if (!ui.data) return;
    // 只顯示開始記帳（startYm）以後的月份
    const all = ui.data.months.filter((m) => !ui.data.startYm || m.ym >= ui.data.startYm);
    const months = all.slice(-ui.range);
    if (!ui.ym || !months.some((m) => m.ym === ui.ym)) ui.ym = months[months.length - 1].ym;
    const cur = months.find((m) => m.ym === ui.ym);
    const idx = all.findIndex((m) => m.ym === ui.ym);
    const prev = idx > 0 ? all[idx - 1] : null;
    const groups = groupMonth(cur);
    const filterCat = ui.filter ? catById(ui.filter) : null;

    const chips = h('div', { class: 'chips', style: { gap: '6px' } }, RANGES.map(([n, label]) =>
      h('button', { type: 'button', class: 'chip chip-sm' + (ui.range === n ? ' on' : ''), onclick: () => { ui.range = n; draw(); } }, label)));
    const filterChip = filterCat
      ? h('button', { type: 'button', class: 'chip chip-sm on', 'data-testid': 'sp-filter', onclick: () => { ui.filter = ''; draw(); } }, `只看：${filterCat.name}`, icon('x'))
      : null;

    const chart = barChart(months, ui, base, (ym) => { ui.ym = ym; draw(); });
    ui.defaultTip = `${ui.range} 個月平均 ${money(chart.avg, base, { whole: true })}／月（虛線）${filterCat ? `　${filterCat.name}` : ''}`;
    ui.tip.textContent = ui.defaultTip;

    const curVal = valueOf(cur, ui.filter), prevVal = prev ? valueOf(prev, ui.filter) : null;
    const diff = prevVal === null ? null : curVal - prevVal;
    const head = h('div', { class: 'sp-head' },
      h('div', null, h('div', { class: 'muted small' }, `${ymLabel(cur.ym)}${filterCat ? '　' + filterCat.name : '　支出'}`),
        h('div', { class: 'sp-total', 'data-testid': 'sp-total' }, money(curVal, base, { whole: true }))),
      diff === null ? null : h('div', { class: 'small', style: { textAlign: 'right' }, 'data-testid': 'sp-diff' }, h('div', { class: 'muted' }, '比上個月'),
        h('div', { style: { fontWeight: 600 } }, diff > 0 ? `多 ${money(diff, base, { whole: true })}` : diff < 0 ? `少 ${money(-diff, base, { whole: true })}` : '一樣')));

    const maxG = groups.length ? Math.max(...groups.map((g) => g.amount)) : 1;
    const rows = groups.map((g) => {
      const c = catById(g.id);
      const name = c ? c.name : '未分類';
      const pct = cur.expense > 0 ? Math.round((g.amount / cur.expense) * 1000) / 10 : 0;
      const isOpen = ui.open === g.id;
      const row = h('button', { type: 'button', class: 'item sp-row' + (ui.filter === g.id ? ' on' : ''), 'data-testid': 'sp-cat', 'data-cat': name,
        onclick: () => { const same = ui.open === g.id; ui.open = same ? '' : g.id; ui.filter = same ? '' : g.id; draw(); } },
        h('div', { class: 'ico', style: catIconStyle(c ? c.color : '') }, icon((c && c.icon) || 'dots')),
        h('div', { class: 'grow' },
          h('div', { class: 't' }, name, g.children.length ? h('span', { class: 'muted small', style: { marginLeft: '6px', fontWeight: 400 } }, isOpen ? '▾' : '▸') : null),
          h('div', { class: 'sp-meter' }, h('div', { class: 'sp-meter-fill', style: { width: `${Math.max(2, Math.round((g.amount / maxG) * 100))}%` } }))),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amt' }, money(g.amount, base, { whole: true })), h('div', { class: 'muted small' }, `${pct}%`)));
      const kids = isOpen && g.children.length
        ? h('ul', { class: 'list sp-kids' }, g.children.map((k) => h('li', null, h('div', { class: 'item' },
          h('div', { class: 'grow' }, h('div', { class: 's', style: { color: 'var(--text)' } }, (catById(k.id) || {}).name || '未分類')),
          h('div', { class: 'amt small' }, money(k.amount, base, { whole: true }))))))
        : null;
      return h('li', null, row, kids);
    });

    // 每個月合計（新到舊），點一下換到那個月
    const monthList = h('div', { class: 'sp-months', 'data-testid': 'sp-months' }, months.slice().reverse().map((m) =>
      h('button', { type: 'button', class: 'sp-month' + (m.ym === ui.ym ? ' on' : ''), 'data-ym': m.ym, onclick: () => { ui.ym = m.ym; draw(); } },
        h('span', { class: 'muted small' }, `${m.ym.slice(0, 4)}/${monthNum(m.ym)} 月`),
        h('span', { class: 'sp-month-amt' }, money(valueOf(m, ui.filter), base, { whole: true })))));

    mount(body,
      h('div', { class: 'row-flex', style: { justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, chips, filterChip),
      chart.svg, ui.tip, monthList, head,
      groups.length ? h('ul', { class: 'list' }, rows) : h('div', { class: 'muted', style: { padding: '8px 0' } }, '這個月沒有支出'),
      cur.missing && cur.missing.length ? h('div', { class: 'muted small' }, `有外幣交易查不到匯率，沒算進去：${cur.missing.join('、')}`) : null,
      h('div', { class: 'muted small', style: { marginTop: '8px' } }, `點長條或月份換月份；點分類展開細項，上面的圖會改成只看這個分類。支出＝支出交易扣掉退款，轉帳、投資買賣、繳卡費都不算；分期付款依每期金額算在出帳的月份。從 ${ui.data.startYm.slice(0, 4)}/${monthNum(ui.data.startYm)} 月（開始記帳）起算。`));
  }

  api.call('getMonthlyExpenses', { months: 12 }).then((r) => { ui.data = r; draw(); }).catch((e) => { ui.error = e; draw(); });
  return openSheet({ title: '每月支出', body });
}
