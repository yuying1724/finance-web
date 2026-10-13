import { h, mount, clear } from '../dom.js';
import { state, prefs } from '../store.js';
import * as api from '../api.js';
import { money as rawMoney, amountClass, MASK } from '../fmt.js';
import { errorText, toast } from '../ui.js';

/**
 * 投資頁「報表」：某段期間的投資損益（未實現變化＋已實現＋股息）、報酬率、期初／淨投入／期末，
 * 每月一覽（堆疊長條，正的往上、負的往下），依標的排行。後端 investReport 計算，見 core/investreport.js。
 */
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs) { const el = document.createElementNS(SVG, tag); Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, String(v))); return el; }
const money = (n, opts = {}) => rawMoney(n, state.data.base, { whole: true, ...opts });
const signed = (n) => money(n, { sign: n !== 0 });
const pct = (r) => (r === null || r === undefined ? '—' : prefs.mask ? MASK : `${r > 0 ? '+' : ''}${(r * 100).toFixed(2)}%`);
const cls = (n) => amountClass(n > 0 ? 'pos' : n < 0 ? 'neg' : 'mute');
// 三種損益的顏色（跟著種類走，圖表與數字旁的色塊一致）
const PARTS = [['unrealizedChange', '未實現損益變化', 'var(--sp-c1)'], ['realized', '已實現損益', 'var(--sp-c2)'], ['dividends', '股息', 'var(--sp-c3)']];
const MODES = [['month', '本月'], ['year', '今年'], ['12m', '近 12 個月'], ['all', '全部'], ['custom', '自訂']];
const LS = 'fin.ir.mode';

const S = { mode: null, from: '', to: '', seq: 0, cache: {} };
function loadMode() {
  if (S.mode) return;
  try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (v && MODES.some(([k]) => k === v.mode)) Object.assign(S, { mode: v.mode, from: v.from || '', to: v.to || '' }); } catch (e) { /* 忽略 */ }
  if (!S.mode) S.mode = 'year';
}
function saveMode() { try { localStorage.setItem(LS, JSON.stringify({ mode: S.mode, from: S.from, to: S.to })); } catch (e) { /* 忽略 */ } }

function rangeOf(mode) {
  const today = state.data.today, ym = today.slice(0, 7);
  if (mode === 'month') return { from: ym + '-01', to: today };
  if (mode === 'year') return { from: today.slice(0, 4) + '-01-01', to: today };
  if (mode === '12m') return { from: FinDates.addMonths(ym, -11) + '-01', to: today };
  if (mode === 'custom') return { from: S.from, to: S.to };
  return { from: '', to: '' };
}
function shortDate(d) { return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; }
function rangeText(sum) {
  const sameYear = sum.from.slice(0, 4) === sum.to.slice(0, 4) && sum.from.slice(0, 4) === state.data.today.slice(0, 4);
  const f = (d) => (sameYear ? shortDate(d) : d.replace(/-/g, '/'));
  return `${f(sum.from)} ～ ${f(sum.to)}`;
}

export function renderInvestReportBody(root) {
  loadMode();
  const periodBox = h('div', { class: 'card' });
  const monthsBox = h('div', { class: 'card', style: { marginTop: '12px' } });
  const symBox = h('div', { class: 'card', style: { marginTop: '12px' } });
  mount(root, periodBox, monthsBox, symBox);

  function chips() {
    const row = h('div', { class: 'chips', 'data-testid': 'ir-modes' }, MODES.map(([k, label]) => h('button', {
      type: 'button', class: 'chip chip-sm' + (S.mode === k ? ' on' : ''), 'data-mode': k,
      onclick: () => {
        if (k === 'custom' && !S.from) { const r = rangeOf('month'); S.from = r.from; S.to = r.to; }
        S.mode = k; saveMode(); load();
      },
    }, label)));
    if (S.mode !== 'custom') return row;
    const fromIn = h('input', { type: 'date', value: S.from, 'aria-label': '開始日期', 'data-testid': 'ir-from' });
    const toIn = h('input', { type: 'date', value: S.to, 'aria-label': '結束日期', 'data-testid': 'ir-to' });
    const apply = h('button', { type: 'button', class: 'btn btn-sm', 'data-testid': 'ir-apply', onclick: () => {
      if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) { toast('請選擇正確的開始與結束日期', { kind: 'bad' }); return; }
      S.from = fromIn.value; S.to = toIn.value; saveMode(); load();
    } }, '套用');
    return h('div', null, row, h('div', { class: 'ir-custom' }, fromIn, h('span', { class: 'muted' }, '～'), toIn, apply));
  }

  function drawPeriod(r) {
    const sum = r.summary;
    const parts = PARTS.map(([k, label, color]) => h('div', { class: 'ir-part' },
      h('span', { class: 'ir-sw', style: { background: color } }), h('span', { class: 'grow' }, label),
      h('b', { class: cls(sum[k]), 'data-testid': 'ir-' + k }, signed(sum[k]))));
    const flows = h('div', { class: 'ir-flows' },
      h('div', null, h('span', { class: 'muted' }, `期初市值（${shortDate(sum.startDate)} 收盤）`), h('b', { 'data-testid': 'ir-start' }, money(sum.startValue))),
      h('div', null, h('span', { class: 'muted' }, '淨投入'), h('b', { 'data-testid': 'ir-net' }, signed(sum.netInvest))),
      h('div', { class: 'ir-sub muted small' }, `買入 ${money(sum.buys)}　賣出入帳 ${money(sum.sells)}`),
      sum.transfers ? h('div', null, h('span', { class: 'muted' }, '補登／調整的持股'), h('b', { 'data-testid': 'ir-transfers' }, signed(sum.transfers))) : null,
      sum.transfers ? h('div', { class: 'ir-sub muted small' }, '後來才補登、開帳或用「股數調整」增減的持股，以當天市值計，不算投入的錢') : null,
      h('div', null, h('span', { class: 'muted' }, '期末市值'), h('b', { 'data-testid': 'ir-end' }, money(sum.endValue))));
    const notes = [];
    const want = rangeOf(S.mode);
    if (want.from && want.from < r.dataStart) notes.push(`投資紀錄從 ${r.dataStart.replace(/-/g, '/')} 開始（舊持股那天一次補登），報表從那天收盤起算。`);
    if (r.missing.length) {
      const btn = h('button', { type: 'button', class: 'btn btn-sm', 'data-testid': 'ir-backfill', onclick: async () => {
        btn.disabled = true; btn.textContent = '補抓中…（約 1 分鐘）';
        try {
          const res = await api.call('backfillPriceHistory', {}, { timeoutMs: 300000 });
          toast(`已補抓 ${res.added} 筆歷史收盤價` + (res.failed.length ? `；查不到：${res.failed.join('、')}` : ''));
          S.cache = {}; load();
        } catch (e) { toast(errorText(e), { kind: 'bad' }); btn.disabled = false; btn.textContent = '補抓歷史收盤價'; }
      } }, '補抓歷史收盤價');
      notes.push(h('div', null, `${r.missing.join('、')} 缺少過去的收盤價，暫時用目前價格估算（數字可能不準）。`, h('div', { style: { marginTop: '6px' } }, btn)));
    }
    mount(periodBox,
      h('div', { class: 'card-title' }, h('h2', null, '投資損益'), h('span', { class: 'muted small', 'data-testid': 'ir-range' }, rangeText(sum))),
      chips(),
      h('div', { class: 'ir-hero' },
        h('div', { class: 'ir-total ' + cls(sum.total), 'data-testid': 'ir-total' }, signed(sum.total)),
        h('div', { class: 'ir-pct ' + cls(sum.returnPct || 0), 'data-testid': 'ir-pct' }, '報酬率 ' + pct(sum.returnPct))),
      h('div', { class: 'ir-parts' }, parts),
      flows,
      notes.length ? h('div', { class: 'notice', style: { marginTop: '10px' } }, notes.map((n) => h('div', null, n))) : null,
      h('p', { class: 'muted small', style: { margin: '10px 2px 0' } }, '投資損益＝未實現損益變化＋已實現損益＋股息，也等於「期末市值－期初市值－淨投入（－補登的持股）＋股息」。未實現是帳面數字（還沒扣賣出手續費與證交稅）。報酬率有考慮期間中投入的時間（定期定額也準）。'));
  }

  function drawMonths(r) {
    const months = r.months.slice(-12);
    const tip = h('div', { class: 'muted small sp-tip', 'data-testid': 'ir-tip' });
    const sel = S.mode === 'month' || (S.mode === 'custom' && S.from && S.from.slice(0, 7) === S.to.slice(0, 7) && S.from.endsWith('-01')) ? (S.mode === 'month' ? state.data.today.slice(0, 7) : S.from.slice(0, 7)) : '';
    const tipOf = (m) => `${Number(m.ym.slice(5))} 月　${signed(m.total)}（未實現 ${signed(m.unrealizedChange)}、已實現 ${signed(m.realized)}、股息 ${money(m.dividends)}）　淨投入 ${signed(m.netInvest)}`;
    const defaultTip = '點長條看那個月的明細';
    tip.textContent = defaultTip;
    const W = 320, H = 170, PL = 4, PR = 4, PT = 16, PB = 18, gap = 2;
    let maxP = 0, minN = 0;
    months.forEach((m) => {
      let p = 0, n = 0;
      PARTS.forEach(([k]) => { if (m[k] > 0) p += m[k]; else n += m[k]; });
      maxP = Math.max(maxP, p); minN = Math.min(minN, n);
    });
    if (maxP === 0 && minN === 0) maxP = 1;
    const span = maxP - minN;
    const y = (v) => PT + ((maxP - v) / span) * (H - PT - PB);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sp-chart', role: 'img', 'aria-label': '每月投資損益長條圖', 'data-testid': 'ir-chart' });
    const n = months.length, slot = (W - PL - PR) / Math.max(n, 1), bw = Math.max(6, Math.min(slot - 6, 36));
    months.forEach((m, i) => {
      const x0 = PL + i * slot + (slot - bw) / 2, on = m.ym === sel;
      // 正的從零線往上疊、負的往下疊；最外側那段兩角 4px 圓角；段與段之間 2px 空隙
      const pos = PARTS.filter(([k]) => m[k] > 0), neg = PARTS.filter(([k]) => m[k] < 0);
      let acc = 0;
      pos.forEach(([k, , color], j) => {
        const top = y(acc + m[k]), bottom = y(acc) - (j > 0 ? gap : 0); acc += m[k];
        if (bottom - top < 0.5) return;
        svg.appendChild(seg(x0, bw, top, bottom, j === pos.length - 1 ? 'top' : '', color, on));
      });
      acc = 0;
      neg.forEach(([k, , color], j) => {
        const top = y(acc) + (j > 0 ? gap : 0), bottom = y(acc + m[k]); acc += m[k];
        if (bottom - top < 0.5) return;
        svg.appendChild(seg(x0, bw, top, bottom, j === neg.length - 1 ? 'bottom' : '', color, on));
      });
      const tick = s('text', { x: x0 + bw / 2, y: H - 5, class: 'nw-tick' + (on ? ' sp-tick-on' : ''), 'text-anchor': 'middle' });
      tick.textContent = Number(m.ym.slice(5)) === 1 || i === 0 ? `${m.ym.slice(2, 4)}/${Number(m.ym.slice(5))}` : `${Number(m.ym.slice(5))}月`;
      svg.appendChild(tick);
      if (on) {
        let up = 0; pos.forEach(([k]) => { up += m[k]; });
        const lbl = s('text', { x: Math.min(Math.max(x0 + bw / 2, 30), W - 30), y: Math.max(y(up) - 4, 10), class: 'sp-val', 'text-anchor': 'middle' });
        lbl.textContent = signed(m.total);
        svg.appendChild(lbl);
      }
      const hit = s('rect', { x: PL + i * slot, y: 0, width: slot, height: H, fill: 'transparent', class: 'sp-hit', 'data-ym': m.ym });
      hit.addEventListener('pointerenter', () => { tip.textContent = tipOf(m); });
      hit.addEventListener('click', () => {
        const rg = FinDates.monthRange(m.ym);
        if (m.ym === state.data.today.slice(0, 7)) S.mode = 'month';
        else { S.mode = 'custom'; S.from = rg.from; S.to = rg.to; }
        saveMode(); load();
      });
      svg.appendChild(hit);
    });
    svg.appendChild(s('line', { x1: PL, x2: W - PR, y1: y(0), y2: y(0), class: 'nw-axis' }));
    svg.addEventListener('pointerleave', () => { tip.textContent = defaultTip; });
    const legend = h('div', { class: 'ir-legend' }, PARTS.map(([, label, color]) => h('span', null, h('span', { class: 'ir-sw', style: { background: color } }), label)));
    // 表格（每個月的數字；圖看不清楚或要抄數字時用）
    const table = h('details', { class: 'ir-table' }, h('summary', { class: 'muted small' }, '看表格'),
      h('table', null,
        h('thead', null, h('tr', null, ['月份', '損益', '未實現', '已實現', '股息', '淨投入'].map((t) => h('th', null, t)))),
        h('tbody', null, r.months.slice().reverse().map((m) => h('tr', null,
          h('td', null, `${m.ym.slice(0, 4)}/${Number(m.ym.slice(5))}`), h('td', { class: cls(m.total) }, signed(m.total)),
          h('td', null, signed(m.unrealizedChange)), h('td', null, signed(m.realized)), h('td', null, money(m.dividends)), h('td', null, signed(m.netInvest)))))));
    mount(monthsBox, h('div', { class: 'card-title' }, h('h2', null, '每月一覽')), legend, svg, tip, table);
  }

  function seg(x, w, top, bottom, round, color, on) {
    const r = round ? Math.min(4, w / 2, bottom - top) : 0;
    let d;
    if (round === 'top') d = `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${bottom} Z`;
    else if (round === 'bottom') d = `M${x},${top} L${x + w},${top} L${x + w},${bottom - r} Q${x + w},${bottom} ${x + w - r},${bottom} L${x + r},${bottom} Q${x},${bottom} ${x},${bottom - r} Z`;
    else d = `M${x},${top} L${x + w},${top} L${x + w},${bottom} L${x},${bottom} Z`;
    return s('path', { d, fill: color, class: 'ir-seg' + (on ? ' on' : '') });
  }

  function drawSymbols(r) {
    const list = r.bySymbol || [];
    const row = (x) => h('li', null, h('div', { class: 'item', 'data-testid': 'ir-sym', 'data-symbol': x.symbol },
      h('div', { class: 'grow' },
        h('div', { class: 't' }, `${x.name}`, h('span', { class: 'muted small' }, `　${x.symbol}${x.held ? '' : '・已出清'}`)),
        h('div', { class: 's' }, `未實現 ${signed(x.unrealizedChange)}・已實現 ${signed(x.realized)}・股息 ${money(x.dividends)}` + (x.netInvest ? `・淨投入 ${signed(x.netInvest)}` : '') + (x.transfers ? `・補登／調整 ${signed(x.transfers)}` : ''))),
      h('div', { class: 'right' },
        h('div', { class: cls(x.total), 'data-testid': 'ir-sym-total' }, signed(x.total)),
        h('div', { class: 'small ' + cls(x.returnPct || 0) }, pct(x.returnPct)))));
    mount(symBox, h('div', { class: 'card-title' }, h('h2', null, '依標的'), h('span', { class: 'muted small' }, '賺最多的在上面')),
      list.length ? h('ul', { class: 'list ir-syms' }, list.map(row)) : h('div', { class: 'empty' }, '這段期間沒有投資紀錄'));
  }

  function draw(r) {
    if (r.empty) {
      mount(periodBox, h('div', { class: 'empty' }, '還沒有投資紀錄。記一筆「買入」之後這裡就會有報表。'));
      clear(monthsBox); clear(symBox); monthsBox.style.display = 'none'; symBox.style.display = 'none';
      return;
    }
    monthsBox.style.display = ''; symBox.style.display = '';
    drawPeriod(r); drawMonths(r); drawSymbols(r);
  }

  async function load() {
    const my = ++S.seq;
    const rg = rangeOf(S.mode);
    const key = rg.from + '|' + rg.to + '|' + (state.loadedAt || '');
    if (S.cache[key]) draw(S.cache[key]);
    else if (!periodBox.firstChild || periodBox.querySelector('.empty')) mount(periodBox, h('div', { class: 'empty' }, '載入中…'));
    try {
      const r = await api.call('investReport', rg, { timeoutMs: 90000 });
      if (my !== S.seq) return;
      S.cache = { [key]: r };
      draw(r);
    } catch (e) {
      if (my !== S.seq) return;
      mount(periodBox, h('div', { class: 'notice bad' }, errorText(e)));
    }
  }
  load();
}
