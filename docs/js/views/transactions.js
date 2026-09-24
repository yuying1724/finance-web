import { h, mount, clear } from '../dom.js';
import { icon } from '../icons.js';
import { state, accountById } from '../store.js';
import * as api from '../api.js';
import { money, dateLabel, monthLabel, categoryInfo, amountClass, catIconStyle } from '../fmt.js';
import { openSheet, confirmDialog, toast, errorText } from '../ui.js';
import { openTxForm } from './txform.js';
import { write, applyTxLocal } from '../data.js';

// ---------- 共用：把一筆交易轉成畫面上的資訊 ----------
export function describe(t) {
  const src = accountById(t.srcAccount), dst = accountById(t.dstAccount);
  const an = (a, id) => (a ? a.name : id || '');
  const fx = t.fxSymbol && t.fxQty ? ' · ' + money(t.fxQty, t.fxSymbol, { noMask: true }) : '';
  const note = (t.merchant ? ' · ' + t.merchant : '') + fx + (t.note ? ' · ' + t.note : '');
  switch (t.type) {
    case '支出': {
      const c = categoryInfo(t.categoryId);
      return { icon: c.icon, color: c.color, title: c.name, sub: an(src, t.srcAccount) + note, text: '-' + money(t.srcQty, t.srcSymbol, { plain: false }), kind: '' };
    }
    case '收入': {
      const c = categoryInfo(t.categoryId);
      return { icon: c.icon, color: c.color, title: c.name, sub: an(dst, t.dstAccount) + note, text: '+' + money(t.dstQty, t.dstSymbol), kind: 'pos' };
    }
    case '退款': {
      const c = categoryInfo(t.categoryId);
      return { icon: 'undo', color: c.color, title: '退款 · ' + c.short, sub: an(dst, t.dstAccount) + note, text: '+' + money(t.dstQty, t.dstSymbol), kind: '' };
    }
    case '轉帳':
      return { icon: 'transfer', title: '轉帳', sub: `${an(src, t.srcAccount)} → ${an(dst, t.dstAccount)}` + note, text: money(t.srcQty, t.srcSymbol), kind: 'mute' };
    case '換匯': {
      const rate = t.srcQty && t.dstQty ? rateText(t) : '';
      return { icon: 'exchange', title: `換匯 ${t.srcSymbol} → ${t.dstSymbol}`, sub: `${an(src, t.srcAccount)} → ${an(dst, t.dstAccount)}${rate ? ' · ' + rate : ''}` + note, text: money(t.dstQty, t.dstSymbol), kind: 'mute' };
    }
    case '調整': {
      const up = !!t.dstAccount;
      return { icon: 'sliders', title: '餘額調整', sub: an(up ? dst : src, up ? t.dstAccount : t.srcAccount) + note,
        text: (up ? '+' : '-') + money(up ? t.dstQty : t.srcQty, up ? t.dstSymbol : t.srcSymbol), kind: 'mute' };
    }
    default:
      return { icon: 'dots', title: t.type, sub: note.slice(3), text: '', kind: 'mute' };
  }
}

function rateText(t) {
  // 匯率 = 以台幣（或較大單位）表示的價格；只在其中一邊是 TWD 時顯示「1 外幣 = x TWD」
  const twdSide = t.srcSymbol === 'TWD' ? 'src' : t.dstSymbol === 'TWD' ? 'dst' : '';
  if (!twdSide) return '';
  const twd = twdSide === 'src' ? t.srcQty : t.dstQty, fx = twdSide === 'src' ? t.dstQty : t.srcQty, fxSym = twdSide === 'src' ? t.dstSymbol : t.srcSymbol;
  return `1 ${fxSym} ≈ ${FinMoney.format(twd / fx, 3, { trim: true })} TWD`;
}

export function txRow(t) {
  const d = describe(t);
  return h('button', { class: 'item' + (t.status === '作廢' ? ' voided' : ''), onclick: () => openTxDetail(t) },
    h('div', { class: 'ico', style: d.color ? catIconStyle(d.color) : null }, icon(d.icon)),
    h('div', { class: 'grow' }, h('div', { class: 't' }, d.title, t.status !== '有效' ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, t.status) : null), h('div', { class: 's' }, d.sub)),
    h('div', { class: amountClass(d.kind) }, d.text));
}

export function groupRows(items) {
  const groups = [];
  for (const t of items) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== t.date) { g = { date: t.date, label: dateLabel(t.date, state.data.today), items: [] }; groups.push(g); }
    g.items.push(t);
  }
  return groups;
}

// ---------- 交易詳情 ----------
export function openTxDetail(t) {
  const d = describe(t);
  const src = accountById(t.srcAccount), dst = accountById(t.dstAccount);
  const rows = [['日期', dateLabel(t.date, state.data.today)], ['類型', t.type + (t.status !== '有效' ? `（${t.status}）` : '')]];
  if (t.srcAccount) rows.push([t.type === '調整' ? '調少' : '轉出／付款', `${src ? src.name : t.srcAccount}　${money(t.srcQty, t.srcSymbol, { noMask: true })}`]);
  if (t.dstAccount) rows.push([t.type === '調整' ? '調多' : '轉入／入帳', `${dst ? dst.name : t.dstAccount}　${money(t.dstQty, t.dstSymbol, { noMask: true })}`]);
  if (t.categoryId && t.type !== '調整') rows.push(['分類', categoryInfo(t.categoryId).name]);
  if (t.merchant) rows.push(['商家', t.merchant]);
  if (t.fxSymbol && t.fxQty) rows.push(['原幣金額', money(t.fxQty, t.fxSymbol, { noMask: true })]);
  if (t.tags) rows.push(['標籤', h('span', null, String(t.tags).split(',').map((x) => h('span', { class: 'badge', style: { marginRight: '4px' } }, x)))]);
  if (t.note) rows.push(['備註', t.note]);
  rows.push(['編號', t.id], ['更新時間', t.updatedAt]);
  const dl = h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));

  const sheet = openSheet({ title: d.title, body: h('div', null, h('div', { class: 'center', style: { margin: '-4px 0 12px' } }, h('div', { class: amountClass(d.kind), style: { fontSize: '26px' } }, d.text)), dl) });
  const btn = (label, cls, fn) => h('button', { class: 'btn btn-sm ' + cls, onclick: fn }, label);
  const actions = h('div', { class: 'row-flex wrap', style: { marginTop: '16px' } });
  if (t.status === '有效' || t.status === '待確認') {
    actions.appendChild(btn('編輯', '', () => { sheet.close(); setTimeout(() => openTxForm({ tx: t }), 0); }));
    if (t.type === '支出') actions.appendChild(btn('退款', '', () => { sheet.close(); setTimeout(() => openTxForm({ preset: { type: '退款', related: t } }), 0); }));
    actions.appendChild(btn('作廢', 'btn-danger', async (e) => {
      const button = e.currentTarget; // 事件結束後 currentTarget 會變成 null，要先存起來
      if (!(await confirmDialog({ title: '作廢這筆交易？', message: '作廢後不會計入餘額與報表，之後可以在交易清單「顯示已作廢」中還原。', confirmText: '作廢', danger: true }))) return;
      await mutate(button, 'voidTransaction', t, sheet, '已作廢');
    }));
  } else if (t.status === '作廢') {
    actions.appendChild(btn('還原', 'btn-primary', (e) => mutate(e.currentTarget, 'restoreTransaction', t, sheet, '已還原')));
  }
  sheet.el.appendChild(actions);
}

// 作廢／還原：關視窗、先在本機把這筆的影響加回或扣掉（樂觀更新），背景送出；失敗自動還原並提示
async function mutate(button, action, t, sheet, doneText) {
  sheet.close();
  const next = Object.assign({}, t, { status: action === 'voidTransaction' ? '作廢' : '有效' });
  const r = await write(action, { id: t.id, expectedUpdatedAt: t.updatedAt }, {
    optimistic: () => applyTxLocal(next, t),
    retry: () => mutate(button, action, t, { close() {} }, doneText),
    failPrefix: '操作失敗，已還原：',
  });
  if (r) toast(doneText);
}

// ---------- 交易清單 ----------
const S = { ym: null, filters: { type: '', accountId: '', categoryId: '', q: '', includeVoid: false }, seq: 0, acctParam: null, cache: null /* 上一次的查詢結果 { key, list, sum }：重畫時先顯示，避免每次都閃「載入中…」 */ };

export function renderTransactions(root, route) {
  const d = state.data;
  if (!S.ym) S.ym = d.today.slice(0, 7);
  if (route.params.acct !== undefined && route.params.acct !== S.acctParam) { S.acctParam = route.params.acct; S.filters.accountId = route.params.acct || ''; }

  const summaryBox = h('div', { class: 'stats', style: { marginTop: '8px' } });
  const listBox = h('div', null);
  const monthLabelEl = h('div', { class: 'm' }, monthLabel(S.ym));

  const shiftMonth = (n) => { S.ym = FinDates.addMonths(S.ym, n); monthLabelEl.textContent = monthLabel(S.ym); load(); };

  const typeSel = h('select', { 'aria-label': '類型', onchange: (e) => { S.filters.type = e.target.value; load(); } },
    h('option', { value: '' }, '全部類型'), d.enabledTxTypes.map((t) => h('option', { value: t, selected: S.filters.type === t }, t)));
  const acctSel = h('select', { 'aria-label': '帳戶', onchange: (e) => { S.filters.accountId = e.target.value; load(); } },
    h('option', { value: '' }, '全部帳戶'), d.accounts.map((a) => h('option', { value: a.id, selected: S.filters.accountId === a.id }, a.name + (a.active ? '' : '（停用）'))));
  const catOptions = [];
  d.categories.filter((c) => !c.parentId && c.type !== '系統').forEach((p) => {
    catOptions.push(h('option', { value: p.id, selected: S.filters.categoryId === p.id }, p.name));
    d.categories.filter((c) => c.parentId === p.id).forEach((c) => catOptions.push(h('option', { value: c.id, selected: S.filters.categoryId === c.id }, `　${c.name}`)));
  });
  const catSel = h('select', { 'aria-label': '分類', onchange: (e) => { S.filters.categoryId = e.target.value; load(); } }, h('option', { value: '' }, '全部分類'), catOptions);
  let timer = null;
  const search = h('input', { type: 'search', placeholder: '搜尋', value: S.filters.q, 'aria-label': '搜尋',
    oninput: (e) => { clearTimeout(timer); const v = e.target.value; timer = setTimeout(() => { S.filters.q = v; load(); }, 250); } });
  const voidToggle = h('label', { class: 'check small muted full' }, h('input', { type: 'checkbox', checked: S.filters.includeVoid, onchange: (e) => { S.filters.includeVoid = e.target.checked; load(); } }), '顯示已作廢的交易');

  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '交易')),
    h('div', { class: 'card' },
      h('div', { class: 'month-nav' },
        h('button', { class: 'icon-btn', 'aria-label': '上個月', onclick: () => shiftMonth(-1) }, icon('left')), monthLabelEl,
        h('button', { class: 'icon-btn', 'aria-label': '下個月', onclick: () => shiftMonth(1) }, icon('right'))),
      summaryBox,
      h('div', { class: 'filters' }, typeSel, acctSel, catSel, search, voidToggle)),
    h('div', { class: 'card', style: { marginTop: '12px' } }, listBox));

  function render(list, sum) {
      const m = (k, v, kind) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (kind === 'pos' ? 'amt-pos' : '') }, v));
      mount(summaryBox, m('收入', money(sum.income, sum.base), 'pos'), m('支出', money(sum.expense, sum.base)), m('結餘', money(sum.net, sum.base, { sign: true }), sum.net > 0 ? 'pos' : ''));
      clear(listBox);
      if (S.filters.q.trim()) listBox.appendChild(h('div', { class: 'muted small', style: { padding: '8px 2px 2px' }, 'data-testid': 'search-scope' }, `搜尋「${S.filters.q.trim()}」：全部期間共 ${list.total} 筆`));
      if (!list.items.length) {
        listBox.appendChild(h('div', { class: 'empty' }, h('div', { class: 'big' }, icon('list')), S.filters.q || S.filters.type || S.filters.accountId || S.filters.categoryId ? '沒有符合條件的交易' : '這個月還沒有交易'));
        return;
      }
      for (const g of groupRows(list.items)) {
        listBox.appendChild(h('div', { class: 'day-head' }, h('span', null, g.label)));
        listBox.appendChild(h('ul', { class: 'list' }, g.items.map((t) => h('li', null, txRow(t)))));
      }
      if (list.total > list.items.length) listBox.appendChild(h('div', { class: 'muted small center', style: { padding: '10px' } }, `只顯示最新 ${list.items.length} 筆（共 ${list.total} 筆），請縮小篩選範圍`));
  }

  async function load() {
    const my = ++S.seq;
    const range = FinDates.monthRange(S.ym);
    const key = S.ym + '|' + JSON.stringify(S.filters);
    // 同一組條件剛查過：先畫上次的結果（畫面不會閃），背景再重查
    if (S.cache && S.cache.key === key) render(S.cache.list, S.cache.sum);
    else mount(listBox, h('div', { class: 'empty' }, '載入中…'));
    try {
      // 有關鍵字時搜尋全部期間（不限當月），像其他記帳軟體的全域搜尋；沒有關鍵字才照月份列
      const allTime = !!S.filters.q.trim();
      const [list, sum] = await Promise.all([
        api.call('listTransactions', { filters: { ...(allTime ? {} : { from: range.from, to: range.to }), ...S.filters }, limit: 500 }),
        api.call('monthSummary', { ym: S.ym }),
      ]);
      if (my !== S.seq) return;
      S.cache = { key, list, sum };
      render(list, sum);
    } catch (e) {
      if (my !== S.seq) return;
      mount(listBox, h('div', { class: 'notice bad' }, errorText(e)));
    }
  }
  load();
}
