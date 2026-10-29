import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { money } from '../fmt.js';
import { pendingRow, groupPending, checkDividendsNow } from './recurring.js';
import { cardRow, openPayForm } from './cards.js';
import { openCollect } from './accounts.js';
import { topupShort, openCashflow } from './cashflow.js';

/**
 * 待辦頁：所有要你處理的事放在一起。
 *  - 現在要處理：7 天內可能不夠扣款的帳戶（放最上面）、日期已到（或已過）的待確認交易、已逾期或 7 天內到期的信用卡帳單
 *  - 還沒到日子：日期還沒到的待確認（例如股息預估下個月才發放，提前入帳也可以先確認）、7 天後才到期的信用卡帳單、
 *    8～30 天後才會不夠扣款的帳戶（標「提前準備」；多半是信用卡本期預估，金額還會變）
 *  - 代墊還沒收回：「應收」帳戶（例如「代墊款」）還有餘額，代表別人還欠你錢（不算進徽章，免得一直掛著數字）
 * 底部分頁的數字徽章只算「現在要處理」。
 */
const CARD_SOON_DAYS = 7;
const SHORT_SOON_DAYS = 7;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function md(d) { const t = new Date(d + 'T00:00:00Z'); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）`; }
function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

/** 還有餘額（別人還欠你）的應收帳戶 */
export function receivables() {
  const d = state.data;
  if (!d) return [];
  return d.accounts.filter((a) => a.type === '應收' && a.active)
    .map((a) => ({ account: a, items: d.balances.filter((b) => b.accountId === a.id && b.qty > 0) }))
    .filter((x) => x.items.length);
}

export function todoBuckets() {
  const d = state.data;
  if (!d) return { nowP: [], laterP: [], nowC: [], laterC: [], nowS: [], laterS: [] };
  const today = d.today;
  const groups = groupPending(d.pendingConfirmations || []);
  const nowP = groups.filter((g) => g[0].date <= today);
  const laterP = groups.filter((g) => g[0].date > today);
  const cards = ((d.cardOverview || {}).items || []).filter((x) => x.hasSettings && x.statementAmountDue > 0 && !x.dueLikelyNextPeriod);
  const isSoon = (x) => x.overdue || (x.dueInDays !== null && x.dueInDays !== undefined && x.dueInDays <= CARD_SOON_DAYS);
  const nowC = cards.filter(isSoon);
  const laterC = cards.filter((x) => !isSoon(x));
  const byDate = (a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0);
  nowC.sort(byDate); laterC.sort(byDate);
  // 可能不夠扣款的帳戶（未來 30 天，來自 bootstrap cashAlert）：7 天內的要現在處理，之後的先提前準備
  const shorts = (((d.cashAlert || {}).short) || []).slice().sort((a, b) => (a.shortDate < b.shortDate ? -1 : a.shortDate > b.shortDate ? 1 : 0));
  const soonEnd = addDays(today, SHORT_SOON_DAYS);
  const nowS = shorts.filter((x) => x.shortDate <= soonEnd);
  const laterS = shorts.filter((x) => x.shortDate > soonEnd);
  return { nowP, laterP, nowC, laterC, nowS, laterS };
}

/** 底部「待辦」分頁的徽章數字：現在要處理的件數 */
export function todoCount() {
  const b = todoBuckets();
  return b.nowP.length + b.nowC.length + b.nowS.length;
}

function cardTodoRow(item) {
  return h('li', { 'data-testid': 'todo-card-due' }, h('div', { class: 'row-flex', style: { gap: '6px', alignItems: 'center' } },
    h('div', { class: 'grow', style: { minWidth: 0 } }, cardRow(item, true)),
    h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'todo-pay', onclick: () => openPayForm(item) }, '繳款')));
}

/** 可能不夠扣款的帳戶：哪天、為了扣什麼、還差多少；「轉帳補足」帶好轉出／轉入／金額 */
function shortTodoRow(s, later) {
  return h('li', { 'data-testid': later ? 'todo-short-later' : 'todo-short', 'data-account': s.name }, h('div', { class: 'item' },
    h('div', { class: 'ico', style: later ? null : { color: 'var(--bad)' } }, icon('alert')),
    h('div', { class: 'grow', style: { minWidth: 0 } },
      h('div', { class: 't' }, `${s.name} 可能不夠扣款`, later ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, '提前準備') : null),
      h('div', { class: 's' }, `${md(s.shortDate)}${s.reason ? '・' + s.reason : ''}`)),
    h('div', { class: 'amt amt-due', style: { marginRight: '8px', whiteSpace: 'nowrap' } }, '差 ' + money(Math.ceil(s.shortfall), s.symbol)),
    h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'todo-topup', onclick: () => topupShort(s) }, '轉帳補足')));
}

function section(title, hint, cardItems, pendingGroups, testid, shorts = [], laterShorts = false) {
  const n = cardItems.length + pendingGroups.length + shorts.length;
  const rows = [].concat(shorts.map((x) => shortTodoRow(x, laterShorts)), cardItems.map(cardTodoRow), pendingGroups.map((g) => h('li', null, pendingRow(g))));
  return h('div', { class: 'card', 'data-testid': testid },
    h('div', { class: 'card-title' }, h('h2', null, `${title}（${n}）`)),
    hint ? h('div', { class: 'muted small', style: { margin: '-4px 0 6px' } }, hint) : null,
    n ? h('ul', { class: 'list' }, rows) : h('div', { class: 'muted', style: { padding: '8px 0' } }, title === '現在要處理' ? '目前沒有要處理的事' : '沒有'));
}

function receivableSection() {
  const list = receivables();
  if (!list.length) return null;
  return h('div', { class: 'card', 'data-testid': 'todo-receivable' },
    h('div', { class: 'card-title' }, h('h2', null, `代墊還沒收回（${list.length}）`)),
    h('div', { class: 'muted small', style: { margin: '-4px 0 6px' } }, '別人還欠你的錢；對方還錢時按「收回」，選錢進到哪個帳戶'),
    h('ul', { class: 'list' }, list.map((x) => h('li', null, h('div', { class: 'item' },
      h('div', { class: 'ico' }, icon('arrowDownCircle')),
      h('div', { class: 'grow' }, h('div', { class: 't' }, x.account.name)),
      h('div', { class: 'amt', style: { marginRight: '8px' } }, x.items.map((b) => money(b.qty, b.symbol)).join('、')),
      h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'todo-collect', onclick: () => openCollect(x.account) }, '收回'))))));
}

export function renderTodo(root) {
  const b = todoBuckets();
  const d = state.data;
  const total = (d.pendingConfirmations || []).length;
  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '待辦'),
      h('button', { class: 'btn btn-sm', 'data-testid': 'check-dividends', onclick: (e) => checkDividendsNow(e.currentTarget) }, icon('coin'), '檢查股息')),
    section('現在要處理', '7 天內可能不夠扣款的帳戶、日期到了的待確認，與 7 天內到期的信用卡帳單', b.nowC, b.nowP, 'todo-now', b.nowS),
    receivableSection(),
    section('還沒到日子', '預估日期還沒到，先不用處理；如果已經提前入帳，也可以先確認。「提前準備」是 8～30 天後可能不夠扣款的帳戶（信用卡本期是預估，金額還會變）', b.laterC, b.laterP, 'todo-later', b.laterS, true),
    h('div', { style: { textAlign: 'center', marginTop: '8px' } },
      h('button', { class: 'link-btn', type: 'button', 'data-testid': 'todo-open-cashflow', onclick: () => openCashflow() }, '未來扣款日曆（各帳戶夠不夠扣）')),
    total ? null : h('div', { class: 'muted small', style: { textAlign: 'center', marginTop: '8px' } }, `定期交易、薪資、股息到期時會自動出現在這裡（信用卡待繳合計 ${money(((d.cardOverview || {}).totalDue) || 0, d.base)}）`));
}
