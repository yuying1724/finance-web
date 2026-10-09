import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { money } from '../fmt.js';
import { pendingRow, groupPending, checkDividendsNow } from './recurring.js';
import { cardRow, openPayForm } from './cards.js';

/**
 * 待辦頁：所有要你處理的事放在一起。
 *  - 現在要處理：日期已到（或已過）的待確認交易、已逾期或 7 天內到期的信用卡帳單
 *  - 還沒到日子：日期還沒到的待確認（例如股息預估下個月才發放，提前入帳也可以先確認）、7 天後才到期的信用卡帳單
 * 底部分頁的數字徽章只算「現在要處理」。
 */
const CARD_SOON_DAYS = 7;

export function todoBuckets() {
  const d = state.data;
  if (!d) return { nowP: [], laterP: [], nowC: [], laterC: [] };
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
  return { nowP, laterP, nowC, laterC };
}

/** 底部「待辦」分頁的徽章數字：現在要處理的件數 */
export function todoCount() {
  const b = todoBuckets();
  return b.nowP.length + b.nowC.length;
}

function cardTodoRow(item) {
  return h('li', { 'data-testid': 'todo-card-due' }, h('div', { class: 'row-flex', style: { gap: '6px', alignItems: 'center' } },
    h('div', { class: 'grow', style: { minWidth: 0 } }, cardRow(item, true)),
    h('button', { class: 'btn btn-sm btn-primary', 'data-testid': 'todo-pay', onclick: () => openPayForm(item) }, '繳款')));
}

function section(title, hint, cardItems, pendingGroups, testid) {
  const n = cardItems.length + pendingGroups.length;
  const rows = [].concat(cardItems.map(cardTodoRow), pendingGroups.map((g) => h('li', null, pendingRow(g))));
  return h('div', { class: 'card', 'data-testid': testid },
    h('div', { class: 'card-title' }, h('h2', null, `${title}（${n}）`)),
    hint ? h('div', { class: 'muted small', style: { margin: '-4px 0 6px' } }, hint) : null,
    n ? h('ul', { class: 'list' }, rows) : h('div', { class: 'muted', style: { padding: '8px 0' } }, title === '現在要處理' ? '目前沒有要處理的事' : '沒有'));
}

export function renderTodo(root) {
  const b = todoBuckets();
  const d = state.data;
  const total = (d.pendingConfirmations || []).length;
  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, '待辦'),
      h('button', { class: 'btn btn-sm', 'data-testid': 'check-dividends', onclick: (e) => checkDividendsNow(e.currentTarget) }, icon('coin'), '檢查股息')),
    section('現在要處理', '日期到了的待確認，與 7 天內到期的信用卡帳單', b.nowC, b.nowP, 'todo-now'),
    section('還沒到日子', '預估日期還沒到，先不用處理；如果已經提前入帳，也可以先確認', b.laterC, b.laterP, 'todo-later'),
    total ? null : h('div', { class: 'muted small', style: { textAlign: 'center', marginTop: '8px' } }, `定期交易、薪資、股息到期時會自動出現在這裡（信用卡待繳合計 ${money(((d.cardOverview || {}).totalDue) || 0, d.base)}）`));
}
