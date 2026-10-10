import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state, accountById } from '../store.js';
import * as api from '../api.js';
import { money, catIconStyle } from '../fmt.js';
import { errorText } from '../ui.js';

/**
 * 每月支出圖表（首頁「本月」卡 → 支出圖表）：
 *  - 上半部：最近 6／12 個月每月支出的長條圖（單一數列、同一個顏色），點長條切換下面看的月份，虛線是期間平均
 *  - 下半部：選定月份的大分類圓餅圖（花最多的 5 類＋其他）與排行（金額、占比、細條），點大分類展開細項，同時上面的圖改成只看這個分類的每月金額
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

/** 明細一列：日期、商家（沒有就用備註／分類）、分期第幾期或付款帳戶、金額 */
function itemRow(x, base) {
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const title = x.merchant || x.note || (catById(x.categoryId) || {}).name || '未分類';
  const acct = (accountById(x.account) || {}).name || '';
  const sub = x.kind === '分期' ? `分期 第 ${x.n}/${x.terms} 期 · ${md(x.date)} 購買，總額 ${money(x.total, x.symbol || base, { whole: true })}`
    : [x.kind === '退款' ? '退款' : '', acct, x.merchant && x.note ? x.note : ''].filter(Boolean).join(' · ');
  return h('li', { 'data-testid': 'sp-item', 'data-kind': x.kind }, h('div', { class: 'item' },
    h('div', { class: 'muted small', style: { minWidth: '38px' } }, md(x.kind === '分期' ? x.closeDate : x.date)),
    h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 't', style: { fontWeight: 500 } }, title, x.kind === '分期' ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, '分期') : null), sub ? h('div', { class: 's' }, sub) : null),
    h('div', { class: 'amt small' }, money(x.amount, base, { whole: true }))));
}
function itemList(items, base) {
  const sorted = items.slice().sort((a, b) => b.amount - a.amount || (a.date < b.date ? 1 : -1));
  return h('ul', { class: 'list sp-items', 'data-testid': 'sp-items' }, sorted.map((x) => itemRow(x, base)));
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

/**
 * 圓餅（甜甜圈）圖：選定月份的大分類占比。
 * 顏色跟著分類走、不跟著排名：整段期間花最多的 5 個大分類固定用色票 1～5（換月份顏色不變），其餘併成「其他」（中性灰）。
 * 色票是驗證過色盲可分辨的 5 色（淺色／深色各一組，見 app.css 的 --sp-c1～c5、--sp-other），片與片之間留 2px 空隙。
 * 只靠顏色分不清時，下面的分類清單有同色圓點＋名稱＋百分比。
 */
const SLOTS = 5;
function slotMap(allMonths) {
  const tot = new Map();
  allMonths.forEach((m) => groupMonth(m).forEach((g) => tot.set(g.id, (tot.get(g.id) || 0) + g.amount)));
  const order = [...tot.entries()].filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, SLOTS).map((e) => e[0]);
  const map = new Map();
  order.forEach((id, i) => map.set(id, i + 1));
  return map;
}
function colorVar(slot) { return slot ? `var(--sp-c${slot})` : 'var(--sp-other)'; }

function donut(groups, slots, total, ui, base, onPick) {
  const segs = [];
  let other = 0;
  groups.forEach((g) => { if (g.amount <= 0) return; const sl = slots.get(g.id); if (sl) segs.push({ id: g.id, slot: sl, amount: g.amount }); else other += g.amount; });
  segs.sort((a, b) => a.slot - b.slot); // 依色票順序排（驗證過相鄰色可分辨）
  if (other > 0.004) segs.push({ id: '__other', slot: 0, amount: other });
  const sum = segs.reduce((a, b) => a + b.amount, 0);
  const R = 70, r = 44, C = 80;
  const svg = s('svg', { viewBox: '0 0 160 160', class: 'sp-donut', role: 'img', 'aria-label': '這個月各大分類支出占比' });
  if (!(sum > 0)) return null;
  const pt = (a, rad) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
  let a0 = 0;
  const nameOf = (sg) => (sg.id === '__other' ? '其他' : ((catById(sg.id) || {}).name || '未分類'));
  segs.forEach((sg) => {
    const frac = sg.amount / sum;
    const a1 = a0 + frac * Math.PI * 2;
    let el;
    if (segs.length === 1) {
      el = s('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', 'stroke-width': R - r, style: `stroke:${colorVar(sg.slot)}` });
    } else {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
      el = s('path', { d: `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`, class: 'sp-seg', style: `fill:${colorVar(sg.slot)}` });
    }
    const dim = ui.filter && ui.filter !== sg.id;
    if (dim) el.setAttribute('opacity', '0.35');
    el.setAttribute('data-seg', nameOf(sg));
    el.addEventListener('pointerenter', () => { ui.dtip.textContent = `${nameOf(sg)}　${money(sg.amount, base, { whole: true })}（${Math.round(frac * 1000) / 10}%）`; });
    el.addEventListener('click', () => { if (sg.id !== '__other') onPick(sg.id); });
    svg.appendChild(el);
    a0 = a1;
  });
  svg.addEventListener('pointerleave', () => { ui.dtip.textContent = ''; });
  const t1 = s('text', { x: C, y: C - 2, 'text-anchor': 'middle', class: 'sp-donut-sub' }); t1.textContent = '本月支出';
  const t2 = s('text', { x: C, y: C + 15, 'text-anchor': 'middle', class: 'sp-donut-total' }); t2.textContent = money(total, base, { whole: true });
  svg.appendChild(t1); svg.appendChild(t2);
  return svg;
}

// 圖表的狀態放在模組裡：資料重新整理、切換分頁回來時，保留看到哪個月、展開哪個分類
const UI = { range: 6, ym: '', filter: '', open: '', kid: '' };
let CACHE = { stamp: null, data: null, error: null };

/** 首頁「支出圖表」按鈕：到「交易 › 圖表」 */
export function openSpending() { location.hash = '#/tx?view=chart'; }

/**
 * 把支出圖表畫進 container（交易分頁上方切到「圖表」）。
 * opts.ym：要看的月份（跟交易明細共用）；opts.onMonth(ym)：圖表換月份時通知；opts.onShowList(ym, categoryId)：按「看這個月的交易明細」
 */
export function mountSpending(container, opts = {}) {
  const base = state.data.base;
  if (opts.ym) UI.ym = opts.ym;
  const ui = Object.assign(UI, { tip: h('div', { class: 'muted small sp-tip', 'aria-live': 'polite' }), defaultTip: '',
    dtip: h('div', { class: 'small sp-dtip', 'aria-live': 'polite' }) });
  const body = h('div', { 'data-testid': 'spending' }, h('div', { class: 'muted' }, '載入中…'));
  mount(container, body);
  const setYm = (ym) => { ui.ym = ym; if (opts.onMonth) opts.onMonth(ym); draw(); };

  function draw() {
    const data = CACHE.data;
    if (!data && CACHE.error) { mount(body, h('div', { class: 'notice bad' }, errorText(CACHE.error))); return; }
    if (!data) return;
    ui.data = data;
    // 只顯示開始記帳（startYm）以後的月份
    const all = ui.data.months.filter((m) => !ui.data.startYm || m.ym >= ui.data.startYm);
    const months = all.slice(-ui.range);
    if (!ui.ym || !months.some((m) => m.ym === ui.ym)) {
      // 要看的月份不在目前範圍：在 12 個月內就自動放大範圍，否則看最新的月份
      if (ui.range < 12 && all.slice(-12).some((m) => m.ym === ui.ym)) { ui.range = 12; draw(); return; }
      ui.ym = months[months.length - 1].ym;
      if (opts.onMonth) opts.onMonth(ui.ym);
    }
    const cur = months.find((m) => m.ym === ui.ym);
    const idx = all.findIndex((m) => m.ym === ui.ym);
    const prev = idx > 0 ? all[idx - 1] : null;
    const groups = groupMonth(cur);
    const slots = slotMap(months); // 依目前看的期間（6／12 個月）排名，換月份顏色不變
    const filterCat = ui.filter ? catById(ui.filter) : null;

    const chips = h('div', { class: 'chips', style: { gap: '6px' } }, RANGES.map(([n, label]) =>
      h('button', { type: 'button', class: 'chip chip-sm' + (ui.range === n ? ' on' : ''), onclick: () => { ui.range = n; draw(); } }, label)));
    const filterChip = filterCat
      ? h('button', { type: 'button', class: 'chip chip-sm on', 'data-testid': 'sp-filter', onclick: () => { ui.filter = ''; draw(); } }, `只看：${filterCat.name}`, icon('x'))
      : null;

    const chart = barChart(months, ui, base, setYm);
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
      const its = (cur.items || []).filter((x) => parentOf(x.categoryId) === g.id);
      const row = h('button', { type: 'button', class: 'item sp-row' + (ui.filter === g.id ? ' on' : ''), 'data-testid': 'sp-cat', 'data-cat': name,
        onclick: () => { const same = ui.open === g.id; ui.open = same ? '' : g.id; ui.filter = same ? '' : g.id; ui.kid = ''; draw(); } },
        h('div', { class: 'ico', style: catIconStyle(c ? c.color : '') }, icon((c && c.icon) || 'dots')),
        h('div', { class: 'grow' },
          h('div', { class: 't' }, h('span', { class: 'sp-dot', style: { background: colorVar(slots.get(g.id)) } }), name, g.children.length || its.length ? h('span', { class: 'muted small', style: { marginLeft: '6px', fontWeight: 400 } }, isOpen ? '▾' : '▸') : null),
          h('div', { class: 'sp-meter' }, h('div', { class: 'sp-meter-fill', style: { width: `${Math.max(2, Math.round((g.amount / maxG) * 100))}%` } }))),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'amt' }, money(g.amount, base, { whole: true })), h('div', { class: 'muted small' }, `${pct}%`)));
      // 展開：細項分類（點一下列出這個月算進去的每一筆，分期會標第幾期）；沒有細項的大分類直接列明細
      let kids = null;
      if (isOpen && g.children.length) {
        const kidList = g.children.slice();
        const direct = its.filter((x) => x.categoryId === g.id);
        if (direct.length) kidList.push({ id: g.id, amount: direct.reduce((sum, x) => sum + x.amount, 0), direct: true });
        kids = h('ul', { class: 'list sp-kids' }, kidList.map((k) => {
          const kOpen = ui.kid === k.id;
          const kItems = its.filter((x) => x.categoryId === k.id);
          return h('li', null, h('button', { type: 'button', class: 'item', 'data-testid': 'sp-kid', 'data-cat': k.direct ? '' : (catById(k.id) || {}).name, onclick: () => { ui.kid = kOpen ? '' : k.id; draw(); } },
            h('div', { class: 'grow' }, h('div', { class: 's', style: { color: 'var(--text)' } }, k.direct ? '（沒有細項）' : (catById(k.id) || {}).name || '未分類',
              h('span', { class: 'muted small', style: { marginLeft: '6px' } }, `${kItems.length} 筆 ${kOpen ? '▾' : '▸'}`))),
            h('div', { class: 'amt small' }, money(k.amount, base, { whole: true }))), kOpen ? itemList(kItems, base) : null);
        }));
      } else if (isOpen && its.length) kids = itemList(its, base);
      const toList = isOpen && opts.onShowList ? h('button', { type: 'button', class: 'link-btn small', 'data-testid': 'sp-to-list', style: { margin: '2px 0 8px 50px' },
        onclick: () => opts.onShowList(ui.ym, ui.kid || g.id) }, `看 ${monthNum(ui.ym)} 月「${(catById(ui.kid || g.id) || {}).name || name}」的交易明細 ›`) : null;
      return h('li', null, row, kids, toList);
    });

    // 每個月合計（新到舊），點一下換到那個月
    const monthList = h('div', { class: 'sp-months', 'data-testid': 'sp-months' }, months.slice().reverse().map((m) =>
      h('button', { type: 'button', class: 'sp-month' + (m.ym === ui.ym ? ' on' : ''), 'data-ym': m.ym, onclick: () => setYm(m.ym) },
        h('span', { class: 'muted small' }, `${m.ym.slice(0, 4)}/${monthNum(m.ym)} 月`),
        h('span', { class: 'sp-month-amt' }, money(valueOf(m, ui.filter), base, { whole: true })))));

    mount(body,
      h('div', { class: 'row-flex', style: { justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, chips, filterChip),
      chart.svg, ui.tip, monthList, head,
      (() => { const pie = donut(groups, slots, cur.expense, ui, base, (id) => { const same = ui.open === id; ui.open = same ? '' : id; ui.filter = same ? '' : id; draw(); });
        return pie ? h('div', { class: 'sp-donut-wrap', 'data-testid': 'sp-donut' }, pie, ui.dtip) : null; })(),
      groups.length ? h('ul', { class: 'list' }, rows) : h('div', { class: 'muted', style: { padding: '8px 0' } }, '這個月沒有支出'),
      cur.missing && cur.missing.length ? h('div', { class: 'muted small' }, `有外幣交易查不到匯率，沒算進去：${cur.missing.join('、')}`) : null,
      h('div', { class: 'muted small', style: { marginTop: '8px' } }, `點長條或月份換月份；點分類展開細項，再點細項可以看這個月算進去的每一筆（分期會標第幾期），上面的圖會改成只看這個分類。「交易明細」只列購買日在這個月的交易，所以之前買的分期不會出現在明細裡。支出＝支出交易扣掉退款，轉帳、投資買賣、繳卡費都不算；分期付款依每期金額算在出帳的月份。從 ${ui.data.startYm.slice(0, 4)}/${monthNum(ui.data.startYm)} 月（開始記帳）起算。`));
  }

  // 資料：跟著 App 的資料版本（state.loadedAt）重抓；有舊資料先畫，背景更新完再畫一次
  const stamp = String(state.loadedAt || '');
  if (CACHE.data) draw();
  if (CACHE.stamp !== stamp) {
    CACHE.stamp = stamp;
    api.call('getMonthlyExpenses', { months: 12 })
      .then((r) => { if (CACHE.stamp !== stamp) return; CACHE.data = r; CACHE.error = null; if (body.isConnected) draw(); })
      .catch((e) => { if (CACHE.stamp !== stamp) return; CACHE.error = e; CACHE.stamp = null; if (body.isConnected) draw(); });
  }
}
